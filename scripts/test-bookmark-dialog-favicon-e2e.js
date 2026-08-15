/**
 * E2E：书签对话框「识别网址图标 + 保存图标」
 *
 * 验证（临时 userData 隔离）：
 *   1. 打开书签对话框（点击工具栏星标）→ 网址栏左侧图标预览自动识别出历史知识库中的真实图标
 *   2. 修改网址 → 预览图标随之重新识别（站点根 /favicon.ico）
 *   3. 点击保存 → 书签持久化图标为识别结果
 *
 * 方法：路由拦截图标请求返回 1x1 PNG + addInitScript 捕获 img 首次赋值 src，
 * 不依赖真实网络，确定性验证。
 *
 * 运行：node scripts/test-bookmark-dialog-favicon-e2e.js
 */
const path = require('path');
const fs = require('fs');

let playwright;
try { playwright = require('playwright-core'); }
catch (e) { playwright = require(path.join(process.env.APPDATA, 'npm', 'node_modules', 'playwright-core')); }
const { _electron } = playwright;

const APP_DIR = path.join(__dirname, '..');
const USER_DATA = path.join(APP_DIR, '.e2e-tmp-dlg-favicon');
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok });
  console.log((ok ? '✅' : '❌') + ' ' + name + (detail ? ' — ' + detail : ''));
}

async function main() {
  fs.rmSync(USER_DATA, { recursive: true, force: true });
  const dataDir = path.join(USER_DATA, 'NeutronBrowser');
  fs.mkdirSync(dataDir, { recursive: true });

  // 空书签栏
  fs.writeFileSync(path.join(dataDir, 'bookmarks.json'), JSON.stringify({
    bookmark_bar: { id: 'bookmark_bar', title: '书签栏', type: 'folder', children: [] },
    other: { id: 'other', title: '其他书签', type: 'folder', children: [] },
    mobile: { id: 'mobile', title: '移动设备书签', type: 'folder', children: [] },
  }, null, 2));
  // 历史：example.com 与 example.net 各有真实图标（非根目录路径，验证知识库优先）
  fs.writeFileSync(path.join(dataDir, 'history.json'), JSON.stringify({
    visits: [
      { id: 'hist_1', url: 'https://example.com/', title: 'Example', favicon: 'https://example.com/icons/app-32.png', visitCount: 1, firstVisitTime: Date.now(), lastVisitTime: Date.now() },
      { id: 'hist_2', url: 'https://example.net/', title: 'Example Net', favicon: 'https://example.net/icons/app-32.png', visitCount: 1, firstVisitTime: Date.now(), lastVisitTime: Date.now() },
    ],
  }, null, 2));

  const electronApp = await _electron.launch({
    executablePath: path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe'),
    args: [APP_DIR, `--user-data-dir=${USER_DATA}`],
    env: { ...process.env },
  });

  let page = null;
  for (const w of await electronApp.windows()) {
    if (String(w.url()).includes('app.html')) { page = w; break; }
  }
  if (!page) throw new Error('main window (app.html) not found');

  // 路由：站点真实图标（非根路径 .png）返回 PNG，其余图标 404
  const okUrls = [
    'https://example.com/icons/app-32.png',
    'https://example.net/icons/app-32.png',
  ];
  const seen = {};
  await page.route('**/*', (route) => {
    const url = route.request().url();
    seen[url] = (seen[url] || 0) + 1;
    if (okUrls.some(u => url.startsWith(u))) {
      route.fulfill({ status: 200, contentType: 'image/png', body: TINY_PNG });
    } else if (/favicon|icons\.duckduckgo|s2\.favicons/i.test(url)) {
      route.fulfill({ status: 404, contentType: 'text/plain', body: 'nope' });
    } else {
      route.continue();
    }
  });
  page.on('console', (msg) => {
    const t = msg.text();
    if (/favicon|icon|bookmark|error/i.test(t)) console.log('[page]', t);
  });

  // 捕获每个 img 首次赋值的 src（mount 在 appendChild 前赋值，用 dataset 标记）
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

  // addInitScript 需在重载后生效（补丁在导航时注入）——先重载，再创建标签
  await page.reload();
  await new Promise(r => setTimeout(r, 3500));

  // 打开一个真实网页标签（让 currentUrl 生效，再点星标打开对话框）
  await electronApp.evaluate(`(async function(){
    const wm = global.windowManager;
    if (wm && wm.createTab) wm.createTab('https://example.com/');
    return true;
  })()`);
  await new Promise(r => setTimeout(r, 2500));

  // 确认当前网址已生效（地址栏显示 example.com）
  const addr = await page.evaluate(() => (document.getElementById('addressInput') || {}).value || '');
  console.log('ADDR', JSON.stringify(addr));
  if (addr.indexOf('example.com') === -1) {
    console.log('address not set, bail');
    await electronApp.close().catch(() => {});
    process.exit(1);
  }

  // 点击工具栏星标按钮打开「添加书签」对话框
  await page.evaluate(() => {
    const b = document.getElementById('btnBookmark');
    if (b) b.click();
    return !!b;
  });
  await new Promise(r => setTimeout(r, 1200));

  const dialogState = await page.evaluate(() => {
    const icon = document.querySelector('#bookmarkUrlIcon img');
    return {
      open: document.getElementById('bookmarkDialog').style.display,
      url: document.getElementById('bookmarkUrl').value,
      iconSrc: icon ? (window.__favMap[icon.dataset.favFirst] || '') : '',
    };
  });
  check('1 对话框已打开且网址正确', dialogState.open === 'flex' && dialogState.url === 'https://example.com/', JSON.stringify(dialogState));
  check('2 打开时自动识别历史知识库图标', dialogState.iconSrc.indexOf('icons/app-32.png') !== -1, JSON.stringify(dialogState));

  // 修改网址 → 图标重新识别为 example.net 的真实图标（非根路径，走路由确定）
  await page.evaluate(() => {
    const input = document.getElementById('bookmarkUrl');
    input.value = 'https://example.net/';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await new Promise(r => setTimeout(r, 1500));
  const afterEdit = await page.evaluate(() => {
    const icon = document.querySelector('#bookmarkUrlIcon img');
    return { iconSrc: icon ? (window.__favMap[icon.dataset.favFirst] || '') : '', text: document.getElementById('bookmarkUrlIcon').textContent };
  });
  check('3 修改网址后重新识别图标', afterEdit.iconSrc.indexOf('example.net/icons/app-32.png') !== -1, JSON.stringify(afterEdit));

  // 点击保存 → 书签持久化识别到的图标
  await page.evaluate(() => {
    const b = document.getElementById('bookmarkDialogSave');
    if (b) b.click();
    return !!b;
  });
  await new Promise(r => setTimeout(r, 1200));
  const saved = await page.evaluate(() =>
    window.NeutronBrowser.getBookmarks().then((b) =>
      (b.bookmark_bar && b.bookmark_bar.children || []).map((c) => ({ url: c.url, favicon: c.favicon }))
    )
  );
  const savedBm = (saved || []).find((s) => s.url === 'https://example.net/') || {};
  check('4 保存后书签带图标（example.net/icons/app-32.png）', savedBm.favicon && savedBm.favicon.indexOf('example.net/icons/app-32.png') !== -1, JSON.stringify(saved));
  // 书签栏对应项应显示该图标
  const barIcon = await page.evaluate(() => {
    const item = document.querySelector('#bookmarkBarItems .bookmark-item');
    if (!item) return '';
    const img = item.querySelector('.bookmark-item__icon img');
    return img ? (window.__favMap[img.dataset.favFirst] || img.getAttribute('src') || '') : '';
  });
  check('5 书签栏显示保存的图标', barIcon.indexOf('example.net/icons/app-32.png') !== -1, JSON.stringify(barIcon));

  const failed = results.filter(r => !r.ok);
  console.log('--- 拦截到的图标请求 ---');
  Object.entries(seen).forEach(([u, c]) => { if (/favicon|duckduckgo|s2\.favicons|app-32/i.test(u)) console.log(c + 'x', u); });
  console.log(failed.length ? `\n❌ FAIL ${failed.length} 项` : '\n✅ ALL PASS');

  await electronApp.close().catch(() => {});
  fs.rmSync(USER_DATA, { recursive: true, force: true });
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
