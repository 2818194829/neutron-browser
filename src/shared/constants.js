/**
 * 共享常量定义
 * 用于主进程与渲染进程之间的 IPC 通道名称和通用常量
 */

// ==================== IPC 通道名称 ====================
const IPC_CHANNELS = {
  // 窗口控制
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_MAXIMIZE: 'window:maximize',
  WINDOW_CLOSE: 'window:close',
  WINDOW_IS_MAXIMIZED: 'window:isMaximized',
  WINDOW_STATE_CHANGED: 'window:stateChanged',
  WINDOW_SET_ALWAYS_ON_TOP: 'window:setAlwaysOnTop',
  WINDOW_IS_ALWAYS_ON_TOP: 'window:isAlwaysOnTop',
  WINDOW_ALWAYS_ON_TOP_CHANGED: 'window:alwaysOnTopChanged',
  UI_MODAL_CHANGED: 'ui:modalChanged',
  UI_MODAL_SNAPSHOT: 'ui:modalSnapshot',
  UI_MODAL_SNAPSHOT_READY: 'ui:modalSnapshotReady',

  // 标签页管理
  TAB_CREATE: 'tab:create',
  TAB_CLOSE: 'tab:close',
  TAB_SWITCH: 'tab:switch',
  TAB_REORDER: 'tab:reorder',
  TAB_PIN: 'tab:pin',
  TAB_MUTE: 'tab:mute',
  TAB_DUPLICATE: 'tab:duplicate',
  TAB_RELOAD: 'tab:reload',
  TAB_UPDATE: 'tab:update',
  TAB_LIST_UPDATED: 'tab:listUpdated',
  TAB_FOCUS_ADDRESS_BAR: 'tab:focusAddressBar',
  TABS_GET_CURRENT: 'tabs:getCurrent',

  // 导航
  NAV_GO: 'nav:go',
  NAV_BACK: 'nav:back',
  NAV_FORWARD: 'nav:forward',
  NAV_REFRESH: 'nav:refresh',
  NAV_STOP: 'nav:stop',
  NAV_HOME: 'nav:home',
  NAV_STATE_CHANGED: 'nav:stateChanged',
  NAV_LOADING_PROGRESS: 'nav:loadingProgress',

  // 书签
  BOOKMARKS_GET_ALL: 'bookmarks:getAll',
  BOOKMARKS_ADD: 'bookmarks:add',
  BOOKMARKS_REMOVE: 'bookmarks:remove',
  BOOKMARKS_UPDATE: 'bookmarks:update',
  BOOKMARKS_MOVE: 'bookmarks:move',
  BOOKMARKS_SEARCH: 'bookmarks:search',
  BOOKMARKS_IS_BOOKMARKED: 'bookmarks:isBookmarked',
  BOOKMARKS_CONTEXT_MENU: 'bookmarks:contextMenu',
  BOOKMARKS_FOLDER_MENU: 'bookmarks:folderMenu',
  BOOKMARKS_FOLDER_CONTEXT_MENU: 'bookmarks:folderContextMenu',
  BOOKMARKS_FOLDER_MENU_OPEN: 'bookmarks:folderMenuOpen',
  BOOKMARKS_BAR_CONTEXT_MENU: 'bookmarks:barContextMenu',
  BOOKMARKS_IMPORT: 'bookmarks:import',
  BOOKMARKS_EXPORT: 'bookmarks:export',
  // 书签跨窗口拖拽状态
  BOOKMARK_DRAG_SET: 'bookmarkDrag:set',
  BOOKMARK_DRAG_CLEAR: 'bookmarkDrag:clear',
  BOOKMARK_DRAG_GET: 'bookmarkDrag:get',
  // 刷新文件夹弹出菜单
  BOOKMARK_FOLDER_REFRESH: 'bookmarkFolder:refresh',
  // 书签已变更（叠加层移动书签后通知主窗口刷新书签栏）
  BOOKMARKS_CHANGED: 'bookmarks:changed',
  BOOKMARKS_REFRESH: 'bookmarks:refresh',
  // 删除重复书签
  BOOKMARKS_REMOVE_DUPLICATES: 'bookmarks:removeDuplicates',

  // 历史记录
  HISTORY_GET_ALL: 'history:getAll',
  HISTORY_SEARCH: 'history:search',
  HISTORY_ADD: 'history:add',
  HISTORY_CLEAR: 'history:clear',
  HISTORY_DELETE_ITEM: 'history:deleteItem',
  HISTORY_GET_RECENT_CLOSED: 'history:getRecentClosed',
  HISTORY_RESTORE_RECENT_CLOSED: 'history:restoreRecentClosed',

  // 下载
  DOWNLOADS_GET_ALL: 'downloads:getAll',
  DOWNLOADS_PAUSE: 'downloads:pause',
  DOWNLOADS_RESUME: 'downloads:resume',
  DOWNLOADS_CANCEL: 'downloads:cancel',
  DOWNLOADS_OPEN_FOLDER: 'downloads:openFolder',
  DOWNLOADS_OPEN_FILE: 'downloads:openFile',
  DOWNLOADS_OPEN_DIRECTORY: 'downloads:openDirectory',
  DOWNLOADS_DELETE: 'downloads:delete',
  DOWNLOADS_CLEAR_COMPLETED: 'downloads:clearCompleted',
  DOWNLOADS_CLEAR_ALL: 'downloads:clearAll',
  DOWNLOADS_RETRY: 'downloads:retry',
  DOWNLOADS_SET_PATH: 'downloads:setPath',
  DOWNLOADS_GET_FILE_ICON: 'downloads:getFileIcon',
  DOWNLOADS_UPDATED: 'downloads:updated',

  // 剪贴板
  CLIPBOARD_COPY: 'clipboard:copy',
  CLIPBOARD_READ: 'clipboard:read',

  // 地址栏编辑
  ADDRESSBAR_EDIT: 'addressbar:edit',
  ADDRESSBAR_OPEN_EMOJI: 'addressbar:openEmoji',

  // 设置
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  SETTINGS_GET_ALL: 'settings:getAll',
  SETTINGS_CHANGED: 'settings:changed',

  // 主题
  THEME_GET: 'theme:get',
  THEME_SET: 'theme:set',
  THEME_CHANGED: 'theme:changed',

  // 菜单事件
  MENU_EVENT: 'menu:event',
  // 覆盖层请求主窗口执行菜单事件（如收藏夹面板内添加书签/新建文件夹）
  MENU_EVENT_REQUEST: 'menu:eventRequest',

  // 应用信息与更新
  APP_GET_INFO: 'app:getInfo',
  APP_CHECK_UPDATE: 'app:checkUpdate',
  UPDATE_DOWNLOAD: 'update:download',
  UPDATE_INSTALL: 'update:install',
  UPDATE_EVENT: 'update:event',

  // 搜索建议
  SEARCH_SUGGEST: 'search:suggest',

  // 扩展
  EXTENSIONS_GET_ALL: 'extensions:getAll',
  EXTENSIONS_INSTALL: 'extensions:install',
  EXTENSIONS_INSTALL_UNPACKED: 'extensions:installUnpacked',
  EXTENSIONS_INSTALL_FROM_EDGE: 'extensions:installFromEdge',
  EXTENSIONS_INSTALL_FILE: 'extensions:installFile',
  EXTENSIONS_DROP_FILE: 'extensions:dropFile',
  // 扩展包拖拽安装（Edge 式全窗口拦截）：
  // enter/leave 通知主进程显示/隐藏全窗拖放覆盖层，drop 携带文件路径统一走主进程转发
  EXTENSIONS_DRAG_ENTER: 'extensions:dragEnter',
  EXTENSIONS_DRAG_LEAVE: 'extensions:dragLeave',
  EXTENSIONS_DRAG_DROP: 'extensions:dragDrop',
  // 拖放诊断：渲染层上报事件 -> 主进程写日志并回传提示（用于排查真实拖放问题）
  EXTENSIONS_DRAG_DEBUG: 'extensions:dragDebug',
  EXTENSIONS_DRAG_DEBUG_EVENT: 'extensions:dragDebugEvent',
  EXTENSIONS_TOGGLE: 'extensions:toggle',
  EXTENSIONS_UNINSTALL: 'extensions:uninstall',
  // 扩展动作（工具栏图标/徽章/Popup）
  EXTENSIONS_GET_ACTIONS: 'extensions:getActions',
  EXTENSIONS_ACTION_BADGE: 'extensions:actionBadge',
  EXTENSIONS_ACTION_CHANGED: 'extensions:actionChanged',
  EXTENSIONS_ACTION_OPEN_POPUP: 'extensions:actionOpenPopup',
  EXTENSIONS_ACTION_HIDE_POPUP: 'extensions:actionHidePopup',
  EXTENSIONS_ACTION_CLICKED: 'extensions:actionClicked',
  EXTENSIONS_INSPECT_VIEW: 'extensions:inspectView',
  // 扩展右键菜单（对齐 Edge：网站访问权限/固定/选项）
  EXTENSIONS_GET_MENU_META: 'extensions:getMenuMeta',
  EXTENSIONS_SET_SITE_ACCESS: 'extensions:setSiteAccess',
  EXTENSIONS_SET_PINNED: 'extensions:setPinned',
  EXTENSIONS_OPEN_OPTIONS: 'extensions:openOptions',
  EXTENSIONS_VIEW_WEB_PERMISSIONS: 'extensions:viewWebPermissions',
  // 扩展真实 API 桥接（webRequest/notifications/cookies/contextMenus）
  EXT_WEBREQUEST_REGISTER: 'ext:webRequestRegister',
  EXT_WEBREQUEST_UNREGISTER: 'ext:webRequestUnregister',
  EXT_NOTIFICATIONS_CREATE: 'ext:notificationsCreate',
  EXT_NOTIFICATIONS_CLEAR: 'ext:notificationsClear',
  EXT_COOKIES_GET: 'ext:cookiesGet',
  EXT_COOKIES_GET_ALL: 'ext:cookiesGetAll',
  EXT_COOKIES_SET: 'ext:cookiesSet',
  EXT_COOKIES_REMOVE: 'ext:cookiesRemove',
  EXT_CONTEXTMENU_REGISTER: 'ext:contextMenuRegister',
  EXT_CONTEXTMENU_UNREGISTER: 'ext:contextMenuUnregister',
  EXT_CONTEXTMENU_CLICKED: 'ext:contextMenuClicked',
  // 扩展真实数据桥接（bookmarks/history/commands）
  EXT_BOOKMARKS: 'ext:bookmarks',
  EXT_HISTORY: 'ext:history',
  EXT_COMMANDS_GET_ALL: 'ext:commandsGetAll',
  // 扩展标签页/窗口/脚本注入桥接
  EXT_TABS: 'ext:tabs',
  EXT_WINDOWS: 'ext:windows',
  EXT_SCRIPTING: 'ext:scripting',
  // 扩展 storage 兜底桥接（Electron 原生 storage 可能异步就绪，扩展脚本早期不可用）
  EXT_STORAGE: 'ext:storage',

  // 悬浮面板覆盖层（面板叠加在实时页面之上显示）
  PANEL_OVERLAY_SHOW: 'panelOverlay:show',
  PANEL_OVERLAY_HIDE: 'panelOverlay:hide',
  PANEL_OVERLAY_ANCHOR: 'panelOverlay:anchor',
  PANEL_OVERLAY_GET_ANCHOR: 'panelOverlay:getAnchor',
  PANEL_OVERLAY_CLOSED: 'panelOverlay:closed',
  PANEL_OVERLAY_CLICK_OUTSIDE: 'panelOverlay:clickOutside',

  // 验证码（真实发送）
  VERIFY_CODE_SEND: 'verify:codeSend',
  VERIFY_CODE_CHECK: 'verify:codeCheck',
};

// ==================== 默认设置 ====================
const DEFAULT_SETTINGS = {
  theme: 'system',           // 'light' | 'dark' | 'system'
  accentColor: 'blue',       // 强调色: 'blue' | 'red' | 'green' | 'purple' | 'orange' | 'pink' | 'teal'
  themeSkin: 'default',      // 主题皮肤: 'default' | 'ocean' | 'forest' | 'sunset' | 'midnight' | 'rose'
  searchEngine: 'google',
  searchEngines: [
    { id: 'google', name: 'Google', url: 'https://www.google.com/search?q=%s' },
    { id: 'bing', name: 'Bing', url: 'https://www.bing.com/search?q=%s' },
    { id: 'duckduckgo', name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s' },
    { id: 'baidu', name: '百度', url: 'https://www.baidu.com/s?wd=%s' },
  ],
  homePage: 'https://www.google.com',
  showHomeButton: true,
  homeButtonTarget: 'custom', // 'newtab' | 'custom'
  newTabPage: 'home',        // 'home' | 'blank' | 'custom'
  newTabCustomUrl: '',
  preloadNewTabPage: false,
  launchAtLogin: false,
  showBookmarkBar: true,
  showBookmarksButton: true,      // 工具栏收藏夹按钮是否显示
  downloadPath: '',           // 空表示使用系统默认下载目录
  askDownloadPath: true,
  startupBehavior: 'home', // 'newTab' | 'home' | 'restore' | 'custom'
  startupPages: [],
  fontSize: 'medium',        // 'small' | 'medium' | 'large'
  enableJavaScript: true,
  enableImages: true,
  enablePopups: false,
  doNotTrack: false,
  clearOnExit: false,
  siteExtensionPermissions: {},
  // 验证码后端地址（由站长在官网 verify-server 统一管理配置，普通用户不可见）
  verifyServerUrl: '',
};

// ==================== 搜索引擎 ====================
const SEARCH_ENGINES = {
  google: { name: 'Google', url: 'https://www.google.com/search?q=%s' },
  bing: { name: 'Bing', url: 'https://www.bing.com/search?q=%s' },
  duckduckgo: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s' },
  baidu: { name: '百度', url: 'https://www.baidu.com/s?wd=%s' },
};

// ==================== 内置页面 URL ====================
const INTERNAL_PAGES = {
  NEW_TAB: 'neutron://newtab',
  SETTINGS: 'neutron://settings',
  HISTORY: 'neutron://history',
  BOOKMARKS: 'neutron://bookmarks',
  DOWNLOADS: 'neutron://downloads',
  EXTENSIONS: 'neutron://extensions',
};

// ==================== 内置页面标题映射 ====================
const INTERNAL_PAGE_TITLES = {
  'neutron://newtab': '新标签页',
  'neutron://settings': '设置',
  'neutron://history': '历史记录',
  'neutron://bookmarks': '书签管理器',
  'neutron://downloads': '下载内容',
  'neutron://extensions': '扩展程序',
};

// ==================== 书签默认结构 ====================
const DEFAULT_BOOKMARKS = {
  'bookmark_bar': {
    id: 'bookmark_bar',
    title: '书签栏',
    type: 'folder',
    children: [],
  },
  'other': {
    id: 'other',
    title: '其他书签',
    type: 'folder',
    children: [],
  },
  'mobile': {
    id: 'mobile',
    title: '移动设备书签',
    type: 'folder',
    children: [],
  },
};

module.exports = {
  IPC_CHANNELS,
  DEFAULT_SETTINGS,
  SEARCH_ENGINES,
  INTERNAL_PAGES,
  INTERNAL_PAGE_TITLES,
  DEFAULT_BOOKMARKS,
};
