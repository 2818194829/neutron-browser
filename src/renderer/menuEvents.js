/**
 * 菜单事件处理（覆盖层请求主窗口执行的动作）
 * 由 app.js 调用 window.NeutronMenuEvents(ctx) 创建，ctx 注入共享依赖。
 * 返回公共方法：handleMenuEvent
 */
window.NeutronMenuEvents = function (ctx) {
  'use strict';

  const {
    state, dom, api,
    showBookmarkDialog, findBookmarkByUrl,
    createBookmarkFolder, editBookmarkFolder, deleteBookmarkFolder,
    refreshBookmarks, updateBookmarkState,
    closeDownloadPanel, openDownloadPanel,
    closeHistoryPanel, openHistoryPanel,
    closeBookmarksPanel, openBookmarksPanel,
    closeBookmarkFolderPopup,
  } = ctx;

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
      case 'toggleBookmarksPanel':
        if (state.bookmarksPanelOpen) {
          closeBookmarksPanel();
        } else {
          openBookmarksPanel();
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

  return { handleMenuEvent };
};
