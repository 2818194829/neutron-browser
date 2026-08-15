/**
 * Neutron Browser - 主进程入口
 * 负责创建主窗口、管理应用生命周期、初始化各模块
 */
const { app, BrowserWindow, session, ipcMain, dialog, net } = require('electron');
const path = require('path');
const WindowManager = require('./windowManager');
const { createAppMenu } = require('./menu');
const { registerIpcHandlers } = require('./ipcHandlers');
const { initStorage, closeStorage } = require('./storage');
const { initExtensions } = require('./extensions');
const { initUpdater } = require('./updater');
const { setupExtensionPolyfills } = require('./extensionPolyfills');
const { IPC_CHANNELS, INTERNAL_PAGES } = require('../shared/constants');

// 保持对窗口管理器的全局引用，防止被垃圾回收
let windowManager = null;
let isDev = process.argv.includes('--dev');

// 内部页面文件路径映射
const INTERNAL_PAGE_FILES = {
  'newtab': 'newtab.html',
  'settings': 'settings.html',
  'history': 'history.html',
  'bookmarks': 'bookmarks.html',
  'downloads': 'downloads.html',
  'extensions': 'extensions.html',
};

/**
 * 将 neutron:// URL 解析为实际文件路径
 * @param {string} neutronUrl - 如 neutron://newtab
 * @returns {string} 实际文件路径
 */
function resolveInternalPage(neutronUrl) {
  try {
    const url = new URL(neutronUrl);
    const pageName = url.hostname;
    const fileName = INTERNAL_PAGE_FILES[pageName] || 'newtab.html';
    return path.join(__dirname, '..', 'renderer', 'pages', fileName);
  } catch (e) {
    return path.join(__dirname, '..', 'renderer', 'pages', 'newtab.html');
  }
}

// 导出供 windowManager 使用
global.resolveInternalPage = resolveInternalPage;

// ==================== 应用启动 ====================
app.whenReady().then(async () => {
  console.log('[Main] 应用启动中...');

  // Windows 任务栏：必须设置 AppUserModelID，否则任务栏按钮/图标会回退到
  // electron.exe 的默认图标，导致自定义窗口图标（Rocket Browser.png）不生效
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.neutron.browser');
  }

  // 初始化存储系统
  await initStorage(app.getPath('userData'));
  console.log('[Main] 存储系统初始化完成');

  // 为扩展页面注入 API polyfill（必须在扩展加载前设置，
  // 否则依赖 webNavigation 等 API 的扩展（如 Adblock Plus）后台崩溃、选项页空白）
  setupExtensionPolyfills();

  // 重新加载已安装且启用的扩展
  await initExtensions();
  console.log('[Main] 扩展系统初始化完成');

  // 注册 IPC 处理器
  registerIpcHandlers();

  // 初始化自动更新（electron-updater）
  initUpdater(() => global.windowManager);
  console.log('[Main] IPC 处理器注册完成');

  // 注册内部协议 neutron://
  registerInternalProtocol();

  // 创建应用菜单
  createAppMenu();
  console.log('[Main] 应用菜单创建完成');

  // 创建窗口管理器（普通窗口）
  windowManager = new WindowManager();
  global.windowManager = windowManager;
  global.windowManagers = [windowManager];

  // 打开主窗口
  windowManager.createMainWindow();

  // macOS: 点击 dock 图标时重新创建窗口
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      windowManager.createMainWindow();
    }
  });

  console.log('[Main] 应用启动完成');
});

// ==================== 无痕窗口 ====================
function createIncognitoWindow() {
  const incognitoWM = new WindowManager({ incognito: true });
  if (!global.windowManagers) global.windowManagers = [];
  global.windowManagers.push(incognitoWM);
  // 无痕会话也需要 neutron:// 内部协议（新标签页/设置等）
  registerInternalProtocolForSession(incognitoWM.session);
  incognitoWM.createMainWindow();
  console.log('[Main] 已创建无痕窗口');
}
global.createIncognitoWindow = createIncognitoWindow;

// ==================== PWA（安装网站为独立应用窗口） ====================
/**
 * 以应用模式打开网站：独立窗口、无浏览器 UI、像原生应用一样运行。
 * @param {string} url 网站地址
 * @param {string} [title] 应用标题（取自页面标题）
 */
function createPwaWindow(url, title) {
  if (!url || typeof url !== 'string') return null;
  let target = url;
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    target = parsed.href;
  } catch (e) {
    return null;
  }

  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    title: title || url,
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',
    icon: path.join(__dirname, '..', '..', 'icon', 'Rocket Browser.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // 应用窗口内打开新窗口/弹窗 → 回到主浏览器新标签页
  win.webContents.setWindowOpenHandler(({ url: u }) => {
    const wm = global.windowManager;
    if (wm && u) wm.createTab(u);
    return { action: 'deny' };
  });

  win.loadURL(target).catch((e) => {
    console.error('[Main] PWA 窗口加载失败:', e);
  });
  console.log('[Main] 已创建 PWA 应用窗口:', target);
  return win;
}
global.createPwaWindow = createPwaWindow;

// ==================== 应用退出 ====================
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  console.log('[Main] 应用即将退出，清理资源...');
  try {
    const { destroyMv3Backgrounds } = require('./extensionBridge');
    destroyMv3Backgrounds();
  } catch (e) { /* 忽略 */ }
  const wms = global.windowManagers || [];
  for (const wm of wms) {
    if (wm) {
      try { wm.cleanup(); } catch (e) { /* 忽略 */ }
    }
  }
});

// ⚠️ 数据库必须等所有窗口关闭后再关闭：
// app.quit() 的事件顺序是 before-quit → 各窗口 close 事件 → will-quit。
// 窗口的 close 处理器会保存窗口状态（settings.set('windowState', ...)），
// 若在 before-quit 就 closeStorage()，数据库已被关闭，
// 后续窗口 close 事件再写库会抛未捕获异常 "database is not open"。
// 因此 closeStorage() 移到 will-quit（所有窗口都已关闭）再执行。
app.on('will-quit', () => {
  try {
    closeStorage();
  } catch (e) { /* 忽略 */ }
});

// ==================== 注册内部协议 ====================
function registerInternalProtocolForSession(sess) {
  sess.protocol.handle('neutron', (request) => {
    const filePath = resolveInternalPage(request.url);
    return net.fetch('file:///' + filePath.replace(/\\/g, '/'));
  });
}

function registerInternalProtocol() {
  registerInternalProtocolForSession(session.defaultSession);
}

// ==================== 安全设置 ====================
/** 根据 webContents 反查所属窗口管理器（多窗口路由） */
function getWindowManagerForContents(contents) {
  const wms = global.windowManagers || [];
  for (const wm of wms) {
    if (!wm) continue;
    if (wm.mainWindow && wm.mainWindow.webContents === contents) return wm;
    if (wm.tabs && wm.tabs.some(t => t.view && t.view.webContents === contents)) return wm;
    if (wm.panelOverlayView && wm.panelOverlayView.webContents === contents) return wm;
  }
  return global.windowManager;
}

app.on('web-contents-created', (event, contents) => {
  contents.on('will-navigate', (event, navigationUrl) => {
    try {
      const parsed = new URL(navigationUrl);
      if (parsed.protocol === 'javascript:') {
        event.preventDefault();
        return;
      }
    } catch (e) { /* 忽略无效 URL */ }
  });

  contents.setWindowOpenHandler(({ url }) => {
    const wm = getWindowManagerForContents(contents);
    if (wm) {
      wm.createTab(url);
    }
    return { action: 'deny' };
  });

  contents.on('render-process-gone', (event, details) => {
    console.error('[Main] 渲染进程崩溃:', details);
    const wm = getWindowManagerForContents(contents);
    if (wm) {
      wm.handleRenderProcessGone(contents, details);
    }
  });
});
