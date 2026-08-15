/**
 * IPC 监听器（渲染层绑定主进程事件）
 * 由 app.js 调用 window.NeutronIpcListeners(ctx) 创建，ctx 注入共享依赖。
 * 返回公共方法：bindIPCListeners
 */
window.NeutronIpcListeners = function (ctx) {
  'use strict';

  const {
    state, dom, api, IS_OVERLAY,
    renderTabs, syncCurrentFaviconToBookmark,
    updateAddressBar, updateNavButtons, updateLoadingBar, updateBookmarkState,
    applyWindowMaximizedClass, applyVerticalTabsLayout, applySidebarLayout,
    updateDownloadRow, renderDownloadPanel, updateDownloadButton, openDownloadPanel,
    handleBookmarkFolderMenuOpen, refreshBookmarks,
  } = ctx;

  function bindIPCListeners() {
    // 标签页列表更新
    const unsub1 = api.onTabListUpdated((data) => {
      state.tabs = data.tabs || [];
      state.activeTabId = data.activeTabId;
      state.tabGroups = data.tabGroups || [];
      if (typeof data.verticalTabs === 'boolean' && data.verticalTabs !== state.verticalTabs) {
        applyVerticalTabsLayout(data.verticalTabs);
      }
      if ((data.splitTabId || null) !== state.splitTabId) {
        state.splitTabId = data.splitTabId || null;
        if (dom.btnSplit) {
          dom.btnSplit.classList.toggle('tool-btn--active', !!state.splitTabId);
          dom.btnSplit.setAttribute('aria-pressed', String(!!state.splitTabId));
        }
      }
      if (typeof data.sidebarOpen === 'boolean' && data.sidebarOpen !== state.sidebarOpen) {
        applySidebarLayout(data.sidebarOpen);
      }
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
        state.currentFavicon = data.favicon || '';
        // 当前页有真实图标时，自动回写同名书签（修复历史遗留空图标）
        syncCurrentFaviconToBookmark();
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
      applyWindowMaximizedClass(data.maximized);
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
      // 已渲染的行做增量更新（实时进度，避免全量重建导致进度条从 0 重新动画）
      if (!updateDownloadRow(data)) {
        renderDownloadPanel();
      }
      updateDownloadButton();

      if (!IS_OVERLAY && isNew && data.state === 'in_progress' && !state.downloadPanelOpen) {
        openDownloadPanel();
      }
    });
    state.unsubscribers.push(unsub5);

    // 书签文件夹弹出菜单
    const unsubFolderMenu = api.onBookmarkFolderMenuOpen(handleBookmarkFolderMenuOpen);
    state.unsubscribers.push(unsubFolderMenu);

    // 书签已变更（叠加层移动书签后）→ 刷新书签栏
    if (api.onBookmarksRefresh) {
      const unsubBookmarksRefresh = api.onBookmarksRefresh(() => {
        refreshBookmarks();
      });
      state.unsubscribers.push(unsubBookmarksRefresh);
    }
  }

  return { bindIPCListeners };
};
