/**
 * 预加载脚本 - 安全桥接主进程与渲染进程
 * 通过 contextBridge 暴露安全的 API 给渲染进程
 */
const { contextBridge, ipcRenderer, webFrame, webUtils } = require('electron');
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

// ==================== 固定页面可见性（防止视频被暂停） ====================
// 打开下载/历史/扩展等悬浮面板时，主进程会 removeBrowserView 让面板置顶，
// 这会使网页 webContents 变为 hidden 并触发 visibilitychange。
// 视频网站（如 B 站）监听到页面隐藏会主动暂停播放 → 表现为"视频卡住/暂停"。
// 因此在页面主世界将 document.hidden/visibilityState 固定为 visible，
// 让站点读取到的始终是可见状态，不会主动暂停视频（不影响 Electron 内部节流）。
try {
  webFrame.executeJavaScript(`
    (function () {
      try {
        Object.defineProperty(document, 'hidden', { get: function () { return false; }, configurable: true });
        Object.defineProperty(document, 'visibilityState', { get: function () { return 'visible'; }, configurable: true });
      } catch (e) {}
    })();
  `, true);
} catch (e) { /* 忽略：某些页面上下文可能无法注入 */ }

// ==================== 特权 API 拆分（安全） ====================
// 完整浏览器控制 API 只暴露给可信 UI（app.html 的 file:// 与内置 neutron:// 页面）。
// 普通网页（http/https 等）仅暴露运行所必需的最小集，防止任意站点窃取书签/历史/剪贴板、
// 关闭窗口、篡改设置或安装扩展。
const isTrustedUi = location.protocol === 'file:' || location.protocol === 'neutron:';
const isEdgeStoreHost = ['microsoftedge.microsoft.com', 'edge.microsoft.com'].includes(location.hostname);

if (!isTrustedUi) {
  contextBridge.exposeInMainWorld('NeutronBrowser', {
    // HTML5 全屏前保存窗口状态（preload 末尾主世界 hook 调用）
    saveFullscreenState: () => {
      try { ipcRenderer.sendSync(IPC_CHANNELS.WINDOW_SAVE_FULLSCREEN_STATE); } catch (e) { /* 忽略 */ }
    },
    // 点击网页任意位置关闭悬浮面板（主进程注入脚本调用）
    notifyPanelClickOutside: () => ipcRenderer.send(IPC_CHANNELS.PANEL_OVERLAY_CLICK_OUTSIDE),
    // 仅 Edge 商店页需要：点击“获取”走商店安装链路
    ...(isEdgeStoreHost ? {
      installFromEdgeStore: (input) => ipcRenderer.invoke(IPC_CHANNELS.EXTENSIONS_INSTALL_FROM_EDGE, input),
    } : {}),
  });
} else {
// 暴露安全的 API 到渲染进程的 window.NeutronBrowser 对象
contextBridge.exposeInMainWorld('NeutronBrowser', {
  // ==================== 窗口控制 ====================
  minimizeWindow: () => ipcRenderer.send(IPC_CHANNELS.WINDOW_MINIMIZE),
  maximizeWindow: () => ipcRenderer.send(IPC_CHANNELS.WINDOW_MAXIMIZE),
  closeWindow: () => ipcRenderer.send(IPC_CHANNELS.WINDOW_CLOSE),
  isMaximized: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_IS_MAXIMIZED),
  // 页面发起 requestFullscreen 前同步保存窗口状态（见文件末尾的主世界 hook）
  saveFullscreenState: () => {
    try { ipcRenderer.sendSync(IPC_CHANNELS.WINDOW_SAVE_FULLSCREEN_STATE); } catch (e) { /* 忽略 */ }
  },
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

  // ==================== 悬浮面板覆盖层 ====================
  showPanelOverlay: (payload) => ipcRenderer.send(IPC_CHANNELS.PANEL_OVERLAY_SHOW, payload),
  hidePanelOverlay: () => ipcRenderer.send(IPC_CHANNELS.PANEL_OVERLAY_HIDE),
  getPanelOverlayAnchor: () => ipcRenderer.invoke(IPC_CHANNELS.PANEL_OVERLAY_GET_ANCHOR),
  onPanelOverlayAnchor: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on(IPC_CHANNELS.PANEL_OVERLAY_ANCHOR, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.PANEL_OVERLAY_ANCHOR, handler);
  },
  onPanelOverlayClosed: (callback) => {
    const handler = () => callback();
    ipcRenderer.on(IPC_CHANNELS.PANEL_OVERLAY_CLOSED, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.PANEL_OVERLAY_CLOSED, handler);
  },
  // 网页点击通知主进程关闭悬浮面板（由注入脚本调用）
  notifyPanelClickOutside: () => ipcRenderer.send(IPC_CHANNELS.PANEL_OVERLAY_CLICK_OUTSIDE),

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

  // ==================== 垂直标签栏 + 标签分组 ====================
  toggleVerticalTabs: (enabled) =>
    ipcRenderer.invoke(IPC_CHANNELS.TAB_VERTICAL_TOGGLE, enabled),
  createTabGroup: (tabIds, name, color) =>
    ipcRenderer.invoke(IPC_CHANNELS.TAB_GROUP_CREATE, { tabIds, name, color }),
  addTabsToGroup: (groupId, tabIds) =>
    ipcRenderer.send(IPC_CHANNELS.TAB_GROUP_ADD, { groupId, tabIds }),
  removeTabFromGroup: (tabId) =>
    ipcRenderer.send(IPC_CHANNELS.TAB_GROUP_REMOVE, { tabId }),
  ungroupTabs: (groupId) =>
    ipcRenderer.send(IPC_CHANNELS.TAB_GROUP_UNGROUP, { groupId }),
  toggleTabGroup: (groupId) =>
    ipcRenderer.send(IPC_CHANNELS.TAB_GROUP_TOGGLE, { groupId }),
  renameTabGroup: (groupId, name) =>
    ipcRenderer.send(IPC_CHANNELS.TAB_GROUP_RENAME, { groupId, name }),
  setTabGroupColor: (groupId, color) =>
    ipcRenderer.send(IPC_CHANNELS.TAB_GROUP_SET_COLOR, { groupId, color }),
  closeTabGroup: (groupId) =>
    ipcRenderer.send(IPC_CHANNELS.TAB_GROUP_CLOSE, { groupId }),

  // ==================== 分屏 ====================
  setSplitTab: (tabId) =>
    ipcRenderer.send(IPC_CHANNELS.SPLIT_SET, { tabId }),

  // ==================== 侧边栏 ====================
  toggleSidebar: (enabled) =>
    ipcRenderer.invoke(IPC_CHANNELS.SIDEBAR_TOGGLE, enabled),

  // ==================== 导航 ====================
  navigateTo: (url) =>
    ipcRenderer.send(IPC_CHANNELS.NAV_GO, { url }),
  goBack: () => ipcRenderer.send(IPC_CHANNELS.NAV_BACK),
  goForward: () => ipcRenderer.send(IPC_CHANNELS.NAV_FORWARD),
  refresh: () => ipcRenderer.send(IPC_CHANNELS.NAV_REFRESH),
  stop: () => ipcRenderer.send(IPC_CHANNELS.NAV_STOP),
  goHome: () => ipcRenderer.send(IPC_CHANNELS.NAV_HOME),
  readerToggle: () => ipcRenderer.invoke(IPC_CHANNELS.READER_TOGGLE),

  // ==================== 书签 ====================
  getBookmarks: () => ipcRenderer.invoke(IPC_CHANNELS.BOOKMARKS_GET_ALL),
  addBookmark: (bookmark) => ipcRenderer.invoke(IPC_CHANNELS.BOOKMARKS_ADD, bookmark),
  resolveSiteFavicon: (url) => ipcRenderer.invoke(IPC_CHANNELS.FAVICON_RESOLVE, { url }),
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
  removeDuplicateBookmarks: () => ipcRenderer.invoke(IPC_CHANNELS.BOOKMARKS_REMOVE_DUPLICATES),
  // 书签跨窗口拖拽状态
  setBookmarkDrag: (id) => ipcRenderer.send(IPC_CHANNELS.BOOKMARK_DRAG_SET, id),
  clearBookmarkDrag: () => ipcRenderer.send(IPC_CHANNELS.BOOKMARK_DRAG_CLEAR),
  getBookmarkDrag: () => ipcRenderer.invoke(IPC_CHANNELS.BOOKMARK_DRAG_GET),
  // 刷新打开的文件夹弹出菜单
  refreshBookmarkFolder: (folderId) => ipcRenderer.send(IPC_CHANNELS.BOOKMARK_FOLDER_REFRESH, folderId),
  // 书签已变更（通知主窗口刷新书签栏）
  notifyBookmarksChanged: () => ipcRenderer.send(IPC_CHANNELS.BOOKMARKS_CHANGED),
  onBookmarksRefresh: (callback) => {
    const handler = () => callback();
    ipcRenderer.on(IPC_CHANNELS.BOOKMARKS_REFRESH, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.BOOKMARKS_REFRESH, handler);
  },

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
  getDownloadFileIcon: (id) => ipcRenderer.invoke(IPC_CHANNELS.DOWNLOADS_GET_FILE_ICON, { id }),
  pauseDownload: (id) => ipcRenderer.invoke(IPC_CHANNELS.DOWNLOADS_PAUSE, { id }),
  resumeDownload: (id) => ipcRenderer.invoke(IPC_CHANNELS.DOWNLOADS_RESUME, { id }),
  cancelDownload: (id) => ipcRenderer.invoke(IPC_CHANNELS.DOWNLOADS_CANCEL, { id }),
  retryDownload: (id) => ipcRenderer.invoke(IPC_CHANNELS.DOWNLOADS_RETRY, { id }),
  copyText: (text) => ipcRenderer.invoke(IPC_CHANNELS.CLIPBOARD_COPY, text),
  readClipboardText: () => ipcRenderer.invoke(IPC_CHANNELS.CLIPBOARD_READ),
  addressBarEdit: (command) => ipcRenderer.invoke(IPC_CHANNELS.ADDRESSBAR_EDIT, command),
  openEmojiPanel: () => ipcRenderer.invoke(IPC_CHANNELS.ADDRESSBAR_OPEN_EMOJI),
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
  installExtensionFromFile: (filePath) => ipcRenderer.invoke(IPC_CHANNELS.EXTENSIONS_INSTALL_FILE, { path: filePath }),
  onExtensionDropFile: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on(IPC_CHANNELS.EXTENSIONS_DROP_FILE, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.EXTENSIONS_DROP_FILE, handler);
  },
  // ==================== 扩展包拖放安装（Edge 式全窗口拦截） ====================
  // File.path 在 Electron 32+ 已移除，必须经 webUtils 桥接获取磁盘路径
  getPathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch (e) {
      return '';
    }
  },
  notifyExtensionDragEnter: () => ipcRenderer.send(IPC_CHANNELS.EXTENSIONS_DRAG_ENTER),
  notifyExtensionDragLeave: () => ipcRenderer.send(IPC_CHANNELS.EXTENSIONS_DRAG_LEAVE),
  notifyExtensionDrop: (filePath) => ipcRenderer.send(IPC_CHANNELS.EXTENSIONS_DRAG_DROP, { path: filePath }),
  // 拖放诊断（真实系统拖放排查）
  logDragDebug: (payload) => ipcRenderer.send(IPC_CHANNELS.EXTENSIONS_DRAG_DEBUG, payload),
  onExtensionDragDebugEvent: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on(IPC_CHANNELS.EXTENSIONS_DRAG_DEBUG_EVENT, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.EXTENSIONS_DRAG_DEBUG_EVENT, handler);
  },
  installFromEdgeStore: (input) => ipcRenderer.invoke(IPC_CHANNELS.EXTENSIONS_INSTALL_FROM_EDGE, input),
  toggleExtension: (id) => ipcRenderer.invoke(IPC_CHANNELS.EXTENSIONS_TOGGLE, { id }),
  uninstallExtension: (id) => ipcRenderer.invoke(IPC_CHANNELS.EXTENSIONS_UNINSTALL, { id }),
  // ==================== 扩展动作（工具栏图标/徽章/Popup） ====================
  getExtensionActions: () => ipcRenderer.invoke(IPC_CHANNELS.EXTENSIONS_GET_ACTIONS),
  onExtensionActionChanged: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on(IPC_CHANNELS.EXTENSIONS_ACTION_CHANGED, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.EXTENSIONS_ACTION_CHANGED, handler);
  },
  triggerExtensionAction: (id) => ipcRenderer.send(IPC_CHANNELS.EXTENSIONS_ACTION_CLICKED, { id }),
  openExtensionPopup: (payload) => ipcRenderer.invoke(IPC_CHANNELS.EXTENSIONS_ACTION_OPEN_POPUP, payload),
  hideExtensionPopup: () => ipcRenderer.send(IPC_CHANNELS.EXTENSIONS_ACTION_HIDE_POPUP),
  onExtensionPopupClosed: (handler) => {
    ipcRenderer.on(IPC_CHANNELS.EXTENSIONS_ACTION_POPUP_CLOSED, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.EXTENSIONS_ACTION_POPUP_CLOSED, handler);
  },
  inspectExtensionView: (id, url) => ipcRenderer.send(IPC_CHANNELS.EXTENSIONS_INSPECT_VIEW, { id, url }),
  triggerExtensionCommand: (id, name) => ipcRenderer.send(IPC_CHANNELS.EXTENSIONS_COMMANDS, { id, name }),
  // ==================== 扩展右键菜单（对齐 Edge） ====================
  getExtensionMenuMeta: (id) => ipcRenderer.invoke(IPC_CHANNELS.EXTENSIONS_GET_MENU_META, { id }),
  setExtensionSiteAccess: (id, mode, site) =>
    ipcRenderer.invoke(IPC_CHANNELS.EXTENSIONS_SET_SITE_ACCESS, { id, mode, site }),
  setExtensionPinned: (id, pinned) => ipcRenderer.invoke(IPC_CHANNELS.EXTENSIONS_SET_PINNED, { id, pinned }),
  openExtensionOptions: (id) => ipcRenderer.invoke(IPC_CHANNELS.EXTENSIONS_OPEN_OPTIONS, { id }),
  viewExtensionWebPermissions: (id) => ipcRenderer.invoke(IPC_CHANNELS.EXTENSIONS_VIEW_WEB_PERMISSIONS, { id }),

  // ==================== 设置 ====================
  getSetting: (key) => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET, key),
  setSetting: (key, value) => ipcRenderer.send(IPC_CHANNELS.SETTINGS_SET, { key, value }),
  // 验证码（真实发送）
  sendVerifyCode: (account) => ipcRenderer.invoke(IPC_CHANNELS.VERIFY_CODE_SEND, account),
  checkVerifyCode: (account, code) => ipcRenderer.invoke(IPC_CHANNELS.VERIFY_CODE_CHECK, { account, code }),
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
  // 请求主窗口执行菜单事件（覆盖层面板使用）
  requestMenuEvent: (action, data) => ipcRenderer.send(IPC_CHANNELS.MENU_EVENT_REQUEST, { action, data }),
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
}

// ==================== 主世界拦截 requestFullscreen（保存窗口状态） ====================
// contextIsolation 开启时本 preload 运行在隔离世界，直接改 Element.prototype 不影响
// 页面主世界。因此用 executeJavaScript 在主世界挂载 hook：页面发起 requestFullscreen
// 的瞬间（窗口尚未被 Electron 自动改成全屏）同步通知主进程保存窗口状态，
// 退出全屏时主进程据此还原窗口。此为 Windows 上 HTML5 全屏退出后窗口
// 尺寸被全屏覆盖 / 变成最大化的关键修复。
try {
  webFrame.executeJavaScript(`
    (function () {
      try {
        // iframe 内 requestFullscreen 的转发：iframe 已由主进程注入 hook，
        // 全屏前 postMessage 到这里，由主 frame 同步保存窗口状态。
        window.addEventListener('message', function (e) {
          try {
            if (e.data && e.data.__neutronSaveFs === 1) {
              if (window.NeutronBrowser && window.NeutronBrowser.saveFullscreenState) {
                window.NeutronBrowser.saveFullscreenState();
              }
            }
          } catch (err) {}
        });
        if (window.__neutronFullscreenHook) return;
        window.__neutronFullscreenHook = true;
        var save = function () {
          try {
            if (window.NeutronBrowser && window.NeutronBrowser.saveFullscreenState) {
              window.NeutronBrowser.saveFullscreenState();
            }
          } catch (e) { /* 忽略 */ }
        };
        // 标准 + 旧前缀（webkit）全屏 API 都要拦截：老式播放器常用 webkitRequestFullscreen
        var names = ['requestFullscreen', 'webkitRequestFullscreen'];
        for (var i = 0; i < names.length; i++) {
          (function (name) {
            var orig = Element.prototype[name];
            if (typeof orig === 'function') {
              Element.prototype[name] = function (options) {
                save();
                return orig.call(this, options);
              };
            }
          })(names[i]);
        }
      } catch (e) { /* 忽略 */ }
    })();
  `, true);
} catch (e) { /* 忽略：某些页面上下文可能无法注入 */ }
