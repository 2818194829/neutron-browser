/**
 * 历史记录悬浮面板
 * 由 app.js 调用 window.NeutronHistoryPanel(ctx) 创建，ctx 注入共享依赖。
 * 返回公共方法：bindHistoryPanel / loadHistoryPanel / positionHistoryPanel /
 *              openHistoryPanel / closeHistoryPanel / showDownloadContextMenu
 */
window.NeutronHistoryPanel = function (ctx) {
  'use strict';

  const {
    state, dom, api, IS_OVERLAY,
    getTrustedFavicon, getSiteFaviconUrl, getGoogleFaviconUrl, getDisplayTitleForUrl,
    closeContextMenu, openContextMenu, showToast, loadDownloads,
    closeDownloadPanel, closeBookmarksPanel, closeExtensionPopup, closeBookmarkFolderPopup,
    getPanelAnchorRect,
  } = ctx;

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
      closeContextMenu();
      await api.deleteHistoryItem(id);
      await loadHistoryPanel();
    });

    dom.contextMenu.appendChild(item);
    openContextMenu();
    dom.contextMenu.style.left = Math.min(x, window.innerWidth - 220) + 'px';
    dom.contextMenu.style.top = Math.min(y, window.innerHeight - 200) + 'px';
  }

  function showDownloadContextMenu(x, y, item) {
    dom.contextMenu.innerHTML = '';
    const addItem = (label, action, cls = '') => {
      const el = document.createElement('div');
      el.className = 'context-menu__item ' + cls;
      el.textContent = label;
      el.addEventListener('click', () => {
        closeContextMenu();
        action();
      });
      dom.contextMenu.appendChild(el);
    };

    // 已取消/失败：重新开始
    if (item.state === 'cancelled' || item.state === 'failed') {
      addItem('重新开始', async () => {
        await api.retryDownload(item.id);
      });
    }
    // 复制下载链接
    if (item.url) {
      addItem('复制下载链接', async () => {
        await api.copyText(item.url);
      });
    }
    // 打开文件
    if (item.state === 'completed') {
      addItem('打开文件', async () => {
        const res = await api.openDownloadFile(item.id);
        if (res && res.ok === false) {
          showToast(res.fallback ? '打开失败，已定位到所在文件夹' : '文件不存在或已被移动', 'error');
        }
      });
    }
    // 在文件夹中显示
    if (item.state !== 'deleted') {
      addItem('在文件夹中显示', async () => {
        const res = await api.openDownloadFolder(item.id);
        if (res && res.ok === false) {
          showToast('文件不存在或已被移动', 'error');
        }
      });
    }
    // 从列表移除
    addItem('从列表移除', async () => {
      await api.deleteDownload(item.id);
      await loadDownloads();
    }, 'context-menu__item--danger');

    openContextMenu();
    dom.contextMenu.style.left = Math.min(x, window.innerWidth - 220) + 'px';
    dom.contextMenu.style.top = Math.min(y, window.innerHeight - 240) + 'px';
  }

  async function openHistoryPanel() {
    if (state.historyPanelOpen) return;

    if (IS_OVERLAY) {
      // 覆盖层内：直接在当前覆盖层中显示面板
      state.historyPanelOpen = true;
      dom.historyPanel.hidden = false;
      dom.historyPanel.style.visibility = 'hidden';
      await loadHistoryPanel();
      if (!state.historyPanelOpen) return;
      positionHistoryPanel();
      dom.historyPanel.style.visibility = 'visible';
      requestAnimationFrame(positionHistoryPanel);
      return;
    }

    // 主窗口：面板显示到透明覆盖层（叠加在实时页面上，页面不缩放、不暂停）
    if (state.contextMenuOpen) closeContextMenu();
    if (state.downloadPanelOpen) closeDownloadPanel();
    if (state.bookmarksPanelOpen) closeBookmarksPanel();
    if (state.extensionPopupOpen) closeExtensionPopup();
    if (dom.bookmarkFolderPopup.style.display === 'block') closeBookmarkFolderPopup();
    const r = dom.btnHistory.getBoundingClientRect();
    state.historyPanelOpen = true;
    api.showPanelOverlay({
      type: 'history',
      anchor: { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height },
    });
  }

  function closeHistoryPanel() {
    if (!state.historyPanelOpen) return;
    state.historyPanelToken++;
    state.historyPanelOpen = false;
    dom.historyPanel.hidden = true;
    dom.historyPanel.style.visibility = '';
    dom.historyMoreMenu.hidden = true;
    api.hidePanelOverlay();
  }

  function positionHistoryPanel() {
    if (IS_OVERLAY) {
      dom.historyPanel.style.left = '0';
      dom.historyPanel.style.top = '0';
      return;
    }
    const rect = getPanelAnchorRect(dom.btnHistory);
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

  return {
    bindHistoryPanel,
    loadHistoryPanel,
    positionHistoryPanel,
    openHistoryPanel,
    closeHistoryPanel,
    showDownloadContextMenu,
  };
};
