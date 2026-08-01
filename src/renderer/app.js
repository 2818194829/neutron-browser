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
    btnDownloads: $('#btnDownloads'),
    downloadPanel: $('#downloadPanel'),
    downloadList: $('#downloadList'),
    downloadSearch: $('#downloadSearch'),
    downloadSearchWrap: $('#downloadSearchWrap'),
    downloadMoreMenu: $('#downloadMoreMenu'),
    btnHistory: $('#btnHistory'),
    historyPanel: $('#historyPanel'),
    historyList: $('#historyList'),
    historySearch: $('#historySearch'),
    historyMoreMenu: $('#historyMoreMenu'),
    btnExtensions: $('#btnExtensions'),
    extensionPopup: $('#extensionPopup'),
    extensionSiteLabel: $('#extensionSiteLabel'),
    extensionSiteToggle: $('#extensionSiteToggle'),
    extensionList: $('#extensionList'),
    btnManageExtensions: $('#btnManageExtensions'),
    btnGetExtensions: $('#btnGetExtensions'),
    btnSettings: $('#btnSettings'),
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
    historyItems: [],
    historyPanelOpen: false,
    historyPanelToken: 0,
    historyPanelPinned: false,
    historyActiveTab: 'all',
    historySearchQuery: '',
    recentClosedTabs: [],
    editingBookmark: null,
    editingFolder: null,
    folderParentId: 'bookmark_bar',
    bookmarkDragId: null,
    bookmarkDropPosition: 'before',
    bookmarkDropMode: 'before',
    extensionPopupOpen: false,
    extensionPopupExtensions: [],
    extensionSitePermissions: null,
    extensionPopupToken: 0,
    modalSnapshotResolver: null,
    theme: 'system',
    folderPopupData: null,
    subFolderPopupTimeout: null,
    subFolderPopupDiv: null,
    unsubscribers: [],
  };

  // ==================== API 快捷方式 ====================
  const api = window.NeutronBrowser;
  const SiteMeta = window.SiteMeta || {};
  if (!api) {
    console.error('[Renderer] NeutronBrowser API 未加载！请检查 preload.js');
    return;
  }

  // ==================== 初始化 ====================
  async function init() {
    console.log('[Renderer] 初始化中...');

    // 加载主题
    state.theme = await api.getTheme();
    applyTheme(state.theme);

    // 加载书签
    state.bookmarks = await api.getBookmarks();
    renderBookmarkBar();
    loadDownloads();

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
    bindExtensionPopup();
    bindKeyboardShortcuts();
    bindIPCListeners();
    bindDragAndDrop();

    // 监听来自系统菜单的事件
    const unsubMenu = api.onMenuEvent(handleMenuEvent);
    state.unsubscribers.push(unsubMenu);

    console.log('[Renderer] 初始化完成');
  }

  // ==================== 主题 ====================
  function applyTheme(theme) {
    if (theme === 'system') {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
    } else {
      document.documentElement.setAttribute('data-theme', theme);
    }
  }

  // 监听系统主题变化
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    if (state.theme === 'system') {
      document.documentElement.setAttribute('data-theme', e.matches ? 'dark' : 'light');
    }
  });

  // ==================== 窗口控制 ====================
  function bindWindowControls() {
    dom.btnMinimize.addEventListener('click', () => api.minimizeWindow());
    dom.btnMaximize.addEventListener('click', () => api.maximizeWindow());
    dom.btnClose.addEventListener('click', () => api.closeWindow());
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

  function renderTabs() {
    const tabsArea = dom.titleBarTabsArea;
    // 清除现有标签页元素
    tabsArea.querySelectorAll('.tab').forEach(el => el.remove());

    state.tabs.forEach((tab, index) => {
      const tabEl = createTabElement(tab, index);
      tabsArea.appendChild(tabEl);
    });

    // 确保新建按钮在最后
    const newBtn = tabsArea.querySelector('.tab-new');
    if (newBtn) tabsArea.removeChild(newBtn);
    renderNewTabButton();
  }

  function createTabElement(tab, index) {
    const el = document.createElement('div');
    el.className = 'tab' + (tab.id === state.activeTabId ? ' tab--active' : '') +
                  (tab.isPinned ? ' tab--pinned' : '');
    el.dataset.tabId = tab.id;
    el.dataset.index = index;
    el.title = tab.title || tab.url || '新标签页';
    el.draggable = true;

    // Favicon
    const faviconDiv = document.createElement('div');
    faviconDiv.className = 'tab__favicon';
    if (tab.isLoading) {
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
    const tabsArea = dom.titleBarTabsArea;
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
    if (state.downloadPanelOpen) closeDownloadPanel();
    if (state.historyPanelOpen) closeHistoryPanel();
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
    if (state.downloadPanelOpen) closeDownloadPanel();
    if (state.historyPanelOpen) closeHistoryPanel();
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
    const rawFavicon = state.editingBookmark && state.editingBookmark.favicon
      ? state.editingBookmark.favicon
      : (state.currentFavicon || '');
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
      return;
    }

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
  }

  async function handleBookmarkDrop(e) {
    e.preventDefault();
    e.stopPropagation();

    const targetId = this.dataset.bookmarkId;
    const draggedId = state.bookmarkDragId;
    const position = state.bookmarkDropPosition;
    const mode = state.bookmarkDropMode;
    clearBookmarkDragVisuals();
    state.bookmarkDragId = null;
    state.bookmarkDropMode = 'before';

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
      }
    } catch (error) {
      console.error('[Renderer] 书签排序失败:', error);
    }
  }

  async function handleBookmarkDropToBar(e) {
    e.preventDefault();
    e.stopPropagation();

    const draggedId = state.bookmarkDragId;
    clearBookmarkDragVisuals();
    state.bookmarkDragId = null;
    state.bookmarkDropMode = 'before';

    if (!draggedId) return;

    try {
      const moved = await api.moveBookmarkIntoFolder(draggedId, 'bookmark_bar');
      if (moved) {
        if (dom.bookmarkFolderPopup.style.display === 'block') {
          closeBookmarkFolderPopup();
        }
        await refreshBookmarks();
      }
    } catch (error) {
      console.error('[Renderer] 书签移动到书签栏失败:', error);
    }
  }

  function handleBookmarkDragEnd() {
    clearBookmarkDragVisuals();
    state.bookmarkDragId = null;
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
      el.dataset.bookmarkId = item.id;

      let icon;
      if (item.type === 'folder') {
        icon = document.createElement('span');
        icon.className = 'bookmark-item__icon bookmark-item__folder-icon';
        icon.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>';
      } else {
        const siteFavicon = getTrustedFavicon(item.favicon, item.url) || getSiteFaviconUrl(item.url);
        const googleFavicon = getGoogleFaviconUrl(item.url);

        if (siteFavicon || googleFavicon) {
          icon = document.createElement('img');
          icon.className = 'bookmark-item__icon';
          icon.alt = '';
          icon.draggable = false;
          icon.referrerPolicy = 'no-referrer';
          icon.src = siteFavicon || googleFavicon;

          icon.addEventListener('error', () => {
            if (!icon.dataset.fallback && googleFavicon && icon.src !== googleFavicon) {
              icon.dataset.fallback = '1';
              icon.src = googleFavicon;
              return;
            }

            const fallback = document.createElement('span');
            fallback.className = 'bookmark-item__icon';
            fallback.textContent = '★';
            icon.replaceWith(fallback);
          });
        } else {
          icon = document.createElement('span');
          icon.className = 'bookmark-item__icon';
          icon.textContent = '★';
        }
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
          if (state.downloadPanelOpen) closeDownloadPanel();
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
    renderBookmarkBar();
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
      api.createTab('neutron://settings');
    });
  }

  function bindDownloadPanel() {
    document.addEventListener('mousedown', (e) => {
      if (!state.downloadPanelOpen || dom.downloadPanel.hidden) return;
      if (dom.downloadPanel.contains(e.target) || dom.btnDownloads.contains(e.target)) return;
      closeDownloadPanel();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && state.downloadPanelOpen) closeDownloadPanel();
    });

    document.getElementById('btnDownloadOpenDir').addEventListener('click', async (e) => {
      e.stopPropagation();
      await api.openDownloadDirectory();
    });

    document.getElementById('btnDownloadSearch').addEventListener('click', (e) => {
      e.stopPropagation();
      dom.downloadSearchWrap.hidden = !dom.downloadSearchWrap.hidden;
      if (!dom.downloadSearchWrap.hidden) dom.downloadSearch.focus();
    });

    dom.downloadSearch.addEventListener('input', () => {
      state.downloadSearchQuery = dom.downloadSearch.value.trim().toLowerCase();
      renderDownloadPanel();
    });

    document.getElementById('btnDownloadMore').addEventListener('click', (e) => {
      e.stopPropagation();
      dom.downloadMoreMenu.hidden = !dom.downloadMoreMenu.hidden;
    });

    document.addEventListener('click', (e) => {
      if (!dom.downloadMoreMenu.hidden && !e.target.closest('.download-panel__more-wrap')) {
        dom.downloadMoreMenu.hidden = true;
      }
    });

    document.getElementById('btnClearCompletedDownloads').addEventListener('click', async () => {
      await api.clearCompletedDownloads();
      dom.downloadMoreMenu.hidden = true;
      await loadDownloads();
    });

    document.getElementById('btnClearAllDownloads').addEventListener('click', async () => {
      await api.clearDownloads();
      dom.downloadMoreMenu.hidden = true;
      await loadDownloads();
    });

    window.addEventListener('resize', () => {
      if (state.downloadPanelOpen) positionDownloadPanel();
    });
  }

  async function loadDownloads() {
    try {
      const items = await api.getDownloads();
      state.downloads = Array.isArray(items) ? items : [];
    } catch (e) {
      state.downloads = [];
    }
    renderDownloadPanel();
  }

  function renderDownloadPanel() {
    const list = dom.downloadList;
    list.innerHTML = '';

    const query = state.downloadSearchQuery;
    const items = state.downloads.filter((item) => {
      if (!query) return true;
      return String(item.filename || '').toLowerCase().includes(query);
    });

    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'download-empty';
      empty.textContent = query ? '没有匹配的下载内容' : '没有下载内容';
      list.appendChild(empty);
      return;
    }

    items.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'download-item';
      if (item.state === 'deleted') row.classList.add('download-item--deleted');

      const icon = document.createElement('div');
      icon.className = 'download-item__icon';
      icon.textContent = getFileIcon(item.filename);

      const body = document.createElement('div');
      body.className = 'download-item__body';

      const name = document.createElement('div');
      name.className = 'download-item__name';
      name.textContent = item.filename || '未命名文件';

      const meta = document.createElement('div');
      meta.className = 'download-item__meta';
      meta.textContent = getDownloadMeta(item);

      body.appendChild(name);
      body.appendChild(meta);

      if (item.state === 'in_progress') {
        const progress = document.createElement('div');
        progress.className = 'download-item__progress';

        const bar = document.createElement('div');
        bar.className = 'download-item__progress-bar';
        const percent = item.totalBytes > 0
          ? Math.min(100, Math.round((item.receivedBytes / item.totalBytes) * 100))
          : 0;
        bar.style.width = `${percent}%`;

        progress.appendChild(bar);
        body.appendChild(progress);
      }

      const actions = document.createElement('div');
      actions.className = 'download-item__actions';

      if (item.state === 'completed') {
        const openFile = document.createElement('button');
        openFile.type = 'button';
        openFile.className = 'download-item__open-file';
        openFile.textContent = '打开文件';
        openFile.addEventListener('click', async (e) => {
          e.stopPropagation();
          await api.openDownloadFile(item.id);
        });
        actions.appendChild(openFile);
      }

      if (item.state !== 'deleted') {
        const openFolder = document.createElement('button');
        openFolder.type = 'button';
        openFolder.className = 'download-item__action';
        openFolder.title = '打开文件夹';
        openFolder.setAttribute('aria-label', '打开文件夹');
        openFolder.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>';
        openFolder.addEventListener('click', async (e) => {
          e.stopPropagation();
          await api.openDownloadFolder(item.id);
        });
        actions.appendChild(openFolder);
      }

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'download-item__action download-item__action--danger';
      remove.title = '删除';
      remove.setAttribute('aria-label', '删除');
      remove.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';
      remove.addEventListener('click', async (e) => {
        e.stopPropagation();
        await api.deleteDownload(item.id);
        await loadDownloads();
      });
      actions.appendChild(remove);

      row.appendChild(icon);
      row.appendChild(body);
      row.appendChild(actions);
      list.appendChild(row);
    });
  }

  function getDownloadMeta(item) {
    if (item.state === 'in_progress') {
      const size = `${formatBytes(item.receivedBytes)} / ${formatBytes(item.totalBytes)}`;
      const speed = item.speed ? ` · ${formatSpeed(item.speed)}` : '';
      return size + speed;
    }
    if (item.state === 'completed') {
      return `已完成 · ${new Date(item.endTime || item.startTime).toLocaleString('zh-CN')}`;
    }
    if (item.state === 'deleted') return '已删除';
    if (item.state === 'paused') return '已暂停';
    if (item.state === 'failed') return '失败';
    if (item.state === 'cancelled') return '已取消';
    return '';
  }

  function formatBytes(bytes) {
    const value = Number(bytes) || 0;
    if (value <= 0) return '未知大小';
    const units = ['B', 'KB', 'MB', 'GB'];
    const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
    return `${parseFloat((value / Math.pow(1024, index)).toFixed(1))} ${units[index]}`;
  }

  function formatSpeed(bytesPerSecond) {
    return `${formatBytes(bytesPerSecond)}/s`;
  }

  function getFileIcon(filename) {
    const ext = String(filename || '').split('.').pop().toLowerCase();
    const icons = {
      pdf: 'PDF', doc: 'DOC', docx: 'DOC', xls: 'XLS', xlsx: 'XLS',
      ppt: 'PPT', pptx: 'PPT', zip: 'ZIP', rar: 'RAR', '7z': '7Z',
      jpg: 'IMG', jpeg: 'IMG', png: 'IMG', gif: 'IMG', svg: 'SVG',
      mp3: 'MP3', wav: 'WAV', mp4: 'MP4', avi: 'AVI', mkv: 'MKV',
      exe: 'EXE', msi: 'MSI', txt: 'TXT', html: 'HTML', js: 'JS',
      py: 'PY', json: 'JSON',
    };
    return icons[ext] || 'FILE';
  }

  async function openDownloadPanel() {
    if (state.downloadPanelOpen) return;
    if (state.historyPanelOpen) closeHistoryPanel();
    if (state.extensionPopupOpen) closeExtensionPopup();
    if (dom.bookmarkFolderPopup.style.display === 'block') closeBookmarkFolderPopup();

    const token = ++state.downloadPanelToken;
    state.downloadPanelOpen = true;
    dom.downloadPanel.hidden = false;
    dom.downloadPanel.style.visibility = 'hidden';

    const snapshotReady = new Promise((resolve) => {
      state.modalSnapshotResolver = resolve;
      setTimeout(() => {
        if (state.modalSnapshotResolver === resolve) {
          state.modalSnapshotResolver = null;
          resolve(null);
        }
      }, 1000);
    });

    api.setModalVisible(true);
    await snapshotReady;

    if (token !== state.downloadPanelToken || !state.downloadPanelOpen) return;

    await loadDownloads();
    if (token !== state.downloadPanelToken || !state.downloadPanelOpen) return;

    positionDownloadPanel();
    dom.downloadPanel.style.visibility = 'visible';
    requestAnimationFrame(positionDownloadPanel);
  }

  function closeDownloadPanel() {
    if (!state.downloadPanelOpen) return;
    state.downloadPanelToken++;
    state.downloadPanelOpen = false;
    dom.downloadPanel.hidden = true;
    dom.downloadPanel.style.visibility = '';
    dom.downloadMoreMenu.hidden = true;
    api.setModalVisible(false);
  }

  function positionDownloadPanel() {
    const rect = dom.btnDownloads.getBoundingClientRect();
    const width = dom.downloadPanel.offsetWidth || 380;
    const height = dom.downloadPanel.offsetHeight || 420;
    let left = rect.right - width;
    let top = rect.bottom + 8;

    if (left < 8) left = 8;
    if (left + width > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - width - 8);
    }
    if (top + height > window.innerHeight - 8) {
      top = Math.max(8, rect.top - height - 8);
    }

    dom.downloadPanel.style.left = `${left}px`;
    dom.downloadPanel.style.top = `${top}px`;
  }

  function bindHistoryPanel() {
    document.addEventListener('mousedown', (e) => {
      if (!state.historyPanelOpen || dom.historyPanel.hidden) return;
      if (state.historyPanelPinned) return;
      if (dom.historyPanel.contains(e.target) || dom.btnHistory.contains(e.target)) return;
      closeHistoryPanel();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && state.historyPanelOpen) closeHistoryPanel();
    });

    document.getElementById('btnHistoryClear').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('确定要清除所有历史记录吗？此操作无法撤销。')) return;
      await api.clearHistory();
      state.historyItems = [];
      renderHistoryPanel();
    });

    document.getElementById('btnHistoryMore').addEventListener('click', (e) => {
      e.stopPropagation();
      dom.historyMoreMenu.hidden = !dom.historyMoreMenu.hidden;
    });

    document.addEventListener('click', (e) => {
      if (!dom.historyMoreMenu.hidden && !e.target.closest('.history-panel__more-wrap')) {
        dom.historyMoreMenu.hidden = true;
      }
    });

    document.getElementById('btnHistoryFullPage').addEventListener('click', () => {
      closeHistoryPanel();
      api.createTab('neutron://history');
    });

    document.getElementById('btnHistoryPin').addEventListener('click', (e) => {
      e.stopPropagation();
      state.historyPanelPinned = !state.historyPanelPinned;
      const btn = document.getElementById('btnHistoryPin');
      btn.classList.toggle('history-panel__tool--active', state.historyPanelPinned);
      btn.title = state.historyPanelPinned ? '取消固定面板' : '固定面板';
    });

    dom.historySearch.addEventListener('input', () => {
      state.historySearchQuery = dom.historySearch.value.trim().toLowerCase();
      renderHistoryPanel();
    });

    document.querySelectorAll('.history-panel__tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        state.historyActiveTab = tab.dataset.tab;
        document.querySelectorAll('.history-panel__tab').forEach((item) => {
          item.classList.toggle('active', item === tab);
        });
        renderHistoryPanel();
      });
    });

    window.addEventListener('resize', () => {
      if (state.historyPanelOpen) positionHistoryPanel();
    });
  }

  async function loadHistoryPanel() {
    try {
      const [history, recentClosed] = await Promise.all([
        api.getHistory(),
        api.getRecentClosedTabs(),
      ]);
      state.historyItems = Array.isArray(history) ? history : [];
      state.recentClosedTabs = Array.isArray(recentClosed) ? recentClosed : [];
    } catch (e) {
      state.historyItems = [];
      state.recentClosedTabs = [];
    }
    renderHistoryPanel();
  }

  function renderHistoryPanel() {
    const list = dom.historyList;
    list.innerHTML = '';

    if (state.historyActiveTab === 'devices') {
      const empty = document.createElement('div');
      empty.className = 'history-empty';
      empty.textContent = '暂无可同步的跨设备标签页';
      list.appendChild(empty);
      return;
    }

    if (state.historyActiveTab === 'recent') {
      renderRecentClosed(list);
      return;
    }

    const query = state.historySearchQuery;
    const items = state.historyItems.filter((item) => {
      if (!query) return true;
      const title = String(item.title || '').toLowerCase();
      const url = String(item.url || '').toLowerCase();
      return title.includes(query) || url.includes(query);
    });

    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'history-empty';
      empty.textContent = query ? '没有匹配的历史记录' : '暂无历史记录';
      list.appendChild(empty);
      return;
    }

    const groups = groupHistoryItems(items);
    groups.forEach((group) => {
      const header = document.createElement('div');
      header.className = 'history-group__title';
      header.textContent = group.label;
      list.appendChild(header);

      group.items.forEach((item) => {
        list.appendChild(createHistoryRow(item));
      });
    });
  }

  function renderRecentClosed(container) {
    const query = state.historySearchQuery;
    const items = state.recentClosedTabs.filter((item) => {
      if (!query) return true;
      const title = String(item.title || '').toLowerCase();
      const url = String(item.url || '').toLowerCase();
      return title.includes(query) || url.includes(query);
    });

    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'history-empty';
      empty.textContent = query ? '没有匹配的最近关闭标签页' : '暂无最近关闭的标签页';
      container.appendChild(empty);
      return;
    }

    items.forEach((item) => {
      container.appendChild(createHistoryRow(item, true));
    });
  }

  function groupHistoryItems(items) {
    const now = Date.now();
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const startToday = startOfToday.getTime();
    const startYesterday = startToday - 86400000;

    const recent = [];
    const today = [];
    const yesterday = [];
    const earlier = {};

    items.forEach((item) => {
      const time = Number(item.lastVisitTime) || 0;
      if (time >= now - 3600000) {
        recent.push(item);
      } else if (time >= startToday) {
        today.push(item);
      } else if (time >= startYesterday) {
        yesterday.push(item);
      } else {
        const date = new Date(time);
        const key = date.toLocaleDateString('zh-CN', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        });
        if (!earlier[key]) earlier[key] = [];
        earlier[key].push(item);
      }
    });

    const sortDesc = (arr) => arr.sort((a, b) => (b.lastVisitTime || 0) - (a.lastVisitTime || 0));
    const groups = [];
    if (recent.length) groups.push({ label: '最近', items: sortDesc(recent) });
    if (today.length) groups.push({ label: '今天', items: sortDesc(today) });
    if (yesterday.length) groups.push({ label: '昨天', items: sortDesc(yesterday) });

    const earlierGroups = Object.entries(earlier)
      .map(([label, entries]) => ({
        label,
        items: sortDesc(entries),
        firstTime: Math.max(...entries.map((item) => item.lastVisitTime || 0)),
      }))
      .sort((a, b) => b.firstTime - a.firstTime);

    groups.push(...earlierGroups);
    return groups;
  }

  function getHistoryFaviconCandidates(item) {
    const candidates = [];
    const trustedFavicon = getTrustedFavicon(item.favicon, item.url);
    if (trustedFavicon) candidates.push(trustedFavicon);

    const siteFavicon = getSiteFaviconUrl(item.url);
    if (siteFavicon) candidates.push(siteFavicon);

    const googleFavicon = getGoogleFaviconUrl(item.url);
    if (googleFavicon) candidates.push(googleFavicon);

    try {
      const host = new URL(item.url).hostname;
      if (host) {
        candidates.push(`https://icons.duckduckgo.com/ip3/${encodeURIComponent(host)}.ico`);
      }
    } catch (e) { /* 忽略无效 URL */ }

    return candidates.filter((value, index, arr) => value && arr.indexOf(value) === index);
  }

  function createHistoryRow(item, isRecentClosed = false) {
    const row = document.createElement('div');
    row.className = 'history-item';
    row.title = `${item.title || item.url}\n${item.url || ''}`;

    const icon = document.createElement('div');
    icon.className = 'history-item__icon';
    const faviconSources = getHistoryFaviconCandidates(item);
    if (faviconSources.length === 0) {
      icon.textContent = '★';
    } else {
      const img = document.createElement('img');
      let index = 0;
      img.alt = '';
      img.draggable = false;
      img.referrerPolicy = 'no-referrer';
      img.addEventListener('error', () => {
        index += 1;
        if (index >= faviconSources.length) {
          img.remove();
          icon.textContent = '★';
          return;
        }
        img.src = faviconSources[index];
      });
      img.src = faviconSources[index];
      icon.appendChild(img);
    }

    const body = document.createElement('div');
    body.className = 'history-item__body';

    const title = document.createElement('div');
    title.className = 'history-item__title';
    title.textContent = getDisplayTitleForUrl(item.title, item.url);
    body.appendChild(title);

    const time = document.createElement('span');
    time.className = 'history-item__time';
    time.textContent = formatHistoryTime(item.lastVisitTime || item.closedAt);

    row.appendChild(icon);
    row.appendChild(body);
    row.appendChild(time);

    row.addEventListener('click', async () => {
      if (isRecentClosed) {
        await api.restoreRecentClosedTab(item.id);
      } else {
        api.navigateTo(item.url);
      }
      closeHistoryPanel();
    });

    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!isRecentClosed) {
        showHistoryContextMenu(e.clientX, e.clientY, item.id);
      }
    });

    return row;
  }

  function formatHistoryTime(timestamp) {
    const time = Number(timestamp) || 0;
    if (!time) return '';
    const date = new Date(time);
    const now = new Date();
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startYesterday = startToday - 86400000;

    if (time >= startToday) {
      return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    }
    if (time >= startYesterday) return '昨天';
    return date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
  }

  function showHistoryContextMenu(x, y, id) {
    dom.contextMenu.innerHTML = '';

    const item = document.createElement('div');
    item.className = 'context-menu__item context-menu__item--danger';
    item.textContent = '从历史记录中删除';
    item.addEventListener('click', async () => {
      dom.contextMenu.style.display = 'none';
      await api.deleteHistoryItem(id);
      await loadHistoryPanel();
    });

    dom.contextMenu.appendChild(item);
    dom.contextMenu.style.display = 'block';
    dom.contextMenu.style.left = Math.min(x, window.innerWidth - 220) + 'px';
    dom.contextMenu.style.top = Math.min(y, window.innerHeight - 200) + 'px';
  }

  async function openHistoryPanel() {
    if (state.historyPanelOpen) return;
    if (state.downloadPanelOpen) closeDownloadPanel();
    if (state.extensionPopupOpen) closeExtensionPopup();
    if (dom.bookmarkFolderPopup.style.display === 'block') closeBookmarkFolderPopup();

    const token = ++state.historyPanelToken;
    state.historyPanelOpen = true;
    dom.historyPanel.hidden = false;
    dom.historyPanel.style.visibility = 'hidden';

    const snapshotReady = new Promise((resolve) => {
      state.modalSnapshotResolver = resolve;
      setTimeout(() => {
        if (state.modalSnapshotResolver === resolve) {
          state.modalSnapshotResolver = null;
          resolve(null);
        }
      }, 1000);
    });

    api.setModalVisible(true);
    await snapshotReady;

    if (token !== state.historyPanelToken || !state.historyPanelOpen) return;

    await loadHistoryPanel();
    if (token !== state.historyPanelToken || !state.historyPanelOpen) return;

    positionHistoryPanel();
    dom.historyPanel.style.visibility = 'visible';
    requestAnimationFrame(positionHistoryPanel);
  }

  function closeHistoryPanel() {
    if (!state.historyPanelOpen) return;
    state.historyPanelToken++;
    state.historyPanelOpen = false;
    dom.historyPanel.hidden = true;
    dom.historyPanel.style.visibility = '';
    dom.historyMoreMenu.hidden = true;
    api.setModalVisible(false);
  }

  function positionHistoryPanel() {
    const rect = dom.btnHistory.getBoundingClientRect();
    const width = dom.historyPanel.offsetWidth || 420;
    const height = dom.historyPanel.offsetHeight || 460;
    let left = rect.right - width;
    let top = rect.bottom + 8;

    if (left < 8) left = 8;
    if (left + width > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - width - 8);
    }
    if (top + height > window.innerHeight - 8) {
      top = Math.max(8, rect.top - height - 8);
    }

    dom.historyPanel.style.left = `${left}px`;
    dom.historyPanel.style.top = `${top}px`;
  }

  function bindExtensionPopup() {
    dom.extensionSiteToggle.addEventListener('change', async () => {
      const perms = await getExtensionSitePermissions();
      perms.enabled = dom.extensionSiteToggle.checked;
      await saveExtensionSitePermissions(perms);
      renderExtensionList(state.extensionPopupExtensions, perms);
    });

    dom.btnManageExtensions.addEventListener('click', () => {
      closeExtensionPopup();
      api.createTab('neutron://extensions');
    });

    dom.btnGetExtensions.addEventListener('click', () => {
      closeExtensionPopup();
      api.createTab('https://microsoftedge.microsoft.com/addons/Microsoft-Edge-Extensions-Home');
    });

    document.addEventListener('mousedown', (e) => {
      if (!state.extensionPopupOpen || dom.extensionPopup.hidden) return;
      if (dom.extensionPopup.contains(e.target) || dom.btnExtensions.contains(e.target)) return;
      closeExtensionPopup();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeExtensionPopup();
    });

    window.addEventListener('resize', () => {
      if (state.extensionPopupOpen) positionExtensionPopup();
    });
  }

  async function openExtensionPopup() {
    if (state.downloadPanelOpen) closeDownloadPanel();
    if (state.historyPanelOpen) closeHistoryPanel();
    const token = ++state.extensionPopupToken;
    state.extensionPopupOpen = true;

    const snapshotReady = new Promise((resolve) => {
      state.modalSnapshotResolver = resolve;
      setTimeout(() => {
        if (state.modalSnapshotResolver === resolve) {
          state.modalSnapshotResolver = null;
          resolve(null);
        }
      }, 1000);
    });

    api.setModalVisible(true);
    await snapshotReady;

    if (token !== state.extensionPopupToken || !state.extensionPopupOpen) return;

    dom.extensionPopup.hidden = false;
    dom.extensionPopup.style.visibility = 'hidden';
    positionExtensionPopup();

    try {
      await loadExtensionPopup();
    } catch (error) {
      console.error('[Renderer] 扩展弹窗加载失败:', error);
      state.extensionPopupExtensions = [];
      renderExtensionList([], { enabled: true, blocked: {} });
    }

    positionExtensionPopup();
    dom.extensionPopup.style.visibility = 'visible';
    requestAnimationFrame(positionExtensionPopup);
  }

  function closeExtensionPopup() {
    if (!state.extensionPopupOpen) return;
    state.extensionPopupToken++;
    state.extensionPopupOpen = false;
    dom.extensionPopup.hidden = true;
    document.querySelectorAll('.extension-more-menu').forEach((menu) => {
      menu.hidden = true;
    });
    api.setModalVisible(false);
  }

  function positionExtensionPopup() {
    const rect = dom.btnExtensions.getBoundingClientRect();
    const width = dom.extensionPopup.offsetWidth || 380;
    const height = dom.extensionPopup.offsetHeight || 420;
    let left = rect.right;
    let top = rect.bottom + 8;

    if (left + width > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - width - 8);
    }
    if (left < 8) left = 8;
    if (top + height > window.innerHeight - 8) {
      top = Math.max(8, rect.top - height - 8);
    }

    dom.extensionPopup.style.left = `${left}px`;
    dom.extensionPopup.style.top = `${top}px`;
  }

  function getSiteKey(url) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.origin;
    } catch (e) {
      // 忽略无效 URL
    }
    return url || '__default__';
  }

  function getSiteLabel(url) {
    try {
      const parsed = new URL(url);
      return parsed.hostname || parsed.href;
    } catch (e) {
      return url || '当前站点';
    }
  }

  async function getExtensionSitePermissions() {
    const key = getSiteKey(state.currentUrl);
    const all = (await api.getSetting('siteExtensionPermissions')) || {};
    const current = all[key] || { enabled: true, blocked: {} };
    if (!current.blocked) current.blocked = {};
    current.origin = key;
    state.extensionSitePermissions = current;
    return current;
  }

  async function saveExtensionSitePermissions(perms) {
    const all = (await api.getSetting('siteExtensionPermissions')) || {};
    all[perms.origin] = { enabled: perms.enabled, blocked: perms.blocked || {} };
    api.setSetting('siteExtensionPermissions', all);
    state.extensionSitePermissions = all[perms.origin];
  }

  async function loadExtensionPopup() {
    dom.extensionSiteLabel.textContent = `允许在${getSiteLabel(state.currentUrl)}使用扩展`;

    const perms = await getExtensionSitePermissions();
    dom.extensionSiteToggle.checked = perms.enabled !== false;

    const extensions = await api.getExtensions();
    state.extensionPopupExtensions = Array.isArray(extensions) ? extensions : [];
    renderExtensionList(state.extensionPopupExtensions, perms);
  }

  function createExtensionMenuAction(label, action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', action);
    return button;
  }

  function renderExtensionList(extensions, perms) {
    const list = dom.extensionList;
    list.innerHTML = '';

    if (!extensions.length) {
      const empty = document.createElement('div');
      empty.className = 'extension-empty';
      empty.textContent = '暂无已安装的扩展程序';
      list.appendChild(empty);
      return;
    }

    extensions.forEach((ext) => {
      const row = document.createElement('div');
      const siteDisabled = perms.enabled === false || Boolean(perms.blocked[ext.id]);
      row.className = ext.enabled === false || siteDisabled
        ? 'extension-item extension-item--disabled'
        : 'extension-item';

      const icon = document.createElement('div');
      icon.className = 'extension-item__icon';
      if (ext.icon) {
        const img = document.createElement('img');
        img.src = 'file:///' + ext.icon.replace(/\\/g, '/');
        img.alt = '';
        img.addEventListener('error', () => {
          icon.textContent = '🧩';
        });
        icon.appendChild(img);
      } else {
        icon.textContent = '🧩';
      }

      const body = document.createElement('div');
      body.className = 'extension-item__body';

      const name = document.createElement('div');
      name.className = 'extension-item__name';
      name.textContent = ext.name || '未命名扩展';

      const desc = document.createElement('div');
      desc.className = 'extension-item__desc';
      if (perms.blocked[ext.id]) {
        desc.textContent = '已在此网站禁用';
      } else if (perms.enabled === false) {
        desc.textContent = '站点权限已关闭';
      } else if (ext.enabled === false) {
        desc.textContent = '已禁用';
      } else {
        desc.textContent = ext.description || '允许在所有站点上使用';
      }

      body.appendChild(name);
      body.appendChild(desc);

      const actions = document.createElement('div');
      actions.className = 'extension-item__actions';

      const blockBtn = document.createElement('button');
      blockBtn.type = 'button';
      blockBtn.className = 'extension-item__action' + (perms.blocked[ext.id] ? ' extension-item__action--active' : '');
      blockBtn.title = '禁止在此网站运行扩展';
      blockBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>';
      blockBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const currentPerms = await getExtensionSitePermissions();
        currentPerms.blocked[ext.id] = !currentPerms.blocked[ext.id];
        await saveExtensionSitePermissions(currentPerms);
        renderExtensionList(state.extensionPopupExtensions, currentPerms);
      });

      const moreBtn = document.createElement('button');
      moreBtn.type = 'button';
      moreBtn.className = 'extension-item__action';
      moreBtn.title = '更多操作';
      moreBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>';

      const moreMenu = document.createElement('div');
      moreMenu.className = 'extension-more-menu';
      moreMenu.hidden = true;
      moreMenu.appendChild(createExtensionMenuAction('扩展详情', () => {
        closeExtensionPopup();
        api.createTab('neutron://extensions');
      }));
      moreMenu.appendChild(createExtensionMenuAction('选项', () => {
        closeExtensionPopup();
        api.createTab('neutron://extensions');
      }));
      moreMenu.appendChild(createExtensionMenuAction('卸载', async () => {
        if (!confirm(`确定要卸载扩展“${ext.name || '未命名扩展'}”吗？`)) return;
        await api.uninstallExtension(ext.id);
        if (state.extensionPopupOpen) await loadExtensionPopup();
      }));

      moreBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        document.querySelectorAll('.extension-more-menu').forEach((menu) => {
          if (menu !== moreMenu) menu.hidden = true;
        });
        moreMenu.hidden = !moreMenu.hidden;
      });

      actions.appendChild(blockBtn);
      actions.appendChild(moreBtn);

      row.appendChild(icon);
      row.appendChild(body);
      row.appendChild(actions);
      row.appendChild(moreMenu);
      list.appendChild(row);
    });
  }

  // ==================== 右键菜单 ====================
  function bindContextMenu() {
    document.addEventListener('click', (e) => {
      dom.contextMenu.style.display = 'none';

      // Don't close folder popup if clicking inside it or on the folder button that opened it
      if (dom.bookmarkFolderPopup.style.display === 'block') {
        const popup = dom.bookmarkFolderPopup;
        const subPopup = state.subFolderPopupDiv;
        const clickedInsidePopup = popup.contains(e.target);
        const clickedInsideSub = subPopup && subPopup.contains(e.target);
        const clickedOnFolder = e.target.closest('.bookmark-item--folder');
        if (!clickedInsidePopup && !clickedInsideSub && !clickedOnFolder) {
          closeBookmarkFolderPopup();
        }
      }
    });
  }

  function showTabContextMenu(x, y, tab) {
    dom.contextMenu.innerHTML = '';

    const items = [
      { label: '新建标签页', action: () => api.createTab(), icon: '+' },
      { label: '重新加载', action: () => api.reloadTab(tab.id), icon: '↻' },
      { type: 'separator' },
      { label: '复制标签页', action: () => api.duplicateTab(tab.id), icon: '⧉' },
      { label: tab.isPinned ? '取消固定标签页' : '固定标签页', action: () => api.pinTab(tab.id), icon: '📌' },
      { type: 'separator' },
      { label: '关闭标签页', action: () => api.closeTab(tab.id), icon: '×', cls: tab.isPinned ? 'context-menu__item--disabled' : '' },
      { label: '关闭其他标签页', action: () => closeOtherTabs(tab.id), icon: '', cls: 'context-menu__item--danger' },
    ];

    items.forEach((item) => {
      if (item.type === 'separator') {
        const sep = document.createElement('div');
        sep.className = 'context-menu__separator';
        dom.contextMenu.appendChild(sep);
        return;
      }

      const el = document.createElement('div');
      el.className = 'context-menu__item ' + (item.cls || '');
      el.innerHTML = `<span>${item.icon}</span> ${item.label}`;
      el.addEventListener('click', () => {
        dom.contextMenu.style.display = 'none';
        if (item.action) item.action();
      });
      dom.contextMenu.appendChild(el);
    });

    dom.contextMenu.style.display = 'block';
    dom.contextMenu.style.left = Math.min(x, window.innerWidth - 220) + 'px';
    dom.contextMenu.style.top = Math.min(y, window.innerHeight - 300) + 'px';
  }

  function closeOtherTabs(tabId) {
    const otherTabs = state.tabs.filter(t => t.id !== tabId && !t.isPinned);
    otherTabs.forEach(t => api.closeTab(t.id));
  }

  // ==================== 书签文件夹弹出菜单 ====================
  function closeBookmarkFolderPopup() {
    api.setModalVisible(false);
    dom.bookmarkFolderPopup.style.display = 'none';
    state.folderPopupData = null;
    clearTimeout(state.subFolderPopupTimeout);
    removeSubFolderPopup();
  }

  function removeSubFolderPopup() {
    if (state.subFolderPopupDiv) {
      state.subFolderPopupDiv.remove();
      state.subFolderPopupDiv = null;
    }
  }

  function handleBookmarkFolderMenuOpen(data) {
    state.folderPopupData = data;
    showBookmarkFolderPopup(data);
  }

  function showBookmarkFolderPopup(data) {
    const { x, y, items } = data;
    api.setModalVisible(true);
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
      renderFolderItems(listEl, items);
    }
    popup.appendChild(listEl);

    popup.style.display = 'block';

    // Position: edge-aware
    const POPUP_WIDTH = 280;
    let left = x;
    if (left + POPUP_WIDTH > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - POPUP_WIDTH - 8);
    }
    popup.style.left = left + 'px';
    popup.style.top = y + 'px';
  }

  function renderFolderItems(container, items) {
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
        el.addEventListener('mouseenter', (e) => {
          clearTimeout(state.subFolderPopupTimeout);
          state.subFolderPopupTimeout = setTimeout(() => {
            showSubFolderPopup(item, el);
          }, 200);
        });
      } else {
        const siteFavicon = getTrustedFavicon(item.favicon, item.url) || getSiteFaviconUrl(item.url);
        const googleFavicon = getGoogleFaviconUrl(item.url);
        const favicon = siteFavicon || googleFavicon;

        const icon = document.createElement('span');
        icon.className = 'bfp-item__icon';

        if (favicon) {
          const img = document.createElement('img');
          img.width = 16;
          img.height = 16;
          img.alt = '';
          img.draggable = false;
          img.referrerPolicy = 'no-referrer';
          img.src = favicon;
          img.addEventListener('error', () => {
            if (!img.dataset.fallback && googleFavicon && img.src !== googleFavicon) {
              img.dataset.fallback = '1';
              img.src = googleFavicon;
              return;
            }

            const fallback = document.createElement('span');
            fallback.className = 'bfp-item__icon';
            fallback.textContent = '★';
            icon.replaceWith(fallback);
          });
          icon.appendChild(img);
        } else {
          icon.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>';
        }

        const title = document.createElement('span');
        title.className = 'bfp-item__title';
        title.textContent = item.title || '未命名书签';

        el.appendChild(icon);
        el.appendChild(title);

        el.addEventListener('click', (e) => {
          e.stopPropagation();
          closeBookmarkFolderPopup();
          api.navigateTo(item.url);
        });
      }

      el.addEventListener('dragstart', handleBookmarkDragStart);
      el.addEventListener('dragend', handleBookmarkDragEnd);

      container.appendChild(el);
    });
  }

  function showSubFolderPopup(folder, anchorEl) {
    removeSubFolderPopup();

    const sub = document.createElement('div');
    sub.className = 'bfp-sub-popup';

    renderFolderItems(sub, (folder.children || []).map(child => ({
      id: child.id,
      title: child.title || (child.type === 'folder' ? '未命名文件夹' : '未命名书签'),
      url: child.url || '',
      favicon: child.favicon || '',
      type: child.type,
      children: child.type === 'folder' ? child.children : [],
    })));

    document.body.appendChild(sub);

    const anchorRect = anchorEl.getBoundingClientRect();
    const SUB_WIDTH = 260;
    let left = anchorRect.right + 4;
    if (left + SUB_WIDTH > window.innerWidth - 8) {
      left = anchorRect.left - SUB_WIDTH - 4;
    }
    let top = anchorRect.top;
    // Keep sub-popup within viewport vertically
    const estimatedHeight = Math.min(sub.children.length * 34 + 16, 400);
    if (top + estimatedHeight > window.innerHeight - 8) {
      top = window.innerHeight - estimatedHeight - 8;
    }

    sub.style.left = left + 'px';
    sub.style.top = top + 'px';
    state.subFolderPopupDiv = sub;
  }

  function escapeHtmlAttr(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  // ==================== 键盘快捷键 ====================
  function bindKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      const isCtrl = e.ctrlKey || e.metaKey;

      // Ctrl+T / Cmd+T: 新建标签页
      if (isCtrl && e.key === 't') {
        e.preventDefault();
        api.createTab();
      }
      // Ctrl+W / Cmd+W: 关闭标签页
      else if (isCtrl && e.key === 'w') {
        e.preventDefault();
        if (state.activeTabId) {
          api.closeTab(state.activeTabId);
        }
      }
      // Ctrl+Shift+T: 重新打开关闭的标签页
      else if (isCtrl && e.shiftKey && e.key === 'T') {
        e.preventDefault();
        // TODO: 实现恢复最近关闭的标签页
      }
      // Ctrl+L / Alt+D: 聚焦地址栏
      else if ((isCtrl && e.key === 'l') || (e.altKey && e.key === 'd')) {
        e.preventDefault();
        dom.addressInput.focus();
        dom.addressInput.select();
      }
      // Ctrl+Tab: 切换到下一个标签页
      else if (isCtrl && e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault();
        switchToNextTab();
      }
      // Ctrl+Shift+Tab: 切换到上一个标签页
      else if (isCtrl && e.shiftKey && e.key === 'Tab') {
        e.preventDefault();
        switchToPrevTab();
      }
      // Ctrl+R / F5: 刷新
      else if ((isCtrl && e.key === 'r') || e.key === 'F5') {
        e.preventDefault();
        if (e.shiftKey) {
          api.reloadTab(null, true); // 硬刷新
        } else {
          api.refresh();
        }
      }
      // Ctrl+D: 添加书签
      else if (isCtrl && e.key === 'd') {
        e.preventDefault();
        showBookmarkDialog(
          state.isBookmarked,
          state.isBookmarked ? findBookmarkByUrl(state.bookmarks, state.currentUrl) : null
        );
      }
      // Ctrl+H: 历史记录
      else if (isCtrl && e.key === 'h') {
        e.preventDefault();
        if (state.historyPanelOpen) {
          closeHistoryPanel();
        } else {
          openHistoryPanel();
        }
      }
      // Ctrl+J: 下载内容
      else if (isCtrl && e.key === 'j') {
        e.preventDefault();
        if (state.downloadPanelOpen) {
          closeDownloadPanel();
        } else {
          openDownloadPanel();
        }
      }
      // Ctrl+Shift+O: 书签管理器
      else if (isCtrl && e.shiftKey && e.key === 'O') {
        e.preventDefault();
        api.createTab('neutron://bookmarks');
      }
      // Ctrl+,: 设置
      else if (isCtrl && e.key === ',') {
        e.preventDefault();
        api.createTab('neutron://settings');
      }
      // Ctrl+Shift+I: 开发者工具
      else if (isCtrl && e.shiftKey && e.key === 'I') {
        e.preventDefault();
        // 主进程会处理 DevTools
      }
      // Esc: 停止加载
      else if (e.key === 'Escape') {
        if (state.isLoading) {
          api.stop();
        }
        dom.addressInput.blur();
      }
    });
  }

  function switchToNextTab() {
    const currentIndex = state.tabs.findIndex(t => t.id === state.activeTabId);
    if (currentIndex < state.tabs.length - 1) {
      api.switchTab(state.tabs[currentIndex + 1].id);
    } else if (state.tabs.length > 0) {
      api.switchTab(state.tabs[0].id);
    }
  }

  function switchToPrevTab() {
    const currentIndex = state.tabs.findIndex(t => t.id === state.activeTabId);
    if (currentIndex > 0) {
      api.switchTab(state.tabs[currentIndex - 1].id);
    } else if (state.tabs.length > 0) {
      api.switchTab(state.tabs[state.tabs.length - 1].id);
    }
  }

  // ==================== 拖放支持（在地址栏） ====================
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

  // ==================== IPC 监听器 ====================
  function bindIPCListeners() {
    // 标签页列表更新
    const unsub1 = api.onTabListUpdated((data) => {
      state.tabs = data.tabs || [];
      state.activeTabId = data.activeTabId;
      renderTabs();
      if (state.historyPanelOpen) closeHistoryPanel();

      // 更新内容区域占位符
      if (state.tabs.length === 0) {
        dom.contentPlaceholder.style.display = '';
      } else {
        dom.contentPlaceholder.style.display = 'none';
      }
    });
    state.unsubscribers.push(unsub1);

    // 导航状态更新
    const unsub2 = api.onNavStateChanged((data) => {
      if (data.tabId === state.activeTabId) {
        state.currentUrl = data.url || '';
        state.currentTitle = data.title || '';
        state.currentFavicon = data.favicon || '';
        state.canGoBack = data.canGoBack || false;
        state.canGoForward = data.canGoForward || false;
        state.isLoading = data.isLoading || false;

        updateAddressBar();
        updateNavButtons();
        updateLoadingBar(data.loadingProgress);
        updateBookmarkState();

        // 更新状态栏
        dom.statusUrl.textContent = state.currentUrl || '';

      }
    });
    state.unsubscribers.push(unsub2);

    // 窗口状态更新
    const unsub3 = api.onWindowStateChanged((data) => {
      state.isMaximized = data.maximized;
      if (data.maximized) {
        dom.maximizeIcon.innerHTML = '<rect x="2" y="2" width="8" height="8" stroke="currentColor" stroke-width="1.5" fill="none"/><rect x="1" y="4" width="8" height="8" stroke="currentColor" stroke-width="1.5" fill="none"/>';
        dom.btnMaximize.title = '还原';
      } else {
        dom.maximizeIcon.innerHTML = '<rect x="1" y="1" width="10" height="10" stroke="currentColor" stroke-width="1.5" fill="none"/>';
        dom.btnMaximize.title = '最大化';
      }
    });
    state.unsubscribers.push(unsub3);

    // 模态浮层打开时显示网页快照，避免 BrowserView 被移除后白屏
    if (api.onModalSnapshot) {
      const unsubSnapshot = api.onModalSnapshot((data) => {
        const hasSnapshot = Boolean(data && data.dataUrl);

        const finishSnapshot = () => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              if (api.notifyModalSnapshotReady) {
                api.notifyModalSnapshotReady();
              }
              if (state.modalSnapshotResolver) {
                const resolve = state.modalSnapshotResolver;
                state.modalSnapshotResolver = null;
                resolve(data);
              }
            });
          });
        };

        if (!hasSnapshot) {
          dom.contentSnapshot.style.backgroundImage = '';
          dom.contentSnapshot.classList.remove('content-snapshot--visible');
          finishSnapshot();
          return;
        }

        const image = new Image();
        image.onload = () => {
          dom.contentSnapshot.style.backgroundImage = `url("${data.dataUrl}")`;
          dom.contentSnapshot.classList.add('content-snapshot--visible');
          finishSnapshot();
        };
        image.onerror = () => {
          dom.contentSnapshot.style.backgroundImage = '';
          dom.contentSnapshot.classList.remove('content-snapshot--visible');
          finishSnapshot();
        };
        image.src = data.dataUrl;
      });
      state.unsubscribers.push(unsubSnapshot);
    }

    // 加载进度
    const unsub4 = api.onLoadingProgress((data) => {
      if (data.tabId === state.activeTabId) {
        updateLoadingBar(data.progress);
      }
    });
    state.unsubscribers.push(unsub4);

    // 下载更新
    const unsub5 = api.onDownloadsUpdated((data) => {
      const isNew = !state.downloads.some((item) => item.id === data.id);
      const index = state.downloads.findIndex((item) => item.id === data.id);
      if (index !== -1) {
        state.downloads[index] = { ...state.downloads[index], ...data };
      } else {
        state.downloads.unshift(data);
      }
      renderDownloadPanel();

      if (isNew && data.state === 'in_progress' && !state.downloadPanelOpen) {
        openDownloadPanel();
      }
    });
    state.unsubscribers.push(unsub5);

    // 书签文件夹弹出菜单
    const unsubFolderMenu = api.onBookmarkFolderMenuOpen(handleBookmarkFolderMenuOpen);
    state.unsubscribers.push(unsubFolderMenu);
  }

  // ==================== 菜单事件处理 ====================
  function handleMenuEvent(data) {
    switch (data.action) {
      case 'addBookmark':
        showBookmarkDialog(
          state.isBookmarked,
          state.isBookmarked ? findBookmarkByUrl(state.bookmarks, state.currentUrl) : null
        );
        break;
      case 'editBookmark':
        showBookmarkDialog(true, data.bookmark);
        break;
      case 'addBookmarkToFolder':
        if (dom.bookmarkFolderPopup.style.display === 'block') closeBookmarkFolderPopup();
        showBookmarkDialog(false, null, data.folderId || 'bookmark_bar');
        break;
      case 'createBookmarkFolder':
        if (dom.bookmarkFolderPopup.style.display === 'block') closeBookmarkFolderPopup();
        createBookmarkFolder(data.parentId || 'bookmark_bar');
        break;
      case 'editBookmarkFolder':
        if (dom.bookmarkFolderPopup.style.display === 'block') closeBookmarkFolderPopup();
        editBookmarkFolder(data.folder);
        break;
      case 'deleteBookmarkFolder':
        if (dom.bookmarkFolderPopup.style.display === 'block') closeBookmarkFolderPopup();
        deleteBookmarkFolder(data.folderId);
        break;
      case 'deleteBookmark':
        api.removeBookmark(data.bookmarkId).then(async () => {
          await refreshBookmarks();
          await updateBookmarkState();
        });
        break;
      case 'toggleDownloadsPanel':
        if (state.downloadPanelOpen) {
          closeDownloadPanel();
        } else {
          openDownloadPanel();
        }
        break;
      case 'toggleHistoryPanel':
        if (state.historyPanelOpen) {
          closeHistoryPanel();
        } else {
          openHistoryPanel();
        }
        break;
      case 'clearBrowsingData':
        // TODO: 显示清除浏览数据对话框
        api.clearHistory();
        break;
      case 'importBookmarks':
        api.importBookmarks();
        break;
      case 'exportBookmarks':
        api.exportBookmarks();
        break;
    }
  }

  // ==================== 启动 ====================
  document.addEventListener('DOMContentLoaded', init);

  // 清理函数
  window.addEventListener('beforeunload', () => {
    state.unsubscribers.forEach(fn => { if (typeof fn === 'function') fn(); });
  });

})();
