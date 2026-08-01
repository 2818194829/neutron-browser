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

  // 历史记录
  HISTORY_GET_ALL: 'history:getAll',
  HISTORY_SEARCH: 'history:search',
  HISTORY_ADD: 'history:add',
  HISTORY_CLEAR: 'history:clear',
  HISTORY_DELETE_ITEM: 'history:deleteItem',

  // 下载
  DOWNLOADS_GET_ALL: 'downloads:getAll',
  DOWNLOADS_PAUSE: 'downloads:pause',
  DOWNLOADS_RESUME: 'downloads:resume',
  DOWNLOADS_CANCEL: 'downloads:cancel',
  DOWNLOADS_OPEN_FOLDER: 'downloads:openFolder',
  DOWNLOADS_RETRY: 'downloads:retry',
  DOWNLOADS_SET_PATH: 'downloads:setPath',
  DOWNLOADS_UPDATED: 'downloads:updated',

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

  // 搜索建议
  SEARCH_SUGGEST: 'search:suggest',

  // 扩展
  EXTENSIONS_GET_ALL: 'extensions:getAll',
  EXTENSIONS_INSTALL: 'extensions:install',
  EXTENSIONS_INSTALL_UNPACKED: 'extensions:installUnpacked',
  EXTENSIONS_INSTALL_FROM_EDGE: 'extensions:installFromEdge',
  EXTENSIONS_TOGGLE: 'extensions:toggle',
  EXTENSIONS_UNINSTALL: 'extensions:uninstall',
};

// ==================== 默认设置 ====================
const DEFAULT_SETTINGS = {
  theme: 'system',           // 'light' | 'dark' | 'system'
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
