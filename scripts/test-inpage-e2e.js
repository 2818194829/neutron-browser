/**
 * 端到端验证：真实启动 Neutron Browser，打开一个"视频页"（本地 HTML），
 * 在播放中执行 pushState/replaceState/hash，确认标签页标题不被清空
 * （即不再显示成「新标签页」）。
 *
 * 运行：
 *   node scripts/test-inpage-e2e.js
 */
const path = require('path');

// playwright-core 为全局安装（本项目未依赖），从全局 node_modules 解析
let playwright;
try {
  playwright = require('playwright-core');
} catch (e) {
  const globalPw = path.join(
    process.env.APPDATA || '',
    'npm', 'node_modules', 'playwright-core'
  );
  playwright = require(globalPw);
}
const { _electron } = playwright;

const APP_DIR = path.join(__dirname, '..'); // 应用根目录（electron 主进程入口）
const USER_DATA = path.join(APP_DIR, '.e2e-tmp-inpage');

async function main() {
  const electronApp = await _electron.launch({
    executablePath: path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe'),
    args: [APP_DIR, `--user-data-dir=${USER_DATA}`],
  });

  // 找主窗口（app.html）
  const windows = electronApp.windows();
  let win = null;
  for (const w of windows) {
    const url = w.url();
    if (url.includes('app.html')) { win = w; break; }
  }
  if (!win) {
    // 等待主窗口出现
    await new Promise(r => setTimeout(r, 3000));
    for (const w of electronApp.windows()) {
      if (w.url().includes('app.html')) { win = w; break; }
    }
  }
  if (!win) throw new Error('找不到主窗口 app.html');

  console.log('主窗口 URL:', win.url());

  // 通过主进程 windowManager 新建标签页加载本地"视频页"（URL 硬编码；evaluate 回调内无 require）
  const result = await electronApp.evaluate(async () => {
    const url = 'file:///D:/python_dev/PositronWorkSpace/pythonProject/%E6%88%91%E7%9A%84%E5%BC%80%E5%8F%91/02%20%E6%88%91%E7%9A%84PC%E6%B5%8F%E8%A7%88%E5%99%A8/scripts/test-inpage-page.html';
    const id = global.windowManager.createTab(url, true);
    return id;
  });

  // 等待页面加载完成 + page-title-updated 设置标题
  await new Promise(r => setTimeout(r, 2500));

  // 读取标签页当前标题（修复前应为空 → 显示「新标签页」；修复后应保留视频页标题）
  const titleBefore = await electronApp.evaluate(async () => {
    const tab = global.windowManager.tabs.find(t => t.url && (t.url.includes('test-inpage-page') || t.url.includes('/watch?')));
    return tab ? { title: tab.title, url: tab.url } : null;
  });

  console.log('\n=== 加载后 ===');
  console.log('tab.title =', JSON.stringify(titleBefore && titleBefore.title));

  // 在页面中执行 pushState（模拟视频播放中的站内导航）
  const wc = electronApp.windows().find(w => w.url().includes('test-inpage-page'));
  if (!wc) throw new Error('找不到视频页 webContents');

  await wc.evaluate(() => {
    window.__pushState();
    window.__replaceState();
    window.__hash();
    return true;
  });
  await new Promise(r => setTimeout(r, 1500));

  // 再次读取标题
  const titleAfter = await electronApp.evaluate(async () => {
    const tab = global.windowManager.tabs.find(t => t.url && (t.url.includes('test-inpage-page') || t.url.includes('/watch?')));
    return tab ? { title: tab.title, url: tab.url } : null;
  });

  console.log('\n=== pushState/replaceState/hash 之后 ===');
  console.log('tab.title =', JSON.stringify(titleAfter && titleAfter.title));
  console.log('tab.url   =', JSON.stringify(titleAfter && titleAfter.url));

  const ok = titleAfter && titleAfter.title === '我的视频页面 - 正在播放';
  console.log('\n' + (ok ? '✅ PASS：站内导航后标题保留（不再变成「新标签页」）' : '❌ FAIL：标题仍被清空'));

  await electronApp.close();
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error('测试失败:', e);
  process.exit(1);
});
