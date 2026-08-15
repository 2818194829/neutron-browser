/**
 * 窗口管理器 - 管理主窗口、标签页视图、窗口状态
 * 核心模块：负责 BrowserWindow 和 WebContentsView 的生命周期管理
 */
const { BrowserWindow, BrowserView, session, app, screen, nativeImage, clipboard, Menu } = require('electron');
const path = require('path');
const { IPC_CHANNELS, INTERNAL_PAGES, INTERNAL_PAGE_TITLES } = require('../shared/constants');
const { getStore } = require('./storage');
const { normalizeHistoryTitle, sanitizeFavicon } = require('../shared/siteMeta');
const { collectExtensionCommands, triggerExtensionCommand } = require('./extensions');

// 应用图标路径（开发与 ASAR 打包路径均从 src/main 上两级到项目根目录）
const APP_ICON_PATH = path.join(__dirname, '..', '..', 'icon', 'Rocket Browser.png');

// 扩展 Popup 尺寸与隐藏位置：
// 隐藏时保持原尺寸移到屏幕外（而非缩成 1×1），重新打开时只做同尺寸平移，
// 避免 1×1↔380×500 的尺寸跳变强制 compositor 重绘白底区域 → 消除打开弹窗时的白闪
const EXT_POPUP_SIZE = { width: 380, height: 500 };
const EXT_POPUP_HIDDEN_X = -2000;
const EXT_POPUP_HIDDEN_Y = -2000;

// 悬浮面板覆盖层（下载/历史/收藏夹/扩展列表/账户等）隐藏位置：
// 与扩展 Popup 同理——视图常驻附加，隐藏时移到屏幕外保持尺寸，
// 避免 add/removeBrowserView 与尺寸跳变导致的整窗重合成频闪
const PANEL_HIDDEN_X = -3000;
const PANEL_HIDDEN_Y = -3000;

// ==================== Edge 商店兼容性（动态生成，与真实内核版本一致） ====================
// 写死旧版本号会导致商店判定"与你的浏览器不兼容"：
// 1) UA/客户端提示版本过旧；2) 与 Chromium 自动发送的真实 Sec-CH-UA-Full-Version-List 不一致。
// 因此基于 process.versions.chrome（如 150.0.7871.212）动态生成，保证与内核完全一致。
const CHROME_VERSION = process.versions.chrome || '150.0.0.0';
const CHROME_MAJOR = String(CHROME_VERSION).split('.')[0] || '150';

const EDGE_USER_AGENT = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_VERSION} Safari/537.36 Edg/${CHROME_VERSION}`;

const EDGE_SEC_CH_UA = `"Microsoft Edge";v="${CHROME_MAJOR}", "Not=A?Brand";v="99", "Chromium";v="${CHROME_MAJOR}"`;
const EDGE_SEC_CH_UA_FULL = `"Microsoft Edge";v="${CHROME_VERSION}", "Not=A?Brand";v="99.0.0.0", "Chromium";v="${CHROME_VERSION}"`;
const EDGE_SEC_CH_UA_PLATFORM = '"Windows"';

const EDGE_STORE_JS_PATCH = `
if (!navigator.userAgentData || !(navigator.userAgentData.brands || []).some(b => b.brand === 'Microsoft Edge')) {
  const edgeBrands = [
    { brand: "Microsoft Edge", version: "${CHROME_MAJOR}" },
    { brand: "Not=A?Brand", version: "99" },
    { brand: "Chromium", version: "${CHROME_MAJOR}" }
  ];
  const edgeFullVersionList = [
    { brand: "Microsoft Edge", version: "${CHROME_VERSION}" },
    { brand: "Not=A?Brand", version: "99.0.0.0" },
    { brand: "Chromium", version: "${CHROME_VERSION}" }
  ];
  // 商店 JS 通过 getHighEntropyValues(['uaFullVersion', ...]) 读取 Edge 完整版本
  // 来判断是否需要"新版本 Microsoft Edge"。Electron 原生的 userAgentData 没有
  // 此方法，调用会抛错 → 版本为 null → 商店判定"与你的浏览器不兼容"并禁用安装按钮。
  // 这里补齐该方法，返回 Edge 风格的高熵值。
  Object.defineProperty(navigator, 'userAgentData', {
    get: () => ({
      brands: edgeBrands,
      mobile: false,
      platform: "Windows",
      getHighEntropyValues: (hints) => {
        const map = {
          architecture: "x86",
          bitness: "64",
          model: "",
          platform: "Windows",
          platformVersion: "10.0.0",
          uaFullVersion: "${CHROME_VERSION}",
          wow64: false,
          brands: edgeBrands,
          mobile: false,
          fullVersionList: edgeFullVersionList
        };
        const out = {};
        (hints || []).forEach((h) => { if (h in map) out[h] = map[h]; });
        return Promise.resolve(out);
      }
    }),
    configurable: true,
    enumerable: true
  });
}

// ---------- Edge 商店私有 API chrome.webstorePrivate ----------
// 商店 JS 用 chrome.webstorePrivate 是否存在来判断"是否真正的 Edge 浏览器"：
//   pt() = IS_NON_ANAHEIM_BROWSER || d(chrome) || d(chrome.webstorePrivate)
// Electron 的 window.chrome 没有此对象 → 判定"与你的浏览器不兼容"并禁用安装按钮。
// 同时商店通过 beginInstallWithManifest3 安装扩展，这里桥接到本浏览器的 Edge 商店安装链路。
const ch = window.chrome || (window.chrome = {});
// 商店代码访问 chrome.runtime.lastError：Electron 普通网页的 chrome.runtime 可能不存在
if (!ch.runtime) {
  ch.runtime = { lastError: undefined };
} else if (!('lastError' in ch.runtime)) {
  try { Object.defineProperty(ch.runtime, 'lastError', { get: function () { return undefined; } }); } catch (e) { /* 忽略 */ }
}
if (!ch.webstorePrivate) {
  ch.webstorePrivate = {
    // 新版安装入口（商店点击"获取"调用），callback 收到 "success" 表示成功
    beginInstallWithManifest3: function (data, callback) {
      const finish = function (errMsg) { if (typeof callback === 'function') callback(errMsg || ''); };
      let input = '';
      if (typeof data === 'string') input = data;
      else if (data && typeof data === 'object') {
        input = data.crxId || data.id || data.url ||
          (data.manifest && data.manifest.update_url) || location.href;
      }
      if (!input) input = location.href;
      if (window.NeutronBrowser && window.NeutronBrowser.installFromEdgeStore) {
        window.NeutronBrowser.installFromEdgeStore(input).then(function (r) {
          finish(r && r.success ? 'success' : ((r && r.message) || 'install failed'));
        }).catch(function (e) { finish(String((e && e.message) || e)); });
      } else {
        finish('no install bridge');
      }
    },
    // 旧版安装入口（兼容商店旧流程）
    install: function (url, onSuccess, onFailure) {
      if (window.NeutronBrowser && window.NeutronBrowser.installFromEdgeStore) {
        window.NeutronBrowser.installFromEdgeStore(url || location.href).then(function (r) {
          if (r && r.success) { if (typeof onSuccess === 'function') onSuccess(); }
          else if (typeof onFailure === 'function') onFailure((r && r.message) || 'install failed');
        }).catch(function (e) { if (typeof onFailure === 'function') onFailure(String((e && e.message) || e)); });
      }
    },
    // 商店在 beginInstallWithManifest3 成功后调用 completeInstall 完成收尾。
    // 本浏览器安装已在 beginInstallWithManifest3 里完成，这里直接回调成功。
    completeInstall: function () {
      const args = Array.prototype.slice.call(arguments);
      const cb = args.find(function (a) { return typeof a === 'function'; });
      if (cb) cb('success');
      return Promise.resolve('success');
    },
    // 模拟已登录的 Edge 账号（成人 MSA），避免商店要求先登录
    getBrowserLogin: function (callback) {
      if (typeof callback === 'function') {
        callback({ account_type: 'MSA', account_location: 'CN', age_group_type: 3 });
      }
    },
    // 偏好设置：成人用户
    getPreferences: function (callback) {
      if (typeof callback === 'function') {
        callback({ is_edge_feedback_enabled: false, aadc_age_group: 'Adult' });
      }
    },
    showFeedbackDialog: function () { /* 反馈对话框：本浏览器无此功能，空操作 */ }
  };
}
`;

function isEdgeStoreUrl(url) {
  try {
    return new URL(url).hostname === 'microsoftedge.microsoft.com';
  } catch (e) {
    return false;
  }
}

let edgeStoreHeadersSetup = false;
function setupEdgeStoreHeaders() {
  if (edgeStoreHeadersSetup) return;
  edgeStoreHeadersSetup = true;
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ['*://microsoftedge.microsoft.com/*'] },
    (details, callback) => {
      details.requestHeaders['Sec-CH-UA'] = EDGE_SEC_CH_UA;
      details.requestHeaders['Sec-CH-UA-Full-Version-List'] = EDGE_SEC_CH_UA_FULL;
      details.requestHeaders['Sec-CH-UA-Platform'] = EDGE_SEC_CH_UA_PLATFORM;
      details.requestHeaders['Sec-CH-UA-Mobile'] = '?0';
      callback({ requestHeaders: details.requestHeaders });
    }
  );
}

class WindowManager {
  constructor(options = {}) {
    /** @type {boolean} 是否无痕窗口（独立非持久会话） */
    this.incognito = !!options.incognito;

    /** @type {Electron.Session} 本窗口使用的会话（无痕用独立 partition，普通用默认会话） */
    this.session = this.incognito
      ? session.fromPartition('incognito')
      : session.defaultSession;

    /** @type {BrowserWindow|null} 主窗口实例 */
    this.mainWindow = null;

    /** @type {Array} 标签页列表 */
    this.tabs = [];

    /** @type {Array<{id:string,name:string,color:string,collapsed:boolean}>} 标签分组列表 */
    this.tabGroups = [];

    /** @type {boolean} 垂直标签栏开关（标签页在左侧竖向排列） */
    this.verticalTabs = false;
    try {
      const settingsStore = getStore('settings');
      this.verticalTabs = settingsStore ? settingsStore.get('verticalTabs', false) : false;
    } catch (e) { /* 忽略 */ }

    /** @type {string|null} 分屏右栏标签页 ID（null 表示未分屏） */
    this.splitTabId = null;

    /** @type {boolean} 侧边栏（左侧固定收藏夹面板）开关 */
    this.sidebarOpen = false;

    /** @type {Array} 最近关闭的标签页 */
    this.recentlyClosed = [];

    /** @type {string|null} 当前活动标签页 ID */
    this.activeTabId = null;

    /** @type {number} 标签页 ID 计数器 */
    this.tabIdCounter = 0;

    /** @type {boolean} 窗口是否最大化 */
    this.isMaximized = false;

    /** @type {Object} 窗口边界（还原时使用） */
    this.windowBounds = { x: 0, y: 0, width: 1280, height: 800 };

    /** @type {Map<string, BrowserView>} BrowserView 缓存 */
    this.viewCache = new Map();

    /** @type {string|null} HTML 模态框打开时挂起的标签页 */
    this.suspendedTabId = null;
    this.modalSnapshotResolve = null;
    this.modalOperationId = 0;
    this.sharedSessionHandlersReady = false;
    this.htmlFullScreenTabId = null;
    /** @type {{wasMaximized:boolean, bounds:Electron.Rectangle}|null} 进入 HTML5 全屏前的窗口状态（退出后恢复） */
    this.htmlFullScreenPrev = null;
    /** @type {{wasMaximized:boolean, bounds:Electron.Rectangle}|null} 窗口级全屏（F11/菜单）进入前状态 */
    this.fsWindowPrev = null;

    /** @type {Map<string, DownloadItem>} 活动下载项（用于暂停/继续/取消） */
    this.downloadItems = new Map();

    /** @type {BrowserView|null} 悬浮面板透明覆盖层视图（叠加在实时页面之上） */
    this.panelOverlayView = null;
    /** @type {string|null} 当前覆盖层显示的面板类型 */
    this.panelOverlayType = null;
    /** @type {Object|null} 当前覆盖层面板的锚点（按钮位置，窗口坐标） */
    this.panelOverlayAnchor = null;
    /** @type {Object|null} 书签文件夹弹出菜单数据 */
    this._bookmarkFolderData = null;
    /** @type {string|null} 跨窗口拖拽中的书签 ID */
    this._draggedBookmarkId = null;
    /** @type {BrowserView|null} 扩展 Popup 覆盖层视图（点击工具栏扩展图标弹出） */
    this.extensionPopupView = null;
    /** @type {string|null} 当前打开的扩展 Popup 对应扩展 ID */
    this.extensionPopupId = null;
    /** @type {Map<string, BrowserWindow>} 扩展选项页窗口（按扩展 ID） */
    this.extensionOptionsWindows = new Map();
    /** @type {BrowserView|null} 扩展包拖放全窗提示覆盖层（Edge 式拖拽安装反馈） */
    this.extensionDropView = null;
    /** @type {number} 拖放进入深度（多来源 enter/leave 计数，0 时隐藏覆盖层） */
    this.extensionDragDepth = 0;

    /** @type {ReturnType<typeof setInterval>|null} 标签页休眠定时器 */
    this._sleepTimer = null;

    // 绑定方法
    this.handleNewWindow = this.handleNewWindow.bind(this);

    this.setupSharedSessionHandlers();

    // 启动后台标签页休眠定时器
    this.startTabSleeper();
  }

  /**
   * 在共享持久会话上只注册一次下载与权限处理器
   */
  setupSharedSessionHandlers() {
    if (this.sharedSessionHandlersReady) return;
    this.sharedSessionHandlersReady = true;

    // 使用本窗口自己的会话（无痕窗口用独立会话，避免污染默认会话）
    const sharedSession = this.session;

    sharedSession.setPermissionRequestHandler((webContents, permission, callback) => {
      // fullscreen 必须放行，否则网页 HTML5 全屏（requestFullscreen）会被拒绝，视频无法全屏
      const allowedPermissions = ['clipboard-read', 'clipboard-sanitized-write', 'fullscreen'];
      callback(allowedPermissions.includes(permission));
    });

    sharedSession.on('will-download', (event, item, webContents) => {
      const tab = this.tabs.find(t => t.view && t.view.webContents === webContents);
      this.handleDownload(event, item, tab ? tab.id : null);
    });
  }

  /**
   * 创建主窗口
   */
  createMainWindow() {
    // 防止重复创建
    if (this.mainWindow && !this.mainWindow.isDestroyed()) return;

    // 加载窗口状态
    const settings = getStore('settings');
    const windowState = settings ? settings.get('windowState') : null;

    const bounds = windowState || {
      width: 1400,
      height: 900,
      x: undefined,
      y: undefined,
    };

    this.mainWindow = new BrowserWindow({
      ...bounds,
      minWidth: 600,
      minHeight: 400,
      frame: false,                    // 无边框窗口
      transparent: true,               // 透明背景，配合 app.css 的 border-radius 实现四角微圆角（Win10 无原生圆角，仅透明方案可行）
      resizable: true,                 // 允许调整大小（Chromium 自定义 WM_NCHITTEST，透明窗口边缘拖拽缩放正常）
      backgroundColor: '#00000000',    // 透明背景色（#AARRGGBB；最大化时主进程会临时切为不透明）
      icon: nativeImage.createFromPath(APP_ICON_PATH),  // 窗口图标
      title: this.incognito ? 'Neutron Browser — 无痕模式' : 'Neutron Browser',
      show: false,                     // 先不显示，等 ready-to-show
      webPreferences: {
        preload: path.join(__dirname, '..', 'renderer', 'preload.js'),
        contextIsolation: true,        // 上下文隔离
        nodeIntegration: false,        // 禁用 Node 集成
        sandbox: false,                // 沙箱（需配合 preload）
        webviewTag: false,
        spellcheck: false,
      },
    });

    // Windows 任务栏图标：BrowserWindow 的 icon 选项已设置，这里再显式 setIcon 双保险，
    // 确保任务栏按钮显示 Rocket Browser 图标（而非 electron.exe 默认图标）
    try {
      this.mainWindow.setIcon(nativeImage.createFromPath(APP_ICON_PATH));
    } catch (e) { /* 忽略 */ }

    // 加载主界面 HTML
    this.mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'app.html'));

    // 注册扩展命令快捷键（对齐 Edge：manifest.commands 的 suggested_key）
    this.registerExtensionCommands();

    // 窗口准备好后显示（避免白屏闪烁）
    this.mainWindow.once('ready-to-show', () => {
      this.mainWindow.show();

      // 开发模式下打开 DevTools
      if (process.argv.includes('--dev')) {
        this.mainWindow.webContents.openDevTools({ mode: 'detach' });
      }

      // 根据启动行为创建初始标签页
      this.openStartupPages();

      // 扩展 chrome.windows.onCreated 事件
      try {
        const { notifyWindowCreated } = require('./extensionBridge');
        notifyWindowCreated();
      } catch (e) { /* 忽略 */ }

      // 恢复窗口置顶状态
      if (settings.get('windowAlwaysOnTop')) {
        this.mainWindow.setAlwaysOnTop(true);
      }
    });

    // 多窗口：聚焦时更新全局「当前窗口管理器」，使菜单/IPC 路由到本窗口
    this.mainWindow.on('focus', () => {
      global.windowManager = this;
    });

    // 监听窗口状态变化
    this.mainWindow.on('maximize', () => {
      this.isMaximized = true;
      // 记录最大化前的「还原边界」。getNormalBounds() 在最大化后仍返回还原边界，
      // 供 HTML 全屏退出后恢复还原状态使用。不能依赖 resize 事件维护——最大化时
      // 的 resize 可能早于 maximize 事件（isMaximized 尚未置位），会把工作区尺寸
      // 误写入镜像。
      try { this.windowBounds = this.mainWindow.getNormalBounds(); } catch (e) { /* 忽略 */ }
      // 最大化时窗口贴满屏幕：切为不透明背景，防止透明边缘露出桌面（渲染层同步去掉圆角）
      try { this.mainWindow.setBackgroundColor('#1a1a2e'); } catch (e) { /* 忽略 */ }
      this.sendToRenderer(IPC_CHANNELS.WINDOW_STATE_CHANGED, { maximized: true });
      this.layoutViews(); // 最大化时调整页面布局
    });

    this.mainWindow.on('unmaximize', () => {
      this.isMaximized = false;
      // 还原后同步镜像为当前边界
      try { this.windowBounds = this.mainWindow.getBounds(); } catch (e) { /* 忽略 */ }
      // 还原时恢复透明背景，重新显示四角微圆角
      try { this.mainWindow.setBackgroundColor('#00000000'); } catch (e) { /* 忽略 */ }
      this.sendToRenderer(IPC_CHANNELS.WINDOW_STATE_CHANGED, { maximized: false });
      this.layoutViews(); // 还原时调整页面布局
    });

    this.mainWindow.on('enter-full-screen', () => {
      if (this.htmlFullScreenTabId) {
        this.layoutViews();
        return;
      }
      // 窗口级全屏（F11 / 菜单「全屏」togglefullscreen）：不走 HTML5 全屏路径，
      // 保存进入前状态供退出时恢复（最大化窗口的全屏会把「还原」边界污染成全屏尺寸）
      if (!this.fsWindowPrev) {
        this.fsWindowPrev = { wasMaximized: this.isMaximized, bounds: this.windowBounds };
      }
      // 全屏切不透明背景（透明窗口合成开销大）
      try { this.mainWindow.setBackgroundColor('#1a1a2e'); } catch (e) { /* 忽略 */ }
      this.layoutViews();
    });

    this.mainWindow.on('leave-full-screen', () => {
      if (this.htmlFullScreenTabId) {
        this.layoutViews();
        this.scheduleFullscreenSelfHeal();
        return;
      }
      // 窗口级全屏（F11/菜单）退出：恢复进入前状态（普通窗口原始大小）。
      // ⚠️ leave-full-screen 触发时窗口可能仍处于全屏尺寸，立即 setBounds 无效
      // 会被随后的 Windows 还原（→最大化）覆盖 → 立即尝试 + 短延迟兜底。
      // setBounds 对最大化/全屏窗口一步生效（自动取消最大化并设置尺寸），
      // 避免「先最大化再退回原始大小」的跳变并修正被污染的还原边界。
      if (this.fsWindowPrev) {
        const prev = this.fsWindowPrev;
        this.fsWindowPrev = null;
        const apply = () => {
          try {
            if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
            this.mainWindow.setBounds(prev.bounds);
            if (!prev.wasMaximized) {
              try { this.mainWindow.setBackgroundColor('#00000000'); } catch (e) { /* 忽略 */ }
            }
            this.layoutViews();
          } catch (e) { /* 忽略 */ }
        };
        apply();               // 立即尝试
        setTimeout(apply, 80); // 兜底：窗口真正退出全屏后 setBounds 生效
      }
      // 终极兜底：无论以何种方式退出全屏（含 enter/leave-html-full-screen 事件
      // 未触发的极端情况），窗口离开全屏后都检查尺寸并强制恢复。
      this.scheduleFullscreenSelfHeal();
    });

    this.mainWindow.on('resize', () => {
      if (!this.isMaximized && !this.htmlFullScreenTabId) {
        const bounds = this.mainWindow.getBounds();
        // 防止 HTML 全屏化（窗口被 Electron 自动改成屏幕大小）污染 windowBounds 镜像：
        // 当窗口尺寸与某个显示器完全重合时视为全屏化，不更新镜像。
        // 该镜像用于退出全屏时兜底恢复（即使页面 hook 失效也能还原窗口尺寸）。
        let coversScreen = false;
        try {
          const display = screen.getDisplayMatching(bounds);
          coversScreen = Math.abs(bounds.x - display.bounds.x) <= 1 &&
            Math.abs(bounds.y - display.bounds.y) <= 1 &&
            Math.abs(bounds.width - display.bounds.width) <= 1 &&
            Math.abs(bounds.height - display.bounds.height) <= 1;
        } catch (e) { /* 忽略 */ }
        if (!coversScreen) {
          this.windowBounds = bounds;
        }
      }
      this.layoutViews(); // 窗口大小变化时实时调整页面布局
    });

    this.mainWindow.on('move', () => {
      if (!this.isMaximized && !this.htmlFullScreenTabId) {
        const bounds = this.mainWindow.getBounds();
        // 与 resize 相同：全屏化（窗口移动到 0,0 并占满显示器）不更新镜像
        let coversScreen = false;
        try {
          const display = screen.getDisplayMatching(bounds);
          coversScreen = Math.abs(bounds.x - display.bounds.x) <= 1 &&
            Math.abs(bounds.y - display.bounds.y) <= 1 &&
            Math.abs(bounds.width - display.bounds.width) <= 1 &&
            Math.abs(bounds.height - display.bounds.height) <= 1;
        } catch (e) { /* 忽略 */ }
        if (!coversScreen) {
          this.windowBounds = bounds;
        }
      }
    });

    // 扩展 chrome.windows 事件（focus/bounds）
    this.mainWindow.on('focus', () => {
      try { const { notifyWindowFocused } = require('./extensionBridge'); notifyWindowFocused(); } catch (e) { /* 忽略 */ }
    });
    let boundsNotifyTimer = null;
    const scheduleBoundsNotify = () => {
      if (boundsNotifyTimer) clearTimeout(boundsNotifyTimer);
      boundsNotifyTimer = setTimeout(() => {
        boundsNotifyTimer = null;
        try { const { notifyWindowBoundsChanged } = require('./extensionBridge'); notifyWindowBoundsChanged(); } catch (e) { /* 忽略 */ }
      }, 200);
    };
    this.mainWindow.on('resize', scheduleBoundsNotify);
    this.mainWindow.on('move', scheduleBoundsNotify);

    // 关闭前保存窗口状态
    this.mainWindow.on('close', () => {
      if (!this.isMaximized) {
        try {
          const bounds = this.mainWindow.getBounds();
          settings.set('windowState', bounds);
        } catch (e) {
          // 防御：退出阶段存储可能已不可用，不影响窗口关闭
        }
      }
    });

    this.mainWindow.on('closed', () => {
      try { const { notifyWindowRemoved } = require('./extensionBridge'); notifyWindowRemoved(); } catch (e) { /* 忽略 */ }
      this.mainWindow = null;
    });

    // 处理 webContents 的新窗口请求
    this.mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      this.createTab(url);
      return { action: 'deny' };
    });

    // 安全兜底：拖拽被 Esc 取消 / 切换到其他窗口时 OS 不再发送 dragleave，
    // 窗口失焦时强制关闭拖放提示覆盖层，避免透明覆盖层残留阻挡交互
    this.mainWindow.on('blur', () => {
      if (this.extensionDragDepth > 0) {
        this.hideExtensionDropOverlay();
      }
      try { const { notifyWindowFocused } = require('./extensionBridge'); notifyWindowFocused(); } catch (e) { /* 忽略 */ }
    });
  }

  /**
   * 设置窗口置顶，持久化状态并通知渲染进程
   * @param {boolean} flag
   * @returns {boolean} 设置后的置顶状态
   */
  setAlwaysOnTop(flag) {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return false;
    this.mainWindow.setAlwaysOnTop(!!flag);
    const current = this.mainWindow.isAlwaysOnTop();
    const settings = getStore('settings');
    settings.set('windowAlwaysOnTop', current);
    this.sendToRenderer(IPC_CHANNELS.WINDOW_ALWAYS_ON_TOP_CHANGED, current);
    return current;
  }

  /**
   * 创建一个新标签页
   * @param {string} url - 要加载的 URL
   * @param {boolean} [active=true] - 是否激活该标签页
   * @returns {string} 标签页 ID
   */
  createTab(url, active = true) {
    const tabId = `tab_${++this.tabIdCounter}`;

    // 解析 URL
    const resolvedUrl = this.resolveUrl(url);

    // 创建 BrowserView，标签使用本窗口的会话（无痕窗口为独立非持久会话）
    const view = new BrowserView({
      webPreferences: {
        session: this.session,
        preload: path.join(__dirname, '..', 'renderer', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });

    // 设置视图初始边界（稍后在布局中调整）
    view.setBounds({ x: 0, y: 0, width: 0, height: 0 });

    // 监听页面事件
    this.setupViewEvents(view, tabId);

    if (isEdgeStoreUrl(resolvedUrl)) {
      setupEdgeStoreHeaders();
      view.webContents.setUserAgent(EDGE_USER_AGENT);
    }

    // 添加视图到窗口（保持附加；初始先缩小隐藏，由 switchTab/layoutViews 定位）
    this.mainWindow.addBrowserView(view);
    this.hideViewInvisible(view);

    // 加载 URL
    view.webContents.loadURL(resolvedUrl);

    if (isEdgeStoreUrl(resolvedUrl)) {
      view.webContents.once('dom-ready', () => {
        view.webContents.executeJavaScript(EDGE_STORE_JS_PATCH).catch(() => {});
      });
    }

    // 创建标签页数据
    const tab = {
      id: tabId,
      url: resolvedUrl,
      title: '新标签页',
      favicon: '',
      view: view,
      isPinned: false,
      isMuted: false,
      isAudible: false,
      isLoading: true,
      loadingProgress: 0,
      canGoBack: false,
      canGoForward: false,
      securityState: 'neutral', // 'secure' | 'insecure' | 'neutral'
      isSleeping: false,        // 标签页休眠（后台超时卸载渲染进程）
      lastActiveAt: Date.now(), // 最近一次被激活的时间戳（用于休眠判定）
      groupId: null,            // 所属标签分组 ID（null 表示未分组）
    };

    this.tabs.push(tab);

    if (active) {
      this.switchTab(tabId);
    }
    // 非活动标签页：不添加到窗口，由 switchTab 管理

    // 通知渲染进程更新标签栏
    this.syncTabsToRenderer();

    // 扩展 chrome.tabs.onCreated 事件
    try {
      const { notifyTabCreated } = require('./extensionBridge');
      notifyTabCreated(tab);
    } catch (e) { /* 忽略 */ }

    return tabId;
  }

  /**
   * 根据启动设置打开初始页面
   */
  openStartupPages() {
    // 防止重复调用（已有标签页时跳过）
    if (this.tabs.length > 0) return;

    const settings = getStore('settings');
    const startupBehavior = settings ? settings.get('startupBehavior', 'home') : 'home';
    const homePage = settings ? settings.get('homePage', 'https://www.google.com') : 'https://www.google.com';

    switch (startupBehavior) {
      case 'home':
        // 启动时打开主页
        this.createTab(homePage);
        break;
      case 'restore':
        // 恢复上次会话（暂简化：打开主页）
        this.createTab(homePage);
        break;
      case 'custom':
        // 打开自定义启动页面列表
        const startupPages = settings ? settings.get('startupPages', []) : [];
        if (startupPages.length > 0) {
          startupPages.forEach((url, index) => {
            this.createTab(url, index === 0);
          });
        } else {
          this.createTab(homePage);
        }
        break;
      case 'newTab':
      default:
        // 打开新标签页
        this.createTab(INTERNAL_PAGES.NEW_TAB);
        break;
    }
  }

  /**
   * 切换到指定标签页
   * @param {string} tabId
   */
  switchTab(tabId) {
    const targetTab = this.tabs.find(t => t.id === tabId);
    if (!targetTab) return;

    // 唤醒休眠标签页（重新加载被卸载的渲染进程）
    this.wakeTab(targetTab);

    // 切换标签页：关闭扩展 Popup（弹窗属于旧标签页上下文）
    this.hideExtensionPopup();

    if (this.htmlFullScreenTabId && this.htmlFullScreenTabId !== tabId) {
      this.exitHtmlFullScreen();
    }

    // 切到分屏右栏标签本身 → 退出分屏，该标签成为唯一活动标签
    if (this.splitTabId && this.splitTabId === tabId) {
      this.splitTabId = null;
    }

    // 隐藏之前活动的标签页（缩小为 1x1 而非移除视图，保持其画面持续渲染，
    // 否则后台标签的视频会"声音正常、画面冻结"）；分屏右栏标签保持可见，不隐藏
    if (this.activeTabId) {
      const prevTab = this.tabs.find(t => t.id === this.activeTabId);
      if (prevTab && prevTab.view && prevTab.id !== this.splitTabId) {
        this.hideViewInvisible(prevTab.view);
      }
    }

    // 显示目标标签页（确保附加到窗口，addBrowserView 幂等）
    this.activeTabId = tabId;
    targetTab.lastActiveAt = Date.now();
    this.mainWindow.addBrowserView(targetTab.view);
    if (this.splitTabId && this.splitTabId !== tabId) {
      const splitTab = this.tabs.find(t => t.id === this.splitTabId);
      if (splitTab && splitTab.view) {
        this.mainWindow.addBrowserView(splitTab.view); // 右栏保持附加
      }
    }
    this.layoutViews();

    // 扩展 chrome.tabs.onActivated 事件
    try {
      const { notifyTabActivated } = require('./extensionBridge');
      notifyTabActivated(tabId);
    } catch (e) { /* 忽略 */ }

    // 通知渲染进程
    this.syncTabsToRenderer();
    this.syncNavState(targetTab);
  }

  /**
   * 唤醒休眠标签页：重新加载被卸载的渲染进程
   * @param {{id:string, view:any, isSleeping:boolean}} tab
   */
  wakeTab(tab) {
    if (!tab || !tab.isSleeping) return;
    tab.isSleeping = false;
    tab.lastActiveAt = Date.now();
    const wc = tab.view && tab.view.webContents;
    if (wc && !wc.isDestroyed()) {
      // 渲染进程已被 forcefullyCrashRenderer 卸载，reload 会重新拉起并加载 URL
      try { wc.reload(); } catch (e) { /* 忽略 */ }
    }
    this.syncTabsToRenderer();
  }

  /**
   * 休眠单个标签页：卸载渲染进程以释放内存，标签页数据保留
   * @param {string} tabId
   */
  sleepTab(tabId) {
    const tab = this.tabs.find(t => t.id === tabId);
    if (!tab || !tab.view || tab.isSleeping || tab.id === this.activeTabId || tab.isPinned) return;
    if (tab.isLoading || tab.isAudible || tab.crashed) return; // 加载中/播放中/已崩溃的标签不休眠
    if (tab.id === this.splitTabId) return; // 分屏右栏可见标签不休眠
    tab.isSleeping = true;
    try {
      // 主动卸载渲染进程；handleRenderProcessGone 会识别 isSleeping 并跳过崩溃处理
      tab.view.webContents.forcefullyCrashRenderer();
    } catch (e) { /* 某些状态下调用可能抛错，忽略 */ }
    this.syncTabsToRenderer();
  }

  /**
   * 定期检查后台标签页，将超时未活动的标签休眠
   */
  sleepInactiveTabs() {
    const now = Date.now();
    const idleMs = this.sleepIdleMs || (5 * 60 * 1000); // 默认 5 分钟
    for (const tab of this.tabs) {
      if (!tab.view || tab.isSleeping || tab.isPinned) continue;
      if (tab.id === this.activeTabId) continue;
      if (tab.id === this.splitTabId) continue; // 分屏右栏可见标签不休眠
      if (tab.isLoading) continue; // 加载中的标签不强制休眠，避免打断导航
      if (tab.isAudible) continue; // 正在播放声音的标签不休眠
      if (now - (tab.lastActiveAt || now) >= idleMs) {
        this.sleepTab(tab.id);
      }
    }
  }

  /**
   * 启动标签页休眠定时器（每分钟检查一次）
   */
  startTabSleeper() {
    if (this._sleepTimer) return;
    this._sleepTimer = setInterval(() => this.sleepInactiveTabs(), 60 * 1000);
  }

  /**
   * 停止标签页休眠定时器
   */
  stopTabSleeper() {
    if (this._sleepTimer) {
      clearInterval(this._sleepTimer);
      this._sleepTimer = null;
    }
  }

  // ==================== 垂直标签栏 ====================

  /**
   * 切换垂直标签栏
   * @param {boolean} enabled
   */
  setVerticalTabs(enabled) {
    this.verticalTabs = !!enabled;
    try {
      const settingsStore = getStore('settings');
      if (settingsStore) settingsStore.set('verticalTabs', this.verticalTabs);
    } catch (e) { /* 忽略 */ }
    this.layoutViews();
    this.syncTabsToRenderer();
  }

  /**
   * 切换侧边栏（左侧固定收藏夹面板）
   * @param {boolean} enabled
   */
  setSidebarOpen(enabled) {
    this.sidebarOpen = !!enabled;
    this.layoutViews();
    this.syncTabsToRenderer();
  }

  // ==================== 分屏 ====================

  /**
   * 设置/取消分屏右栏标签
   * @param {string|null} tabId 右栏标签页 ID；传 null 退出分屏
   */
  setSplitTab(tabId) {
    const prevSplitId = this.splitTabId;
    if (tabId) {
      const tab = this.tabs.find(t => t.id === tabId);
      if (!tab || !tab.view) return;
      if (tab.id === this.activeTabId) return; // 不能与活动标签相同
      // 更换分屏目标时，隐藏旧的分屏视图（避免残留占位）
      if (prevSplitId && prevSplitId !== tabId) {
        const old = this.tabs.find(t => t.id === prevSplitId);
        if (old && old.view) this.hideViewInvisible(old.view);
      }
      this.splitTabId = tab.id;
      this.mainWindow.addBrowserView(tab.view); // 幂等附加右栏
    } else {
      // 退出分屏：隐藏旧分屏视图
      if (prevSplitId) {
        const old = this.tabs.find(t => t.id === prevSplitId);
        if (old && old.view) this.hideViewInvisible(old.view);
      }
      this.splitTabId = null;
    }
    this.layoutViews();
    this.syncTabsToRenderer();
  }

  // ==================== 标签分组 ====================

  /**
   * 清理空分组（分组内无任何标签页时移除）
   */
  cleanupEmptyGroups() {
    this.tabGroups = this.tabGroups.filter(g => this.tabs.some(t => t.groupId === g.id));
    if (this.tabGroups.length === 0) {
      // 保持引用不变，避免 renderer 引用失效（可选）
    }
  }

  /**
   * 生成新的分组 ID
   */
  generateGroupId() {
    return 'g_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
  }

  /**
   * 创建标签分组并把指定标签页加入
   * @param {string[]} tabIds
   * @param {string} [name]
   * @param {string} [color]
   */
  createTabGroup(tabIds, name, color) {
    const ids = (tabIds || []).filter(id => this.tabs.some(t => t.id === id));
    if (ids.length === 0) return null;
    const group = {
      id: this.generateGroupId(),
      name: name || '新分组',
      color: color || '#4285f4',
      collapsed: false,
    };
    this.tabGroups.push(group);
    for (const t of this.tabs) {
      if (ids.includes(t.id)) t.groupId = group.id;
    }
    this.syncTabsToRenderer();
    return group.id;
  }

  /**
   * 把标签页加入已有分组
   * @param {string} groupId
   * @param {string[]} tabIds
   */
  addTabsToGroup(groupId, tabIds) {
    if (!this.tabGroups.some(g => g.id === groupId)) return;
    for (const t of this.tabs) {
      if ((tabIds || []).includes(t.id)) t.groupId = groupId;
    }
    this.syncTabsToRenderer();
  }

  /**
   * 把单个标签页从分组移除（变成未分组）
   * @param {string} tabId
   */
  removeTabFromGroup(tabId) {
    const tab = this.tabs.find(t => t.id === tabId);
    if (tab) tab.groupId = null;
    this.cleanupEmptyGroups();
    this.syncTabsToRenderer();
  }

  /**
   * 解散整个分组（标签页保留，仅移除分组）
   * @param {string} groupId
   */
  ungroupGroup(groupId) {
    for (const t of this.tabs) {
      if (t.groupId === groupId) t.groupId = null;
    }
    this.tabGroups = this.tabGroups.filter(g => g.id !== groupId);
    this.syncTabsToRenderer();
  }

  /**
   * 折叠/展开分组
   * @param {string} groupId
   */
  toggleTabGroupCollapsed(groupId) {
    const group = this.tabGroups.find(g => g.id === groupId);
    if (!group) return;
    group.collapsed = !group.collapsed;
    this.syncTabsToRenderer();
  }

  /**
   * 重命名分组
   * @param {string} groupId
   * @param {string} name
   */
  renameTabGroup(groupId, name) {
    const group = this.tabGroups.find(g => g.id === groupId);
    if (!group) return;
    group.name = name || '分组';
    this.syncTabsToRenderer();
  }

  /**
   * 设置分组颜色
   * @param {string} groupId
   * @param {string} color
   */
  setTabGroupColor(groupId, color) {
    const group = this.tabGroups.find(g => g.id === groupId);
    if (!group) return;
    group.color = color;
    this.syncTabsToRenderer();
  }

  /**
   * 关闭分组内所有标签页
   * @param {string} groupId
   */
  closeTabGroup(groupId) {
    const ids = this.tabs.filter(t => t.groupId === groupId).map(t => t.id);
    for (const id of ids) this.closeTab(id);
  }

  /**
   * 关闭标签页
   * @param {string} tabId
   */
  closeTab(tabId) {
    const tabIndex = this.tabs.findIndex(t => t.id === tabId);
    if (tabIndex === -1) return;

    const tab = this.tabs[tabIndex];

    // 不允许关闭固定标签页
    if (tab.isPinned) return;

    this.recentlyClosed.unshift({
      id: tabId,
      url: tab.url || '',
      title: tab.title || tab.url || '已关闭的标签页',
      favicon: tab.favicon || '',
      closedAt: Date.now(),
    });
    if (this.recentlyClosed.length > 30) {
      this.recentlyClosed.length = 30;
    }

    // 从窗口中移除视图
    if (tab.view) {
      this.mainWindow.removeBrowserView(tab.view);
      tab.view.webContents.close();
    }

    // 从列表中移除
    this.tabs.splice(tabIndex, 1);

    // 关闭后清理空分组与分屏引用
    this.cleanupEmptyGroups();
    if (this.splitTabId === tabId) this.splitTabId = null;

    if (this.htmlFullScreenTabId === tabId) {
      this.exitHtmlFullScreen();
    }

    // 如果关闭的是活动标签页，切换到相邻标签页
    if (this.activeTabId === tabId) {
      if (this.tabs.length > 0) {
        const newIndex = Math.min(tabIndex, this.tabs.length - 1);
        this.switchTab(this.tabs[newIndex].id);
      } else {
        // 无标签页时创建空白标签页
        this.createTab(INTERNAL_PAGES.NEW_TAB);
      }
    }

    // 扩展 chrome.tabs.onRemoved 事件
    try {
      const { notifyTabRemoved } = require('./extensionBridge');
      notifyTabRemoved(tabId, false);
    } catch (e) { /* 忽略 */ }

    this.syncTabsToRenderer();
  }

  /**
   * 获取最近关闭的标签页
   */
  getRecentlyClosed() {
    return this.recentlyClosed;
  }

  /**
   * 恢复最近关闭的标签页
   * @param {string} id
   */
  restoreRecentlyClosed(id) {
    const index = this.recentlyClosed.findIndex(item => item.id === id);
    if (index === -1) return false;
    const item = this.recentlyClosed[index];
    this.recentlyClosed.splice(index, 1);
    this.createTab(item.url, true);
    return true;
  }

  /**
   * 判断边界是否等同于某个显示器尺寸（即「全屏污染值」）
   * @param {Electron.Rectangle} bounds
   */
  isFullscreenLikeBounds(bounds) {
    if (!bounds || typeof bounds.width !== 'number' || bounds.width <= 0) return true;
    try {
      const display = screen.getDisplayMatching(bounds);
      return bounds.width >= display.bounds.width - 2 &&
        bounds.height >= display.bounds.height - 2;
    } catch (e) { return false; }
  }

  /**
   * 处理网页 HTML5 全屏
   * @param {string} tabId
   * @param {boolean} entering
   */
  handleHtmlFullScreen(tabId, entering) {
    const tab = this.tabs.find(item => item.id === tabId);
    if (!tab) return;

    if (entering) {
      this.htmlFullScreenTabId = tabId;
      // ⚠️ Windows 坑：最大化窗口进入全屏后，「还原」状态的边界会被覆盖成全屏尺寸。
      // 且 Electron 对 HTML5 全屏会先自动改窗口为全屏再触发本事件，此时读取的
      // bounds 已是全屏尺寸。
      // 进入前状态（三层保障，不依赖页面 hook）：
      //   1) preload 在页面 requestFullscreen 时提前保存的 htmlFullScreenPrev；
      //   2) 若缺失或为全屏污染值，用主进程镜像 windowBounds/isMaximized
      //      （由 resize/move/maximize/unmaximize 事件持续维护，全屏化 resize/move 不更新）。
      if (!this.htmlFullScreenPrev || this.isFullscreenLikeBounds(this.htmlFullScreenPrev.bounds)) {
        this.htmlFullScreenPrev = {
          wasMaximized: this.isMaximized,
          bounds: this.windowBounds,
        };
      }
      // ⭐ 关键：若窗口当前是最大化，先取消最大化再进全屏——让 Electron 记录
      // 「普通」作为退出还原目标。否则退出全屏时 Electron 会先把窗口还原成
      // 最大化、再被我们的 setBounds 修正，造成「先最大化再退回原始大小」的
      // 两步跳变。用户期望退出后直接回到原始窗口大小。
      if (this.mainWindow.isMaximized()) {
        try { this.mainWindow.unmaximize(); } catch (e) { /* 忽略 */ }
      }
      // 全屏时切不透明背景：本窗口是透明窗口（四角圆角），Windows 对透明窗口的
      // 全屏切换合成开销大（卡顿主因）。全屏无圆角需求，直接切不透明减少重合成。
      try { this.mainWindow.setBackgroundColor('#1a1a2e'); } catch (e) { /* 忽略 */ }
      this.mainWindow.setFullScreen(true);
      this.layoutViews();
      return;
    }

    if (this.htmlFullScreenTabId !== tabId) return;
    this.exitHtmlFullScreen();
  }

  /**
   * 延时检查窗口是否仍异常保持全屏尺寸（自愈兜底）
   * 最大化/正常全屏属正常状态跳过；普通窗口若退出全屏后仍停在全屏尺寸则强制恢复。
   */
  scheduleFullscreenSelfHeal() {
    setTimeout(() => {
      try {
        if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
        if (this.htmlFullScreenTabId) return;               // 又进入了全屏
        if (this.mainWindow.isMaximized() || this.mainWindow.isFullScreen()) return;
        const b = this.mainWindow.getBounds();
        if (this.isFullscreenLikeBounds(b)) {
          this.mainWindow.setBounds(this.windowBounds);
        }
      } catch (e) { /* 忽略 */ }
    }, 400);
  }

  /**
   * 退出网页 HTML5 全屏并恢复窗口状态
   * （Windows 坑：最大化窗口进出全屏后，还原尺寸会被全屏尺寸覆盖，需手动恢复）
   */
  exitHtmlFullScreen() {
    if (!this.htmlFullScreenTabId) return;
    this.htmlFullScreenTabId = null;
    const prev = this.htmlFullScreenPrev;
    this.htmlFullScreenPrev = null;
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
    this.mainWindow.setFullScreen(false);

    // 退出全屏后恢复窗口背景：非最大化才恢复透明（透明用于四角圆角，最大化时
    // 由 maximize 切不透明、unmaximize 恢复透明，这里不重复处理）
    if (!this.isMaximized) {
      try { this.mainWindow.setBackgroundColor('#00000000'); } catch (e) { /* 忽略 */ }
    }

    // 确定要恢复的「进入全屏前状态」：
    // 1) preload hook 保存的 prev —— 但需排除被污染的（等于全屏尺寸）值
    //    （hook 可能未拦截到页面调用的 API，如 webkitRequestFullscreen）
    // 2) 若 prev 无效，用主进程 windowBounds 镜像兜底（resize 时全屏化不更新，保持正确）
    let restore = null;
    if (prev) {
      try {
        const display = screen.getDisplayMatching(prev.bounds);
        const looksFullscreen = prev.bounds.width >= display.bounds.width - 2 &&
          prev.bounds.height >= display.bounds.height - 2;
        if (!looksFullscreen) restore = prev;
      } catch (e) { restore = prev; }
    }
    if (!restore) {
      restore = { wasMaximized: this.isMaximized, bounds: this.windowBounds };
    }
    try {
      if (restore.wasMaximized) {
        // 用户期望：退出全屏直接回到「原始窗口大小」（普通窗口），不经过最大化。
        // setBounds 对全屏/最大化窗口一步生效（自动取消最大化并设置尺寸），
        // 窗口从全屏直接到原始尺寸，无「先最大化再还原」的中间跳变。
        this.mainWindow.setBounds(restore.bounds);
      } else {
        // 普通窗口：确保不被最大化，直接恢复到原始边界
        if (this.mainWindow.isMaximized()) this.mainWindow.unmaximize();
        this.mainWindow.setBounds(restore.bounds);
      }
    } catch (e) { /* 忽略 */ }
    this.layoutViews();

    // 最终自愈：延时检查窗口是否仍异常保持全屏尺寸（极端情况下 setFullScreen(false)
    // 未还原、且镜像恢复被异步覆盖），强制用镜像恢复。
    this.scheduleFullscreenSelfHeal();
  }

  /**
   * 将 BrowserView 缩小为 1x1 并留在窗口左上角（保持附加在窗口内）。
   * 为什么不能 removeBrowserView：视图被移出窗口后，display compositor 会
   * 停止提交该视图的画面帧 → 网页/视频画面冻结，但媒体仍在解码（声音正常）。
   * 为什么不能移出屏幕（负坐标）：会触发遮挡检测，页面变 hidden → 视频暂停。
   * 保持附加且留在窗口内、仅缩小到 1x1：页面保持 visible、合成器持续渲染，
   * 视频画面与声音都不会中断（仅占用左上角 1 个像素，肉眼不可见）。
   * @param {Electron.BrowserView} view
   */
  hideViewInvisible(view) {
    if (!view) return;
    try {
      view.setBounds({ x: 0, y: 0, width: 1, height: 1 });
    } catch (e) { /* 忽略 */ }
  }

  /**
   * 重排视图布局
   */
  layoutViews() {
    if (!this.mainWindow) return;

    if (this.htmlFullScreenTabId) {
      const fullScreenTab = this.tabs.find(t => t.id === this.htmlFullScreenTabId);
      if (fullScreenTab && fullScreenTab.view) {
        const display = screen.getDisplayMatching(this.mainWindow.getBounds());
        // setBounds 去重：全屏过渡期间 resize/enter-full-screen 等事件密集触发
        // layoutViews，bounds 未变化时不重复设置，避免无谓重绘卡顿
        const nb = { x: 0, y: 0, width: display.bounds.width, height: display.bounds.height };
        const cb = fullScreenTab.view.getBounds();
        if (cb.x !== nb.x || cb.y !== nb.y || cb.width !== nb.width || cb.height !== nb.height) {
          fullScreenTab.view.setBounds(nb);
        }
      }
      return;
    }

    // 模态框（下载/历史/扩展面板）打开期间，被挂起的标签页保持 1x1 缩小隐藏，
    // 防止这里把它放回屏幕而盖住面板
    if (this.suspendedTabId) return;

    // 浏览器 UI 高度（与 app.css 中的 CSS 变量保持一致）
    const titleBarHeight = 38;
    const toolbarHeight = 46;
    const bookmarkBarHeight = 32;
    const statusBarHeight = 24;
    const topOffset = titleBarHeight + toolbarHeight + bookmarkBarHeight;
    // 左侧偏移：垂直标签栏宽度 + 侧边栏宽度（与 app.css 变量保持一致）
    const leftOffset = (this.verticalTabs ? 220 : 0) + (this.sidebarOpen ? 300 : 0);

    const contentBounds = this.mainWindow.getContentBounds();
    const activeTab = this.tabs.find(t => t.id === this.activeTabId);
    const splitTab = this.splitTabId ? this.tabs.find(t => t.id === this.splitTabId) : null;
    const contentHeight = contentBounds.height - topOffset - statusBarHeight;
    const setViewBounds = (view, nb) => {
      const cb = view.getBounds();
      if (cb.x !== nb.x || cb.y !== nb.y || cb.width !== nb.width || cb.height !== nb.height) {
        view.setBounds(nb);
      }
    };

    // 分屏模式：活动标签在左栏、分屏标签在右栏（中间留 2px 缝隙显示背景）
    if (splitTab && splitTab.view && splitTab.id !== this.activeTabId) {
      const gap = 2;
      const totalW = contentBounds.width - leftOffset;
      const leftW = Math.floor((totalW - gap) / 2);
      if (activeTab && activeTab.view) {
        setViewBounds(activeTab.view, { x: leftOffset, y: topOffset, width: leftW, height: contentHeight });
      }
      setViewBounds(splitTab.view, {
        x: leftOffset + leftW + gap,
        y: topOffset,
        width: totalW - leftW - gap,
        height: contentHeight,
      });
    } else if (activeTab && activeTab.view) {
      // BrowserView 放在 UI 元素下方，留出标题栏、工具栏、书签栏、状态栏空间；
      // 垂直标签栏模式下再留出左侧标签栏宽度
      setViewBounds(activeTab.view, {
        x: leftOffset,
        y: topOffset,
        width: contentBounds.width - leftOffset,
        height: contentHeight,
      });
    }

    // 悬浮面板覆盖层跟随内容区布局
    this.layoutPanelOverlay();
  }

  /**
   * 切换 HTML 模态框与 BrowserView 的可见关系
   * BrowserView 始终盖在主窗口 webContents 之上，因此显示模态框时需要把当前标签页
   * 缩小为 1x1（保持附加且留在窗口内，避免视频画面冻结）
   * @param {boolean} visible
   */
  async setModalVisible(visible) {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
    const operationId = ++this.modalOperationId;

    if (visible) {
      if (this.activeTabId && !this.suspendedTabId) {
        const tab = this.tabs.find(t => t.id === this.activeTabId);
        if (tab && tab.view) {
          this.suspendedTabId = this.activeTabId;
          let snapshotReady = Promise.resolve();
          try {
            const image = await tab.view.webContents.capturePage();
            const dataUrl = image && !image.isEmpty() ? image.toDataURL() : '';
            this.sendToRenderer(IPC_CHANNELS.UI_MODAL_SNAPSHOT, { dataUrl });
            snapshotReady = new Promise((resolve) => {
              this.modalSnapshotResolve = resolve;
              setTimeout(() => {
                if (this.modalSnapshotResolve === resolve) {
                  this.modalSnapshotResolve = null;
                  resolve();
                }
              }, 2000);
            });
          } catch (e) {
            this.sendToRenderer(IPC_CHANNELS.UI_MODAL_SNAPSHOT, { dataUrl: '' });
            snapshotReady = new Promise((resolve) => {
              this.modalSnapshotResolve = resolve;
              setTimeout(() => {
                if (this.modalSnapshotResolve === resolve) {
                  this.modalSnapshotResolve = null;
                  resolve();
                }
              }, 2000);
            });
          }
          await snapshotReady;
          if (operationId !== this.modalOperationId || this.suspendedTabId !== this.activeTabId) {
            return;
          }
          // 缩小为 1x1 而非 removeBrowserView：保持附加且留在窗口内，
          // 让视频画面持续渲染（不会出现"声音正常、画面冻结"），
          // 关闭面板后无缝恢复，视频不被打断、不改变显示形态
          this.hideViewInvisible(tab.view);
          // 分屏模式下右栏视图同样缩小隐藏，避免盖住面板
          if (this.splitTabId && this.splitTabId !== this.activeTabId) {
            const splitTab = this.tabs.find(t => t.id === this.splitTabId);
            if (splitTab && splitTab.view) this.hideViewInvisible(splitTab.view);
          }
        }
      }
      return;
    }

    if (!this.suspendedTabId) {
      this.sendToRenderer(IPC_CHANNELS.UI_MODAL_SNAPSHOT, { dataUrl: '' });
      return;
    }

    const target = this.tabs.find(t => t.id === this.suspendedTabId);
    this.suspendedTabId = null; // 先清除，layoutViews 才能把标签页放回屏幕
    if (target && target.view) {
      this.mainWindow.addBrowserView(target.view); // 幂等
      this.layoutViews();
    }
    this.sendToRenderer(IPC_CHANNELS.UI_MODAL_SNAPSHOT, { dataUrl: '' });
  }

  resolveModalSnapshot() {
    if (!this.modalSnapshotResolve) return;
    const resolve = this.modalSnapshotResolve;
    this.modalSnapshotResolve = null;
    resolve();
  }

  // ==================== 悬浮面板覆盖层 ====================

  /**
   * 创建/获取悬浮面板覆盖层视图（小型透明，仅占面板大小）。
   * 透明背景让 CSS border-radius 圆角正确显示，面板内容不透明
   * 由 CSS 背景色提供。尺寸小，不会触发全屏遮挡导致的视频冻结。
   * @returns {Electron.BrowserView}
   */
  ensurePanelOverlayView() {
    // 视图可能已销毁（webContents 崩溃后引用残留）→ 清理引用并重建
    if (this.panelOverlayView) {
      if (this.panelOverlayView.webContents && !this.panelOverlayView.webContents.isDestroyed()) {
        return this.panelOverlayView;
      }
      try { this.mainWindow.removeBrowserView(this.panelOverlayView); } catch (e) { /* 忽略 */ }
      this.panelOverlayView = null;
    }
    const overlay = new BrowserView({
      webPreferences: {
        preload: path.join(__dirname, '..', 'renderer', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        transparent: true,
        backgroundThrottling: false,
      },
    });
    try {
      overlay.setBackgroundColor('#00000000');
    } catch (e) { /* 忽略 */ }
    this.panelOverlayView = overlay;
    // 视图常驻附加：add 一次后不再 remove（避免每次开/关面板整窗重合成频闪），
    // 初始移到屏幕外保持隐藏
    try {
      this.mainWindow.addBrowserView(overlay);
      overlay.setBounds({ x: PANEL_HIDDEN_X, y: PANEL_HIDDEN_Y, width: 1, height: 1 });
    } catch (e) { /* 忽略 */ }
    overlay.webContents.on('did-finish-load', () => {
      this.sendPanelOverlayAnchor();
    });
    return overlay;
  }

  /**
   * 根据面板类型估算面板尺寸
   */
  _getPanelSize(type) {
    switch (type) {
      case 'downloads': return { width: 380, height: 440 };
      case 'history': return { width: 420, height: 480 };
      case 'extensions': return { width: 380, height: 420 };
      case 'bookmarks': return { width: 400, height: 520 };
      case 'bookmarkFolder': return { width: 280, height: 360 };
      case 'account': return { width: 320, height: 500 };
      default: return { width: 380, height: 420 };
    }
  }

  /**
   * 向活动标签页注入"点击关闭面板"监听器。
   * 用户点击网页任意位置 → IPC 通知主进程关闭悬浮面板。
   */
  _injectPanelClickCloser() {
    const activeTab = this.tabs.find(t => t.id === this.activeTabId);
    if (!activeTab || !activeTab.view || activeTab.view.webContents.isDestroyed()) return;
    activeTab.view.webContents.executeJavaScript(`
      if (!window.__neutronPanelCloser) {
        window.__neutronPanelCloser = function() {
          document.removeEventListener('click', window.__neutronPanelCloser, true);
          delete window.__neutronPanelCloser;
          if (window.NeutronBrowser && window.NeutronBrowser.notifyPanelClickOutside) {
            window.NeutronBrowser.notifyPanelClickOutside();
          }
        };
        document.addEventListener('click', window.__neutronPanelCloser, true);
      }
    `).catch(() => {});
  }

  /**
   * 从活动标签页清除"点击关闭面板"监听器。
   */
  _removePanelClickCloser() {
    const activeTab = this.tabs.find(t => t.id === this.activeTabId);
    if (!activeTab || !activeTab.view || activeTab.view.webContents.isDestroyed()) return;
    activeTab.view.webContents.executeJavaScript(`
      if (window.__neutronPanelCloser) {
        document.removeEventListener('click', window.__neutronPanelCloser, true);
        delete window.__neutronPanelCloser;
      }
    `).catch(() => {});
  }

  /**
   * 显示悬浮面板覆盖层：小型不透明面板浮在页面之上。
   * @param {Object} payload - { type: 'downloads'|'history'|'extensions', anchor }
   */
  async showPanelOverlay(payload) {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
    const type = payload && payload.type;
    if (!type) return;
    // 面板与扩展 Popup 互斥
    this.hideExtensionPopup();
    const overlay = this.ensurePanelOverlayView();
    if (!overlay || overlay.webContents.isDestroyed()) return;
    this.panelOverlayType = type;
    this.panelOverlayAnchor = (payload && payload.anchor) || null;

    // 先把视图移到屏幕外（保持尺寸），在屏幕外完成加载，最后同尺寸平移到目标位置。
    // 视图常驻附加，不 add/removeBrowserView、无尺寸跳变 → 消除整窗重合成频闪
    try {
      const b = overlay.getBounds();
      overlay.setBounds({
        x: PANEL_HIDDEN_X,
        y: PANEL_HIDDEN_Y,
        width: b.width > 0 ? b.width : 380,
        height: b.height > 0 ? b.height : 420,
      });
    } catch (e) { /* 忽略 */ }

    const targetUrl = 'file:///' + path.join(__dirname, '..', 'renderer', 'app.html').replace(/\\/g, '/')
      + `?overlay=1&panel=${encodeURIComponent(type)}`;
    if (overlay.webContents.getURL() !== targetUrl) {
      await overlay.webContents.loadURL(targetUrl).catch(() => {});
    }

    // 定位到目标位置（同尺寸移动）+ 仅当不在顶层时才置顶
    this.layoutPanelOverlay();
    const views = this.mainWindow.getBrowserViews();
    if (views[views.length - 1] !== overlay) {
      this.mainWindow.setTopBrowserView(overlay);
    }
    this.sendPanelOverlayAnchor();

    // 向活动页面注入"点击任意位置关闭面板"监听器
    this._injectPanelClickCloser();
  }

  /**
   * 隐藏悬浮面板覆盖层
   */
  hidePanelOverlay() {
    if (!this.panelOverlayView) return;
    // 视图已销毁：仅清理引用，不再操作
    if (!this.panelOverlayView.webContents || this.panelOverlayView.webContents.isDestroyed()) {
      this.panelOverlayView = null;
      this.panelOverlayType = null;
      this.panelOverlayAnchor = null;
      this._bookmarkFolderData = null;
      return;
    }
    // 清除页面注入的点击监听器
    this._removePanelClickCloser();
    try {
      // 移到屏幕外保持附加（不 removeBrowserView）：避免整窗重合成频闪
      const b = this.panelOverlayView.getBounds();
      this.panelOverlayView.setBounds({
        x: PANEL_HIDDEN_X,
        y: PANEL_HIDDEN_Y,
        width: b.width > 0 ? b.width : 380,
        height: b.height > 0 ? b.height : 420,
      });
    } catch (e) { /* 忽略 */ }
    this.panelOverlayType = null;
    this.panelOverlayAnchor = null;
    this._bookmarkFolderData = null;
    this.sendToRenderer(IPC_CHANNELS.PANEL_OVERLAY_CLOSED, {});
  }

  // ==================== 扩展包拖放全窗覆盖层（Edge 式） ====================

  /**
   * 创建/获取扩展包拖放提示覆盖层：透明 BrowserView 盖住整个窗口，
   * 加载 app.html?overlay=1&panel=extensionDrop 显示居中的「松开以安装扩展」提示卡片。
   * BrowserView 是原生视图，可以盖在网页标签页之上，实现全窗口的拖放反馈。
   */
  ensureExtensionDropView() {
    if (this.extensionDropView) return this.extensionDropView;
    const view = new BrowserView({
      webPreferences: {
        preload: path.join(__dirname, '..', 'renderer', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        transparent: true,
        backgroundThrottling: false,
      },
    });
    try {
      view.setBackgroundColor('#00000000');
    } catch (e) { /* 忽略 */ }
    // 竞态兜底：覆盖层首次创建加载 app.html 期间用户就松手时，
    // 文件会落到未初始化的 webContents 上被 Chromium 当作 file:// 导航。
    // 在此拦截 .crx/.zip 的导航并转交安装链路，避免覆盖层跳转成错误页。
    view.webContents.on('will-navigate', (event, url) => {
      if (!url || !url.startsWith('file://')) return;
      const filePath = this.fileUrlToPath(url);
      if (filePath && /\.(crx|zip)$/i.test(filePath)) {
        event.preventDefault();
        this.handleExtensionDragDrop(filePath);
      }
    });
    this.extensionDropView = view;
    return view;
  }

  /**
   * 显示拖放提示覆盖层（进入窗口拖拽 .crx/.zip 时）
   */
  showExtensionDropOverlay() {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
    const view = this.ensureExtensionDropView();

    const contentBounds = this.mainWindow.getContentBounds();
    view.setBounds({
      x: 0,
      y: 0,
      width: Math.round(contentBounds.width),
      height: Math.round(contentBounds.height),
    });

    this.mainWindow.addBrowserView(view);
    this.mainWindow.setTopBrowserView(view);

    const targetUrl = 'file:///' + path.join(__dirname, '..', 'renderer', 'app.html').replace(/\\/g, '/')
      + '?overlay=1&panel=extensionDrop';
    if (view.webContents.getURL() !== targetUrl) {
      view.webContents.loadURL(targetUrl).catch(() => {});
    }
  }

  /**
   * 隐藏拖放提示覆盖层并重置计数
   */
  hideExtensionDropOverlay() {
    this.extensionDragDepth = 0;
    if (!this.extensionDropView) return;
    try {
      this.mainWindow.removeBrowserView(this.extensionDropView);
    } catch (e) { /* 忽略 */ }
  }

  /**
   * 拖拽进入（.crx/.zip）：计数 +1 并显示覆盖层。
   * 事件可能来自主窗口渲染层 / 网页预加载脚本 / 覆盖层自身，
   * 用计数器避免跨 webContents 边界时覆盖层闪烁。
   */
  handleExtensionDragEnter() {
    this.extensionDragDepth++;
    console.log('[DropInstall][main] dragEnter depth=', this.extensionDragDepth);
    try { require('./dragDebugLog').logDrag('main', 'dragEnter', { depth: this.extensionDragDepth }); } catch (e) { /* 忽略 */ }
    this.showExtensionDropOverlay();
  }

  /**
   * 拖拽离开：计数 -1，归零时隐藏覆盖层
   */
  handleExtensionDragLeave() {
    this.extensionDragDepth = Math.max(0, this.extensionDragDepth - 1);
    console.log('[DropInstall][main] dragLeave depth=', this.extensionDragDepth);
    try { require('./dragDebugLog').logDrag('main', 'dragLeave', { depth: this.extensionDragDepth }); } catch (e) { /* 忽略 */ }
    if (this.extensionDragDepth === 0) {
      this.hideExtensionDropOverlay();
    }
  }

  /**
   * 拖放完成：隐藏覆盖层并转发文件路径给主窗口渲染层执行安装
   * （统一安装链路：网页区域 / 主窗口 chrome 区域 / 覆盖层都汇合到这里）
   * @param {string} filePath
   */
  handleExtensionDragDrop(filePath) {
    console.log('[DropInstall][main] dragDrop path=', filePath);
    try { require('./dragDebugLog').logDrag('main', 'drop', { path: filePath }); } catch (e) { /* 忽略 */ }
    this.hideExtensionDropOverlay();
    // 空路径也转发：渲染层会给出「无法获取文件路径」的明确提示，而不是静默失败
    if (typeof filePath === 'string') {
      this.sendToRenderer(IPC_CHANNELS.EXTENSIONS_DROP_FILE, filePath);
    }
  }

  /**
   * 覆盖层布局：仅占面板大小，定位在触发按钮附近。
   */
  layoutPanelOverlay() {
    if (!this.mainWindow || !this.panelOverlayView) return;
    // 面板未打开：保持隐藏（屏幕外），避免 layoutViews 把它放回屏幕
    if (!this.panelOverlayType) return;
    const contentBounds = this.mainWindow.getContentBounds();
    const size = this._getPanelSize(this.panelOverlayType || 'downloads');
    const anchor = this.panelOverlayAnchor || { left: 100, top: 0, right: 140, bottom: 36, width: 40, height: 36 };
    const titleBarH = 38;
    const toolbarH = 46;

    let left, top;

    if (this.panelOverlayType === 'bookmarkFolder') {
      // 书签文件夹弹出菜单：直接定位到点击坐标
      left = anchor.left;
      top = anchor.top;
    } else {
      // 下载/历史/扩展面板：右对齐按钮，向下偏移
      left = anchor.right - size.width;
      top = titleBarH + toolbarH + (anchor.bottom - anchor.top) + 8;
    }

    if (left < 8) left = 8;
    if (left + size.width > contentBounds.width - 8) {
      left = Math.max(8, contentBounds.width - size.width - 8);
    }
    if (top + size.height > contentBounds.height - 32) {
      top = Math.max(titleBarH + toolbarH + 4, anchor.top - size.height - 8);
    }

    // setBounds 要求整数坐标，浮点数会导致 conversion failure
    this.panelOverlayView.setBounds({
      x: Math.round(left),
      y: Math.round(top),
      width: Math.round(size.width),
      height: Math.round(size.height),
    });
  }

  /**
   * 发送锚点（按钮位置）到覆盖层，供面板定位。
   * 覆盖层视口坐标 = 窗口坐标 - contentOffsetY。
   */
  sendPanelOverlayAnchor() {
    if (!this.panelOverlayView || this.panelOverlayView.webContents.isDestroyed()) return;
    this.panelOverlayView.webContents.send(IPC_CHANNELS.PANEL_OVERLAY_ANCHOR, {
      anchor: this.panelOverlayAnchor,
      contentOffsetY: 84,
      bookmarkFolderData: this._bookmarkFolderData || null,
    });
    // 数据不在此清除，由 hidePanelOverlay 统一清理（避免推送时序丢失）
  }

  /**
   * 刷新书签文件夹弹出菜单（书签被移入/移出后实时更新）。
   * 重新从存储读取文件夹内容并推送到覆盖层重新渲染。
   * @param {string} folderId
   */
  refreshBookmarkFolderPopup(folderId) {
    if (!folderId) return;
    const store = getStore('bookmarks');
    const data = store.getAll();

    const findFolder = (folder) => {
      if (!folder) return null;
      if (folder.id === folderId) return folder;
      for (const child of (folder.children || [])) {
        if (child.type === 'folder') {
          const found = findFolder(child);
          if (found) return found;
        }
      }
      return null;
    };

    let folder = null;
    for (const key of Object.keys(data)) {
      if (data[key].type !== 'folder') continue;
      folder = folder || findFolder(data[key]);
    }
    if (!folder || !this.panelOverlayView || this.panelOverlayView.webContents.isDestroyed()) return;

    const buildItems = (parent) => (parent.children || []).map(child => ({
      id: child.id,
      title: child.title || (child.type === 'folder' ? '未命名文件夹' : '未命名书签'),
      url: child.url || '',
      favicon: child.favicon || '',
      type: child.type,
      children: child.type === 'folder' ? buildItems(child) : [],
    }));

    this._bookmarkFolderData = {
      folderId: folder.id,
      folderTitle: folder.title || '未命名文件夹',
      x: (this._bookmarkFolderData && this._bookmarkFolderData.x) || 0,
      y: (this._bookmarkFolderData && this._bookmarkFolderData.y) || 0,
      items: buildItems(folder),
    };
    // 推送到覆盖层重新渲染
    this.sendPanelOverlayAnchor();
  }

  // ==================== 扩展 Popup 覆盖层（对齐 Edge：点击工具栏扩展图标弹出） ====================

  /** 创建/获取扩展 Popup 覆盖层视图（非透明白底 BrowserView，加载 chrome-extension:// 的 popup.html） */
  ensureExtensionPopupView() {
    // ⚠️ 视图可能已销毁（webContents 崩溃/cleanup 异常后引用残留），复用会报
    // 「Can't add a destroyed child view to a parent view」（setTopBrowserView 抛错）
    // → 检测到已销毁则清理引用并重建。
    if (this.extensionPopupView) {
      // ⚠️ BrowserView 销毁后 .webContents 可能返回 undefined，需防御
      if (this.extensionPopupView.webContents && !this.extensionPopupView.webContents.isDestroyed()) {
        return this.extensionPopupView;
      }
      try { this.mainWindow.removeBrowserView(this.extensionPopupView); } catch (e) { /* 忽略 */ }
      this.extensionPopupView = null;
    }
    const overlay = new BrowserView({
      webPreferences: {
        preload: path.join(__dirname, '..', 'renderer', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        // 非透明：透明视图在 Windows 上 add/setBounds 会造成整窗重合成频闪，
        // 且扩展 popup 页面透明时弹窗会完全隐形（"点了没反应"）
        transparent: false,
        backgroundThrottling: false,
      },
    });
    try {
      overlay.setBackgroundColor('#FFFFFF');
    } catch (e) { /* 忽略 */ }
    // popup 页面加载失败（文件缺失/导航失败）→ 自动关闭并通知渲染层提示
    overlay.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame || !this.extensionPopupId) return;
      if (errorCode === -3) return; // ERR_ABORTED：主动切换加载/关闭，忽略
      this.hideExtensionPopup();
      this.sendToRenderer(IPC_CHANNELS.EXTENSIONS_ACTION_POPUP_CLOSED, { failed: true, errorCode });
    });
    this.extensionPopupView = overlay;
    return overlay;
  }

  /**
   * 打开扩展 Popup（悬浮在工具栏扩展图标下方）
   * @param {Object} payload - { id, popup, anchor }
   * @returns {Promise<{ok:boolean, reason?:string}>} 供渲染层提示失败原因
   */
  async openExtensionPopup(payload) {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return { ok: false, reason: 'no-window' };
    const { id, popup, anchor } = payload || {};
    if (!id || !popup) return { ok: false, reason: 'no-popup' };

    // popup 文件存在性校验：扩展更新后路径可能失效，提前给出明确提示
    const { getInstalledExtensions } = require('./extensions');
    const installed = getInstalledExtensions();
    const ext = installed.find((e) => e.id === id);
    if (!ext || !ext.path) return { ok: false, reason: 'not-installed' };
    const popupRel = String(popup).replace(/^\/+/, '').split(/[?#]/)[0];
    if (!popupRel || !require('fs').existsSync(path.join(ext.path, popupRel))) {
      return { ok: false, reason: 'popup-missing' };
    }

    // 关闭其他悬浮面板覆盖层
    if (this.panelOverlayView && this.panelOverlayType) this.hidePanelOverlay();

    const view = this.ensureExtensionPopupView();
    if (!view || view.webContents.isDestroyed()) {
      return { ok: false, reason: 'no-view' };
    }

    // 先计算目标位置（锚点下方、右对齐），再统一处理「隐藏 → 加载 → 显示」，
    // 保证弹窗在屏幕外完成所有准备工作后才平移到目标位置
    const size = EXT_POPUP_SIZE;
    const rect = anchor || { left: 100, top: 0, right: 140, bottom: 36, width: 40, height: 36 };
    const contentBounds = this.mainWindow.getContentBounds();
    const titleBarH = 38;
    const toolbarH = 46;
    let left = rect.right - size.width;
    let top = titleBarH + toolbarH + (rect.bottom - rect.top) + 8;
    if (left < 8) left = 8;
    if (left + size.width > contentBounds.width - 8) {
      left = Math.max(8, contentBounds.width - size.width - 8);
    }
    if (top + size.height > contentBounds.height - 32) {
      top = Math.max(titleBarH + toolbarH + 4, rect.top - size.height - 8);
    }
    const targetBounds = { x: Math.round(left), y: Math.round(top), width: size.width, height: size.height };

    const targetUrl = `chrome-extension://${id}/${String(popup).replace(/^\/+/, '')}`;
    const needLoad = view.webContents.getURL() !== targetUrl;

    this.extensionPopupId = id;

    // 先把视图移到屏幕外（保持原尺寸，避免与 1×1 之间的尺寸跳变）
    try {
      const b = view.getBounds();
      const w = b.width > 0 ? b.width : size.width;
      const h = b.height > 0 ? b.height : size.height;
      view.setBounds({ x: EXT_POPUP_HIDDEN_X, y: EXT_POPUP_HIDDEN_Y, width: w, height: h });
    } catch (e) { /* 忽略 */ }

    // 仅在 URL 变化时重新加载（在屏幕外完成加载，白底加载页不会在目标位置闪现）
    if (needLoad) {
      await view.webContents.loadURL(targetUrl).catch(() => {});
      // 加载失败：did-fail-load 已把视图隐藏并通知渲染层 → 不再定位显示
      if (!this.extensionPopupId) return { ok: false, reason: 'load-failed' };
    }

    // 附加到窗口（幂等，视图常驻不 remove）；仅当不在顶层时才置顶，
    // 避免每次打开都触发整窗重合成频闪
    this.mainWindow.addBrowserView(view);
    const views = this.mainWindow.getBrowserViews();
    if (views[views.length - 1] !== view) {
      this.mainWindow.setTopBrowserView(view);
    }

    // 同尺寸平移到目标位置：无尺寸跳变 → 无白闪
    view.setBounds(targetBounds);

    // 点击网页任意位置关闭 Popup
    this._injectPanelClickCloser();
    return { ok: true };
  }

  /** 关闭扩展 Popup（移到屏幕外保持附加：不 add/remove BrowserView，避免网页频闪） */
  hideExtensionPopup() {
    if (!this.extensionPopupView) return;
    // 视图已销毁（webContents 为 undefined 或 isDestroyed）：仅清理引用，不再操作
    if (!this.extensionPopupView.webContents || this.extensionPopupView.webContents.isDestroyed()) {
      this.extensionPopupView = null;
      return;
    }
    this._removePanelClickCloser();
    try {
      // 移到屏幕外（保持原尺寸），而非缩成 1×1：
      // 重新打开时只做同尺寸平移，没有 1×1→380×500 的尺寸跳变，
      // 不会强制 compositor 重绘整块白底区域 → 消除打开弹窗时的白闪
      const b = this.extensionPopupView.getBounds();
      const w = b.width > 0 ? b.width : EXT_POPUP_SIZE.width;
      const h = b.height > 0 ? b.height : EXT_POPUP_SIZE.height;
      this.extensionPopupView.setBounds({
        x: EXT_POPUP_HIDDEN_X,
        y: EXT_POPUP_HIDDEN_Y,
        width: w,
        height: h,
      });
    } catch (e) { /* 忽略 */ }
    if (this.extensionPopupId) {
      this.extensionPopupId = null;
      // 通知渲染层同步状态（用于图标开关切换）
      this.sendToRenderer(IPC_CHANNELS.EXTENSIONS_ACTION_POPUP_CLOSED, {});
    }
  }

  /** 检查视图 fallback：打开扩展任意页面（后台页/选项页）的 DevTools */
  openExtensionInspectView(extId) {
    const { webContents } = require('electron');
    const target = webContents.getAllWebContents().find((wc) => {
      const url = wc.getURL();
      return url.includes(`chrome-extension://${extId}/`);
    });
    if (target && !target.isDestroyed()) target.openDevTools({ mode: 'detach' });
  }

  /**
   * 打开扩展选项页（对齐 Edge：右键扩展 → 扩展选项）。
   * 已有窗口则聚焦，否则创建新窗口加载 chrome-extension:// 的 options 页面。
   */
  openExtensionOptionsPage(extId) {
    const { getExtensionMenuMeta } = require('./extensions');
    const meta = getExtensionMenuMeta(extId);
    if (!meta) return { success: false, message: '扩展不存在' };
    if (!meta.hasOptionsPage) return { success: false, message: '此扩展没有选项页' };

    const existing = this.extensionOptionsWindows.get(extId);
    if (existing && !existing.isDestroyed()) {
      if (existing.isMinimized()) existing.restore();
      existing.focus();
      return { success: true, focused: true };
    }

    const win = new BrowserWindow({
      width: 840,
      height: 640,
      minWidth: 480,
      minHeight: 360,
      title: `${meta.name} - 选项`,
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, '..', 'renderer', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });

    this.extensionOptionsWindows.set(extId, win);
    win.on('closed', () => {
      if (this.extensionOptionsWindows.get(extId) === win) {
        this.extensionOptionsWindows.delete(extId);
      }
    });

    const targetUrl = `chrome-extension://${extId}/${String(meta.optionsPage).replace(/^\/+/, '')}`;
    win.loadURL(targetUrl).catch((e) => {
      win.webContents.loadURL(`chrome-extension://${extId}/`).catch(() => {});
      console.warn('[Extensions] 选项页加载失败:', e && e.message);
    });
    return { success: true };
  }

  // ==================== 扩展命令快捷键（对齐 Edge：manifest.commands） ====================

  /** 注册扩展命令快捷键（应用级 before-input-event 捕获） */
  registerExtensionCommands() {
    this._extensionCommands = collectExtensionCommands() || [];
    if (this._extensionCommands.length === 0 || !this.mainWindow) return;

    // chrome UI（地址栏/工具栏）聚焦时
    this.mainWindow.webContents.on('before-input-event', (event, input) => {
      this.handleExtensionCommandInput(event, input);
    });
  }

  /** 统一的扩展命令快捷键处理（chrome UI 与网页标签页共用） */
  handleExtensionCommandInput(event, input) {
    if (!this._extensionCommands || this._extensionCommands.length === 0) return;
    const cmd = this._extensionCommands.find((c) => this.matchAccelerator(c.accelerator, input));
    if (!cmd) return;
    event.preventDefault();
    triggerExtensionCommand(cmd.extId, cmd.name);
  }

  /** 匹配加速键字符串与键盘输入（支持 Ctrl/Alt/Shift/Cmd/CommandOrControl/功能键） */
  matchAccelerator(accelerator, input) {
    const parts = String(accelerator || '')
      .split('+')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const MODS = ['ctrl', 'control', 'command', 'cmd', 'meta', 'alt', 'option',
      'shift', 'super', 'win', 'commandorcontrol', 'cmdorctrl'];
    const key = parts.filter((p) => !MODS.includes(p)).join('');
    if (!key) return false;

    const hasCtrl = parts.includes('ctrl') || parts.includes('control');
    const hasCmd = parts.includes('command') || parts.includes('cmd') || parts.includes('meta');
    const hasAlt = parts.includes('alt') || parts.includes('option');
    const hasShift = parts.includes('shift');
    const hasCmdOrCtrl = parts.includes('commandorcontrol') || parts.includes('cmdorctrl');

    const inputKey = String(input.key || '').toLowerCase();
    if (inputKey !== key) return false;

    const ctrlOk = hasCmdOrCtrl ? (input.control || input.meta) : (hasCtrl ? input.control : !input.control);
    const cmdOk = hasCmdOrCtrl ? true : (hasCmd ? input.meta : !input.meta);
    const altOk = hasAlt ? input.alt : !input.alt;
    const shiftOk = hasShift ? input.shift : !input.shift;
    return ctrlOk && cmdOk && altOk && shiftOk;
  }

  /**
   * 记录或更新当前标签页的历史条目
   * @param {Object} tab - 标签页对象
   * @param {'navigation'|'meta'} mode - navigation 表示一次新访问，meta 表示标题/图标更新
   */
  recordHistoryEntry(tab, mode) {
    // 无痕窗口不写入历史记录
    if (this.incognito) return;
    if (!tab || !tab.url || !/^https?:/i.test(tab.url)) return;

    const store = getStore('history');
    const visits = store.get('visits', []);
    const url = tab.url;
    const title = normalizeHistoryTitle(tab.title, url);
    const favicon = sanitizeFavicon(tab.favicon, url);
    const existing = visits.find((item) => item.url === url);

    if (mode === 'navigation') {
      if (existing) {
        existing.title = title;
        existing.favicon = favicon || sanitizeFavicon(existing.favicon, url);
        existing.visitCount = (existing.visitCount || 1) + 1;
        existing.lastVisitTime = Date.now();
      } else {
        visits.unshift({
          id: `hist_${Date.now()}`,
          url,
          title,
          favicon,
          visitCount: 1,
          firstVisitTime: Date.now(),
          lastVisitTime: Date.now(),
        });
      }
    } else if (existing) {
      existing.title = title;
      existing.favicon = favicon || sanitizeFavicon(existing.favicon, url);
    } else {
      visits.unshift({
        id: `hist_${Date.now()}`,
        url,
        title,
        favicon,
        visitCount: 1,
        firstVisitTime: Date.now(),
        lastVisitTime: Date.now(),
      });
    }

    if (visits.length > 10000) {
      visits.splice(10000);
    }
    store.set('visits', visits);
  }

  /**
   * 设置视图事件监听
   * @param {BrowserView} view
   * @param {string} tabId
   */
  setupViewEvents(view, tabId) {
    const wc = view.webContents;

    // ===== 拦截 iframe 内的 HTML5 全屏（视频站内嵌播放器，如 B 站/爱奇艺） =====
    // iframe 有独立的 JS 上下文（realm），主 frame 的 requestFullscreen hook 拦截不到。
    // 因此主进程在每个子 frame 创建/加载完成时注入 hook：iframe 请求全屏前通过
    // postMessage 通知主 frame（preload 已监听），主 frame 再同步保存窗口状态。
    const IFRAME_FS_HOOK = `(function () {
      try {
        if (window.__neutronFsHook) return;
        var save = function () {
          try { window.top.postMessage({ __neutronSaveFs: 1 }, '*'); } catch (e) {}
        };
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
        window.__neutronFsHook = true;
      } catch (e) {}
    })();`;

    const injectIframeFsHook = (frame) => {
      try {
        frame.executeJavaScript(IFRAME_FS_HOOK).catch(() => {});
      } catch (e) { /* 忽略 */ }
    };

    wc.on('frame-created', (event, details) => {
      const frame = details && details.frame;
      if (frame && frame !== wc.mainFrame) injectIframeFsHook(frame);
    });

    // 兜底：frame-created 时 JS 环境可能未就绪导致注入失败，加载完成后重试
    wc.on('did-frame-finish-load', () => {
      try {
        const frames = wc.mainFrame ? wc.mainFrame.frames : [];
        for (const f of frames) injectIframeFsHook(f);
      } catch (e) { /* 忽略 */ }
    });

    // 网页右键菜单，参考 Edge 的常用操作
    this.setupWebContentsContextMenu(wc);

    // 扩展命令快捷键：网页聚焦时也要生效（mainWindow.webContents 只覆盖 chrome UI）
    wc.on('before-input-event', (event, input) => {
      this.handleExtensionCommandInput(event, input);
    });

    // 拖放 .crx/.zip 扩展包到网页区域：Electron 默认会把文件导航到 file://，
    // 在此拦截并转交渲染层安装扩展
    wc.on('will-navigate', (event, url) => {
      if (!url || !url.startsWith('file://')) return;
      const filePath = this.fileUrlToPath(url);
      if (filePath && /\.(crx|zip)$/i.test(filePath)) {
        event.preventDefault();
        this.sendToRenderer(IPC_CHANNELS.EXTENSIONS_DROP_FILE, filePath);
      }
    });

    // 页面标题更新
    wc.on('page-title-updated', (event, title) => {
      const tab = this.tabs.find(t => t.id === tabId);
      if (tab) {
        tab.title = title;
        this.syncTabsToRenderer();
        this.syncNavState(tab);
        this.recordHistoryEntry(tab, 'meta');
        this.notifyTabUpdatedForExt(tab, { title });
      }
    });

    wc.on('enter-html-full-screen', () => {
      // 注意：Electron 会先自动把窗口改成全屏再触发本事件（无法 preventDefault），
      // 进入前的窗口状态由 preload 的 requestFullscreen 拦截提前保存。
      this.handleHtmlFullScreen(tabId, true);
    });

    wc.on('leave-html-full-screen', () => {
      this.handleHtmlFullScreen(tabId, false);
    });

    // 页面 favicon 更新
    wc.on('page-favicon-updated', (event, favicons) => {
      const tab = this.tabs.find(t => t.id === tabId);
      if (tab && favicons.length > 0) {
        tab.favicon = favicons[0];
        this.syncTabsToRenderer();
        this.syncNavState(tab);
        this.recordHistoryEntry(tab, 'meta');
        this.notifyTabUpdatedForExt(tab, { favIconUrl: favicons[0] });
      }
    });

    // URL 变化（导航完成）
    wc.on('did-navigate', (event, url) => {
      const tab = this.tabs.find(t => t.id === tabId);
      if (tab) {
        tab.url = url;
        tab.isLoading = false;
        tab.loadingProgress = 100;
        this.syncTabsToRenderer();
        this.syncNavState(tab);
        this.recordHistoryEntry(tab, 'navigation');
        this.notifyTabUpdatedForExt(tab, { url, status: 'complete' });
        // 真实导航成功：清理导航前的标题备份
        delete tab._prevTitle;
        delete tab._prevFavicon;
      }
    });

    wc.on('did-navigate-in-page', (event, url) => {
      const tab = this.tabs.find(t => t.id === tabId);
      if (tab) {
        tab.url = url;
        this.syncTabsToRenderer();
        this.syncNavState(tab);
        this.recordHistoryEntry(tab, 'navigation');
        this.notifyTabUpdatedForExt(tab, { url });
      }
    });

    // 加载开始
    wc.on('did-start-loading', () => {
      // 新页面开始加载：重置媒体计数与后台节流（上一页面的媒体已被销毁）
      mediaCount = 0;
      setThrottling(true);
      const tab = this.tabs.find(t => t.id === tabId);
      if (tab) {
        tab.isLoading = true;
        tab.loadingProgress = 0;
        this.syncTabsToRenderer();
      }
    });

    // 加载完成
    wc.on('did-stop-loading', () => {
      const tab = this.tabs.find(t => t.id === tabId);
      if (tab) {
        tab.isLoading = false;
        tab.loadingProgress = 100;
        this.syncTabsToRenderer();
        this.syncNavState(tab);
      }
    });

    // 加载进度
    wc.on('did-start-navigation', (event, url, isInPlace, isMainFrame) => {
      if (isMainFrame && isEdgeStoreUrl(url)) {
        setupEdgeStoreHeaders();
        wc.setUserAgent(EDGE_USER_AGENT);
        wc.executeJavaScript(EDGE_STORE_JS_PATCH).catch(() => {});
      }
      const tab = this.tabs.find(t => t.id === tabId);
      if (tab) {
        if (isMainFrame) {
          tab.url = url || tab.url;
          // ⚠️ 站内 History API 导航（isInPlace=true：pushState/replaceState/hash 变化）
          // 是同文档导航，页面不重载、document.title 不变 → page-title-updated 不会
          // 再次触发。若在这里清空 tab.title，标签页会永久显示「新标签页」——
          // 视频页在播放中做站内导航（如 B 站换集/切清晰度/直播拉流）即触发此 bug。
          // 因此仅真正的跨文档导航才清空标题/图标并置加载状态。
          if (!isInPlace) {
            // 记录旧标题/图标：导航被中止（ERR_ABORTED，旧页面仍显示）时恢复
            tab._prevTitle = tab.title || '';
            tab._prevFavicon = tab.favicon || '';
            tab.title = '';
            tab.favicon = '';
            tab.isLoading = true;
            tab.loadingProgress = 10;
          }
          this.syncNavState(tab);
        }
        if (!isInPlace) {
          tab.loadingProgress = 10;
          this.sendToRenderer(IPC_CHANNELS.NAV_LOADING_PROGRESS, { tabId, progress: 10 });
        }
      }
    });

    // 主框架导航被中止（ERR_ABORTED）：导航未 commit，旧页面通常仍显示，
    // 恢复标题/图标，避免标签页显示成「新标签页」
    wc.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame) return;
      const tab = this.tabs.find(t => t.id === tabId);
      if (!tab) return;
      if (errorCode === -3 && !tab.title && tab._prevTitle) {
        tab.title = tab._prevTitle;
        tab.favicon = tab._prevFavicon || tab.favicon;
        tab.isLoading = false;
        tab.loadingProgress = 100;
        this.syncTabsToRenderer();
        this.syncNavState(tab);
      }
      delete tab._prevTitle;
      delete tab._prevFavicon;
    });

    // 音频状态变化 + 后台节流控制
    // 媒体播放期间关闭后台节流（setBackgroundThrottling(false)）：窗口最小化/
    // 被遮挡等窗口级隐藏时，页面仍报告可见、不节流 rAF/定时器、媒体不被挂起，
    // 站点也不会因 visibilitychange 主动调 video.pause()。
    // （标签页被缩小隐藏时页面仍保持可见，主要由 hideViewInvisible 保证渲染。）
    let mediaCount = 0;
    const setThrottling = (allowed) => {
      try {
        if (!wc.isDestroyed()) wc.setBackgroundThrottling(allowed);
      } catch (e) { /* 忽略：某些情况下 webContents 已不可用 */ }
    };

    wc.on('media-started-playing', () => {
      mediaCount += 1;
      setThrottling(false); // 有媒体在播：禁止后台节流，防止视频被挂起/暂停
      const tab = this.tabs.find(t => t.id === tabId);
      if (tab) {
        tab.isAudible = true;
        this.syncTabsToRenderer();
      }
    });

    wc.on('media-paused', () => {
      mediaCount = Math.max(0, mediaCount - 1);
      const tab = this.tabs.find(t => t.id === tabId);
      if (tab) {
        // 可能存在多个媒体，简单检查
        if (!wc.isCurrentlyAudible() && mediaCount === 0) {
          setThrottling(true); // 无任何媒体播放：恢复正常后台节流
          tab.isAudible = false;
          this.syncTabsToRenderer();
        }
      }
    });

    // 导航状态更新
    wc.on('did-navigate', () => this.updateNavStateForTab(tabId));
    wc.on('did-navigate-in-page', () => this.updateNavStateForTab(tabId));
    wc.on('did-start-navigation', () => this.updateNavStateForTab(tabId));
  }

  /**
   * 为网页标签添加 Edge 风格右键菜单
   * @param {Electron.WebContents} wc
   */
  setupWebContentsContextMenu(wc) {
    wc.on('context-menu', (event, params) => {
      const template = [];
      const hasSelection = Boolean(params.selectionText && params.selectionText.trim());
      const isEditable = Boolean(params.isEditable);
      const editFlags = params.editFlags || {};

      if (params.linkURL) {
        template.push(
          { label: '在新标签页中打开链接', click: () => this.createTab(params.linkURL) },
          { label: '在新标签页中后台打开链接', click: () => this.createTab(params.linkURL, false) },
          { type: 'separator' },
          { label: '复制链接地址', click: () => clipboard.writeText(params.linkURL) },
          { label: '下载链接', click: () => wc.downloadURL(params.linkURL) },
          { type: 'separator' }
        );
      }

      if (params.mediaType === 'image') {
        template.push(
          { label: '在新标签页中打开图片', click: () => this.createTab(params.srcURL) },
          { label: '复制图片地址', click: () => clipboard.writeText(params.srcURL) },
          { label: '图片另存为...', click: () => wc.downloadURL(params.srcURL) },
          { type: 'separator' }
        );
      } else if (params.mediaType === 'video' || params.mediaType === 'audio') {
        template.push(
          { label: '复制媒体地址', click: () => clipboard.writeText(params.srcURL) },
          { label: '媒体另存为...', click: () => wc.downloadURL(params.srcURL) },
          { type: 'separator' }
        );
      }

      if (isEditable || hasSelection) {
        if (isEditable) {
          template.push(
            { role: 'undo', label: '撤销', enabled: editFlags.canUndo !== false },
            { role: 'redo', label: '重做', enabled: editFlags.canRedo !== false },
            { type: 'separator' }
          );
        }

        template.push(
          { role: 'cut', label: '剪切', enabled: isEditable && editFlags.canCut !== false },
          { role: 'copy', label: '复制', enabled: hasSelection || (isEditable && editFlags.canCopy !== false) },
          { type: 'separator' }
        );

        if (isEditable) {
          template.push(
            { role: 'paste', label: '粘贴', enabled: editFlags.canPaste !== false },
            { role: 'delete', label: '删除', enabled: editFlags.canDelete !== false },
            { type: 'separator' }
          );
        }

        template.push({ role: 'selectAll', label: '全选' });

        if (hasSelection) {
          const selected = params.selectionText.trim();
          const label = selected.length > 24
            ? `搜索“${selected.slice(0, 24)}...”`
            : `搜索“${selected}”`;
          template.push(
            { type: 'separator' },
            {
              label,
              click: () => {
                const settings = getStore('settings');
                const engineId = settings ? settings.get('searchEngine', 'google') : 'google';
                const engines = settings ? settings.get('searchEngines', []) : [];
                const engine = engines.find(item => item.id === engineId);
                const searchUrl = engine ? engine.url : 'https://www.google.com/search?q=%s';
                this.createTab(searchUrl.replace('%s', encodeURIComponent(selected)));
              },
            }
          );
        }

        template.push({ type: 'separator' });
      }

      template.push(
        {
          label: '后退',
          enabled: Boolean(wc.canGoBack && wc.canGoBack()),
          click: () => wc.goBack(),
        },
        {
          label: '前进',
          enabled: Boolean(wc.canGoForward && wc.canGoForward()),
          click: () => wc.goForward(),
        },
        {
          label: '重新加载',
          click: () => wc.reload(),
        },
        { type: 'separator' },
        {
          label: '页面另存为...',
          click: () => wc.downloadURL(wc.getURL()),
        },
        {
          label: '安装为应用',
          click: () => {
            const currentUrl = wc.getURL();
            const currentTitle = wc.getTitle();
            if (typeof global.createPwaWindow === 'function') {
              global.createPwaWindow(currentUrl, currentTitle || currentUrl);
            }
          },
        },
        {
          label: '打印...',
          click: () => wc.print({ silent: false, printBackground: true }),
        },
        { type: 'separator' },
        {
          label: '检查元素',
          click: () => wc.inspectElement(params.x, params.y),
        }
      );

      // 扩展右键菜单项（对齐 Edge：chrome.contextMenus）
      try {
        const { buildExtensionContextMenuItems } = require('./extensionBridge');
        const extItems = buildExtensionContextMenuItems(params, (extId, menuId, info) => {
          const { findExtensionBackgroundWebContents } = require('./extensions');
          const extWc = findExtensionBackgroundWebContents(extId);
          if (extWc && !extWc.isDestroyed()) {
            extWc.executeJavaScript(
              `window.__neutronFireContextMenuClick && window.__neutronFireContextMenuClick(${JSON.stringify(menuId)}, ${JSON.stringify(info)})`
            ).catch(() => {});
          }
        });
        if (extItems.length > 0) {
          template.push({ type: 'separator' });
          extItems.forEach((item) => template.push(item));
        }
      } catch (e) { /* 扩展菜单构建失败不影响默认菜单 */ }

      const menu = Menu.buildFromTemplate(template);
      const tab = this.tabs.find(item => item.view && item.view.webContents === wc);
      const viewBounds = tab && tab.view ? tab.view.getBounds() : { x: 0, y: 0 };
      menu.popup({
        window: this.mainWindow,
        x: Math.round((viewBounds.x || 0) + params.x),
        y: Math.round((viewBounds.y || 0) + params.y),
      });
    });
  }

  /**
   * 更新标签页的导航状态
   */
  updateNavStateForTab(tabId) {
    const tab = this.tabs.find(t => t.id === tabId);
    if (tab && tab.view && tab.view.webContents) {
      const wc = tab.view.webContents;
      tab.canGoBack = wc.canGoBack ? wc.canGoBack() : false;
      tab.canGoForward = wc.canGoForward ? wc.canGoForward() : false;

      if (tabId === this.activeTabId) {
        this.syncNavState(tab);
      }
    }
  }

  /**
   * 同步导航状态到渲染进程
   */
  syncNavState(tab) {
    if (!tab) return;
    this.sendToRenderer(IPC_CHANNELS.NAV_STATE_CHANGED, {
      tabId: tab.id,
      url: tab.url,
      title: tab.title,
      favicon: tab.favicon || '',
      canGoBack: tab.canGoBack,
      canGoForward: tab.canGoForward,
      isLoading: tab.isLoading,
      loadingProgress: tab.loadingProgress,
    });
  }

  /** 扩展 chrome.tabs.onUpdated 事件（标题/URL/favicon/状态变化时派发） */
  notifyTabUpdatedForExt(tab, changeInfo) {
    try {
      const { notifyTabUpdated } = require('./extensionBridge');
      notifyTabUpdated(tab, changeInfo || {});
    } catch (e) { /* 忽略 */ }
  }

  /**
   * 同步标签页列表到渲染进程
   */
  syncTabsToRenderer() {
    const tabsData = this.tabs.map(t => ({
      id: t.id,
      url: t.url,
      title: t.title,
      favicon: t.favicon,
      isPinned: t.isPinned,
      isMuted: t.isMuted,
      isAudible: t.isAudible,
      isLoading: t.isLoading,
      loadingProgress: t.loadingProgress,
      securityState: t.securityState,
      isSleeping: t.isSleeping,
      groupId: t.groupId,
    }));
    this.sendToRenderer(IPC_CHANNELS.TAB_LIST_UPDATED, {
      tabs: tabsData,
      activeTabId: this.activeTabId,
      tabGroups: this.tabGroups,
      verticalTabs: this.verticalTabs,
      splitTabId: this.splitTabId,
      sidebarOpen: this.sidebarOpen,
    });
  }

  /**
   * 向渲染进程发送消息
   */
  sendToRenderer(channel, data) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, data);
    }
  }

  /**
   * 广播到主窗口与悬浮面板覆盖层（面板需要实时更新，如下载进度）
   */
  broadcast(channel, data) {
    this.sendToRenderer(channel, data);
    if (this.panelOverlayView && !this.panelOverlayView.webContents.isDestroyed()) {
      try {
        this.panelOverlayView.webContents.send(channel, data);
      } catch (e) { /* 忽略 */ }
    }
  }

  /**
   * 将 file:// URL 转为本地文件路径（Windows 兼容）
   * @param {string} url
   * @returns {string}
   */
  fileUrlToPath(url) {
    try {
      const u = new URL(url);
      let p = decodeURIComponent(u.pathname);
      // Windows: /C:/Users/... → C:/Users/...
      if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1);
      return p.replace(/\//g, path.sep);
    } catch (e) {
      return '';
    }
  }

  /**
   * 解析 URL（自动补全、搜索转换等）
   */
  resolveUrl(input) {
    if (!input || input.trim() === '') {
      return INTERNAL_PAGES.NEW_TAB;
    }

    // 内部页面 - 将 neutron:// 转换为 file:// 路径
    if (input.startsWith('neutron://')) {
      if (global.resolveInternalPage) {
        const filePath = global.resolveInternalPage(input);
        // 保留 query 与 hash（如 neutron://settings#privacy → settings.html#privacy）
        let suffix = '';
        try {
          const u = new URL(input);
          suffix = (u.search || '') + (u.hash || '');
        } catch (e) { /* 忽略 */ }
        return 'file:///' + filePath.replace(/\\/g, '/') + suffix;
      }
      return input;
    }

    // 已经是完整 URL（http/https/file/ftp）
    if (/^https?:\/\//i.test(input) || /^file:\/\//i.test(input) || /^ftp:\/\//i.test(input)) {
      return input;
    }

    // 自定义协议（chrome-extension:// 扩展选项页、moz-extension:// 等）原样放行
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(input)) {
      return input;
    }

    // 本地文件路径（Windows 或 Unix 风格）
    if (/^[a-zA-Z]:[\\/]/i.test(input) || input.startsWith('/')) {
      return 'file:///' + input.replace(/\\/g, '/');
    }

    // 包含 . 且不含空格，视为域名
    if (input.includes('.') && !input.includes(' ')) {
      if (!input.startsWith('//')) {
        return `https://${input}`;
      }
      return `https:${input}`;
    }

    // IP 地址 或 localhost
    if (/^localhost/i.test(input) || /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/.test(input)) {
      return `https://${input}`;
    }

    // 其他情况视为搜索
    const settings = getStore('settings');
    const searchEngine = settings ? settings.get('searchEngine', 'google') : 'google';
    const engines = settings ? settings.get('searchEngines', []) : [];
    const engine = engines.find(e => e.id === searchEngine);
    const searchUrl = engine ? engine.url : 'https://www.google.com/search?q=%s';
    return searchUrl.replace('%s', encodeURIComponent(input));
  }

  /**
   * 处理下载事件
   */
  handleDownload(event, item, tabId) {
    const downloadsStore = getStore('downloads');
    const settings = getStore('settings');

    // 根据「下载前询问保存位置」设置决定保存方式：
    // - 询问（askDownloadPath=true）：不调用 setSavePath，Electron 默认弹出保存位置对话框
    // - 不询问（askDownloadPath=false）：直接保存到下载目录，不弹窗
    const askPath = settings.get('askDownloadPath', true);
    let savePath = '';
    if (!askPath) {
      const downloadDir = settings.get('downloadPath') || app.getPath('downloads');
      savePath = path.join(downloadDir, item.getFilename());
      item.setSavePath(savePath);
    }

    const downloadItem = {
      id: `dl_${Date.now()}`,
      filename: item.getFilename(),
      url: item.getURL(),
      mimeType: item.getMimeType(),
      totalBytes: item.getTotalBytes(),
      receivedBytes: 0,
      speed: 0,
      state: 'in_progress', // 'in_progress' | 'paused' | 'completed' | 'failed' | 'cancelled'
      startTime: Date.now(),
      endTime: null,
      savePath: savePath,
      tabId: tabId,
      deleted: false,
    };

    // 保存下载项
    const downloads = downloadsStore.get('items', []);
    downloads.unshift(downloadItem);
    downloadsStore.set('items', downloads);

    // 保存 DownloadItem 引用（用于暂停/继续/取消）
    this.downloadItems.set(downloadItem.id, item);

    // 通知渲染进程（主窗口 + 悬浮面板覆盖层）
    this.broadcast(IPC_CHANNELS.DOWNLOADS_UPDATED, downloadItem);

    // 监听下载进度（updated 事件周期性触发；速度用字节差值计算，Electron 无 getCurrentSpeed）
    let speedLastBytes = 0;
    let speedLastTime = Date.now();
    item.on('updated', (event, state) => {
      const now = Date.now();
      const received = item.getReceivedBytes();
      const elapsedSec = (now - speedLastTime) / 1000;
      if (elapsedSec >= 0.5) {
        downloadItem.speed = Math.max(0, Math.round((received - speedLastBytes) / elapsedSec));
        speedLastBytes = received;
        speedLastTime = now;
      }
      downloadItem.receivedBytes = received;
      downloadItem.totalBytes = item.getTotalBytes();
      downloadItem.savePath = item.getSavePath() || downloadItem.savePath;

      if (state === 'progressing') {
        // 防御：done 之后若 Electron 仍触发 updated('progressing')，
        // 不要回退已经 'completed'/'cancelled'/'paused' 的状态
        if (!item.isDone() && !item.isPaused()) {
          // 兜底：数据已 100% 接收（receivedBytes >= totalBytes）时提前标记完成，
          // 避免渲染端停留在满格进度条；done 事件会最终确认状态
          if (downloadItem.totalBytes > 0 && downloadItem.receivedBytes >= downloadItem.totalBytes) {
            downloadItem.state = 'completed';
            downloadItem.endTime = Date.now();
          } else {
            downloadItem.state = 'in_progress';
          }
        }
      } else if (state === 'completed') {
        downloadItem.state = 'completed';
        downloadItem.endTime = Date.now();
      } else if (state === 'cancelled') {
        downloadItem.state = 'cancelled';
        downloadItem.endTime = Date.now();
      } else if (state === 'interrupted') {
        downloadItem.state = 'interrupted'; // 保留中断状态，可断点续传
        downloadItem.endTime = Date.now();
      }

      // 更新存储
      const allDownloads = downloadsStore.get('items', []);
      const idx = allDownloads.findIndex(d => d.id === downloadItem.id);
      if (idx !== -1) {
        allDownloads[idx] = downloadItem;
        downloadsStore.set('items', allDownloads);
      }

      this.broadcast(IPC_CHANNELS.DOWNLOADS_UPDATED, downloadItem);
    });

    item.once('done', (event, state) => {
      downloadItem.receivedBytes = item.getReceivedBytes();
      downloadItem.totalBytes = item.getTotalBytes();
      downloadItem.savePath = item.getSavePath() || downloadItem.savePath;

      if (state === 'completed') {
        downloadItem.state = 'completed';
        downloadItem.endTime = Date.now();
      } else if (state === 'cancelled') {
        downloadItem.state = 'cancelled';
        downloadItem.endTime = Date.now();
      } else {
        // 中断（网络断开等）：保留中断状态，可断点续传
        downloadItem.state = 'interrupted';
        downloadItem.endTime = Date.now();
      }

      if (!downloadItem.savePath && downloadItem.filename) {
        const settings = getStore('settings');
        const downloadDir = settings.get('downloadPath') || app.getPath('downloads');
        downloadItem.savePath = path.join(downloadDir, downloadItem.filename);
      }

      const allDownloads = downloadsStore.get('items', []);
      const idx = allDownloads.findIndex(d => d.id === downloadItem.id);
      if (idx !== -1) {
        allDownloads[idx] = downloadItem;
        downloadsStore.set('items', allDownloads);
      }
      this.broadcast(IPC_CHANNELS.DOWNLOADS_UPDATED, downloadItem);
      // 中断的下载保留 DownloadItem 引用，供「继续下载」（断点续传）使用；
      // 已完成/已取消则释放引用
      if (state !== 'interrupted') {
        this.downloadItems.delete(downloadItem.id);
      }
    });
  }

  /**
   * 暂停下载（保留 DownloadItem 引用以便恢复）
   * @param {string} id
   */
  pauseDownload(id) {
    const item = this.downloadItems.get(id);
    // 注意：不能用 canResume() 做前置判断（未暂停过的下载 canResume() 为 false，会导致 pause() 不执行）
    if (item && !item.isDone()) item.pause();
    const store = getStore('downloads');
    const items = store.get('items', []);
    const d = items.find((x) => x.id === id);
    if (d && d.state === 'in_progress') {
      d.state = 'paused';
      store.set('items', items);
      this.broadcast(IPC_CHANNELS.DOWNLOADS_UPDATED, d);
    }
  }

  /**
   * 继续下载
   * @param {string} id
   */
  resumeDownload(id) {
    const item = this.downloadItems.get(id);
    if (!item) return this.retryDownload(id); // 引用已释放（如应用重启后）→ 整文件重下
    try {
      // 断点续传：从中断/暂停位置继续（要求服务器支持 Range 且存在 .part 部分文件）
      if (item.canResume()) {
        item.resume();
      } else if (!item.isDone() && item.isPaused()) {
        item.resume();
      }
    } catch (e) {
      return this.retryDownload(id); // 无法续传 → 整文件重下
    }
    const store = getStore('downloads');
    const items = store.get('items', []);
    const d = items.find((x) => x.id === id);
    if (d && (d.state === 'paused' || d.state === 'interrupted')) {
      d.state = 'in_progress';
      d.endTime = null;
      store.set('items', items);
      this.broadcast(IPC_CHANNELS.DOWNLOADS_UPDATED, d);
    }
  }

  /**
   * 取消下载
   * @param {string} id
   */
  cancelDownload(id) {
    const item = this.downloadItems.get(id);
    // 注意：Electron DownloadItem 没有 canCancel() 方法（会抛 TypeError），直接调用 cancel()
    if (item && !item.isDone()) item.cancel();
  }

  /**
   * 重新开始下载（已取消/失败的下载，重新触发下载）
   * @param {string} id
   */
  retryDownload(id) {
    const store = getStore('downloads');
    const items = store.get('items', []);
    const d = items.find((x) => x.id === id);
    if (!d || !d.url) return false;
    // 重新触发下载（will-download 事件会创建新的下载项）
    const tab = this.tabs.find((t) => t.id === this.activeTabId) || this.tabs[0];
    if (tab && tab.view && !tab.view.webContents.isDestroyed()) {
      tab.view.webContents.downloadURL(d.url);
    } else if (this.sharedSession) {
      this.sharedSession.downloadURL(d.url);
    }
    return true;
  }

  /**
   * 处理渲染进程崩溃
   */
  handleRenderProcessGone(contents, details) {
    // 查找崩溃的标签页
    const tab = this.tabs.find(t => t.view && t.view.webContents === contents);
    if (tab) {
      // 标签页休眠导致的主动卸载不是崩溃：跳过崩溃处理，等待 wakeTab 重新加载
      if (tab.isSleeping) {
        return;
      }
      console.error(`[Main] 标签页 "${tab.title}" 崩溃:`, details.reason);
      // 标记标签页状态
      tab.crashed = true;
      this.syncTabsToRenderer();

      // 可以在此处实现崩溃恢复逻辑
    }
  }

  /**
   * 处理新窗口请求
   */
  handleNewWindow(url) {
    this.createTab(url);
  }

  /**
   * 清理资源
   */
  cleanup() {
    this.stopTabSleeper();

    // 销毁所有 BrowserView
    for (const tab of this.tabs) {
      if (tab.view) {
        try {
          this.mainWindow.removeBrowserView(tab.view);
          tab.view.webContents.close();
        } catch (e) { /* 忽略 */ }
      }
    }
    this.tabs = [];
    this.suspendedTabId = null;
    this.splitTabId = null;
    this.viewCache.clear();

    // 销毁悬浮面板覆盖层
    if (this.panelOverlayView) {
      try {
        this.mainWindow.removeBrowserView(this.panelOverlayView);
        this.panelOverlayView.webContents.close();
      } catch (e) { /* 忽略 */ }
      this.panelOverlayView = null;
    }

    // 销毁扩展 Popup 覆盖层
    if (this.extensionPopupView) {
      try {
        this.mainWindow.removeBrowserView(this.extensionPopupView);
        this.extensionPopupView.webContents.close();
      } catch (e) { /* 忽略 */ }
      this.extensionPopupView = null;
    }

    // 销毁扩展包拖放提示覆盖层
    if (this.extensionDropView) {
      try {
        this.mainWindow.removeBrowserView(this.extensionDropView);
        this.extensionDropView.webContents.close();
      } catch (e) { /* 忽略 */ }
      this.extensionDropView = null;
    }
    this.extensionDragDepth = 0;
  }
}

module.exports = WindowManager;
