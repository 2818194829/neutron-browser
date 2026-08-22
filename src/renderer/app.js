/**
 * Neutron Browser - 渲染进程主逻辑
 * 管理标签栏、地址栏、书签栏、工具栏等 UI 组件
 * 与主进程通过 IPC 通信
 */
(function () {
  'use strict';

  // ==================== DOM 元素引用 ====================
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const dom = {
    app: $('#app'),
    titleBar: $('#titleBar'),
    titleBarTabsArea: $('#titleBarTabsArea'),
    btnPin: $('#btnPin'),
    btnMinimize: $('#btnMinimize'),
    btnMaximize: $('#btnMaximize'),
    btnClose: $('#btnClose'),
    maximizeIcon: $('#maximizeIcon'),
    toolbar: $('#toolbar'),
    btnBack: $('#btnBack'),
    btnForward: $('#btnForward'),
    btnRefresh: $('#btnRefresh'),
    refreshIcon: $('#refreshIcon'),
    btnHome: $('#btnHome'),
    addressInput: $('#addressInput'),
    addressBarContainer: $('#addressBarContainer'),
    loadingBar: $('#loadingBar'),
    securityIndicator: $('#securityIndicator'),
    securityIcon: $('#securityIcon'),
    btnBookmark: $('#btnBookmark'),
    bookmarkIcon: $('#bookmarkIcon'),
    btnVerticalTabs: $('#btnVerticalTabs'),
    btnSplit: $('#btnSplit'),
    btnSidebar: $('#btnSidebar'),
    sidebar: $('#sidebar'),
    sidebarContent: $('#sidebarContent'),
    btnSidebarClose: $('#btnSidebarClose'),
    verticalTabStrip: $('#verticalTabStrip'),
    appBody: $('#appBody'),
    appMain: $('#appMain'),
    btnDownloads: $('#btnDownloads'),
    downloadBadge: $('#downloadBadge'),
    downloadRing: $('#downloadRing'),
    downloadRingFill: $('#downloadRingFill'),
    panelBackdrop: $('#panelBackdrop'),
    downloadPanel: $('#downloadPanel'),
    downloadList: $('#downloadList'),
    downloadSearch: $('#downloadSearch'),
    downloadSearchWrap: $('#downloadSearchWrap'),
    downloadMoreMenu: $('#downloadMoreMenu'),
    btnBookmarks: $('#btnBookmarks'),
    bookmarksPanel: $('#bookmarksPanel'),
    bookmarksList: $('#bookmarksList'),
    bookmarksSearch: $('#bookmarksSearch'),
    bookmarksSearchWrap: $('#bookmarksSearchWrap'),
    bookmarksMoreMenu: $('#bookmarksMoreMenu'),
    btnHistory: $('#btnHistory'),
    historyPanel: $('#historyPanel'),
    historyList: $('#historyList'),
    historySearch: $('#historySearch'),
    historyMoreMenu: $('#historyMoreMenu'),
    btnExtensions: $('#btnExtensions'),
    extensionToolbarIcons: $('#extensionToolbarIcons'),
    extensionPopup: $('#extensionPopup'),
    skinCanvas: $('#skinCanvas'),
    extensionSiteLabel: $('#extensionSiteLabel'),
    extensionSiteToggle: $('#extensionSiteToggle'),
    extensionList: $('#extensionList'),
    btnManageExtensions: $('#btnManageExtensions'),
    btnGetExtensions: $('#btnGetExtensions'),
    btnSettings: $('#btnSettings'),
    btnAccount: $('#btnAccount'),
    accountMenu: $('#accountMenu'),
    accountMenuAvatarLg: $('#accountMenuAvatarLg'),
    accountMenuName: $('#accountMenuName'),
    accountMenuEmail: $('#accountMenuEmail'),
    accountMenuSyncText: $('#accountMenuSyncText'),
    accountNewProfile: $('#accountNewProfile'),
    accountNewProfileInput: $('#accountNewProfileInput'),
    accountNewProfileCancel: $('#accountNewProfileCancel'),
    accountNewProfileOk: $('#accountNewProfileOk'),
    accountLoginView: $('#accountLoginView'),
    accountRegisterView: $('#accountRegisterView'),
    accountForgotView: $('#accountForgotView'),
    accountLoginClose: $('#accountLoginClose'),
    accountLoginTabPwd: $('#accountLoginTabPwd'),
    accountLoginTabCode: $('#accountLoginTabCode'),
    accountLoginPwdArea: $('#accountLoginPwdArea'),
    accountLoginCodeArea: $('#accountLoginCodeArea'),
    accountLoginUsername: $('#accountLoginUsername'),
    accountLoginPassword: $('#accountLoginPassword'),
    accountLoginTogglePwd: $('#accountLoginTogglePwd'),
    accountLoginError: $('#accountLoginError'),
    accountLoginSubmit: $('#accountLoginSubmit'),
    accountLoginPhone: $('#accountLoginPhone'),
    accountLoginSendCode: $('#accountLoginSendCode'),
    accountLoginCode: $('#accountLoginCode'),
    accountLoginCodeError: $('#accountLoginCodeError'),
    accountLoginCodeSubmit: $('#accountLoginCodeSubmit'),
    accountLoginMockCode: $('#accountLoginMockCode'),
    accountLoginForgot: $('#accountLoginForgot'),
    accountLoginGoRegister: $('#accountLoginGoRegister'),
    accountRegisterClose: $('#accountRegisterClose'),
    accountRegisterNickname: $('#accountRegisterNickname'),
    accountRegisterPhone: $('#accountRegisterPhone'),
    accountRegisterSendCode: $('#accountRegisterSendCode'),
    accountRegisterCode: $('#accountRegisterCode'),
    accountRegisterMockCode: $('#accountRegisterMockCode'),
    accountRegisterPassword: $('#accountRegisterPassword'),
    accountRegisterPassword2: $('#accountRegisterPassword2'),
    accountRegisterError: $('#accountRegisterError'),
    accountRegisterSubmit: $('#accountRegisterSubmit'),
    accountRegisterGoLogin: $('#accountRegisterGoLogin'),
    accountForgotClose: $('#accountForgotClose'),
    accountForgotPhone: $('#accountForgotPhone'),
    accountForgotSendCode: $('#accountForgotSendCode'),
    accountForgotCode: $('#accountForgotCode'),
    accountForgotMockCode: $('#accountForgotMockCode'),
    accountForgotPassword: $('#accountForgotPassword'),
    accountForgotPassword2: $('#accountForgotPassword2'),
    accountForgotError: $('#accountForgotError'),
    accountForgotSubmit: $('#accountForgotSubmit'),
    accountForgotGoLogin: $('#accountForgotGoLogin'),
    bookmarkBar: $('#bookmarkBar'),
    bookmarkBarItems: $('#bookmarkBarItems'),
    contentArea: $('#contentArea'),
    contentSnapshot: $('#contentSnapshot'),
    contentPlaceholder: $('#contentPlaceholder'),
    statusBar: $('#statusBar'),
    statusUrl: $('#statusUrl'),
    statusZoom: $('#statusZoom'),
    contextMenu: $('#contextMenu'),
    bookmarkFolderPopup: $('#bookmarkFolderPopup'),
    bookmarkDialog: $('#bookmarkDialog'),
    bookmarkDialogTitle: $('#bookmarkDialogTitle'),
    bookmarkName: $('#bookmarkName'),
    bookmarkUrl: $('#bookmarkUrl'),
    bookmarkUrlIcon: $('#bookmarkUrlIcon'),
    bookmarkFolder: $('#bookmarkFolder'),
    bookmarkDialogClose: $('#bookmarkDialogClose'),
    bookmarkDialogCancel: $('#bookmarkDialogCancel'),
    bookmarkDialogSave: $('#bookmarkDialogSave'),
    bookmarkDialogRemove: $('#bookmarkDialogRemove'),
    folderDialog: $('#folderDialog'),
    folderDialogTitle: $('#folderDialogTitle'),
    folderName: $('#folderName'),
    folderDialogClose: $('#folderDialogClose'),
    folderDialogCancel: $('#folderDialogCancel'),
    folderDialogSave: $('#folderDialogSave'),
  };

  // ==================== 状态 ====================
  const state = {
    tabs: [],
    activeTabId: null,
    tabGroups: [],
    verticalTabs: false,
    splitTabId: null,
    sidebarOpen: false,
    isMaximized: false,
    currentUrl: '',
    currentTitle: '',
    currentFavicon: '',
    canGoBack: false,
    canGoForward: false,
    isLoading: false,
    isBookmarked: false,
    bookmarks: {},
    downloads: [],
    downloadPanelOpen: false,
    downloadPanelToken: 0,
    downloadSearchQuery: '',
    bookmarksPanelOpen: false,
    bookmarksPanelToken: 0,
    bookmarksPanelPinned: false,
    bookmarksSearchQuery: '',
    bookmarksPanelExpanded: {},   // 收藏夹面板内各文件夹的展开状态 (folderId -> boolean)
    historyItems: [],
    historyPanelOpen: false,
    historyPanelToken: 0,
    historyPanelPinned: false,
    historyActiveTab: 'all',
    historySearchQuery: '',
    recentClosedTabs: [],
    editingBookmark: null,
    editingFolder: null,
    dialogRecognizedFavicon: '',   // 书签对话框内识别到的网址图标（保存时使用）
    dialogFaviconToken: 0,          // 对话框图标识别令牌（防旧网址异步结果覆盖）
    folderParentId: 'bookmark_bar',
    bookmarkDragId: null,
    bookmarkDropPosition: 'before',
    bookmarkDropMode: 'before',
    bookmarkFolderPopupOpenId: null, // 当前打开的文件夹弹出菜单对应文件夹 ID
    folderPopupOpenTimer: null,      // 拖拽悬停时自动打开文件夹的防抖定时器
    extensionPopupOpen: false,
    extensionPopupOpenId: null,     // 当前打开的扩展 Popup 对应扩展 ID（开关切换用）
    extensionPopupExtensions: [],
    extensionActions: [],           // 工具栏扩展图标动作列表
    extensionSitePermissions: null,
    extensionPopupToken: 0,
    modalSnapshotResolver: null,
    theme: 'system',
    accentColor: 'blue',
    themeSkin: 'default',
    isAlwaysOnTop: false,
    contextMenuOpen: false,
    folderPopupData: null,
    subFolderPopupTimeout: null,
    subFolderPopupDiv: null,
    accountMenuOpen: false,
    account: null,   // { isLoggedIn, name, email }
    accountSync: true,   // 同步是否启用（菜单项可切换）
    mockCodes: {},       // 本地模拟验证码（未配置发送服务时的降级方案）
    unsubscribers: [],
  };

  // ==================== API 快捷方式 ====================
  const api = window.NeutronBrowser;
  const SiteMeta = window.SiteMeta || {};
  if (!api) {
    console.error('[Renderer] NeutronBrowser API 未加载！请检查 preload.js');
    return;
  }

  // 覆盖层模式：面板作为透明覆盖层叠加在实时页面之上（?overlay=1&panel=xxx）
  const IS_OVERLAY = new URLSearchParams(location.search).has('overlay');
  const OVERLAY_PANEL = IS_OVERLAY
    ? (new URLSearchParams(location.search).get('panel') || 'downloads')
    : null;

  // ==================== 初始化 ====================
  async function init() {
    // 覆盖层模式：只初始化当前面板
    if (IS_OVERLAY) {
      await initOverlay();
      return;
    }

    console.log('[Renderer] 初始化中...');

    // 加载外观（主题 + 强调色 + 皮肤）
    state.theme = await api.getTheme();
    const [accentColor, themeSkin, chromeFgOverride, liveSkinScrim] = await Promise.all([
      api.getSetting('accentColor'),
      api.getSetting('themeSkin'),
      api.getSetting('chromeFgOverride'),
      api.getSetting('liveSkinScrim'),
    ]);
    state.accentColor = accentColor || 'blue';
    state.themeSkin = themeSkin || 'default';
    state.chromeFgOverride = chromeFgOverride || 'auto';
    state.liveSkinScrim = liveSkinScrim || 'auto';
    applyAppearance();

    // 加载书签
    state.bookmarks = await api.getBookmarks();
    renderBookmarkBar();
    // 预载历史/书签图标知识库（异步），就绪后刷新书签栏让图标更准确
    ensureFaviconCache().then(() => renderBookmarkBar());
    loadDownloads();

    // 工具栏收藏夹按钮显示控制（设置页/菜单可隐藏）
    api.getSetting('showBookmarksButton').then((show) => {
      if (show === false) dom.btnBookmarks.style.display = 'none';
    });

    // 加载账户状态 + 渲染头像
    await loadAccount();
    renderAccountAvatar();

    // 绑定事件
    bindWindowControls();
    bindNavigationButtons();
    bindAddressBar();
    bindTabEvents();
    bindBookmarkEvents();
    bindContextMenu();
    bindBookmarkDialog();
    bindFolderDialog();
    bindToolButtons();
    bindDownloadPanel();
    bindHistoryPanel();
    bindBookmarksPanel();
    bindExtensionPopup();
    bindExtensionToolbar();
    bindAccountMenu();
    bindKeyboardShortcuts();
    bindIPCListeners();
    bindDragAndDrop();
    setupExtensionDropInstall();

    // 监听设置页主题/强调色/皮肤变更
    if (api.onThemeChanged) {
      const unsubTheme = api.onThemeChanged((theme) => {
        state.theme = theme;
        applyAppearance();
      });
      state.unsubscribers.push(unsubTheme);
    }

    // 监听设置变更：工具栏收藏夹按钮显示、书签栏显示实时同步
    if (api.onSettingsChanged) {
      const unsubSettings = api.onSettingsChanged((data) => {
        if (data && 'showBookmarksButton' in data) {
          dom.btnBookmarks.style.display = data.showBookmarksButton === false ? 'none' : '';
        }
        if (data && 'showBookmarkBar' in data) {
          dom.bookmarkBar.classList.toggle('bookmark-bar--hidden', data.showBookmarkBar === false);
        }
      });
      state.unsubscribers.push(unsubSettings);
    }

    // 监听来自系统菜单的事件
    const unsubMenu = api.onMenuEvent(handleMenuEvent);
    state.unsubscribers.push(unsubMenu);

    // 覆盖层面板被关闭（Esc/点击外部）时同步状态
    if (api.onPanelOverlayClosed) {
      const unsubOverlayClosed = api.onPanelOverlayClosed(() => {
        state.downloadPanelOpen = false;
        state.historyPanelOpen = false;
        state.bookmarksPanelOpen = false;
        state.extensionPopupOpen = false;
        state.accountMenuOpen = false;
        state.bookmarkFolderPopupOpenId = null;
        state.folderPopupData = null;
        // 账户菜单可能在覆盖层内完成退出/登录，关闭后同步头像
        loadAccount().then(renderAccountAvatar);
      });
      state.unsubscribers.push(unsubOverlayClosed);
    }

    console.log('[Renderer] 初始化完成');
  }

  /**
   * 覆盖层模式初始化：只渲染当前面板（面板叠加在实时页面之上显示）
   */
  async function initOverlay() {
    console.log('[Overlay] 覆盖层初始化，panel =', OVERLAY_PANEL);
    document.documentElement.classList.add('overlay-mode');
    document.documentElement.dataset.overlayPanel = OVERLAY_PANEL;

    // 扩展包拖放提示覆盖层：全窗透明 BrowserView，居中显示「松开以安装扩展」卡片
    // 并处理落在覆盖层上的拖放事件（drop → 统一走主进程转发安装）
    if (OVERLAY_PANEL === 'extensionDrop') {
      const dropEl = document.getElementById('dropOverlay');
      if (dropEl) dropEl.hidden = false;
      try {
        state.theme = await api.getTheme();
        applyAppearance();
      } catch (e) { /* 忽略 */ }
      setupExtensionDropInstall();
      // 安全兜底：拖拽被 Esc 取消时 OS 不会发送 dragleave，覆盖层上点击/按键时主动隐藏
      const safeHide = () => {
        if (api.notifyExtensionDragLeave) api.notifyExtensionDragLeave();
      };
      window.addEventListener('mousedown', safeHide);
      window.addEventListener('keydown', safeHide);
      return;
    }

    // 外观（面板需要正确的主题变量）
    state.theme = await api.getTheme();
    const [accentColor, themeSkin, chromeFgOverride, liveSkinScrim] = await Promise.all([
      api.getSetting('accentColor'),
      api.getSetting('themeSkin'),
      api.getSetting('chromeFgOverride'),
      api.getSetting('liveSkinScrim'),
    ]);
    state.accentColor = accentColor || 'blue';
    state.themeSkin = themeSkin || 'default';
    state.chromeFgOverride = chromeFgOverride || 'auto';
    state.liveSkinScrim = liveSkinScrim || 'auto';
    applyAppearance();

    // 绑定面板相关事件（复用主窗口逻辑）
    bindDownloadPanel();
    bindHistoryPanel();
    bindBookmarksPanel();
    bindExtensionPopup();
    bindExtensionToolbar();
    bindAccountMenu();
    bindIPCListeners();

    // 主进程推送锚点 → 显示并定位面板
    if (api.onPanelOverlayAnchor) {
      api.onPanelOverlayAnchor(({ anchor, contentOffsetY, bookmarkFolderData }) => {
        state.overlayAnchor = anchor || null;
        state.overlayOffsetY = contentOffsetY || 0;
        if (bookmarkFolderData) {
          state.bookmarkFolderData = bookmarkFolderData;
          renderBookmarkFolderInOverlay(bookmarkFolderData);
        }
        showOverlayPanel();
      });
    }
    // 主动拉取锚点（避免推送时序问题）
    try {
      const data = await api.getPanelOverlayAnchor();
      if (data) {
        state.overlayAnchor = data.anchor || null;
        state.overlayOffsetY = data.contentOffsetY || 0;
        if (data.bookmarkFolderData) {
          state.bookmarkFolderData = data.bookmarkFolderData;
          renderBookmarkFolderInOverlay(data.bookmarkFolderData);
        }
      }
    } catch (e) { /* 忽略 */ }
    showOverlayPanel();
  }

  /**
   * 在叠加层中渲染书签文件夹弹出菜单
   */
  function renderBookmarkFolderInOverlay(data) {
    const { items } = data || {};
    if (!items) return;
    const popup = dom.bookmarkFolderPopup;
    popup.innerHTML = '';
    popup.classList.toggle('bookmark-folder-popup--empty', items.length === 0);

    const listEl = document.createElement('div');
    listEl.className = 'bfp-list';
    if (items.length === 0) {
      const emptyEl = document.createElement('div');
      emptyEl.className = 'bfp-empty';
      emptyEl.textContent = '空';
      listEl.appendChild(emptyEl);
    } else {
      renderFolderItemsInOverlay(listEl, items);
    }
    popup.appendChild(listEl);

    // 支持从书签栏把书签拖入本文件夹（跨窗口，通过全局拖拽状态协调）
    popup.ondragover = (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    };
    popup.ondrop = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      let draggedId = state.bookmarkDragId;
      if (!draggedId && api.getBookmarkDrag) {
        try { draggedId = await api.getBookmarkDrag(); } catch (err) { /* 忽略 */ }
      }
      const folderId = state.bookmarkFolderData && state.bookmarkFolderData.folderId;
      if (!draggedId || !folderId) return;
      try {
        const moved = await api.moveBookmarkIntoFolder(draggedId, folderId);
        state.bookmarkDragId = null;
        if (api.clearBookmarkDrag) api.clearBookmarkDrag();
        if (moved) {
          // 通知主窗口刷新书签栏
          if (api.notifyBookmarksChanged) api.notifyBookmarksChanged();
          // 实时刷新当前文件夹弹出菜单
          api.refreshBookmarkFolder(folderId);
        }
      } catch (err) {
        console.error('[Overlay] 拖入书签失败:', err);
      }
    };
  }

  function renderFolderItemsInOverlay(container, items) {
    items.forEach(item => {
      const el = document.createElement('div');
      el.className = 'bfp-item';
      el.draggable = true;
      el.dataset.bookmarkId = item.id || '';

      if (item.type === 'folder') {
        el.innerHTML = `<span class="bfp-item__icon bfp-item__icon--folder">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
        </span>
        <span class="bfp-item__title">${escapeHtmlAttr(item.title)}</span>
        <span class="bfp-item__arrow">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </span>`;
      } else {
        const icon = document.createElement('span');
        icon.className = 'bfp-item__icon';
        mountBookmarkIcon(icon, item);
        const title = document.createElement('span');
        title.className = 'bfp-item__title';
        title.textContent = item.title || '未命名书签';
        el.appendChild(icon);
        el.appendChild(title);
        el.addEventListener('click', () => {
          api.navigateTo(item.url);
          closeDownloadPanel(); // 复用关闭逻辑
        });
        // 支持将文件夹内的书签拖拽到书签栏（跨窗口，通过全局拖拽状态协调）
        el.addEventListener('dragstart', (e) => {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', item.id);
          state.bookmarkDragId = item.id;
          if (api.setBookmarkDrag) api.setBookmarkDrag(item.id);
        });
        el.addEventListener('dragend', () => {
          state.bookmarkDragId = null;
          if (api.clearBookmarkDrag) api.clearBookmarkDrag();
        });
      }
      container.appendChild(el);
    });
  }

  /**
   * 覆盖层内显示当前面板（每次调用都会重新加载数据并定位）
   */
  async function showOverlayPanel() {
    try {
      if (OVERLAY_PANEL === 'downloads') {
        state.downloadPanelOpen = true;
        dom.downloadPanel.hidden = false;
        dom.downloadPanel.style.visibility = 'hidden';
        await loadDownloads();
        positionDownloadPanel();
        dom.downloadPanel.style.visibility = 'visible';
        requestAnimationFrame(positionDownloadPanel);
      } else if (OVERLAY_PANEL === 'history') {
        state.historyPanelOpen = true;
        dom.historyPanel.hidden = false;
        dom.historyPanel.style.visibility = 'hidden';
        await loadHistoryPanel();
        positionHistoryPanel();
        dom.historyPanel.style.visibility = 'visible';
        requestAnimationFrame(positionHistoryPanel);
      } else if (OVERLAY_PANEL === 'bookmarks') {
        state.bookmarksPanelOpen = true;
        dom.bookmarksPanel.hidden = false;
        dom.bookmarksPanel.style.visibility = 'hidden';
        await refreshBookmarksPanel();
        if (!state.bookmarksPanelOpen) return;
        positionBookmarksPanel();
        dom.bookmarksPanel.style.visibility = 'visible';
        requestAnimationFrame(positionBookmarksPanel);
      } else if (OVERLAY_PANEL === 'extensions') {
        state.extensionPopupOpen = true;
        dom.extensionPopup.hidden = false;
        dom.extensionPopup.style.visibility = 'hidden';
        positionExtensionPopup();
        try {
          await loadExtensionPopup();
        } catch (e) {
          state.extensionPopupExtensions = [];
          renderExtensionList([], { enabled: true, blocked: {} });
        }
        positionExtensionPopup();
        dom.extensionPopup.style.visibility = 'visible';
        requestAnimationFrame(positionExtensionPopup);
      } else if (OVERLAY_PANEL === 'bookmarkFolder') {
        // 书签文件夹弹出菜单：数据由主进程通过 anchor 推送
        state.downloadPanelOpen = true; // 复用关闭逻辑
        // 若数据已到达则先渲染，再显示
        if (state.bookmarkFolderData) {
          renderBookmarkFolderInOverlay(state.bookmarkFolderData);
        }
        dom.bookmarkFolderPopup.style.display = 'block';
        dom.bookmarkFolderPopup.style.left = '0';
        dom.bookmarkFolderPopup.style.top = '0';
        dom.bookmarkFolderPopup.style.right = '0';
        dom.bookmarkFolderPopup.style.bottom = '0';
        dom.bookmarkFolderPopup.style.width = 'auto';
        dom.bookmarkFolderPopup.style.maxHeight = '100%';
        dom.bookmarkFolderPopup.style.borderRadius = '12px';
        dom.bookmarkFolderPopup.style.overflow = 'hidden';
      } else if (OVERLAY_PANEL === 'account') {
        // 账户面板：已登录=账户菜单，未登录=登录界面
        state.accountMenuOpen = true;
        await loadAccount();
        renderAccountMenu();
        showAccountView(state.account && state.account.isLoggedIn ? 'accountMenu' : 'accountLoginView');
      }
    } catch (e) {
      console.error('[Overlay] 显示面板失败:', e);
    }
  }

  // ==================== 外观 ====================
  function resolveTheme(theme) {
    return theme === 'system'
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : theme;
    }

  function applyAppearance() {
    document.documentElement.setAttribute('data-theme', resolveTheme(state.theme));
    document.documentElement.setAttribute('data-accent', state.accentColor || 'blue');
    document.documentElement.setAttribute('data-skin', state.themeSkin || 'default');
    // 强制 chrome 图标/文字前景（设置页「图标与文字颜色」，chromeContrast.js 读取）
    document.documentElement.setAttribute('data-chrome-fg', state.chromeFgOverride || 'auto');
    // 沉浸式动态皮肤：跟随皮肤/主题切换动画
    if (liveSkinsApi) {
      liveSkinsApi.setSkin(state.themeSkin || 'default');
      liveSkinsApi.setTheme(resolveTheme(state.theme));
      liveSkinsApi.setScrim(state.liveSkinScrim || 'auto');
    }
    // chrome 按钮前景自适应：按背景亮度自动选黑/白（浅色花纹皮肤下白按钮不可见的老问题）
    if (chromeContrastApi) {
      chromeContrastApi.setLive(!!(liveSkinsApi && liveSkinsApi.isLive(state.themeSkin || 'default')));
      chromeContrastApi.refresh();
    }
  }

  // 监听系统主题变化
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    if (state.theme === 'system') {
      document.documentElement.setAttribute('data-theme', e.matches ? 'dark' : 'light');
      if (liveSkinsApi) liveSkinsApi.setTheme(e.matches ? 'dark' : 'light');
      // ⚠️ 自适应前景也必须刷新：chromeContrast 用内联变量覆盖颜色，
      // 优先级高于样式表——不刷新的话系统切暗色后按钮仍是旧深色（规则失效的根因）
      if (chromeContrastApi) {
        chromeContrastApi.refresh();
        // 动态皮肤画布需一帧按新主题重绘，延迟再采样一次
        const isLive = !!(liveSkinsApi && liveSkinsApi.isLive(state.themeSkin || 'default'));
        if (isLive) setTimeout(() => chromeContrastApi.refresh(), 200);
      }
    }
  });

  // ==================== 窗口控制 ====================
  // 最大化时窗口直角铺满屏幕（去掉圆角/边框），还原时恢复微圆角
  function applyWindowMaximizedClass(maximized) {
    document.documentElement.classList.toggle('window-maximized', !!maximized);
  }

  function bindWindowControls() {
    dom.btnMinimize.addEventListener('click', () => api.minimizeWindow());
    dom.btnMaximize.addEventListener('click', () => api.maximizeWindow());
    dom.btnClose.addEventListener('click', () => api.closeWindow());

    // 初始化窗口最大化状态（用于圆角/直角切换）
    if (api.isMaximized) {
      api.isMaximized().then((m) => applyWindowMaximizedClass(m));
    }

    // 透明窗口不支持系统原生双击标题栏最大化，手动实现（标签/按钮上双击除外）
    const dragRegion = document.querySelector('.title-bar__drag-region');
    if (dragRegion) {
      dragRegion.addEventListener('dblclick', (e) => {
        if (e.target.closest('button, .tab, input, a, [role="tab"]')) return;
        api.maximizeWindow();
      });
    }

    // 窗口置顶（图钉按钮）
    if (api.isAlwaysOnTop) {
      api.isAlwaysOnTop().then((flag) => {
        state.isAlwaysOnTop = Boolean(flag);
        updatePinButton();
      });
    }
    dom.btnPin.addEventListener('click', async () => {
      const next = !state.isAlwaysOnTop;
      state.isAlwaysOnTop = next;
      updatePinButton();
      await api.setAlwaysOnTop(next);
    });
    if (api.onAlwaysOnTopChanged) {
      const unsubPin = api.onAlwaysOnTopChanged((flag) => {
        state.isAlwaysOnTop = Boolean(flag);
        updatePinButton();
      });
      state.unsubscribers.push(unsubPin);
    }
  }

  function updatePinButton() {
    const active = state.isAlwaysOnTop;
    dom.btnPin.classList.toggle('is-active', active);
    dom.btnPin.setAttribute('aria-pressed', String(active));
    dom.btnPin.title = active ? '取消窗口置顶' : '窗口置顶';
  }

  // ==================== 导航按钮 ====================
  function bindNavigationButtons() {
    dom.btnBack.addEventListener('click', () => api.goBack());
    dom.btnForward.addEventListener('click', () => api.goForward());
    dom.btnRefresh.addEventListener('click', () => {
      if (state.isLoading) {
        api.stop();
      } else {
        api.refresh();
      }
    });
    dom.btnHome.addEventListener('click', () => api.goHome());
    api.getSetting('showHomeButton').then((show) => {
      dom.btnHome.style.display = show === false ? 'none' : '';
    });
    if (api.onSettingsChanged) {
      const unsubSettings = api.onSettingsChanged(({ key, value }) => {
        if (key === 'showHomeButton') {
          dom.btnHome.style.display = value === false ? 'none' : '';
        } else if (key === 'accentColor') {
          state.accentColor = value || 'blue';
          applyAppearance();
        } else if (key === 'themeSkin') {
          state.themeSkin = value || 'default';
          applyAppearance();
        } else if (key === 'chromeFgOverride') {
          state.chromeFgOverride = value || 'auto';
          applyAppearance();
        } else if (key === 'liveSkinScrim') {
          state.liveSkinScrim = value || 'auto';
          applyAppearance();
        } else if (key === 'theme') {
          state.theme = value || 'system';
          applyAppearance();
        } else if (key === 'account') {
          state.account = value || { isLoggedIn: false, name: '', email: '' };
          renderAccountAvatar();
        }
      });
      state.unsubscribers.push(unsubSettings);
    }

    // 鼠标侧键导航
    document.addEventListener('mousedown', (e) => {
      if (e.button === 3) { // 后退键
        e.preventDefault();
        api.goBack();
      } else if (e.button === 4) { // 前进键
        e.preventDefault();
        api.goForward();
      }
    });
  }

  function updateNavButtons() {
    dom.btnBack.disabled = !state.canGoBack;
    dom.btnForward.disabled = !state.canGoForward;

    // 刷新/停止按钮切换
    if (state.isLoading) {
      dom.refreshIcon.innerHTML = '<line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" stroke-width="2"/><line x1="6" y1="18" x2="18" y2="6" stroke="currentColor" stroke-width="2"/>';
    } else {
      dom.refreshIcon.innerHTML = '<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>';
    }
  }

  // ==================== 地址栏 ====================
  function bindAddressBar() {
    // 回车导航
    dom.addressInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const input = dom.addressInput.value.trim();
        if (input) {
          navigateToUrl(input);
        }
      }
    });

    // 点击全选
    dom.addressInput.addEventListener('focus', () => {
      dom.addressInput.select();
    });

    // 失去焦点时恢复显示当前 URL
    dom.addressInput.addEventListener('blur', () => {
      updateAddressBar();
    });

    // 右键菜单（Edge 风格）
    dom.addressInput.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showAddressBarContextMenu(e.clientX, e.clientY);
    });
  }

  function navigateToUrl(input) {
    // 检查是否是内部页面
    if (input === 'neutron://downloads') {
      openDownloadPanel();
      return;
    }
    if (input === 'neutron://history') {
      openHistoryPanel();
      return;
    }
    if (input === 'neutron://settings' ||
        input === 'neutron://bookmarks' ||
        input === 'neutron://extensions' || input === 'neutron://newtab') {
      api.createTab(input);
      return;
    }

    // 检查是否是 URL 还是搜索词
    let url = input;

    // 已经包含协议
    if (/^https?:\/\//i.test(url) || /^file:\/\//i.test(url) || /^neutron:\/\//i.test(url)) {
      // 完整 URL，直接使用
    }
    // 包含点且不含空格的域名
    else if (url.includes('.') && !url.includes(' ')) {
      url = 'https://' + url;
    }
    // 可能是 localhost 或 IP
    else if (/^localhost/i.test(url) || /^\d+\.\d+\.\d+\.\d+/.test(url)) {
      url = 'https://' + url;
    }
    // 文件路径
    else if (/^[a-zA-Z]:\\/.test(url) || /^\//.test(url)) {
      url = 'file:///' + url.replace(/\\/g, '/');
    }
    // 搜索
    else {
      url = null; // 使用默认搜索
    }

    if (url) {
      api.navigateTo(url);
    } else {
      // 作为搜索词处理
      api.navigateTo(input);
    }

    dom.addressInput.blur();
  }

  function updateAddressBar() {
    if (state.currentUrl && !state.currentUrl.startsWith('neutron://')) {
      dom.addressInput.value = state.currentUrl;
    } else if (state.currentUrl && state.currentUrl.startsWith('neutron://')) {
      dom.addressInput.value = '';
      dom.addressInput.placeholder = '输入网址或搜索内容';
    }

    // 更新安全指示器
    updateSecurityIndicator();
  }

  function updateSecurityIndicator() {
    const url = state.currentUrl || '';
    if (url.startsWith('https://')) {
      dom.securityIndicator.className = 'address-bar__security address-bar__security--secure';
      dom.securityIcon.innerHTML = '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>';
      dom.securityIndicator.title = '安全连接';
    } else if (url.startsWith('http://')) {
      dom.securityIndicator.className = 'address-bar__security address-bar__security--insecure';
      dom.securityIcon.innerHTML = '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>';
      dom.securityIndicator.title = '不安全连接';
    } else if (url.startsWith('neutron://')) {
      dom.securityIndicator.className = 'address-bar__security';
      dom.securityIcon.innerHTML = '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>';
      dom.securityIndicator.title = '内部页面';
    } else {
      dom.securityIndicator.className = 'address-bar__security';
      dom.securityIcon.innerHTML = '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>';
      dom.securityIndicator.title = '';
    }
  }

  function updateLoadingBar(progress) {
    if (progress === undefined) return;

    if (progress < 100 && progress > 0) {
      dom.loadingBar.className = 'address-bar__loading-bar address-bar__loading-bar--loading';
      dom.loadingBar.style.transform = `scaleX(${Math.min(progress / 100, 0.9)})`;
    } else if (progress >= 100) {
      dom.loadingBar.className = 'address-bar__loading-bar address-bar__loading-bar--done';
    } else {
      dom.loadingBar.className = 'address-bar__loading-bar';
      dom.loadingBar.style.transform = 'scaleX(0)';
    }
  }

  // ==================== 标签页 UI ====================
  function bindTabEvents() {
    // 新建标签页按钮在标签栏中动态创建
    renderNewTabButton();
  }

  // 返回当前模式下的标签页容器（水平标签栏 或 垂直标签栏）
  function getTabContainer() {
    return state.verticalTabs ? dom.verticalTabStrip : dom.titleBarTabsArea;
  }

  function renderTabs() {
    const tabsArea = getTabContainer();
    // 清除现有标签页与分组标题元素
    tabsArea.querySelectorAll('.tab, .tab-group-header').forEach(el => el.remove());

    let lastGroupId = null;
    state.tabs.forEach((tab, index) => {
      // 分组标题：当 groupId 发生变化且存在分组时插入
      if (tab.groupId !== lastGroupId && tab.groupId) {
        const group = state.tabGroups.find(g => g.id === tab.groupId);
        if (group) appendGroupHeader(tabsArea, group);
      }
      lastGroupId = tab.groupId;
      // 折叠分组：隐藏其下标签页（但保持活动标签页可见，避免当前页凭空消失）
      const group = tab.groupId ? state.tabGroups.find(g => g.id === tab.groupId) : null;
      if (group && group.collapsed && tab.id !== state.activeTabId) return;

      const tabEl = createTabElement(tab, index);
      tabsArea.appendChild(tabEl);
    });

    // 确保新建按钮在最后
    const newBtn = tabsArea.querySelector('.tab-new');
    if (newBtn) tabsArea.removeChild(newBtn);
    renderNewTabButton();
  }

  function appendGroupHeader(container, group) {
    const header = document.createElement('div');
    header.className = 'tab-group-header' + (group.collapsed ? ' tab-group-header--collapsed' : '');
    header.dataset.groupId = group.id;
    header.style.setProperty('--group-color', group.color || '#4285f4');
    const caret = document.createElement('span');
    caret.className = 'tab-group-header__caret';
    caret.textContent = group.collapsed ? '›' : '⌄';
    const dot = document.createElement('span');
    dot.className = 'tab-group-header__dot';
    const name = document.createElement('span');
    name.className = 'tab-group-header__name';
    name.textContent = group.name || '分组';
    const count = document.createElement('span');
    count.className = 'tab-group-header__count';
    count.textContent = String(state.tabs.filter(t => t.groupId === group.id).length);
    header.appendChild(caret);
    header.appendChild(dot);
    header.appendChild(name);
    header.appendChild(count);
    header.title = '点击折叠/展开分组';
    header.addEventListener('click', () => api.toggleTabGroup(group.id));
    container.appendChild(header);
  }

  // 应用垂直标签栏布局开关（切换 class 与容器显隐，不触发重绘，渲染由调用方负责）
  function applyVerticalTabsLayout(enabled) {
    state.verticalTabs = !!enabled;
    dom.app.classList.toggle('app--vertical-tabs', !!enabled);
    if (dom.verticalTabStrip) dom.verticalTabStrip.hidden = !enabled;
    if (dom.btnVerticalTabs) {
      dom.btnVerticalTabs.classList.toggle('tool-btn--active', !!enabled);
      dom.btnVerticalTabs.setAttribute('aria-pressed', String(!!enabled));
    }
  }

  // 应用侧边栏开关（切换显隐与按钮激活态，打开时渲染收藏夹）
  function applySidebarLayout(enabled) {
    state.sidebarOpen = !!enabled;
    if (dom.sidebar) dom.sidebar.hidden = !enabled;
    if (dom.btnSidebar) {
      dom.btnSidebar.classList.toggle('tool-btn--active', !!enabled);
      dom.btnSidebar.setAttribute('aria-pressed', String(!!enabled));
    }
    if (enabled) renderSidebar();
  }

  // 渲染侧边栏收藏夹（书签栏 + 子文件夹，平铺可点击导航）
  function renderSidebar() {
    const container = dom.sidebarContent;
    if (!container) return;
    container.innerHTML = '';
    const bar = state.bookmarks && state.bookmarks['bookmark_bar'];
    const children = (bar && bar.children) || [];
    if (children.length === 0) {
      container.innerHTML = '<div class="sidebar__empty">书签栏为空</div>';
      return;
    }
    const walk = (items, depth) => {
      for (const item of items) {
        if (!item) continue;
        if (item.type === 'folder') {
          const folder = document.createElement('div');
          folder.className = 'sidebar__folder';
          folder.style.paddingLeft = (8 + depth * 14) + 'px';
          folder.textContent = '📁 ' + (item.title || '文件夹');
          container.appendChild(folder);
          if (item.children && item.children.length) walk(item.children, depth + 1);
        } else if (item.type === 'bookmark' || item.url) {
          const link = document.createElement('a');
          link.className = 'sidebar__link';
          link.href = item.url || '#';
          link.style.paddingLeft = (8 + depth * 14) + 'px';
          link.textContent = item.title || item.url || '未命名';
          link.title = item.url || '';
          link.addEventListener('click', (e) => {
            e.preventDefault();
            navigateToUrl(item.url);
          });
          container.appendChild(link);
        }
      }
    };
    walk(children, 0);
  }

  function createTabElement(tab, index) {
    const el = document.createElement('div');
    el.className = 'tab' + (tab.id === state.activeTabId ? ' tab--active' : '') +
                  (tab.isPinned ? ' tab--pinned' : '') +
                  (tab.isSleeping ? ' tab--sleeping' : '') +
                  (tab.id === state.splitTabId ? ' tab--split' : '');
    el.dataset.tabId = tab.id;
    el.dataset.index = index;
    el.title = (tab.title || tab.url || '新标签页') + (tab.isSleeping ? '（已休眠，点击唤醒）' : '');
    el.draggable = true;

    // Favicon
    const faviconDiv = document.createElement('div');
    faviconDiv.className = 'tab__favicon';
    if (tab.isSleeping) {
      // 休眠指示器（月亮图标）
      faviconDiv.classList.add('tab__favicon--sleeping');
      faviconDiv.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
    } else if (tab.isLoading) {
      faviconDiv.classList.add('tab__favicon--loading');
      faviconDiv.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="32"><animate attributeName="stroke-dashoffset" values="32;0" dur="1.5s" repeatCount="indefinite"/></circle></svg>';
    } else if (tab.favicon) {
      faviconDiv.innerHTML = `<img src="${tab.favicon}" alt="" onerror="this.style.display='none'" />`;
    } else {
      faviconDiv.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>';
    }
    el.appendChild(faviconDiv);

    // 标题
    const titleSpan = document.createElement('span');
    titleSpan.className = 'tab__title';
    titleSpan.textContent = tab.title || '新标签页';
    el.appendChild(titleSpan);

    // 音频指示器
    if (tab.isAudible) {
      const audioDiv = document.createElement('div');
      audioDiv.className = 'tab__audio-indicator';
      audioDiv.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3z"/></svg>';
      audioDiv.addEventListener('click', (e) => {
        e.stopPropagation();
        api.muteTab(tab.id);
      });
      el.appendChild(audioDiv);
    }

    // 关闭按钮（固定标签页不显示）
    if (!tab.isPinned) {
      const closeBtn = document.createElement('button');
      closeBtn.className = 'tab__close';
      closeBtn.innerHTML = '&times;';
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        api.closeTab(tab.id);
      });
      // 中键关闭
      el.addEventListener('mousedown', (e) => {
        if (e.button === 1) {
          e.preventDefault();
          api.closeTab(tab.id);
        }
      });
      el.appendChild(closeBtn);
    }

    // 点击切换标签页
    el.addEventListener('click', (e) => {
      if (e.target === el || e.target.classList.contains('tab__title') ||
          e.target.classList.contains('tab__favicon') || e.target.tagName === 'svg' ||
          e.target.tagName === 'IMG' || e.target.tagName === 'circle' ||
          e.target.tagName === 'path' || e.target.tagName === 'line') {
        api.switchTab(tab.id);
      }
    });

    // 右键菜单
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showTabContextMenu(e.clientX, e.clientY, tab);
    });

    // 拖拽
    el.addEventListener('dragstart', handleDragStart);
    el.addEventListener('dragover', handleDragOver);
    el.addEventListener('drop', handleDrop);
    el.addEventListener('dragend', handleDragEnd);

    return el;
  }

  function renderNewTabButton() {
    const tabsArea = getTabContainer();
    const existing = tabsArea.querySelector('.tab-new');
    if (existing) return;

    const newBtn = document.createElement('div');
    newBtn.className = 'tab-new';
    newBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
    newBtn.title = '新建标签页 (Ctrl+T)';
    newBtn.addEventListener('click', () => api.createTab());
    tabsArea.appendChild(newBtn);
  }

  // ==================== 标签页拖拽 ====================
  let dragSrcIndex = null;

  function handleDragStart(e) {
    dragSrcIndex = parseInt(this.dataset.index, 10);
    this.style.opacity = '0.5';
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', this.dataset.tabId);
  }

  function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }

  function handleDrop(e) {
    e.preventDefault();
    const targetIndex = parseInt(this.dataset.index, 10);
    if (dragSrcIndex !== null && dragSrcIndex !== targetIndex) {
      api.reorderTab(dragSrcIndex, targetIndex);
    }
  }

  function handleDragEnd(e) {
    this.style.opacity = '1';
    dragSrcIndex = null;
  }

  // ==================== 书签 ====================
  async function bindBookmarkEvents() {
    dom.btnBookmark.addEventListener('click', () => {
      if (state.isBookmarked) {
        showBookmarkDialog(true, findBookmarkByUrl(state.bookmarks, state.currentUrl));
      } else {
        showBookmarkDialog(false);
      }
    });

    // 书签栏显示控制
    api.getSetting('showBookmarkBar').then((show) => {
      if (!show) {
        dom.bookmarkBar.classList.add('bookmark-bar--hidden');
      }
    });

    dom.bookmarkBarItems.addEventListener('contextmenu', (e) => {
      if (e.target.closest('.bookmark-item')) return;
      e.preventDefault();
      api.showBookmarkBarContextMenu({ x: e.clientX, y: e.clientY });
    });

    dom.bookmarkBarItems.addEventListener('dragover', (e) => {
      if (!e.target.closest('.bookmark-item')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      }
    });

    dom.bookmarkBarItems.addEventListener('drop', (e) => {
      if (e.target.closest('.bookmark-item')) return;
      handleBookmarkDropToBar(e);
    });
  }

  async function updateBookmarkState() {
    if (state.currentUrl && !state.currentUrl.startsWith('neutron://')) {
      state.isBookmarked = await api.isBookmarked(state.currentUrl);
      if (state.isBookmarked) {
        dom.bookmarkIcon.setAttribute('fill', '#fcc934');
        dom.bookmarkIcon.setAttribute('stroke', '#fcc934');
        dom.btnBookmark.classList.add('address-bar__bookmark-btn--active');
      } else {
        dom.bookmarkIcon.setAttribute('fill', 'none');
        dom.bookmarkIcon.setAttribute('stroke', 'currentColor');
        dom.btnBookmark.classList.remove('address-bar__bookmark-btn--active');
      }
    }
  }

  function bindBookmarkDialog() {
    dom.bookmarkDialogClose.addEventListener('click', closeBookmarkDialog);
    dom.bookmarkDialogCancel.addEventListener('click', closeBookmarkDialog);
    dom.bookmarkDialogSave.addEventListener('click', saveBookmark);
    dom.bookmarkDialogRemove.addEventListener('click', removeBookmark);
    dom.bookmarkDialog.addEventListener('click', (e) => {
      if (e.target === dom.bookmarkDialog) closeBookmarkDialog();
    });

    // 网址输入时实时识别网站图标（防抖 350ms）
    let faviconTimer = null;
    dom.bookmarkUrl.addEventListener('input', () => {
      clearTimeout(faviconTimer);
      faviconTimer = setTimeout(recognizeBookmarkDialogFavicon, 350);
    });
    // 回车保存
    [dom.bookmarkName, dom.bookmarkUrl, dom.bookmarkFolder].forEach((el) => {
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') saveBookmark();
      });
    });
  }

  function bindFolderDialog() {
    dom.folderDialogClose.addEventListener('click', closeFolderDialog);
    dom.folderDialogCancel.addEventListener('click', closeFolderDialog);
    dom.folderDialogSave.addEventListener('click', saveFolderDialog);
    dom.folderDialog.addEventListener('click', (e) => {
      if (e.target === dom.folderDialog) closeFolderDialog();
    });
    dom.folderName.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        saveFolderDialog();
      }
    });
  }

  function showFolderDialog(isEditing, folder = null, parentId = 'bookmark_bar') {
    if (state.contextMenuOpen) closeContextMenu();
    if (state.downloadPanelOpen) closeDownloadPanel();
    if (state.historyPanelOpen) closeHistoryPanel();
    if (state.bookmarksPanelOpen) closeBookmarksPanel();
    state.editingFolder = folder || null;
    state.folderParentId = parentId;
    api.setModalVisible(true);
    dom.folderDialog.style.display = 'flex';
    dom.folderDialogTitle.textContent = isEditing ? '编辑文件夹' : '新建文件夹';
    dom.folderName.value = folder ? (folder.title || '') : '';
    dom.folderName.focus();
    dom.folderName.select();
  }

  function closeFolderDialog() {
    dom.folderDialog.style.display = 'none';
    state.editingFolder = null;
    api.setModalVisible(false);
  }

  async function saveFolderDialog() {
    const name = dom.folderName.value.trim();
    if (!name) {
      dom.folderName.focus();
      return;
    }

    if (state.editingFolder) {
      await api.updateBookmark(state.editingFolder.id, { title: name });
    } else {
      await api.addFolder({ title: name, parentId: state.folderParentId });
    }
    await refreshBookmarks();
    closeFolderDialog();
  }

  function renderBookmarkFolderOptions(selectedId = 'bookmark_bar') {
    const folders = [];
    const collectFolders = (folder, depth) => {
      if (!folder || folder.type !== 'folder') return;
      folders.push({ folder, depth });
      for (const child of (folder.children || [])) {
        if (child.type === 'folder') collectFolders(child, depth + 1);
      }
    };

    for (const key of Object.keys(state.bookmarks)) {
      collectFolders(state.bookmarks[key], 0);
    }

    dom.bookmarkFolder.innerHTML = '';
    for (const { folder, depth } of folders) {
      const option = document.createElement('option');
      option.value = folder.id;
      option.textContent = `${'  '.repeat(depth)}${folder.title}`;
      dom.bookmarkFolder.appendChild(option);
    }
    dom.bookmarkFolder.value = selectedId;
  }

  async function showBookmarkDialog(isEditing, bookmark = null, defaultFolderId = null) {
    if (state.contextMenuOpen) closeContextMenu();
    if (state.downloadPanelOpen) closeDownloadPanel();
    if (state.historyPanelOpen) closeHistoryPanel();
    if (state.bookmarksPanelOpen) closeBookmarksPanel();
    state.editingBookmark = bookmark || null;
    api.setModalVisible(true);
    dom.bookmarkDialog.style.display = 'flex';
    if (isEditing) {
      dom.bookmarkDialogTitle.textContent = '编辑书签';
      dom.bookmarkDialogRemove.style.display = 'inline-block';
    } else {
      dom.bookmarkDialogTitle.textContent = '添加书签';
      dom.bookmarkDialogRemove.style.display = 'none';
    }
    renderBookmarkFolderOptions(
      (bookmark && bookmark.parentId) || defaultFolderId || 'bookmark_bar'
    );
    dom.bookmarkName.value = (bookmark && bookmark.title) || getDisplayTitleForUrl(state.currentTitle, state.currentUrl) || '';
    dom.bookmarkUrl.value = (bookmark && bookmark.url) || state.currentUrl || '';
    if (bookmark && bookmark.parentId) {
      dom.bookmarkFolder.value = bookmark.parentId;
    }
    state.dialogRecognizedFavicon = '';
    recognizeBookmarkDialogFavicon();
    dom.bookmarkName.focus();
    dom.bookmarkName.select();
  }

  function closeBookmarkDialog() {
    dom.bookmarkDialog.style.display = 'none';
    state.editingBookmark = null;
    api.setModalVisible(false);
  }

  async function saveBookmark() {
    const targetUrl = dom.bookmarkUrl.value || state.currentUrl || '';
    // 优先使用对话框内识别到的网址图标；未识别时回退已存图标/当前页图标
    const rawFavicon = state.dialogRecognizedFavicon ||
      ((state.editingBookmark && state.editingBookmark.favicon) || state.currentFavicon || '');
    const favicon = getTrustedFavicon(rawFavicon, targetUrl);
    const bookmark = {
      title: dom.bookmarkName.value || getDisplayTitleForUrl(state.currentTitle, targetUrl) || '未命名书签',
      url: targetUrl,
      parentId: dom.bookmarkFolder.value,
      favicon,
    };

    if (!bookmark.url) {
      alert('请输入有效的网址');
      return;
    }

    if (state.editingBookmark) {
      await api.updateBookmark(state.editingBookmark.id, bookmark);
    } else {
      await api.addBookmark(bookmark);
    }
    await refreshBookmarks();
    await updateBookmarkState();
    closeBookmarkDialog();
  }

  async function removeBookmark() {
    if (state.editingBookmark) {
      await api.removeBookmark(state.editingBookmark.id);
    } else {
      const findAndRemove = (folder) => {
        if (!folder.children) return false;
        for (const child of folder.children) {
          if (child.type === 'bookmark' && child.url === state.currentUrl) {
            api.removeBookmark(child.id);
            return true;
          }
          if (child.type === 'folder' && findAndRemove(child)) return true;
        }
        return false;
      };

      const bookmarks = await api.getBookmarks();
      for (const key of Object.keys(bookmarks)) {
        if (findAndRemove(bookmarks[key])) break;
      }
    }

    await refreshBookmarks();
    await updateBookmarkState();
    closeBookmarkDialog();
  }

  function createBookmarkFolder(parentId) {
    showFolderDialog(false, null, parentId || 'bookmark_bar');
  }

  function editBookmarkFolder(folder) {
    if (!folder || !folder.id) return;
    showFolderDialog(true, folder);
  }

  async function deleteBookmarkFolder(folderId) {
    if (!folderId) return;
    if (!confirm('确定要删除这个文件夹及其中的书签吗？')) return;

    await api.removeBookmark(folderId);
    await refreshBookmarks();
  }

  function clearBookmarkDragVisuals() {
    document.querySelectorAll(
      '.bookmark-item--dragging, .bookmark-item--drop-before, .bookmark-item--drop-after, .bookmark-item--drop-into'
    ).forEach((el) => el.classList.remove(
      'bookmark-item--dragging',
      'bookmark-item--drop-before',
      'bookmark-item--drop-after',
      'bookmark-item--drop-into'
    ));
  }

  function handleBookmarkDragStart(e) {
    state.bookmarkDragId = this.dataset.bookmarkId;
    state.bookmarkDropPosition = 'before';
    state.bookmarkDropMode = 'before';
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', this.dataset.bookmarkId);
    this.classList.add('bookmark-item--dragging');
    // 跨窗口拖拽：通知主进程记录被拖拽的书签
    if (api.setBookmarkDrag) api.setBookmarkDrag(this.dataset.bookmarkId);
  }

  // 拖拽悬停在书签文件夹中间区域时，防抖自动打开该文件夹的悬浮窗
  function scheduleFolderPopupOpen(folderEl) {
    if (state.folderPopupOpenTimer) clearTimeout(state.folderPopupOpenTimer);
    const folderId = folderEl && folderEl.dataset ? folderEl.dataset.bookmarkId : null;
    if (!folderId) return;
    const folder = state.bookmarks.bookmark_bar.children.find(c => c.id === folderId);
    if (!folder || folder.type !== 'folder') return;

    state.folderPopupOpenTimer = setTimeout(() => {
      state.folderPopupOpenTimer = null;
      // 若悬浮窗已打开且是该文件夹，无需重复打开
      if (state.bookmarkFolderPopupOpenId === folderId) return;
      state.bookmarkFolderPopupOpenId = folderId;
      const rect = folderEl.getBoundingClientRect();
      api.showBookmarkFolderMenu({
        folder: folder,
        x: rect.left,
        y: rect.bottom + 4,
      });
    }, 350);
  }

  function handleBookmarkDragOver(e) {
    e.preventDefault();
    const targetId = this.dataset.bookmarkId;

    if (!state.bookmarkDragId || state.bookmarkDragId === targetId) {
      this.classList.remove(
        'bookmark-item--drop-before',
        'bookmark-item--drop-after',
        'bookmark-item--drop-into'
      );
      if (state.folderPopupOpenTimer) { clearTimeout(state.folderPopupOpenTimer); state.folderPopupOpenTimer = null; }
      return;
    }

    e.dataTransfer.dropEffect = 'move';
    const rect = this.getBoundingClientRect();
    const isFolder = this.classList.contains('bookmark-item--folder');
    const isMiddle = e.clientX > rect.left + rect.width * 0.25 &&
      e.clientX < rect.left + rect.width * 0.75;

    if (isFolder && isMiddle) {
      state.bookmarkDropMode = 'into';
      this.classList.add('bookmark-item--drop-into');
      this.classList.remove('bookmark-item--drop-before', 'bookmark-item--drop-after');
      // 自动打开文件夹悬浮窗（防抖）
      scheduleFolderPopupOpen(this);
      return;
    }

    // 移出中间区域：取消待打开的悬浮窗
    if (state.folderPopupOpenTimer) { clearTimeout(state.folderPopupOpenTimer); state.folderPopupOpenTimer = null; }
    state.bookmarkDropMode = 'before';
    state.bookmarkDropPosition = e.clientX < rect.left + rect.width / 2 ? 'before' : 'after';
    this.classList.toggle('bookmark-item--drop-before', state.bookmarkDropPosition === 'before');
    this.classList.toggle('bookmark-item--drop-after', state.bookmarkDropPosition === 'after');
    this.classList.remove('bookmark-item--drop-into');
  }

  function handleBookmarkDragLeave(e) {
    if (e.currentTarget.contains(e.relatedTarget)) return;
    this.classList.remove(
      'bookmark-item--drop-before',
      'bookmark-item--drop-after',
      'bookmark-item--drop-into'
    );
    if (state.folderPopupOpenTimer) { clearTimeout(state.folderPopupOpenTimer); state.folderPopupOpenTimer = null; }
  }

  async function handleBookmarkDrop(e) {
    e.preventDefault();
    e.stopPropagation();

    const targetId = this.dataset.bookmarkId;
    let draggedId = state.bookmarkDragId;
    // 拖拽可能来自覆盖层（文件夹弹出菜单），用全局拖拽状态兜底
    if (!draggedId && api.getBookmarkDrag) {
      try { draggedId = await api.getBookmarkDrag(); } catch (err) { /* 忽略 */ }
    }
    const position = state.bookmarkDropPosition;
    const mode = state.bookmarkDropMode;
    clearBookmarkDragVisuals();
    state.bookmarkDragId = null;
    state.bookmarkDropMode = 'before';
    if (state.folderPopupOpenTimer) { clearTimeout(state.folderPopupOpenTimer); state.folderPopupOpenTimer = null; }

    if (!draggedId || draggedId === targetId) return;

    try {
      const moved = mode === 'into'
        ? await api.moveBookmarkIntoFolder(draggedId, targetId)
        : await api.moveBookmark(draggedId, targetId, position);
      if (moved) {
        if (dom.bookmarkFolderPopup.style.display === 'block') {
          closeBookmarkFolderPopup();
        }
        await refreshBookmarks();
        // 若目标文件夹的悬浮窗正打开着，实时刷新其内容
        if (state.bookmarkFolderPopupOpenId === targetId) {
          api.refreshBookmarkFolder(targetId);
        }
      }
    } catch (error) {
      console.error('[Renderer] 书签排序失败:', error);
    }
  }

  async function handleBookmarkDropToBar(e) {
    e.preventDefault();
    e.stopPropagation();

    let draggedId = state.bookmarkDragId;
    // 拖拽可能来自覆盖层（文件夹弹出菜单），用全局拖拽状态兜底
    if (!draggedId && api.getBookmarkDrag) {
      try { draggedId = await api.getBookmarkDrag(); } catch (err) { /* 忽略 */ }
    }
    clearBookmarkDragVisuals();
    state.bookmarkDragId = null;
    state.bookmarkDropMode = 'before';
    if (state.folderPopupOpenTimer) { clearTimeout(state.folderPopupOpenTimer); state.folderPopupOpenTimer = null; }

    if (!draggedId) return;

    try {
      const moved = await api.moveBookmarkIntoFolder(draggedId, 'bookmark_bar');
      if (moved) {
        if (dom.bookmarkFolderPopup.style.display === 'block') {
          closeBookmarkFolderPopup();
        }
        await refreshBookmarks();
        // 刷新正打开的文件夹弹出菜单（被拖出的书签从列表中移除）
        if (state.bookmarkFolderPopupOpenId) {
          api.refreshBookmarkFolder(state.bookmarkFolderPopupOpenId);
        }
      }
    } catch (error) {
      console.error('[Renderer] 书签移动到书签栏失败:', error);
    }
  }

  function handleBookmarkDragEnd() {
    clearBookmarkDragVisuals();
    state.bookmarkDragId = null;
    if (state.folderPopupOpenTimer) { clearTimeout(state.folderPopupOpenTimer); state.folderPopupOpenTimer = null; }
    if (api.clearBookmarkDrag) api.clearBookmarkDrag();
  }

  function renderBookmarkBar() {
    dom.bookmarkBarItems.innerHTML = '';

    const bookmarkBar = state.bookmarks.bookmark_bar;
    if (!bookmarkBar || !bookmarkBar.children) return;

    bookmarkBar.children.forEach((item) => {
      const el = document.createElement('div');
      el.className = item.type === 'folder'
        ? 'bookmark-item bookmark-item--folder'
        : 'bookmark-item';
      el.title = item.title || (item.type === 'folder' ? '未命名文件夹' : '未命名书签');
      el.draggable = true;
      el.tabIndex = 0; // 键盘可聚焦（focus-visible 描边反馈）
      el.dataset.bookmarkId = item.id;

      let icon;
      if (item.type === 'folder') {
        icon = document.createElement('span');
        icon.className = 'bookmark-item__icon bookmark-item__folder-icon';
        icon.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>';
      } else {
        // 网站图标：统一走智能解析（历史知识库 → /favicon.ico → DuckDuckGo → Google → ★）
        icon = document.createElement('span');
        icon.className = 'bookmark-item__icon';
        mountBookmarkIcon(icon, item);
      }

      const title = document.createElement('span');
      title.className = 'bookmark-item__title';
      title.textContent = el.title;

      el.appendChild(icon);
      el.appendChild(title);

      if (item.type === 'folder') {
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          e.preventDefault();
          // 再次点击同一文件夹 → 关闭悬浮窗
          if (state.bookmarkFolderPopupOpenId === item.id) {
            state.bookmarkFolderPopupOpenId = null;
            api.hidePanelOverlay();
            return;
          }
          if (state.downloadPanelOpen) closeDownloadPanel();
          state.bookmarkFolderPopupOpenId = item.id;
          const rect = el.getBoundingClientRect();
          api.showBookmarkFolderMenu({
            folder: item,
            x: rect.left,
            y: rect.bottom + 4,
          });
        });
      } else {
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          if (dom.bookmarkFolderPopup.style.display === 'block') {
            closeBookmarkFolderPopup();
          }
          if (state.downloadPanelOpen) closeDownloadPanel();
          api.navigateTo(item.url);
        });
      }

      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (item.type === 'folder') {
          if (state.downloadPanelOpen) closeDownloadPanel();
          if (dom.bookmarkFolderPopup.style.display === 'block') {
            closeBookmarkFolderPopup();
          }
          api.showBookmarkFolderContextMenu({
            x: e.clientX,
            y: e.clientY,
            folder: item,
          });
          return;
        }
        if (state.downloadPanelOpen) closeDownloadPanel();
        api.showBookmarkContextMenu({
          x: e.clientX,
          y: e.clientY,
          bookmark: {
            id: item.id,
            title: item.title,
            url: item.url,
            parentId: item.parentId,
          },
        });
      });

      el.addEventListener('dragstart', handleBookmarkDragStart);
      el.addEventListener('dragover', handleBookmarkDragOver);
      el.addEventListener('dragleave', handleBookmarkDragLeave);
      el.addEventListener('drop', handleBookmarkDrop);
      el.addEventListener('dragend', handleBookmarkDragEnd);
      dom.bookmarkBarItems.appendChild(el);
    });
  }

  async function refreshBookmarks() {
    state.bookmarks = await api.getBookmarks();
    warmFaviconCacheFromBookmarks();
    renderBookmarkBar();
    // 收藏夹面板打开时同步刷新
    if (state.bookmarksPanelOpen) renderBookmarksPanel();
  }

  function findBookmarkByUrl(bookmarks, url) {
    const findInFolder = (folder) => {
      if (!folder || !folder.children) return null;
      for (const child of folder.children) {
        if (child.type === 'bookmark' && child.url === url) return child;
        if (child.type === 'folder') {
          const found = findInFolder(child);
          if (found) return found;
        }
      }
      return null;
    };

    for (const key of Object.keys(bookmarks || {})) {
      const found = findInFolder(bookmarks[key]);
      if (found) return found;
    }
    return null;
  }

  function getSiteFaviconUrl(url) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
      return `${parsed.origin}/favicon.ico`;
    } catch (e) {
      return '';
    }
  }

  function getGoogleFaviconUrl(url) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
      return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(parsed.hostname)}&sz=32`;
    } catch (e) {
      return '';
    }
  }

  function getTrustedFavicon(favicon, url) {
    if (!favicon || !url) return '';
    if (SiteMeta.isFaviconTrusted) {
      return SiteMeta.isFaviconTrusted(favicon, url) ? favicon : '';
    }
    return favicon;
  }

  // ==================== 网站图标智能解析（书签栏/收藏夹面板/文件夹弹窗统一使用） ====================
  // favicon 知识库：host/url → 已确认的真实图标（来自历史记录、书签、本次会话解析成功）
  const faviconCacheByHost = {};
  const faviconCacheByUrl = {};
  let faviconCacheReady = false;

  function walkBookmarkItems(bookmarks) {
    const out = [];
    const walk = (folder) => {
      ((folder && folder.children) || []).forEach((child) => {
        if (child.type === 'bookmark') out.push(child);
        else if (child.type === 'folder') walk(child);
      });
    };
    Object.keys(bookmarks || {}).forEach((key) => walk(bookmarks[key]));
    return out;
  }

  function warmFaviconCacheFromBookmarks() {
    walkBookmarkItems(state.bookmarks).forEach((b) => {
      const f = getTrustedFavicon(b.favicon, b.url);
      if (!f) return;
      faviconCacheByUrl[b.url] = f;
      try {
        const host = new URL(b.url).hostname;
        if (host && !faviconCacheByHost[host]) faviconCacheByHost[host] = f;
      } catch (e) { /* 忽略无效 URL */ }
    });
  }

  /** 预载图标知识库：历史记录里存的是 Chromium 从页面 <link rel="icon"> 抓取的真实图标 */
  async function ensureFaviconCache() {
    if (faviconCacheReady) { warmFaviconCacheFromBookmarks(); return; }
    faviconCacheReady = true;
    try {
      const history = await api.getHistory();
      (history || []).forEach((h) => {
        const f = getTrustedFavicon(h.favicon, h.url);
        if (!f) return;
        faviconCacheByUrl[h.url] = f;
        try {
          const host = new URL(h.url).hostname;
          if (host && !faviconCacheByHost[host]) faviconCacheByHost[host] = f;
        } catch (e) { /* 忽略无效 URL */ }
      });
    } catch (e) { /* 历史加载失败不阻塞书签栏 */ }
    warmFaviconCacheFromBookmarks();
  }

  /** 书签图标的候选链：已存图标 → 历史/书签知识库 → /favicon.ico → DuckDuckGo → DNSPod → Google */
  function getBookmarkFaviconCandidates(item) {
    const candidates = [];
    const push = (v) => { if (v && candidates.indexOf(v) === -1) candidates.push(v); };
    if (!item || !item.url) return candidates;

    push(getTrustedFavicon(item.favicon, item.url));
    try {
      const u = new URL(item.url);
      push(faviconCacheByUrl[item.url] || faviconCacheByHost[u.hostname] || '');
    } catch (e) {}
    push(getSiteFaviconUrl(item.url));
    try {
      const host = new URL(item.url).hostname;
      if (host) {
        push(`https://icons.duckduckgo.com/ip3/${encodeURIComponent(host)}.ico`);
        // DNSPod 图标代理（腾讯，国内可用，避免 DDG/Google 被墙时无图标）
        push(`https://statics.dnspod.cn/proxy_favicon/_/favicon?domain=${encodeURIComponent(host)}`);
      }
    } catch (e) {}
    push(getGoogleFaviconUrl(item.url));
    return candidates;
  }

  /** 图标解析成功：写入会话知识库；仅可信图标（同站/白名单 CDN）回写书签持久化 */
  function rememberFavicon(url, faviconUrl, bookmarkId) {
    try {
      const u = new URL(url);
      const host = u.hostname;
      if (host && !faviconCacheByHost[host]) faviconCacheByHost[host] = faviconUrl;
      // 精确 URL 只记第一个成功值，避免后到的解析结果覆盖更准确的图标
      if (!faviconCacheByUrl[url]) faviconCacheByUrl[url] = faviconUrl;
    } catch (e) { return; }
    if (!bookmarkId || !getTrustedFavicon(faviconUrl, url)) return;
    const bm = findBookmarkByUrl(state.bookmarks, url);
    if (bm && bm.favicon !== faviconUrl) {
      bm.favicon = faviconUrl;
      api.updateBookmark(bookmarkId, { favicon: faviconUrl }).catch(() => {});
    }
  }

  /**
   * 为书签图标容器挂载真实网站图标（候选链异步推进，成功后缓存并回写书签）
   * @param {HTMLElement} iconEl - 图标容器（span/div，样式含 ... img 规则）
   * @param {Object} item - 书签项 {id, url, favicon}
   * @param {string} [fallbackText] - 全部失败时的占位符（默认 ★）
   * @param {Function} [onResolved] - 解析完成回调（成功传 src，失败传 ''）
   */
  function mountBookmarkIcon(iconEl, item, fallbackText, onResolved) {
    const fallback = fallbackText === undefined ? '★' : fallbackText;
    const candidates = getBookmarkFaviconCandidates(item);
    if (candidates.length === 0) {
      iconEl.textContent = fallback;
      if (onResolved) onResolved('');
      return;
    }

    const img = document.createElement('img');
    img.alt = '';
    img.draggable = false;
    img.referrerPolicy = 'no-referrer';
    let index = 0;
    img.addEventListener('error', () => {
      index += 1;
      if (index >= candidates.length) {
        img.remove();
        iconEl.textContent = fallback;
        if (onResolved) onResolved('');
        return;
      }
      img.src = candidates[index];
    });
    img.addEventListener('load', () => {
      rememberFavicon(item.url, img.src, item.id);
      if (onResolved) onResolved(img.src);
    });
    img.src = candidates[index];
    iconEl.appendChild(img);
  }

  /** 编辑/添加书签对话框：识别网址图标并实时预览（保存时使用识别结果） */
  async function recognizeBookmarkDialogFavicon() {
    const url = dom.bookmarkUrl.value.trim();
    const iconEl = dom.bookmarkUrlIcon;
    const token = ++state.dialogFaviconToken; // 防止旧网址的异步结果覆盖新输入
    iconEl.innerHTML = '';
    state.dialogRecognizedFavicon = '';
    if (!/^https?:\/\//i.test(url)) {
      iconEl.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>';
      return;
    }
    const existing = (state.editingBookmark && state.editingBookmark.favicon) || '';
    // 同步先取第一个可信候选（已存图标/历史知识库/站点根图标），保证保存即可带上
    const candidates = getBookmarkFaviconCandidates({ url, favicon: existing });
    const syncTrusted = candidates.map((c) => getTrustedFavicon(c, url)).find(Boolean) || '';
    state.dialogRecognizedFavicon = syncTrusted;
    // 异步走完整候选链（/favicon.ico → DuckDuckGo → DNSPod → Google），成功后展示并更新保存值
    mountBookmarkIcon(iconEl, { id: null, url, favicon: existing }, '★', (src) => {
      if (token === state.dialogFaviconToken) {
        state.dialogRecognizedFavicon = src || syncTrusted;
      }
    });

    // 主进程抓取页面 HTML 解析真实 <link rel="icon">（最准确），成功后替换预览并写入知识库
    if (api.resolveSiteFavicon) {
      try {
        const resolved = await api.resolveSiteFavicon(url);
        if (token !== state.dialogFaviconToken) return;
        const trusted = resolved && getTrustedFavicon(resolved.favicon, url);
        if (!trusted) return;
        // 若知识库已有该站真实图标，且解析结果是根目录兜底，不降级覆盖
        try {
          const host = new URL(url).hostname;
          const known = faviconCacheByHost[host] || '';
          if (known && trusted === `${new URL(url).origin}/favicon.ico`) return;
        } catch (e) {}
        state.dialogRecognizedFavicon = trusted;
        rememberFavicon(url, trusted, null); // 写入会话知识库，书签栏同站书签同步受益
        iconEl.innerHTML = '';
        mountBookmarkIcon(iconEl, { id: null, url, favicon: existing }, '★', (src) => {
          if (token === state.dialogFaviconToken) {
            state.dialogRecognizedFavicon = src || trusted;
          }
        });
      } catch (e) { /* 主进程解析失败：保持候选链结果 */ }
    }
  }

  /** 当前页浏览时，把真实图标回写到同名书签（历史遗留空图标自动修复） */
  function syncCurrentFaviconToBookmark() {
    if (!state.currentUrl || !state.currentFavicon) return;
    if (!getTrustedFavicon(state.currentFavicon, state.currentUrl)) return;
    const bm = findBookmarkByUrl(state.bookmarks, state.currentUrl);
    if (!bm || bm.favicon === state.currentFavicon) return;
    bm.favicon = state.currentFavicon;
    api.updateBookmark(bm.id, { favicon: state.currentFavicon }).catch(() => {});
    const barIcon = dom.bookmarkBarItems.querySelector(`[data-bookmark-id="${CSS.escape(bm.id)}"] .bookmark-item__icon`);
    if (barIcon) {
      barIcon.innerHTML = '';
      mountBookmarkIcon(barIcon, bm);
    }
  }

  function getDisplayTitleForUrl(title, url) {
    if (SiteMeta.normalizeHistoryTitle) {
      return SiteMeta.normalizeHistoryTitle(title, url);
    }
    const value = String(title || '').trim();
    if (value && value !== '新标签页') return value;
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch (e) {
      return value || url || '未知页面';
    }
  }

  // ==================== 工具按钮 ====================
  function bindToolButtons() {
    dom.btnVerticalTabs.addEventListener('click', async () => {
      try {
        const enabled = await api.toggleVerticalTabs(!state.verticalTabs);
        applyVerticalTabsLayout(enabled);
      } catch (e) { /* 忽略 */ }
    });
    dom.btnSplit.addEventListener('click', () => {
      if (state.splitTabId) {
        api.setSplitTab(null); // 退出分屏
      } else {
        const idx = state.tabs.findIndex(t => t.id === state.activeTabId);
        const target = state.tabs[idx + 1] || state.tabs[idx - 1];
        if (!target) {
          showToast('至少需要两个标签页才能分屏');
          return;
        }
        api.setSplitTab(target.id);
      }
    });
    dom.btnSidebar.addEventListener('click', async () => {
      try {
        const enabled = await api.toggleSidebar(!state.sidebarOpen);
        applySidebarLayout(enabled);
      } catch (e) { /* 忽略 */ }
    });
    if (dom.btnSidebarClose) {
      dom.btnSidebarClose.addEventListener('click', () => api.toggleSidebar(false).then(applySidebarLayout));
    }
    dom.btnDownloads.addEventListener('click', (e) => {
      e.stopPropagation();
      if (state.downloadPanelOpen) {
        closeDownloadPanel();
      } else {
        openDownloadPanel();
      }
    });
    dom.btnHistory.addEventListener('click', (e) => {
      e.stopPropagation();
      if (state.historyPanelOpen) {
        closeHistoryPanel();
      } else {
        openHistoryPanel();
      }
    });
    dom.btnBookmarks.addEventListener('click', (e) => {
      e.stopPropagation();
      if (state.bookmarksPanelOpen) {
        closeBookmarksPanel();
      } else {
        openBookmarksPanel();
      }
    });
    dom.btnExtensions.addEventListener('click', () => {
      if (state.extensionPopupOpen) {
        closeExtensionPopup();
      } else {
        openExtensionPopup();
      }
    });
    dom.btnSettings.addEventListener('click', () => {
      if (state.downloadPanelOpen) closeDownloadPanel();
      if (state.historyPanelOpen) closeHistoryPanel();
      if (state.bookmarksPanelOpen) closeBookmarksPanel();
      api.createTab('neutron://settings');
    });

    // 主窗口全局点击：当面板/文件夹悬浮窗打开时，点击工具栏/书签栏/标题栏关闭
    document.addEventListener('mousedown', (e) => {
      const anyOpen = state.downloadPanelOpen || state.historyPanelOpen ||
        state.bookmarksPanelOpen || state.extensionPopupOpen || state.accountMenuOpen ||
        !!state.bookmarkFolderPopupOpenId;
      if (!anyOpen) return;
      // 排除面板按钮自身（由按钮 click 处理开关）
      if (dom.btnDownloads.contains(e.target) || dom.btnHistory.contains(e.target) ||
          dom.btnBookmarks.contains(e.target) || dom.btnExtensions.contains(e.target) ||
          dom.btnSettings.contains(e.target) || dom.btnAccount.contains(e.target)) return;
      // 排除书签文件夹自身（由文件夹 click 处理开关）
      if (state.bookmarkFolderPopupOpenId && e.target.closest) {
        const folderEl = e.target.closest('.bookmark-item--folder');
        if (folderEl && folderEl.dataset.bookmarkId === state.bookmarkFolderPopupOpenId) return;
      }
      // 排除地址栏（用户可能在输入）
      if (dom.addressInput.contains(e.target)) return;
      // 关闭所有面板
      if (state.downloadPanelOpen) closeDownloadPanel();
      if (state.historyPanelOpen) closeHistoryPanel();
      if (state.bookmarksPanelOpen) closeBookmarksPanel();
      if (state.extensionPopupOpen) closeExtensionPopup();
      if (state.accountMenuOpen) closeAccountMenu();
      if (state.bookmarkFolderPopupOpenId) {
        state.bookmarkFolderPopupOpenId = null;
        api.hidePanelOverlay();
      }
    });
  }

  // ==================== 账户登录下拉菜单（已抽离到 accountMenu.js） ====================
  const accountMenuApi = window.NeutronAccountMenu({
    state, dom, api, IS_OVERLAY,
    closeDownloadPanel, closeHistoryPanel, closeBookmarksPanel,
    closeExtensionPopup, closeContextMenu, showToast,
  });
  function loadAccount() { return accountMenuApi.loadAccount(); }
  function renderAccountAvatar() { return accountMenuApi.renderAccountAvatar(); }
  function renderAccountMenu() { return accountMenuApi.renderAccountMenu(); }
  function showAccountView(name) { return accountMenuApi.showAccountView(name); }
  function bindAccountMenu() { return accountMenuApi.bindAccountMenu(); }
  function closeAccountMenu() { return accountMenuApi.closeAccountMenu(); }

  // ==================== 下载悬浮面板（已抽离到 downloadPanel.js） ====================
  const downloadPanelApi = window.NeutronDownloadPanel({
    state, dom, api, IS_OVERLAY,
    showToast, showDownloadContextMenu,
    closeContextMenu, closeHistoryPanel, closeBookmarksPanel,
    closeExtensionPopup, closeBookmarkFolderPopup, getPanelAnchorRect,
  });
  function bindDownloadPanel() { return downloadPanelApi.bindDownloadPanel(); }
  function loadDownloads() { return downloadPanelApi.loadDownloads(); }
  function updateDownloadButton() { return downloadPanelApi.updateDownloadButton(); }
  function updateDownloadRow(item) { return downloadPanelApi.updateDownloadRow(item); }
  function renderDownloadPanel() { return downloadPanelApi.renderDownloadPanel(); }
  function openDownloadPanel() { return downloadPanelApi.openDownloadPanel(); }
  function closeDownloadPanel() { return downloadPanelApi.closeDownloadPanel(); }
  function positionDownloadPanel() { return downloadPanelApi.positionDownloadPanel(); }

  function formatBytes(bytes) {
    return window.NeutronUtils.formatBytes(bytes);
  }

  function formatSpeed(bytesPerSecond) {
    return window.NeutronUtils.formatSpeed(bytesPerSecond);
  }

  // 彩色文件类型图标：返回 { text, color, bg }
  // ==================== 文件类型图标（已抽离到 fileIcons.js） ====================
  function getFileIcon(filename) {
    return window.NeutronFileIcons.getFileIcon(filename);
  }

  // 面板定位锚点：主窗口用按钮位置；覆盖层用主进程传入的锚点（转覆盖层视口坐标）
  function getPanelAnchorRect(btnEl) {
    if (!IS_OVERLAY) return btnEl.getBoundingClientRect();
    const a = state.overlayAnchor || {};
    const offY = state.overlayOffsetY || 0;
    const left = a.left || 0;
    const right = a.right || (a.left + (a.width || 380));
    const top = (a.top || 0) - offY;
    const bottom = (a.bottom || (a.top || 0)) - offY;
    return { left, right, top, bottom, width: right - left, height: bottom - top };
  }

  // ==================== 历史记录悬浮面板（已抽离到 historyPanel.js） ====================
  const historyPanelApi = window.NeutronHistoryPanel({
    state, dom, api, IS_OVERLAY,
    getTrustedFavicon, getSiteFaviconUrl, getGoogleFaviconUrl, getDisplayTitleForUrl,
    closeContextMenu, openContextMenu, showToast, loadDownloads,
    closeDownloadPanel, closeBookmarksPanel, closeExtensionPopup, closeBookmarkFolderPopup,
    getPanelAnchorRect,
  });
  function bindHistoryPanel() { return historyPanelApi.bindHistoryPanel(); }
  function loadHistoryPanel() { return historyPanelApi.loadHistoryPanel(); }
  function positionHistoryPanel() { return historyPanelApi.positionHistoryPanel(); }
  function openHistoryPanel() { return historyPanelApi.openHistoryPanel(); }
  function closeHistoryPanel() { return historyPanelApi.closeHistoryPanel(); }
  function showDownloadContextMenu(x, y, item) { return historyPanelApi.showDownloadContextMenu(x, y, item); }

  // ==================== 收藏夹悬浮面板（已抽离到 bookmarksPanel.js） ====================
  const bookmarksPanelApi = window.NeutronBookmarksPanel({
    state, dom, api, IS_OVERLAY,
    closeContextMenu, closeDownloadPanel, closeHistoryPanel,
    closeExtensionPopup, closeBookmarkFolderPopup,
    getPanelAnchorRect, refreshBookmarks, showToast,
    findBookmarkByUrl, getDisplayTitleForUrl, getTrustedFavicon,
    escapeHtmlAttr, mountBookmarkIcon,
  });
  function bindBookmarksPanel() { return bookmarksPanelApi.bindBookmarksPanel(); }
  function openBookmarksPanel() { return bookmarksPanelApi.openBookmarksPanel(); }
  function closeBookmarksPanel() { return bookmarksPanelApi.closeBookmarksPanel(); }
  function positionBookmarksPanel() { return bookmarksPanelApi.positionBookmarksPanel(); }
  function refreshBookmarksPanel() { return bookmarksPanelApi.refreshBookmarksPanel(); }
  function renderBookmarksPanel() { return bookmarksPanelApi.renderBookmarksPanel(); }

  // ==================== 扩展弹窗（已抽离到 extensionPopup.js） ====================
  const extensionPopupApi = window.NeutronExtensionPopup({
    state, dom, api, IS_OVERLAY,
    closeContextMenu, closeDownloadPanel, closeHistoryPanel, closeBookmarksPanel,
    getPanelAnchorRect,
  });
  function bindExtensionPopup() { return extensionPopupApi.bindExtensionPopup(); }
  function openExtensionPopup() { return extensionPopupApi.openExtensionPopup(); }
  function closeExtensionPopup() { return extensionPopupApi.closeExtensionPopup(); }
  function positionExtensionPopup() { return extensionPopupApi.positionExtensionPopup(); }
  function loadExtensionPopup() { return extensionPopupApi.loadExtensionPopup(); }

  // ==================== 工具栏扩展图标（已抽离到 extensionToolbar.js） ====================
  const extensionToolbarApi = window.NeutronExtensionToolbar({
    state, dom, api,
    showToast, showExtensionContextMenu,
    closeDownloadPanel, closeHistoryPanel, closeBookmarksPanel,
    closeExtensionPopup, closeContextMenu,
  });
  function bindExtensionToolbar() { return extensionToolbarApi.bindExtensionToolbar(); }

  // ==================== 扩展右键菜单（已抽离到 extensionContextMenu.js） ====================
  const extensionContextMenuApi = window.NeutronExtensionContextMenu({
    state, dom, api,
    showToast, closeContextMenu, closeExtensionPopup, openContextMenu,
  });
  function showExtensionContextMenu(x, y, action) {
    return extensionContextMenuApi.showExtensionContextMenu(x, y, action);
  }

  // ==================== 右键菜单 + 地址栏右键菜单（已抽离到 contextMenu.js） ====================
  const contextMenuApi = window.NeutronContextMenu({
    state, dom, api, IS_OVERLAY,
    closeDownloadPanel, closeHistoryPanel, closeExtensionPopup,
    closeBookmarkFolderPopup, closeBookmarkDialog, closeFolderDialog,
    showToast, navigateToUrl,
  });
  function openContextMenu() { return contextMenuApi.openContextMenu(); }
  function closeContextMenu() { return contextMenuApi.closeContextMenu(); }
  function bindContextMenu() { return contextMenuApi.bindContextMenu(); }
  function showAddressBarContextMenu(x, y) { return contextMenuApi.showAddressBarContextMenu(x, y); }
  function showTabContextMenu(x, y, tab) { return contextMenuApi.showTabContextMenu(x, y, tab); }

  // ==================== 书签文件夹弹出菜单（已抽离到 bookmarkFolderPopup.js） ====================
  const bookmarkFolderPopupApi = window.NeutronBookmarkFolderPopup({
    state, dom, api,
    closeContextMenu, mountBookmarkIcon, handleBookmarkDragStart, handleBookmarkDragEnd,
  });
  function closeBookmarkFolderPopup() { return bookmarkFolderPopupApi.closeBookmarkFolderPopup(); }
  function removeSubFolderPopup() { return bookmarkFolderPopupApi.removeSubFolderPopup(); }
  function handleBookmarkFolderMenuOpen(data) { return bookmarkFolderPopupApi.handleBookmarkFolderMenuOpen(data); }
  function showBookmarkFolderPopup(data) { return bookmarkFolderPopupApi.showBookmarkFolderPopup(data); }

  // 共享工具：HTML 属性转义（书签面板/文件夹弹窗等多处使用）
  function escapeHtmlAttr(str) { return window.NeutronUtils.escapeHtmlAttr(str); }

  // ==================== 键盘快捷键（已抽离到 keyboardShortcuts.js） ====================
  const keyboardShortcutsApi = window.NeutronKeyboardShortcuts({
    state, dom, api,
    showBookmarkDialog, findBookmarkByUrl,
    closeHistoryPanel, openHistoryPanel,
    closeDownloadPanel, openDownloadPanel,
    closeBookmarksPanel, openBookmarksPanel,
  });
  function bindKeyboardShortcuts() { return keyboardShortcutsApi.bindKeyboardShortcuts(); }

  // ==================== 拖放支持 + 拖拽安装扩展（已抽离到 extensionDropInstall.js） ====================
  const extensionDropInstallApi = window.NeutronExtensionDropInstall({
    state, api, IS_OVERLAY, showToast, loadExtensionPopup,
  });
  function setupExtensionDropInstall() { return extensionDropInstallApi.setupExtensionDropInstall(); }

  // ==================== 全局 Toast ====================
  function showToast(message, type) {
    return window.NeutronToast.showToast(message, type);
  }

  function bindDragAndDrop() {
    dom.addressInput.addEventListener('dragover', (e) => {
      e.preventDefault();
    });
    dom.addressInput.addEventListener('drop', (e) => {
      e.preventDefault();
      const droppedUrl = e.dataTransfer.getData('text/plain');
      if (droppedUrl) {
        dom.addressInput.value = droppedUrl;
        navigateToUrl(droppedUrl);
      }
    });
  }

  // ==================== IPC 监听器（已抽离到 ipcListeners.js） ====================
  const ipcListenersApi = window.NeutronIpcListeners({
    state, dom, api, IS_OVERLAY,
    renderTabs, syncCurrentFaviconToBookmark,
    updateAddressBar, updateNavButtons, updateLoadingBar, updateBookmarkState,
    applyWindowMaximizedClass, applyVerticalTabsLayout, applySidebarLayout,
    updateDownloadRow, renderDownloadPanel, updateDownloadButton, openDownloadPanel,
    handleBookmarkFolderMenuOpen, refreshBookmarks,
  });
  function bindIPCListeners() { return ipcListenersApi.bindIPCListeners(); }

  // ==================== 菜单事件处理（已抽离到 menuEvents.js） ====================
  const menuEventsApi = window.NeutronMenuEvents({
    state, dom, api,
    showBookmarkDialog, findBookmarkByUrl,
    createBookmarkFolder, editBookmarkFolder, deleteBookmarkFolder,
    refreshBookmarks, updateBookmarkState,
    closeDownloadPanel, openDownloadPanel,
    closeHistoryPanel, openHistoryPanel,
    closeBookmarksPanel, openBookmarksPanel,
    closeBookmarkFolderPopup,
  });
  function handleMenuEvent(data) { return menuEventsApi.handleMenuEvent(data); }

  // ==================== 沉浸式动态皮肤（已抽离到 liveSkins.js） ====================
  // 仅主窗口启用（覆盖层内无需动画）；皮肤/主题变化由 applyAppearance 驱动
  const liveSkinsApi = !IS_OVERLAY && window.NeutronLiveSkins
    ? window.NeutronLiveSkins({ canvas: dom.skinCanvas })
    : null;
  if (liveSkinsApi) {
    liveSkinsApi.init();
    liveSkinsApi.setSkin(state.themeSkin || 'default');
    liveSkinsApi.setTheme(resolveTheme(state.theme));
  }

  // ==================== chrome 按钮前景自适应（已抽离到 chromeContrast.js） ====================
  // 按 chrome 背景亮度自动计算黑/白按钮前景，解决浅色皮肤下白按钮不可见问题
  const chromeContrastApi = !IS_OVERLAY && window.NeutronChromeContrast
    ? window.NeutronChromeContrast({ canvas: dom.skinCanvas })
    : null;
  if (chromeContrastApi) {
    chromeContrastApi.refresh();
  }

  // ==================== 启动 ====================
  document.addEventListener('DOMContentLoaded', init);

  // 清理函数
  window.addEventListener('beforeunload', () => {
    state.unsubscribers.forEach(fn => { if (typeof fn === 'function') fn(); });
  });

})();
