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
  setAlwaysOnTop: (flag) => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_SET_ALWAYS_ON_TOP, flag),
  isAlwaysOnTop: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_IS_ALWAYS_ON_TOP),
  onAlwaysOnTopChanged: (callback) => {
    const handler = (event, flag) => callback(flag);
    ipcRenderer.on(IPC_CHANNELS.WINDOW_ALWAYS_ON_TOP_CHANGED, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.WINDOW_ALWAYS_ON_TOP_CHANGED, handler);
  },
  setModalVisible: (visible) => ipcRenderer.send(IPC_CHANNELS.UI_MODAL_CHANGED, visible),
  onModalSnapshot: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on(IPC_CHANNELS.UI_MODAL_SNAPSHOT, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.UI_MODAL_SNAPSHOT, handler);
  },
  notifyModalSnapshotReady: () => ipcRenderer.send(IPC_CHANNELS.UI_MODAL_SNAPSHOT_READY),

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
  getCurrentTabs: () => ipcRenderer.invoke(IPC_CHANNELS.TABS_GET_CURRENT),

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
  addFolder: (folder) => ipcRenderer.invoke(IPC_CHANNELS.BOOKMARKS_ADD, { ...folder, type: 'folder' }),
  updateBookmark: (id, bookmark) => ipcRenderer.invoke(IPC_CHANNELS.BOOKMARKS_UPDATE, { id, bookmark }),
  moveBookmark: (id, targetId, position = 'before') =>
    ipcRenderer.invoke(IPC_CHANNELS.BOOKMARKS_MOVE, { id, targetId, position }),
  moveBookmarkIntoFolder: (id, folderId) =>
    ipcRenderer.invoke(IPC_CHANNELS.BOOKMARKS_MOVE, { id, folderId }),
  removeBookmark: (id) => ipcRenderer.invoke(IPC_CHANNELS.BOOKMARKS_REMOVE, id),
  isBookmarked: (url) => ipcRenderer.invoke(IPC_CHANNELS.BOOKMARKS_IS_BOOKMARKED, url),
  showBookmarkContextMenu: (payload) => ipcRenderer.send(IPC_CHANNELS.BOOKMARKS_CONTEXT_MENU, payload),
  showBookmarkFolderMenu: (payload) => ipcRenderer.send(IPC_CHANNELS.BOOKMARKS_FOLDER_MENU, payload),
  showBookmarkFolderContextMenu: (payload) => ipcRenderer.send(IPC_CHANNELS.BOOKMARKS_FOLDER_CONTEXT_MENU, payload),
  onBookmarkFolderMenuOpen: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on(IPC_CHANNELS.BOOKMARKS_FOLDER_MENU_OPEN, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.BOOKMARKS_FOLDER_MENU_OPEN, handler);
  },
  showBookmarkBarContextMenu: (payload) => ipcRenderer.send(IPC_CHANNELS.BOOKMARKS_BAR_CONTEXT_MENU, payload),
  importBookmarks: () => ipcRenderer.invoke(IPC_CHANNELS.BOOKMARKS_IMPORT),
  exportBookmarks: () => ipcRenderer.invoke(IPC_CHANNELS.BOOKMARKS_EXPORT),

  // ==================== 历史记录 ====================
  getHistory: () => ipcRenderer.invoke(IPC_CHANNELS.HISTORY_GET_ALL),
  searchHistory: (query) => ipcRenderer.invoke(IPC_CHANNELS.HISTORY_SEARCH, query),
  addHistory: (entry) => ipcRenderer.send(IPC_CHANNELS.HISTORY_ADD, entry),
  clearHistory: () => ipcRenderer.send(IPC_CHANNELS.HISTORY_CLEAR),
  deleteHistoryItem: (id) => ipcRenderer.send(IPC_CHANNELS.HISTORY_DELETE_ITEM, { id }),
  getRecentClosedTabs: () => ipcRenderer.invoke(IPC_CHANNELS.HISTORY_GET_RECENT_CLOSED),
  restoreRecentClosedTab: (id) => ipcRenderer.invoke(IPC_CHANNELS.HISTORY_RESTORE_RECENT_CLOSED, { id }),

  // ==================== 下载 ====================
  getDownloads: () => ipcRenderer.invoke(IPC_CHANNELS.DOWNLOADS_GET_ALL),
  pauseDownload: (id) => ipcRenderer.invoke(IPC_CHANNELS.DOWNLOADS_PAUSE, { id }),
  resumeDownload: (id) => ipcRenderer.invoke(IPC_CHANNELS.DOWNLOADS_RESUME, { id }),
  cancelDownload: (id) => ipcRenderer.invoke(IPC_CHANNELS.DOWNLOADS_CANCEL, { id }),
  copyText: (text) => ipcRenderer.invoke(IPC_CHANNELS.CLIPBOARD_COPY, text),
  openDownloadFolder: (id) => ipcRenderer.invoke(IPC_CHANNELS.DOWNLOADS_OPEN_FOLDER, { id }),
  openDownloadFile: (id) => ipcRenderer.invoke(IPC_CHANNELS.DOWNLOADS_OPEN_FILE, { id }),
  openDownloadDirectory: () => ipcRenderer.invoke(IPC_CHANNELS.DOWNLOADS_OPEN_DIRECTORY),
  deleteDownload: (id) => ipcRenderer.invoke(IPC_CHANNELS.DOWNLOADS_DELETE, { id }),
  clearCompletedDownloads: () => ipcRenderer.invoke(IPC_CHANNELS.DOWNLOADS_CLEAR_COMPLETED),
  clearDownloads: () => ipcRenderer.invoke(IPC_CHANNELS.DOWNLOADS_CLEAR_ALL),
  setDownloadPath: () => ipcRenderer.invoke(IPC_CHANNELS.DOWNLOADS_SET_PATH),

  // ==================== 扩展 ====================
  getExtensions: () => ipcRenderer.invoke(IPC_CHANNELS.EXTENSIONS_GET_ALL),
  installExtension: () => ipcRenderer.invoke(IPC_CHANNELS.EXTENSIONS_INSTALL),
  installUnpackedExtension: () => ipcRenderer.invoke(IPC_CHANNELS.EXTENSIONS_INSTALL_UNPACKED),
  installFromEdgeStore: (input) => ipcRenderer.invoke(IPC_CHANNELS.EXTENSIONS_INSTALL_FROM_EDGE, input),
  toggleExtension: (id) => ipcRenderer.invoke(IPC_CHANNELS.EXTENSIONS_TOGGLE, { id }),
  uninstallExtension: (id) => ipcRenderer.invoke(IPC_CHANNELS.EXTENSIONS_UNINSTALL, { id }),

  // ==================== 设置 ====================
  getSetting: (key) => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET, key),
  setSetting: (key, value) => ipcRenderer.send(IPC_CHANNELS.SETTINGS_SET, { key, value }),
  getAllSettings: () => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET_ALL),
  onSettingsChanged: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on(IPC_CHANNELS.SETTINGS_CHANGED, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.SETTINGS_CHANGED, handler);
  },

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
  getAppInfo: () => ipcRenderer.invoke(IPC_CHANNELS.APP_GET_INFO),
  checkForUpdate: () => ipcRenderer.invoke(IPC_CHANNELS.APP_CHECK_UPDATE),
  downloadUpdate: () => ipcRenderer.invoke(IPC_CHANNELS.UPDATE_DOWNLOAD),
  installUpdate: () => ipcRenderer.invoke(IPC_CHANNELS.UPDATE_INSTALL),
  onUpdateEvent: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on(IPC_CHANNELS.UPDATE_EVENT, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.UPDATE_EVENT, handler);
  },
  onLoadingProgress: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on(IPC_CHANNELS.NAV_LOADING_PROGRESS, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.NAV_LOADING_PROGRESS, handler);
  },
});
