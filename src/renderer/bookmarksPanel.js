/**
 * 收藏夹悬浮面板
 * 由 app.js 调用 window.NeutronBookmarksPanel(ctx) 创建，ctx 注入共享依赖。
 * 返回公共方法：bindBookmarksPanel / openBookmarksPanel / closeBookmarksPanel /
 *              positionBookmarksPanel / refreshBookmarksPanel / renderBookmarksPanel
 */
window.NeutronBookmarksPanel = function (ctx) {
  'use strict';

  const {
    state, dom, api, IS_OVERLAY,
    closeContextMenu, closeDownloadPanel, closeHistoryPanel,
    closeExtensionPopup, closeBookmarkFolderPopup,
    getPanelAnchorRect, refreshBookmarks, showToast,
    findBookmarkByUrl, getDisplayTitleForUrl, getTrustedFavicon,
    escapeHtmlAttr, mountBookmarkIcon,
  } = ctx;

  function bindBookmarksPanel() {
    document.addEventListener('mousedown', (e) => {
      if (!state.bookmarksPanelOpen || dom.bookmarksPanel.hidden) return;
      if (state.bookmarksPanelPinned) return;
      if (dom.bookmarksPanel.contains(e.target) || dom.btnBookmarks.contains(e.target)) return;
      closeBookmarksPanel();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && state.bookmarksPanelOpen) closeBookmarksPanel();
    });

    document.getElementById('btnBookmarkAdd').addEventListener('click', (e) => {
      e.stopPropagation();
      // 覆盖层内对话框无法独立显示，转发给主窗口（主窗口持有当前页面状态）
      if (api.requestMenuEvent) api.requestMenuEvent('addBookmark');
      closeBookmarksPanel();
    });

    document.getElementById('btnBookmarkNewFolder').addEventListener('click', (e) => {
      e.stopPropagation();
      if (api.requestMenuEvent) api.requestMenuEvent('createBookmarkFolder', { parentId: 'bookmark_bar' });
      closeBookmarksPanel();
    });

    document.getElementById('btnBookmarksSearch').addEventListener('click', (e) => {
      e.stopPropagation();
      dom.bookmarksSearchWrap.hidden = !dom.bookmarksSearchWrap.hidden;
      if (!dom.bookmarksSearchWrap.hidden) dom.bookmarksSearch.focus();
    });

    dom.bookmarksSearch.addEventListener('input', () => {
      state.bookmarksSearchQuery = dom.bookmarksSearch.value.trim().toLowerCase();
      renderBookmarksPanel();
    });

    document.getElementById('btnBookmarksMore').addEventListener('click', (e) => {
      e.stopPropagation();
      const willOpen = dom.bookmarksMoreMenu.hidden;
      dom.bookmarksMoreMenu.hidden = !willOpen;
      if (willOpen) updateBookmarkBarSubmenu();
    });

    document.addEventListener('click', (e) => {
      if (!dom.bookmarksMoreMenu.hidden && !e.target.closest('.bookmarks-panel__more-wrap')) {
        dom.bookmarksMoreMenu.hidden = true;
      }
    });

    // 打开收藏夹页面（书签管理器）
    document.getElementById('btnBookmarksOpenPage').addEventListener('click', (e) => {
      e.stopPropagation();
      dom.bookmarksMoreMenu.hidden = true;
      closeBookmarksPanel();
      api.createTab('neutron://bookmarks');
    });

    // 将此页添加到收藏夹
    document.getElementById('btnBookmarksAddCurrent').addEventListener('click', (e) => {
      e.stopPropagation();
      dom.bookmarksMoreMenu.hidden = true;
      if (api.requestMenuEvent) api.requestMenuEvent('addBookmark');
      closeBookmarksPanel();
    });

    // 将打开的页面添加到收藏夹
    document.getElementById('btnBookmarksAddOpen').addEventListener('click', async (e) => {
      e.stopPropagation();
      dom.bookmarksMoreMenu.hidden = true;
      await addAllOpenTabsToBookmarks();
    });

    // 添加文件夹
    document.getElementById('btnBookmarksAddFolder').addEventListener('click', (e) => {
      e.stopPropagation();
      dom.bookmarksMoreMenu.hidden = true;
      if (api.requestMenuEvent) api.requestMenuEvent('createBookmarkFolder', { parentId: 'bookmark_bar' });
      closeBookmarksPanel();
    });

    // 导入收藏夹
    document.getElementById('btnBookmarksImport').addEventListener('click', async (e) => {
      e.stopPropagation();
      dom.bookmarksMoreMenu.hidden = true;
      try {
        const res = await api.importBookmarks();
        if (res && res.success) {
          await refreshBookmarks();
          showToast(res.message || '导入成功', 'success');
        } else {
          showToast((res && res.message) || '导入失败', 'error');
        }
      } catch (err) {
        showToast('导入失败: ' + ((err && err.message) || err), 'error');
      }
    });

    // 导出收藏夹
    document.getElementById('btnBookmarksExport').addEventListener('click', async (e) => {
      e.stopPropagation();
      dom.bookmarksMoreMenu.hidden = true;
      try {
        const res = await api.exportBookmarks();
        if (res && res.success) {
          showToast(res.message || '导出成功', 'success');
        } else {
          showToast((res && res.message) || '导出失败', 'error');
        }
      } catch (err) {
        showToast('导出失败: ' + ((err && err.message) || err), 'error');
      }
    });

    // 删除重复的收藏夹
    document.getElementById('btnBookmarksRemoveDuplicates').addEventListener('click', async (e) => {
      e.stopPropagation();
      dom.bookmarksMoreMenu.hidden = true;
      try {
        const res = await api.removeDuplicateBookmarks();
        if (res && res.success) {
          await refreshBookmarks();
          showToast(
            res.removed > 0 ? `已删除 ${res.removed} 个重复的收藏夹` : '没有找到重复的收藏夹',
            res.removed > 0 ? 'success' : ''
          );
        } else {
          showToast((res && res.message) || '操作失败', 'error');
        }
      } catch (err) {
        showToast('操作失败: ' + ((err && err.message) || err), 'error');
      }
    });

    // 显示收藏夹栏（子菜单）
    document.querySelectorAll('#bookmarksBarSubmenu [data-bookmark-bar]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const show = btn.dataset.bookmarkBar === 'true';
        api.setSetting('showBookmarkBar', show);
        dom.bookmarkBar.classList.toggle('bookmark-bar--hidden', !show);
        dom.bookmarksMoreMenu.hidden = true;
        updateBookmarkBarSubmenu();
        showToast(show ? '收藏夹栏已显示' : '收藏夹栏已隐藏', 'success');
      });
    });

    // 在工具栏中隐藏收藏夹按钮
    document.getElementById('btnBookmarksHideButton').addEventListener('click', (e) => {
      e.stopPropagation();
      api.setSetting('showBookmarksButton', false);
      dom.btnBookmarks.style.display = 'none';
      dom.bookmarksMoreMenu.hidden = true;
      showToast('收藏夹按钮已从工具栏隐藏', 'success');
    });

    document.getElementById('btnBookmarksPin').addEventListener('click', (e) => {
      e.stopPropagation();
      state.bookmarksPanelPinned = !state.bookmarksPanelPinned;
      const btn = document.getElementById('btnBookmarksPin');
      btn.classList.toggle('bookmarks-panel__tool--active', state.bookmarksPanelPinned);
      btn.title = state.bookmarksPanelPinned ? '取消固定面板' : '固定面板';
    });

    window.addEventListener('resize', () => {
      if (state.bookmarksPanelOpen) positionBookmarksPanel();
    });
  }

  async function openBookmarksPanel() {
    if (state.bookmarksPanelOpen) return;

    if (IS_OVERLAY) {
      // 覆盖层内：直接在当前覆盖层中显示面板
      state.bookmarksPanelOpen = true;
      dom.bookmarksPanel.hidden = false;
      dom.bookmarksPanel.style.visibility = 'hidden';
      await refreshBookmarksPanel();
      if (!state.bookmarksPanelOpen) return;
      positionBookmarksPanel();
      dom.bookmarksPanel.style.visibility = 'visible';
      requestAnimationFrame(positionBookmarksPanel);
      return;
    }

    // 主窗口：面板显示到透明覆盖层（叠加在实时页面上，页面不缩放、不暂停）
    if (state.contextMenuOpen) closeContextMenu();
    if (state.downloadPanelOpen) closeDownloadPanel();
    if (state.historyPanelOpen) closeHistoryPanel();
    if (state.extensionPopupOpen) closeExtensionPopup();
    if (dom.bookmarkFolderPopup.style.display === 'block') closeBookmarkFolderPopup();
    const r = dom.btnBookmarks.getBoundingClientRect();
    state.bookmarksPanelOpen = true;
    dom.btnBookmarks.classList.add('tool-btn--active');
    dom.btnBookmarks.setAttribute('aria-expanded', 'true');
    api.showPanelOverlay({
      type: 'bookmarks',
      anchor: { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height },
    });
  }

  function closeBookmarksPanel() {
    if (!state.bookmarksPanelOpen) return;
    state.bookmarksPanelToken++;
    state.bookmarksPanelOpen = false;
    dom.bookmarksPanel.hidden = true;
    dom.bookmarksPanel.style.visibility = '';
    dom.bookmarksMoreMenu.hidden = true;
    dom.btnBookmarks.classList.remove('tool-btn--active');
    dom.btnBookmarks.setAttribute('aria-expanded', 'false');
    api.hidePanelOverlay();
  }

  function positionBookmarksPanel() {
    if (IS_OVERLAY) {
      dom.bookmarksPanel.style.left = '0';
      dom.bookmarksPanel.style.top = '0';
      return;
    }
    const rect = getPanelAnchorRect(dom.btnBookmarks);
    const width = dom.bookmarksPanel.offsetWidth || 400;
    const height = dom.bookmarksPanel.offsetHeight || 520;
    let left = rect.right - width;
    let top = rect.bottom + 8;

    if (left < 8) left = 8;
    if (left + width > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - width - 8);
    }
    if (top + height > window.innerHeight - 8) {
      top = Math.max(8, rect.top - height - 8);
    }

    dom.bookmarksPanel.style.left = `${left}px`;
    dom.bookmarksPanel.style.top = `${top}px`;
  }

  async function refreshBookmarksPanel() {
    state.bookmarks = await api.getBookmarks();
    renderBookmarksPanel();
  }

  /** 更新"显示收藏夹栏"子菜单的选中状态 */
  async function updateBookmarkBarSubmenu() {
    let show = true;
    try {
      show = (await api.getSetting('showBookmarkBar')) !== false;
    } catch (e) { /* 忽略 */ }
    const submenu = document.getElementById('bookmarksBarSubmenu');
    if (!submenu) return;
    submenu.querySelectorAll('[data-bookmark-bar]').forEach((btn) => {
      const val = btn.dataset.bookmarkBar === 'true';
      btn.classList.toggle('bookmarks-menu__item--checked', val === show);
    });
  }

  /** 将所有打开的标签页加入收藏夹（跳过已收藏的） */
  async function addAllOpenTabsToBookmarks() {
    let urls = [];
    try {
      urls = (await api.getCurrentTabs()) || [];
    } catch (e) { urls = []; }
    // 过滤掉内部页面与已收藏的
    const toAdd = urls.filter((tab) => {
      if (!tab || !tab.url || tab.url.startsWith('neutron://')) return false;
      return !findBookmarkByUrl(state.bookmarks, tab.url);
    });

    if (toAdd.length === 0) {
      showToast('所有打开的页面已在收藏夹中', 'success');
      return;
    }

    let added = 0;
    for (const tab of toAdd) {
      const url = tab.url;
      const title = getDisplayTitleForUrl(tab.title || '', url);
      const favicon = getTrustedFavicon(tab.favicon || '', url);
      await api.addBookmark({ title, url, parentId: 'bookmark_bar', favicon });
      added++;
    }
    await refreshBookmarks();
    showToast(`已将 ${added} 个打开的页面添加到收藏夹`, 'success');
  }

  /** 渲染收藏夹面板内容（分区 + 文件夹树 + 书签列表） */
  function renderBookmarksPanel() {
    const list = dom.bookmarksList;
    list.innerHTML = '';

    const query = state.bookmarksSearchQuery;

    // 根分区：书签栏 → 其他书签 → 移动设备书签
    const rootNames = {
      bookmark_bar: '收藏夹栏',
      other: '其他书签',
      mobile: '移动设备书签',
    };
    const roots = [];
    for (const key of ['bookmark_bar', 'other', 'mobile']) {
      const folder = state.bookmarks[key];
      if (!folder || folder.type !== 'folder') continue;
      const items = folder.children || [];
      if (query) {
        // 搜索模式：只保留有匹配内容的分区
        const matches = [];
        collectBookmarkMatches(items, query, matches);
        if (matches.length === 0) continue;
        roots.push({ key, folder, items, matches });
      } else {
        if (items.length === 0) continue; // 无内容分区在非搜索模式隐藏
        roots.push({ key, folder, items });
      }
    }

    if (roots.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'bookmarks-empty';
      const icon = document.createElement('div');
      icon.className = 'bookmarks-empty__icon';
      icon.textContent = query ? '🔍' : '⭐';
      empty.appendChild(icon);
      const text = document.createElement('div');
      text.textContent = query ? '没有匹配的收藏夹' : '还没有收藏夹';
      empty.appendChild(text);
      list.appendChild(empty);
      return;
    }

    roots.forEach(({ key, folder, items, matches }) => {
      const section = document.createElement('div');
      section.className = 'bookmarks-section';

      // 分区头（可折叠）
      const header = document.createElement('div');
      header.className = 'bookmarks-section__header';
      header.innerHTML = `
        <svg class="bookmarks-section__caret" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        <span class="bookmarks-section__icon">☆</span>
        <span class="bookmarks-section__title">${escapeHtmlAttr(rootNames[key] || folder.title || '收藏夹')}</span>
        <span class="bookmarks-section__count">${items.length}</span>
      `;
      const sectionExpanded = state.bookmarksPanelExpanded[key] !== false;
      header.classList.toggle('collapsed', !sectionExpanded);
      header.addEventListener('click', () => {
        state.bookmarksPanelExpanded[key] = state.bookmarksPanelExpanded[key] === false ? true : false;
        renderBookmarksPanel();
      });
      section.appendChild(header);

      // 分区内容
      const body = document.createElement('div');
      body.className = 'bookmarks-section__body';
      body.style.display = sectionExpanded ? '' : 'none';
      section.appendChild(body);

      if (query) {
        // 搜索模式：展示预计算的全部匹配项（文件夹 + 书签，扁平层级）
        (matches || []).forEach((m) => {
          body.appendChild(buildBookmarkPanelRow(m.item, m.depth, true));
        });
      } else {
        if (items.length === 0) {
          const emptyEl = document.createElement('div');
          emptyEl.className = 'bookmarks-empty';
          emptyEl.textContent = '空';
          body.appendChild(emptyEl);
        } else {
          items.forEach((item) => {
            body.appendChild(buildBookmarkPanelRow(item, 0, false));
          });
        }
      }

      list.appendChild(section);
    });
  }

  /** 递归收集匹配搜索词的书签/文件夹 */
  function collectBookmarkMatches(items, query, out, depth = 0) {
    for (const item of items || []) {
      const title = String(item.title || '').toLowerCase();
      const url = String(item.url || '').toLowerCase();
      if (title.includes(query) || url.includes(query)) {
        out.push({ item, depth });
      }
      if (item.type === 'folder') {
        collectBookmarkMatches(item.children, query, out, depth + 1);
      }
    }
  }

  /** 构建收藏夹面板单行（文件夹可展开，书签点击导航） */
  function buildBookmarkPanelRow(item, depth, isSearch) {
    const wrapper = document.createElement('div');
    wrapper.className = 'bookmarks-folder-wrap';
    wrapper.dataset.bookmarkId = item.id;

    const row = document.createElement('div');
    row.className = 'bookmarks-row';
    row.dataset.bookmarkId = item.id;
    row.style.paddingLeft = `${12 + depth * 16}px`;

    if (item.type === 'folder') {
      row.classList.add('bookmarks-row--folder');
      const expanded = state.bookmarksPanelExpanded[item.id] !== false;
      const hasChildren = !!(item.children && item.children.length > 0);
      row.classList.toggle('collapsed', !expanded);
      row.innerHTML = `
        <svg class="bookmarks-row__caret" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        <span class="bookmarks-row__icon bookmarks-row__icon--folder"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg></span>
        <span class="bookmarks-row__title">${escapeHtmlAttr(item.title || '未命名文件夹')}</span>
        <span class="bookmarks-row__count">${hasChildren ? item.children.length : ''}</span>
      `;
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        // 搜索模式下仅展示层级，点击仍可展开
        state.bookmarksPanelExpanded[item.id] = !expanded;
        renderBookmarksPanel();
      });
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        api.showBookmarkFolderContextMenu({
          x: e.clientX,
          y: e.clientY,
          folder: item,
        });
      });
      wrapper.appendChild(row);

      // 非搜索模式且展开时渲染子项
      if (!isSearch && hasChildren && expanded) {
        const childrenWrap = document.createElement('div');
        childrenWrap.className = 'bookmarks-children';
        (item.children || []).forEach((child) => {
          childrenWrap.appendChild(buildBookmarkPanelRow(child, depth + 1, false));
        });
        wrapper.appendChild(childrenWrap);
      }
      return wrapper;
    }

    // 书签
    row.classList.add('bookmarks-row--bookmark');
    row.title = item.url || '';
    const iconWrap = document.createElement('span');
    iconWrap.className = 'bookmarks-row__icon';
    mountBookmarkIcon(iconWrap, item);
    const titleSpan = document.createElement('span');
    titleSpan.className = 'bookmarks-row__title';
    titleSpan.textContent = item.title || '未命名书签';
    row.appendChild(iconWrap);
    row.appendChild(titleSpan);
    row.addEventListener('click', (e) => {
      e.stopPropagation();
      api.navigateTo(item.url);
      closeBookmarksPanel();
    });
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
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
    wrapper.appendChild(row);
    return wrapper;
  }

  return {
    bindBookmarksPanel,
    openBookmarksPanel,
    closeBookmarksPanel,
    positionBookmarksPanel,
    refreshBookmarksPanel,
    renderBookmarksPanel,
  };
};
