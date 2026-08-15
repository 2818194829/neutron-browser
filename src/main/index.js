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

  // 创建窗口管理器
  windowManager = new WindowManager();
  global.windowManager = windowManager;

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
  if (windowManager) {
    windowManager.cleanup();
  }
  try {
    closeStorage();
  } catch (e) { /* 忽略 */ }
});

// ==================== 注册内部协议 ====================
function registerInternalProtocol() {
  session.defaultSession.protocol.handle('neutron', (request) => {
    const filePath = resolveInternalPage(request.url);
    return net.fetch('file:///' + filePath.replace(/\\/g, '/'));
  });
}

// ==================== 安全设置 ====================
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
    if (windowManager) {
      windowManager.createTab(url);
    }
    return { action: 'deny' };
  });

  contents.on('render-process-gone', (event, details) => {
    console.error('[Main] 渲染进程崩溃:', details);
    if (windowManager) {
      windowManager.handleRenderProcessGone(contents, details);
    }
  });
});
