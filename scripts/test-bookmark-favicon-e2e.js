/**
 * E2E：书签栏网站图标智能解析
 *
 * 验证场景（临时 userData 隔离，不污染真实数据）：
 *   A. 空图标书签 + 历史有真实图标 → 优先使用历史真实图标（icons/app-32.png）
 *   B. 空图标书签 + 无历史 → 回退到站点根 /favicon.ico
 *   C. 已存可信图标书签 → 优先显示已存图标（github.com/favicon.ico）
 *
 * 方法：通过 addInitScript 在页面加载前给 HTMLImageElement.src 打补丁，
 * 同步捕获书签栏每个图标元素被赋值的【首个 src】（即候选链第一项）。
 * 完全确定：不依赖网络可用性、HTTP/内存缓存、路由拦截。
 *
 * 运行：node scripts/test-bookmark-favicon-e2e.js
 */
const path = require('path');
const fs = require('fs');

let playwright;
try { playwright = require('playwright-core'); }
catch (e) { playwright = require(path.join(process.env.APPDATA, 'npm', 'node_modules', 'playwright-core')); }
const { _electron } = playwright;

const APP_DIR = path.join(__dirname, '..');
const USER_DATA = path.join(APP_DIR, '.e2e-tmp-favicon');

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok });
  console.log((ok ? '✅' : '❌') + ' ' + name + (detail ? ' — ' + detail : ''));
}

async function main() {
  fs.rmSync(USER_DATA, { recursive: true, force: true });
  const dataDir = path.join(USER_DATA, 'NeutronBrowser');
  fs.mkdirSync(dataDir, { recursive: true });

  fs.writeFileSync(path.join(dataDir, 'bookmarks.json'), JSON.stringify({
    bookmark_bar: {
      id: 'bookmark_bar', title: '书签栏', type: 'folder',
      children: [
        { id: 'bm_a', title: 'Example', type: 'bookmark', url: 'https://example.com/', parentId: 'bookmark_bar', dateAdded: 1, favicon: '' },
        { id: 'bm_b', title: 'Example Org', type: 'bookmark', url: 'https://example.org/', parentId: 'bookmark_bar', dateAdded: 1, favicon: '' },
        { id: 'bm_c', title: 'GitHub', type: 'bookmark', url: 'https://github.com/', parentId: 'bookmark_bar', dateAdded: 1, favicon: 'https://github.com/favicon.ico' },
      ],
    },
    other: { id: 'other', title: '其他书签', type: 'folder', children: [] },
    mobile: { id: 'mobile', title: '移动设备书签', type: 'folder', children: [] },
  }, null, 2));

  // 历史：example.com 有真实图标（非根目录路径，用于验证优先级与知识库命中）
  fs.writeFileSync(path.join(dataDir, 'history.json'), JSON.stringify({
    visits: [
      { id: 'hist_1', url: 'https://example.com/', title: 'Example', favicon: 'https://example.com/icons/app-32.png', visitCount: 1, firstVisitTime: Date.now(), lastVisitTime: Date.now() },
    ],
  }, null, 2));

  const electronApp = await _electron.launch({
    executablePath: path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe'),
    args: [APP_DIR, `--user-data-dir=${USER_DATA}`],
    env: { ...process.env },
  });

  // 找到主窗口（书签栏所在页面）
  let page = null;
  for (const w of await electronApp.windows()) {
    if (String(w.url()).includes('app.html')) { page = w; break; }
  }
  if (!page) throw new Error('main window (app.html) not found');

  // 页面加载前补丁：在 img 元素上标记并记录其【首次被赋值的 src】（候选链第一项）。
  // 注意 mountBookmarkIcon 在 appendChild 前就赋值 src，此时元素不在 DOM，
  // 不能靠 closest('.bookmark-item') 定位，改为在元素上打 data 标记 + 全局映射。
  await page.addInitScript(() => {
    window.__favMap = {};
    window.__favCounter = 0;
    const desc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
    Object.defineProperty(HTMLImageElement.prototype, 'src', {
      get() { return desc.get.call(this); },
      set(v) {
        desc.set.call(this, v);
        try {
          if (!this.dataset.favFirst) {
            const key = 'f' + (window.__favCounter++);
            this.dataset.favFirst = key;
            window.__favMap[key] = String(v);
          }
        } catch (e) { /* 忽略 */ }
      },
      configurable: true,
    });
  });

  // 重载：让补丁在 init 渲染书签栏前生效（只捕获赋值，不受网络/缓存影响）
  await page.reload();
  // 等待 init（含 ensureFaviconCache 历史知识库预载）完成
  await new Promise(r => setTimeout(r, 4000));

  const captured = await page.evaluate(() => {
    const out = {};
    document.querySelectorAll('#bookmarkBarItems .bookmark-item').forEach((el) => {
      const img = el.querySelector('.bookmark-item__icon img');
      if (img && img.dataset.favFirst) {
        out[el.dataset.bookmarkId] = window.__favMap[img.dataset.favFirst] || '';
      }
    });
    return out;
  });
  const hist = captured['bm_a'] || '';
  const plain = captured['bm_b'] || '';
  const stored = captured['bm_c'] || '';

  check('A 空图标书签优先使用历史真实图标', hist.indexOf('icons/app-32.png') !== -1, JSON.stringify(captured));
  check('B 无历史书签回退站点根 /favicon.ico', plain.indexOf('example.org/favicon.ico') !== -1, JSON.stringify(captured));
  check('C 已存可信图标书签优先显示', stored.indexOf('github.com/favicon.ico') !== -1, JSON.stringify(captured));

  const failed = results.filter(r => !r.ok);
  console.log(failed.length ? `\n❌ FAIL ${failed.length} 项` : '\n✅ ALL PASS');

  await electronApp.close().catch(() => {});
  fs.rmSync(USER_DATA, { recursive: true, force: true });
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
