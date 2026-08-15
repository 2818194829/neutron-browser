/**
 * 书签文件夹弹出菜单（二级子菜单）
 * 由 app.js 调用 window.NeutronBookmarkFolderPopup(ctx) 创建，ctx 注入共享依赖：
 *   state / dom / api / closeContextMenu / mountBookmarkIcon / handleBookmarkDragStart / handleBookmarkDragEnd
 * 返回公共方法：closeBookmarkFolderPopup / removeSubFolderPopup / handleBookmarkFolderMenuOpen / showBookmarkFolderPopup
 */
window.NeutronBookmarkFolderPopup = function (ctx) {
  'use strict';

  const {
    state, dom, api,
    closeContextMenu, mountBookmarkIcon,
    handleBookmarkDragStart, handleBookmarkDragEnd,
  } = ctx;

  function closeBookmarkFolderPopup() {
    dom.bookmarkFolderPopup.style.display = 'none';
    state.folderPopupData = null;
    state.bookmarkFolderPopupOpenId = null;
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
    if (state.contextMenuOpen) closeContextMenu();
    // 书签文件夹弹出菜单已改用面板叠加层（showPanelOverlay），
    // 不再调用 setModalVisible，避免视频冻结。
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
        <span class="bfp-item__title">${window.NeutronUtils.escapeHtmlAttr(item.title)}</span>
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
        const icon = document.createElement('span');
        icon.className = 'bfp-item__icon';
        mountBookmarkIcon(icon, item);

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

  return {
    closeBookmarkFolderPopup,
    removeSubFolderPopup,
    handleBookmarkFolderMenuOpen,
    showBookmarkFolderPopup,
  };
};
