/**
 * 预加载脚本 - 安全桥接主进程与渲染进程
 * 通过 contextBridge 暴露安全的 API 给渲染进程
 */
const { contextBridge, ipcRenderer, webFrame } = require('electron');
const { IPC_CHANNELS } = require('../shared/constants');

// ==================== Ctrl+滚轮 缩放页面 ====================
window.addEventListener('wheel', (event) => {
  if (event.ctrlKey) {
    event.preventDefault();
    const delta = event.deltaY < 0 ? 0.5 : -0.5;
    const currentZoom = webFrame.getZoomLevel();
    const newZoom = Math.max(-5, Math.min(5, currentZoom + delta));
    webFrame.setZoomLevel(newZoom);
  }
}, { passive: false });

// 暴露安全的 API 到渲染进程的 window.NeutronBrowser 对象
contextBridge.exposeInMainWorld('NeutronBrowser', {
  // ==================== 窗口控制 ====================
  minimizeWindow: () => ipcRenderer.send(IPC_CHANNELS.WINDOW_MINIMIZE),
  maximizeWindow: () => ipcRenderer.send(IPC_CHANNELS.WINDOW_MAXIMIZE),
  closeWindow: () => ipcRenderer.send(IPC_CHANNELS.WINDOW_CLOSE),
  isMaximized: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_IS_MAXIMIZED),
  setModalVisible: (visible) => ipcRenderer.send(IPC_CHANNELS.UI_MODAL_CHANGED, visible),

  // ==================== 标签页管理 ====================
  createTab: (url, active = true) =>
    ipcRenderer.invoke(IPC_CHANNELS.TAB_CREATE, { url, active }),
  closeTab: (tabId) =>
    ipcRenderer.send(IPC_CHANNELS.TAB_CLOSE, { tabId }),
  switchTab: (tabId) =>
    ipcRenderer.send(IPC_CHANNELS.TAB_SWITCH, { tabId }),
  reorderTab: (fromIndex, toIndex) =>
    ipcRenderer.send(IPC_CHANNELS.TAB_REORDER, { fromIndex, toIndex }),
  pinTab: (tabId) =>
    ipcRenderer.send(IPC_CHANNELS.TAB_PIN, { tabId }),
  muteTab: (tabId) =>
    ipcRenderer.send(IPC_CHANNELS.TAB_MUTE, { tabId }),
  duplicateTab: (tabId) =>
    ipcRenderer.send(IPC_CHANNELS.TAB_DUPLICATE, { tabId }),
  reloadTab: (tabId, ignoreCache = false) =>
    ipcRenderer.send(IPC_CHANNELS.TAB_RELOAD, { tabId, ignoreCache }),

  // ==================== 导航 ====================
  navigateTo: (url) =>
    ipcRenderer.send(IPC_CHANNELS.NAV_GO, { url }),
  goBack: () => ipcRenderer.send(IPC_CHANNELS.NAV_BACK),
  goForward: () => ipcRenderer.send(IPC_CHANNELS.NAV_FORWARD),
  refresh: () => ipcRenderer.send(IPC_CHANNELS.NAV_REFRESH),
  stop: () => ipcRenderer.send(IPC_CHANNELS.NAV_STOP),
  goHome: () => ipcRenderer.send(IPC_CHANNELS.NAV_HOME),

  // ==================== 书签 ====================
  getBookmarks: () => ipcRenderer.invoke(IPC_CHANNELS.BOOKMARKS_GET_ALL),
  addBookmark: (bookmark) => ipcRenderer.invoke(IPC_CHANNELS.BOOKMARKS_ADD, bookmark),
  removeBookmark: (id) => ipcRenderer.invoke(IPC_CHANNELS.BOOKMARKS_REMOVE, id),
  isBookmarked: (url) => ipcRenderer.invoke(IPC_CHANNELS.BOOKMARKS_IS_BOOKMARKED, url),
  importBookmarks: () => ipcRenderer.invoke(IPC_CHANNELS.BOOKMARKS_IMPORT),
  exportBookmarks: () => ipcRenderer.invoke(IPC_CHANNELS.BOOKMARKS_EXPORT),

  // ==================== 历史记录 ====================
  getHistory: () => ipcRenderer.invoke(IPC_CHANNELS.HISTORY_GET_ALL),
  searchHistory: (query) => ipcRenderer.invoke(IPC_CHANNELS.HISTORY_SEARCH, query),
  addHistory: (entry) => ipcRenderer.send(IPC_CHANNELS.HISTORY_ADD, entry),
  clearHistory: () => ipcRenderer.send(IPC_CHANNELS.HISTORY_CLEAR),
  deleteHistoryItem: (id) => ipcRenderer.send(IPC_CHANNELS.HISTORY_DELETE_ITEM, { id }),

  // ==================== 下载 ====================
  getDownloads: () => ipcRenderer.invoke(IPC_CHANNELS.DOWNLOADS_GET_ALL),
  openDownloadFolder: (id) => ipcRenderer.invoke(IPC_CHANNELS.DOWNLOADS_OPEN_FOLDER, { id }),
  setDownloadPath: () => ipcRenderer.invoke(IPC_CHANNELS.DOWNLOADS_SET_PATH),

  // ==================== 扩展 ====================
  getExtensions: () => ipcRenderer.invoke(IPC_CHANNELS.EXTENSIONS_GET_ALL),
  installExtension: () => ipcRenderer.invoke(IPC_CHANNELS.EXTENSIONS_INSTALL),
  installUnpackedExtension: () => ipcRenderer.invoke(IPC_CHANNELS.EXTENSIONS_INSTALL_UNPACKED),
  toggleExtension: (id) => ipcRenderer.invoke(IPC_CHANNELS.EXTENSIONS_TOGGLE, { id }),
  uninstallExtension: (id) => ipcRenderer.invoke(IPC_CHANNELS.EXTENSIONS_UNINSTALL, { id }),

  // ==================== 设置 ====================
  getSetting: (key) => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET, key),
  setSetting: (key, value) => ipcRenderer.send(IPC_CHANNELS.SETTINGS_SET, { key, value }),
  getAllSettings: () => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET_ALL),

  // ==================== 主题 ====================
  getTheme: () => ipcRenderer.invoke(IPC_CHANNELS.THEME_GET),
  setTheme: (theme) => ipcRenderer.send(IPC_CHANNELS.THEME_SET, theme),
  onThemeChanged: (callback) => {
    const handler = (event, theme) => callback(theme);
    ipcRenderer.on(IPC_CHANNELS.THEME_CHANGED, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.THEME_CHANGED, handler);
  },

  // ==================== 事件监听 ====================
  onTabListUpdated: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on(IPC_CHANNELS.TAB_LIST_UPDATED, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.TAB_LIST_UPDATED, handler);
  },
  onNavStateChanged: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on(IPC_CHANNELS.NAV_STATE_CHANGED, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.NAV_STATE_CHANGED, handler);
  },
  onWindowStateChanged: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on(IPC_CHANNELS.WINDOW_STATE_CHANGED, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.WINDOW_STATE_CHANGED, handler);
  },
  onDownloadsUpdated: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on(IPC_CHANNELS.DOWNLOADS_UPDATED, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.DOWNLOADS_UPDATED, handler);
  },
  onMenuEvent: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on(IPC_CHANNELS.MENU_EVENT, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.MENU_EVENT, handler);
  },
  onLoadingProgress: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on(IPC_CHANNELS.NAV_LOADING_PROGRESS, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.NAV_LOADING_PROGRESS, handler);
  },
});
