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
    btnHistory: $('#btnHistory'),
    btnExtensions: $('#btnExtensions'),
    btnSettings: $('#btnSettings'),
    bookmarkBar: $('#bookmarkBar'),
    bookmarkBarItems: $('#bookmarkBarItems'),
    contentArea: $('#contentArea'),
    contentPlaceholder: $('#contentPlaceholder'),
    statusBar: $('#statusBar'),
    statusUrl: $('#statusUrl'),
    statusZoom: $('#statusZoom'),
    contextMenu: $('#contextMenu'),
    bookmarkDialog: $('#bookmarkDialog'),
    bookmarkDialogTitle: $('#bookmarkDialogTitle'),
    bookmarkName: $('#bookmarkName'),
    bookmarkUrl: $('#bookmarkUrl'),
    bookmarkFolder: $('#bookmarkFolder'),
    bookmarkDialogClose: $('#bookmarkDialogClose'),
    bookmarkDialogCancel: $('#bookmarkDialogCancel'),
    bookmarkDialogSave: $('#bookmarkDialogSave'),
    bookmarkDialogRemove: $('#bookmarkDialogRemove'),
  };

  // ==================== 状态 ====================
  const state = {
    tabs: [],
    activeTabId: null,
    isMaximized: false,
    currentUrl: '',
    currentTitle: '',
    canGoBack: false,
    canGoForward: false,
    isLoading: false,
    isBookmarked: false,
    bookmarks: {},
    theme: 'system',
    unsubscribers: [],
  };

  // ==================== API 快捷方式 ====================
  const api = window.NeutronBrowser;
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

    // 绑定事件
    bindWindowControls();
    bindNavigationButtons();
    bindAddressBar();
    bindTabEvents();
    bindBookmarkEvents();
    bindContextMenu();
    bindBookmarkDialog();
    bindToolButtons();
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
    if (input === 'neutron://settings' || input === 'neutron://history' ||
        input === 'neutron://bookmarks' || input === 'neutron://downloads' ||
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
        showBookmarkDialog(true);
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

  async function showBookmarkDialog(isEditing) {
    api.setModalVisible(true);
    dom.bookmarkDialog.style.display = 'flex';
    if (isEditing) {
      dom.bookmarkDialogTitle.textContent = '编辑书签';
      dom.bookmarkDialogRemove.style.display = 'inline-block';
    } else {
      dom.bookmarkDialogTitle.textContent = '添加书签';
      dom.bookmarkDialogRemove.style.display = 'none';
    }
    dom.bookmarkName.value = state.currentTitle || '';
    dom.bookmarkUrl.value = state.currentUrl || '';
    dom.bookmarkName.focus();
    dom.bookmarkName.select();
  }

  function closeBookmarkDialog() {
    dom.bookmarkDialog.style.display = 'none';
    api.setModalVisible(false);
  }

  async function saveBookmark() {
    const activeTab = state.tabs.find(tab => tab.id === state.activeTabId);
    const bookmark = {
      title: dom.bookmarkName.value || '未命名书签',
      url: dom.bookmarkUrl.value || state.currentUrl,
      parentId: dom.bookmarkFolder.value,
      favicon: activeTab && activeTab.favicon ? activeTab.favicon : '',
    };

    if (!bookmark.url) {
      alert('请输入有效的网址');
      return;
    }

    await api.addBookmark(bookmark);
    state.bookmarks = await api.getBookmarks();
    await updateBookmarkState();
    renderBookmarkBar();
    closeBookmarkDialog();
  }

  async function removeBookmark() {
    // 查找并移除当前 URL 的书签
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

    state.bookmarks = await api.getBookmarks();
    await updateBookmarkState();
    renderBookmarkBar();
    closeBookmarkDialog();
  }

  function renderBookmarkBar() {
    dom.bookmarkBarItems.innerHTML = '';

    const bookmarkBar = state.bookmarks.bookmark_bar;
    if (!bookmarkBar || !bookmarkBar.children) return;

    bookmarkBar.children.forEach((item) => {
      if (item.type !== 'bookmark') return;

      const el = document.createElement('div');
      el.className = 'bookmark-item';
      el.title = item.title;

      const siteFavicon = item.favicon || getSiteFaviconUrl(item.url);
      const googleFavicon = getGoogleFaviconUrl(item.url);
      let icon;

      if (siteFavicon || googleFavicon) {
        icon = document.createElement('img');
        icon.className = 'bookmark-item__icon';
        icon.alt = '';
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

      const title = document.createElement('span');
      title.className = 'bookmark-item__title';
      title.textContent = item.title;

      el.appendChild(icon);
      el.appendChild(title);
      el.addEventListener('click', () => {
        api.navigateTo(item.url);
      });
      dom.bookmarkBarItems.appendChild(el);
    });
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

  // ==================== 工具按钮 ====================
  function bindToolButtons() {
    dom.btnDownloads.addEventListener('click', () => {
      api.createTab('neutron://downloads');
    });
    dom.btnHistory.addEventListener('click', () => {
      api.createTab('neutron://history');
    });
    dom.btnExtensions.addEventListener('click', () => {
      api.createTab('neutron://extensions');
    });
    dom.btnSettings.addEventListener('click', () => {
      api.createTab('neutron://settings');
    });
  }

  // ==================== 右键菜单 ====================
  function bindContextMenu() {
    document.addEventListener('click', () => {
      dom.contextMenu.style.display = 'none';
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
        showBookmarkDialog(state.isBookmarked);
      }
      // Ctrl+H: 历史记录
      else if (isCtrl && e.key === 'h') {
        e.preventDefault();
        api.createTab('neutron://history');
      }
      // Ctrl+J: 下载内容
      else if (isCtrl && e.key === 'j') {
        e.preventDefault();
        api.createTab('neutron://downloads');
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
        state.canGoBack = data.canGoBack || false;
        state.canGoForward = data.canGoForward || false;
        state.isLoading = data.isLoading || false;

        updateAddressBar();
        updateNavButtons();
        updateLoadingBar(data.loadingProgress);
        updateBookmarkState();

        // 更新状态栏
        dom.statusUrl.textContent = state.currentUrl || '';

        // 添加历史记录
        if (data.url && !data.url.startsWith('neutron://') && !data.isLoading) {
          api.addHistory({ url: data.url, title: data.title });
        }
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

    // 加载进度
    const unsub4 = api.onLoadingProgress((data) => {
      if (data.tabId === state.activeTabId) {
        updateLoadingBar(data.progress);
      }
    });
    state.unsubscribers.push(unsub4);

    // 下载更新
    const unsub5 = api.onDownloadsUpdated((data) => {
      // 可以在此更新下载计数徽标
      console.log('[Renderer] 下载更新:', data.filename, data.state);
    });
    state.unsubscribers.push(unsub5);
  }

  // ==================== 菜单事件处理 ====================
  function handleMenuEvent(data) {
    switch (data.action) {
      case 'addBookmark':
        showBookmarkDialog(state.isBookmarked);
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
