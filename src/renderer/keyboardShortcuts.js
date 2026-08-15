/**
 * 键盘快捷键
 * 由 app.js 调用 window.NeutronKeyboardShortcuts(ctx) 创建，ctx 注入共享依赖。
 * 返回公共方法：bindKeyboardShortcuts
 */
window.NeutronKeyboardShortcuts = function (ctx) {
  'use strict';

  const {
    state, dom, api,
    showBookmarkDialog, findBookmarkByUrl,
    closeHistoryPanel, openHistoryPanel,
    closeDownloadPanel, openDownloadPanel,
    closeBookmarksPanel, openBookmarksPanel,
  } = ctx;

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
      // Ctrl+Shift+B: 收藏夹面板
      else if (isCtrl && e.shiftKey && e.key === 'B') {
        e.preventDefault();
        if (state.bookmarksPanelOpen) {
          closeBookmarksPanel();
        } else {
          openBookmarksPanel();
        }
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

  return { bindKeyboardShortcuts };
};
