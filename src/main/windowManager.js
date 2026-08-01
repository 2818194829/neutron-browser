/**
 * 窗口管理器 - 管理主窗口、标签页视图、窗口状态
 * 核心模块：负责 BrowserWindow 和 WebContentsView 的生命周期管理
 */
const { BrowserWindow, BrowserView, session, app, screen, nativeImage, clipboard, Menu } = require('electron');
const path = require('path');
const { IPC_CHANNELS, INTERNAL_PAGES, INTERNAL_PAGE_TITLES } = require('../shared/constants');
const { getStore } = require('./storage');

// 应用图标路径（打包后 icon/ 在 ASAR 外部，需多一级向上）
const APP_ICON_PATH = app.isPackaged
  ? path.join(__dirname, '..', '..', '..', 'icon', 'Rocket Browser.png')
  : path.join(__dirname, '..', '..', 'icon', 'Rocket Browser.png');

const EDGE_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0';

const EDGE_SEC_CH_UA = '"Microsoft Edge";v="120", "Not=A?Brand";v="24", "Chromium";v="120"';
const EDGE_SEC_CH_UA_PLATFORM = '"Windows"';

const EDGE_STORE_JS_PATCH = `
if (!navigator.userAgentData || !navigator.userAgentData.brands.some(b => b.brand === 'Microsoft Edge')) {
  Object.defineProperty(navigator, 'userAgentData', {
    get: () => ({
      brands: [
        { brand: "Microsoft Edge", version: "120" },
        { brand: "Not=A?Brand", version: "24" },
        { brand: "Chromium", version: "120" }
      ],
      mobile: false,
      platform: "Windows"
    }),
    configurable: true,
    enumerable: true
  });
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
      details.requestHeaders['Sec-CH-UA-Platform'] = EDGE_SEC_CH_UA_PLATFORM;
      callback({ requestHeaders: details.requestHeaders });
    }
  );
}

class WindowManager {
  constructor() {
    /** @type {BrowserWindow|null} 主窗口实例 */
    this.mainWindow = null;

    /** @type {Array} 标签页列表 */
    this.tabs = [];

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

    // 绑定方法
    this.handleNewWindow = this.handleNewWindow.bind(this);

    this.setupSharedSessionHandlers();
  }

  /**
   * 在共享持久会话上只注册一次下载与权限处理器
   */
  setupSharedSessionHandlers() {
    if (this.sharedSessionHandlersReady) return;
    this.sharedSessionHandlersReady = true;

    const sharedSession = session.defaultSession;

    sharedSession.setPermissionRequestHandler((webContents, permission, callback) => {
      const allowedPermissions = ['clipboard-read', 'clipboard-sanitized-write'];
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
      resizable: true,                 // 允许调整大小
      backgroundColor: '#1a1a2e',      // 背景色
      icon: nativeImage.createFromPath(APP_ICON_PATH),  // 窗口图标
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

    // 加载主界面 HTML
    this.mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'app.html'));

    // 窗口准备好后显示（避免白屏闪烁）
    this.mainWindow.once('ready-to-show', () => {
      this.mainWindow.show();

      // 开发模式下打开 DevTools
      if (process.argv.includes('--dev')) {
        this.mainWindow.webContents.openDevTools({ mode: 'detach' });
      }

      // 根据启动行为创建初始标签页
      this.openStartupPages();
    });

    // 监听窗口状态变化
    this.mainWindow.on('maximize', () => {
      this.isMaximized = true;
      this.sendToRenderer(IPC_CHANNELS.WINDOW_STATE_CHANGED, { maximized: true });
      this.layoutViews(); // 最大化时调整页面布局
    });

    this.mainWindow.on('unmaximize', () => {
      this.isMaximized = false;
      this.sendToRenderer(IPC_CHANNELS.WINDOW_STATE_CHANGED, { maximized: false });
      this.layoutViews(); // 还原时调整页面布局
    });

    this.mainWindow.on('resize', () => {
      if (!this.isMaximized) {
        const bounds = this.mainWindow.getBounds();
        this.windowBounds = bounds;
      }
      this.layoutViews(); // 窗口大小变化时实时调整页面布局
    });

    this.mainWindow.on('move', () => {
      if (!this.isMaximized) {
        const bounds = this.mainWindow.getBounds();
        this.windowBounds = bounds;
      }
    });

    // 关闭前保存窗口状态
    this.mainWindow.on('close', () => {
      if (!this.isMaximized) {
        const bounds = this.mainWindow.getBounds();
        settings.set('windowState', bounds);
      }
    });

    this.mainWindow.on('closed', () => {
      this.mainWindow = null;
    });

    // 处理 webContents 的新窗口请求
    this.mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      this.createTab(url);
      return { action: 'deny' };
    });
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

    // 创建 BrowserView，所有标签共享默认持久会话
    const view = new BrowserView({
      webPreferences: {
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

    // 添加视图到窗口
    this.mainWindow.addBrowserView(view);

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
    };

    this.tabs.push(tab);

    if (active) {
      this.switchTab(tabId);
    }
    // 非活动标签页：不添加到窗口，由 switchTab 管理

    // 通知渲染进程更新标签栏
    this.syncTabsToRenderer();

    return tabId;
  }

  /**
   * 根据启动设置打开初始页面
   */
  openStartupPages() {
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

    // 隐藏之前活动的标签页（从窗口中移除）
    if (this.activeTabId) {
      const prevTab = this.tabs.find(t => t.id === this.activeTabId);
      if (prevTab && prevTab.view) {
        this.mainWindow.removeBrowserView(prevTab.view);
      }
    }

    // 显示目标标签页（添加到窗口）
    this.activeTabId = tabId;
    this.mainWindow.addBrowserView(targetTab.view);
    this.layoutViews();

    // 通知渲染进程
    this.syncTabsToRenderer();
    this.syncNavState(targetTab);
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

    // 从窗口中移除视图
    if (tab.view) {
      this.mainWindow.removeBrowserView(tab.view);
      tab.view.webContents.close();
    }

    // 从列表中移除
    this.tabs.splice(tabIndex, 1);

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

    this.syncTabsToRenderer();
  }

  /**
   * 重排视图布局
   */
  layoutViews() {
    if (!this.mainWindow) return;

    // 浏览器 UI 高度（与 app.css 中的 CSS 变量保持一致）
    const titleBarHeight = 38;
    const toolbarHeight = 46;
    const bookmarkBarHeight = 32;
    const statusBarHeight = 24;
    const topOffset = titleBarHeight + toolbarHeight + bookmarkBarHeight;

    const contentBounds = this.mainWindow.getContentBounds();
    const activeTab = this.tabs.find(t => t.id === this.activeTabId);
    if (activeTab && activeTab.view) {
      // BrowserView 放在 UI 元素下方，留出标题栏、工具栏、书签栏、状态栏空间
      activeTab.view.setBounds({
        x: 0,
        y: topOffset,
        width: contentBounds.width,
        height: contentBounds.height - topOffset - statusBarHeight,
      });
    }
  }

  /**
   * 切换 HTML 模态框与 BrowserView 的可见关系
   * BrowserView 始终盖在主窗口 webContents 之上，因此显示模态框时需要暂时移除当前标签页视图
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
          this.mainWindow.removeBrowserView(tab.view);
        }
      }
      return;
    }

    if (!this.suspendedTabId) {
      this.sendToRenderer(IPC_CHANNELS.UI_MODAL_SNAPSHOT, { dataUrl: '' });
      return;
    }

    const target = this.tabs.find(t => t.id === this.suspendedTabId);
    if (target && target.view) {
      this.mainWindow.addBrowserView(target.view);
      this.layoutViews();
    }
    this.sendToRenderer(IPC_CHANNELS.UI_MODAL_SNAPSHOT, { dataUrl: '' });
    this.suspendedTabId = null;
  }

  resolveModalSnapshot() {
    if (!this.modalSnapshotResolve) return;
    const resolve = this.modalSnapshotResolve;
    this.modalSnapshotResolve = null;
    resolve();
  }

  /**
   * 设置视图事件监听
   * @param {BrowserView} view
   * @param {string} tabId
   */
  setupViewEvents(view, tabId) {
    const wc = view.webContents;

    // 网页右键菜单，参考 Edge 的常用操作
    this.setupWebContentsContextMenu(wc);

    // 页面标题更新
    wc.on('page-title-updated', (event, title) => {
      const tab = this.tabs.find(t => t.id === tabId);
      if (tab) {
        tab.title = title;
        this.syncTabsToRenderer();
      }
    });

    // 页面 favicon 更新
    wc.on('page-favicon-updated', (event, favicons) => {
      const tab = this.tabs.find(t => t.id === tabId);
      if (tab && favicons.length > 0) {
        tab.favicon = favicons[0];
        this.syncTabsToRenderer();
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
      }
    });

    wc.on('did-navigate-in-page', (event, url) => {
      const tab = this.tabs.find(t => t.id === tabId);
      if (tab) {
        tab.url = url;
        this.syncTabsToRenderer();
        this.syncNavState(tab);
      }
    });

    // 加载开始
    wc.on('did-start-loading', () => {
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
        tab.loadingProgress = 10;
        this.sendToRenderer(IPC_CHANNELS.NAV_LOADING_PROGRESS, { tabId, progress: 10 });
      }
    });

    // 音频状态变化
    wc.on('media-started-playing', () => {
      const tab = this.tabs.find(t => t.id === tabId);
      if (tab) {
        tab.isAudible = true;
        this.syncTabsToRenderer();
      }
    });

    wc.on('media-paused', () => {
      const tab = this.tabs.find(t => t.id === tabId);
      if (tab) {
        // 可能存在多个媒体，简单检查
        if (!wc.isCurrentlyAudible()) {
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
          label: '打印...',
          click: () => wc.print({ silent: false, printBackground: true }),
        },
        { type: 'separator' },
        {
          label: '检查元素',
          click: () => wc.inspectElement(params.x, params.y),
        }
      );

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
      canGoBack: tab.canGoBack,
      canGoForward: tab.canGoForward,
      isLoading: tab.isLoading,
      loadingProgress: tab.loadingProgress,
    });
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
    }));
    this.sendToRenderer(IPC_CHANNELS.TAB_LIST_UPDATED, {
      tabs: tabsData,
      activeTabId: this.activeTabId,
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
        return 'file:///' + filePath.replace(/\\/g, '/');
      }
      return input;
    }

    // 已经是完整 URL（http/https/file/ftp）
    if (/^https?:\/\//i.test(input) || /^file:\/\//i.test(input) || /^ftp:\/\//i.test(input)) {
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
      savePath: item.getSavePath(),
      tabId: tabId,
    };

    // 保存下载项
    const downloads = downloadsStore.get('items', []);
    downloads.unshift(downloadItem);
    downloadsStore.set('items', downloads);

    // 通知渲染进程
    this.sendToRenderer(IPC_CHANNELS.DOWNLOADS_UPDATED, downloadItem);

    // 监听下载进度
    item.on('updated', (event, state) => {
      downloadItem.receivedBytes = item.getReceivedBytes();
      downloadItem.totalBytes = item.getTotalBytes();
      downloadItem.speed = item.getCurrentSpeed ? item.getCurrentSpeed() : 0;

      if (state === 'progressing') {
        downloadItem.state = 'in_progress';
      } else if (state === 'completed') {
        downloadItem.state = 'completed';
        downloadItem.endTime = Date.now();
      } else if (state === 'cancelled') {
        downloadItem.state = 'cancelled';
        downloadItem.endTime = Date.now();
      } else if (state === 'interrupted') {
        downloadItem.state = 'failed';
        downloadItem.endTime = Date.now();
      }

      // 更新存储
      const allDownloads = downloadsStore.get('items', []);
      const idx = allDownloads.findIndex(d => d.id === downloadItem.id);
      if (idx !== -1) {
        allDownloads[idx] = downloadItem;
        downloadsStore.set('items', allDownloads);
      }

      this.sendToRenderer(IPC_CHANNELS.DOWNLOADS_UPDATED, downloadItem);
    });

    item.once('done', (event, state) => {
      if (state === 'completed') {
        downloadItem.state = 'completed';
        downloadItem.endTime = Date.now();
      } else if (state === 'cancelled') {
        downloadItem.state = 'cancelled';
        downloadItem.endTime = Date.now();
      } else {
        downloadItem.state = 'failed';
        downloadItem.endTime = Date.now();
      }

      const allDownloads = downloadsStore.get('items', []);
      const idx = allDownloads.findIndex(d => d.id === downloadItem.id);
      if (idx !== -1) {
        allDownloads[idx] = downloadItem;
        downloadsStore.set('items', allDownloads);
      }
      this.sendToRenderer(IPC_CHANNELS.DOWNLOADS_UPDATED, downloadItem);
    });
  }

  /**
   * 处理渲染进程崩溃
   */
  handleRenderProcessGone(contents, details) {
    // 查找崩溃的标签页
    const tab = this.tabs.find(t => t.view && t.view.webContents === contents);
    if (tab) {
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
    this.viewCache.clear();
  }
}

module.exports = WindowManager;
