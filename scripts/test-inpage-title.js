/**
 * 验证「站内 History API 导航（pushState/replaceState/hash）导致标签页标题
 * 被清空 → 标签页显示『新标签页』」的问题。
 *
 * 运行：
 *   node scripts/test-inpage-title.js
 *
 * 用真实 windowManager 的事件处理逻辑：加载一个带 <video> 标题的页面，
 * 页面在播放中做 pushState（不改 document.title），观察 tab.title 是否被清空。
 */
const { app, BrowserWindow, BrowserView, ipcMain } = require('electron');
const path = require('path');

// 模拟 windowManager.setupViewEvents 中 did-start-navigation 的当前逻辑
function makeTabState() {
  return { title: '初始视频页', favicon: '', url: '' };
}

let log = [];
let tab = makeTabState();

function handleStartNavigation(url, isInPlace, isMainFrame) {
  // ---- 复刻修复后的 windowManager.js 代码 ----
  if (isMainFrame) {
    tab.url = url || tab.url;
    if (!isInPlace) {
      tab._prevTitle = tab.title || '';
      tab._prevFavicon = tab.favicon || '';
      tab.title = '';
      tab.favicon = '';
      tab.isLoading = true;
      tab.loadingProgress = 10;
    }
  }
  // --------------------------------------
  log.push(`[did-start-navigation] url=${url.slice(0, 60)} inPlace=${isInPlace} mainFrame=${isMainFrame} → tab.title='${tab.title}'`);
}

function handleNavigateInPage(url) {
  tab.url = url;
  log.push(`[did-navigate-in-page] url=${url.slice(0, 60)} → tab.title='${tab.title}'`);
}

function handlePageTitleUpdated(title) {
  tab.title = title;
  log.push(`[page-title-updated] title='${title}'`);
}

// 兜底：防止挂起
const hardTimeout = setTimeout(() => { console.log('=== 超时强制退出 ==='); app.exit(1); }, 25000);

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 800, height: 600, show: false });
  const view = new BrowserView({ webPreferences: { sandbox: false } });
  win.addBrowserView(view);
  view.setBounds({ x: 0, y: 0, width: 800, height: 600 });

  const wc = view.webContents;

  wc.on('did-start-navigation', (e, url, isInPlace, isMainFrame) => {
    handleStartNavigation(url, isInPlace, isMainFrame);
  });
  wc.on('did-navigate-in-page', (e, url) => handleNavigateInPage(url));
  wc.on('page-title-updated', (e, title) => handlePageTitleUpdated(title));

  // 页面：带标题，播放"视频"过程中做 pushState / replaceState / hash 变化
  // （file:// 页面允许 History API；data: URL 的 origin 为 null 会抛 SecurityError）
  const pageUrl = 'file:///' + path.join(__dirname, 'test-inpage-page.html').replace(/\\/g, '/');

  await wc.loadURL(pageUrl);

  console.log('=== 初始状态 ===');
  console.log('tab.title =', JSON.stringify(tab.title));

  console.log('\n=== 模拟页面在播放视频中执行 pushState（不改 document.title）===');
  tab.title = '我的视频页面 - 正在播放'; // 页面已加载完成，标题正常
  await wc.executeJavaScript('window.__pushState(); true;');
  await new Promise(r => setTimeout(r, 500));
  console.log('tab.title 最终 =', JSON.stringify(tab.title), tab.title === '' ? '  ← 标题被清空（BUG）' : '');

  console.log('\n=== 再模拟 replaceState ===');
  await wc.executeJavaScript('window.__replaceState(); true;');
  await new Promise(r => setTimeout(r, 500));
  console.log('tab.title 最终 =', JSON.stringify(tab.title));

  console.log('\n=== 再模拟 hash 变化 ===');
  await wc.executeJavaScript('window.__hash(); true;');
  await new Promise(r => setTimeout(r, 500));
  console.log('tab.title 最终 =', JSON.stringify(tab.title));

  console.log('\n=== 事件序列 ===');
  log.forEach(l => console.log(l));

  clearTimeout(hardTimeout);
  win.destroy();
  app.quit();
});
