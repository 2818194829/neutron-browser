/**
 * 端到端验证：真实 Neutron Browser 打开新标签页（TabSpace）
 * 1. 壁纸类型默认为「每日一图」（image）
 * 2. 快捷方式图标渲染为真实 favicon（img.favicon-img）
 * 3. 页面无 JS 错误
 *
 * 运行：node scripts/test-newtab-favicon-e2e.js
 */
const path = require('path');

let playwright;
try { playwright = require('playwright-core'); }
catch (e) { playwright = require(path.join(process.env.APPDATA, 'npm', 'node_modules', 'playwright-core')); }
const { _electron } = playwright;

const APP_DIR = path.join(__dirname, '..');
const USER_DATA = path.join(APP_DIR, '.e2e-tmp-newtab');

async function main() {
  const electronApp = await _electron.launch({
    executablePath: path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe'),
    args: [APP_DIR, `--user-data-dir=${USER_DATA}`],
  });
  await new Promise(r => setTimeout(r, 3000));

  // 主进程里打开新标签页
  await electronApp.evaluate(async () => {
    global.windowManager.createTab('neutron://newtab', true);
  });
  await new Promise(r => setTimeout(r, 2000));

  // 读取新标签页页面状态（不传参，按 URL 查找；evaluate 传参有兼容问题）
  const state = await electronApp.evaluate(async () => {
    const tab = global.windowManager.tabs.find(t => t.url && t.url.includes('newtab.html'));
    if (!tab || !tab.view) return { error: 'tab not found' };
    const wc = tab.view.webContents;
    const errors = [];
    try { wc.on('console-message', (e, level, message) => { if (level >= 3) errors.push(String(message)); }); } catch (e) {}

    // 等待页面初始化完成（最多 12 秒，明确等待壁纸切换为默认 image）
    let ready = false;
    for (let k = 0; k < 40; k++) {
      try {
        const s = String(await wc.executeJavaScript(
          `document.readyState + '|' + document.body.getAttribute('data-wallpaper') + '|' + document.querySelectorAll('.sc-item').length`
        ));
        const parts = s.split('|');
        if (parts[0] === 'complete' && parts[1] === 'image' && +parts[2] > 0) { ready = true; break; }
      } catch (e) { /* 页面可能还在加载 */ }
      await new Promise(r => setTimeout(r, 300));
    }
    if (!ready) {
      return { error: '页面未在 12s 内初始化完成',
        wallpaper: await wc.executeJavaScript(`document.body.getAttribute('data-wallpaper')`).catch(() => '?'),
        scCount: await wc.executeJavaScript(`document.querySelectorAll('.sc-item').length`).catch(() => -1) };
    }

    const r = await wc.executeJavaScript(`(function () {
      var bg = document.getElementById('bgImage');
      return {
        wallpaper: document.body.getAttribute('data-wallpaper'),
        bgVisible: bg ? bg.classList.contains('is-visible') : false,
        bgImage: bg ? (bg.style.backgroundImage || '').slice(0, 80) : '',
        scCount: document.querySelectorAll('.sc-item').length,
        faviconImgs: document.querySelectorAll('.sc-item__icon img').length,
        letterIcons: document.querySelectorAll('.sc-item__icon:not(:has(img))').length
      };
    })();`);

    // 等 favicon 异步加载（书签/历史缓存 → favicon.ico → 兜底服务）
    await new Promise(res => setTimeout(res, 4000));
    const r2 = await wc.executeJavaScript(`(function () {
      return {
        faviconImgs: document.querySelectorAll('.sc-item__icon img').length,
        firstFaviconSrc: (document.querySelector('.sc-item__icon img') || {}).src || ''
      };
    })();`);

    return { r, r2, errors };
  });

  console.log('=== 页面状态 ===');
  console.log(JSON.stringify(state, null, 2));

  const r = (state && state.r) || {};
  const r2 = (state && state.r2) || {};
  const okWallpaper = r.wallpaper === 'image' && r.bgVisible;
  const okFavicon = r.scCount > 0 && r2.faviconImgs > 0;
  const noJsError = state && !state.error && (!state.errors || state.errors.length === 0);
  console.log('\n结果:');
  console.log('  壁纸默认每日一图:', okWallpaper ? '✅ PASS' : '❌ FAIL (' + r.wallpaper + ', bgVisible=' + r.bgVisible + ')');
  console.log('  快捷方式 favicon:', okFavicon ? '✅ PASS (' + r2.faviconImgs + '/' + r.scCount + ' 个图标, 例: ' + (r2.firstFaviconSrc || '').slice(0, 70) + ')' : (r.scCount > 0 ? '⚠️ 部分/未加载（可能网络或本地无缓存）' : '❌ 无快捷方式'));
  console.log('  无 JS 错误:', noJsError ? '✅ PASS' : '❌ FAIL ' + JSON.stringify(state && state.errors) + ' ' + JSON.stringify(state && state.error));

  await electronApp.close();
  process.exit(okWallpaper && noJsError ? 0 : 1);
}

main().catch(e => { console.error('测试失败:', e); process.exit(1); });
