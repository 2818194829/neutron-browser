/**
 * 下载悬浮面板
 * 由 app.js 调用 window.NeutronDownloadPanel(ctx) 创建，ctx 注入共享依赖。
 * 返回公共方法：loadDownloads / bindDownloadPanel / positionDownloadPanel /
 *              openDownloadPanel / closeDownloadPanel / updateDownloadRow /
 *              renderDownloadPanel / updateDownloadButton
 */
window.NeutronDownloadPanel = function (ctx) {
  'use strict';

  const {
    state, dom, api, IS_OVERLAY,
    showToast, showDownloadContextMenu,
    closeContextMenu, closeHistoryPanel, closeBookmarksPanel,
    closeExtensionPopup, closeBookmarkFolderPopup, getPanelAnchorRect,
  } = ctx;

  const formatBytes = (bytes) => window.NeutronUtils.formatBytes(bytes);
  const formatSpeed = (bps) => window.NeutronUtils.formatSpeed(bps);
  const getFileIcon = (filename) => window.NeutronFileIcons.getFileIcon(filename);

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

    document.getElementById('btnDownloadShowAll').addEventListener('click', async (e) => {
      e.stopPropagation();
      closeDownloadPanel();
      api.createTab('neutron://downloads');
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
    updateDownloadButton();
  }

  // 更新工具栏下载按钮：进行中显示环形进度，完成显示徽章
  function updateDownloadButton() {
    const active = state.downloads.filter((i) => i.state === 'in_progress');
    const completed = state.downloads.filter((i) => i.state === 'completed');
    if (!dom.downloadRing || !dom.downloadBadge) return;

    if (active.length > 0) {
      const total = active.reduce((s, i) => s + (i.totalBytes || 0), 0);
      const received = active.reduce((s, i) => s + (i.receivedBytes || 0), 0);
      const pct = total > 0 ? Math.min(100, Math.round((received / total) * 100)) : 0;
      const circumference = 62.8; // 2πr, r=10
      dom.downloadRing.hidden = false;
      dom.downloadRingFill.style.strokeDashoffset = String(circumference * (1 - pct / 100));
      dom.btnDownloads.classList.add('tool-btn--downloading');
      dom.downloadBadge.hidden = true;
    } else {
      dom.downloadRing.hidden = true;
      dom.btnDownloads.classList.remove('tool-btn--downloading');
      if (completed.length > 0) {
        dom.downloadBadge.hidden = false;
        dom.downloadBadge.textContent = completed.length > 99 ? '99+' : String(completed.length);
      } else {
        dom.downloadBadge.hidden = true;
      }
    }
  }

  // 构造下载项操作按钮
  function makeDownloadAction(title, kind, handler) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `download-item__action download-item__action--${kind}`;
    btn.title = title;
    btn.setAttribute('aria-label', title);
    const icons = {
      pause: '<path d="M6 4h4v16H6z"/><path d="M14 4h4v16h-4z"/>',
      play: '<polygon points="6 4 20 12 6 20 6 4"/>',
      cancel: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
      folder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
      link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
      restart: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
      trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>',
    };
    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icons[kind] || ''}</svg>`;
    btn.addEventListener('click', handler);
    return btn;
  }

  // 下载状态文字（辅助信息行，中性色）
  function getDownloadStateText(item) {
    switch (item.state) {
      case 'paused': return '已暂停';
      case 'failed': return '下载失败';
      case 'cancelled': return '已取消';
      case 'deleted': return '已删除';
      default: return '';
    }
  }

  function getDownloadProgressInfo(item, percent) {
    const parts = [`${percent}%`];
    if (item.totalBytes > 0) {
      parts.push(`${formatBytes(item.receivedBytes)} / ${formatBytes(item.totalBytes)}`);
    }
    if (item.speed) parts.push(formatSpeed(item.speed));
    return parts.join(' · ');
  }

  // 构建单个下载项行（对标 Chromium 下载气泡：左图标 + 文件名/状态行，纵向紧凑布局）
  function buildDownloadRow(item) {
    // 兜底：数据已 100% 接收（receivedBytes >= totalBytes）但状态仍为 in_progress 时，
    // 一律按「已完成」展示，避免下载完成后残留满格进度条
    const state = (item.state === 'in_progress' && item.totalBytes > 0 &&
                   item.receivedBytes >= item.totalBytes)
      ? 'completed'
      : item.state;

    const row = document.createElement('div');
    row.className = 'download-item';
    row.dataset.id = item.id;
    if (state === 'deleted' || state === 'cancelled') row.classList.add('download-item--inactive');

    // 文件图标：优先显示真实系统图标（资源管理器风格，异步获取），加载期间/文件不存在时用类型 SVG 兜底
    const icon = document.createElement('div');
    const iconInfo = getFileIcon(item.filename);
    icon.className = `download-item__icon dl-icon dl-icon--${iconInfo.type}`;
    icon.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${iconInfo.svg}</svg>`;
    if (api && api.getDownloadFileIcon) {
      api.getDownloadFileIcon(item.id).then((dataUrl) => {
        if (dataUrl && icon.isConnected) {
          icon.innerHTML = '';
          icon.className = 'download-item__icon';
          const img = document.createElement('img');
          img.className = 'download-item__real-icon';
          img.src = dataUrl;
          img.draggable = false;
          icon.appendChild(img);
        }
      }).catch(() => {});
    }

    // 主体：文件名 + 状态/操作行
    const body = document.createElement('div');
    body.className = 'download-item__body';

    const name = document.createElement('div');
    name.className = 'download-item__name';
    name.textContent = item.filename || '未命名文件';
    name.title = item.filename || '';
    body.appendChild(name);

    const statusRow = document.createElement('div');
    statusRow.className = 'download-item__status-row';

    if (state === 'in_progress' || state === 'paused') {
      // 轻量进度：品牌色细进度条 + 百分比/大小/速度
      const progressRow = document.createElement('div');
      progressRow.className = 'download-item__progress-row';
      const barWrap = document.createElement('div');
      barWrap.className = 'download-item__progress';
      const bar = document.createElement('div');
      bar.className = 'download-item__progress-bar';
      if (state === 'paused') bar.classList.add('download-item__progress-bar--paused');
      const percent = item.totalBytes > 0
        ? Math.min(100, Math.round((item.receivedBytes / item.totalBytes) * 100))
        : 0;
      bar.style.width = `${percent}%`;
      barWrap.appendChild(bar);
      const info = document.createElement('span');
      info.className = 'download-item__progress-info';
      info.textContent = getDownloadProgressInfo(item, percent);
      progressRow.appendChild(barWrap);
      progressRow.appendChild(info);
      statusRow.appendChild(progressRow);
    } else if (state === 'completed') {
      // 已完成：绿色状态提示 + 「打开文件」/「在文件夹中显示」
      const doneText = document.createElement('span');
      doneText.className = 'download-item__state-text download-item__state-text--done';
      doneText.textContent = '已完成';
      statusRow.appendChild(doneText);

      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'download-item__open';
      open.textContent = '打开文件';
      open.addEventListener('click', async (e) => {
        e.stopPropagation();
        const res = await api.openDownloadFile(item.id);
        if (res && res.ok === false) {
          showToast(res.fallback ? '打开失败，已定位到所在文件夹' : '文件不存在或已被移动', 'error');
        }
      });
      statusRow.appendChild(open);

      const showFolder = document.createElement('button');
      showFolder.type = 'button';
      showFolder.className = 'download-item__open';
      showFolder.textContent = '在文件夹中显示';
      showFolder.addEventListener('click', async (e) => {
        e.stopPropagation();
        const res = await api.openDownloadFolder(item.id);
        if (res && res.ok === false) {
          showToast('文件不存在或已被移动', 'error');
        }
      });
      statusRow.appendChild(showFolder);
    } else {
      const text = getDownloadStateText(item);
      if (text) {
        const span = document.createElement('span');
        span.className = 'download-item__state-text';
        span.textContent = text;
        statusRow.appendChild(span);
      }
    }
    body.appendChild(statusRow);

    // hover 操作按钮（右）
    const actions = document.createElement('div');
    actions.className = 'download-item__actions';

    if (state === 'in_progress') {
      actions.appendChild(makeDownloadAction('暂停', 'pause', async (e) => {
        e.stopPropagation();
        await api.pauseDownload(item.id);
      }));
    } else if (state === 'paused') {
      actions.appendChild(makeDownloadAction('继续', 'play', async (e) => {
        e.stopPropagation();
        await api.resumeDownload(item.id);
      }));
    }
    if (state === 'in_progress' || state === 'paused') {
      actions.appendChild(makeDownloadAction('取消', 'cancel', async (e) => {
        e.stopPropagation();
        await api.cancelDownload(item.id);
      }));
    }
    // 已取消/失败：可重新开始下载
    if (state === 'cancelled' || state === 'failed') {
      actions.appendChild(makeDownloadAction('重新开始', 'restart', async (e) => {
        e.stopPropagation();
        await api.retryDownload(item.id);
      }));
    }
    // 已完成行的「在文件夹中显示」已在状态行常显，hover 操作不再重复
    if (state !== 'deleted' && state !== 'completed') {
      actions.appendChild(makeDownloadAction('在文件夹中显示', 'folder', async (e) => {
        e.stopPropagation();
        await api.openDownloadFolder(item.id);
      }));
    }
    if (item.url) {
      actions.appendChild(makeDownloadAction('复制下载链接', 'link', async (e) => {
        e.stopPropagation();
        await api.copyText(item.url);
      }));
    }
    actions.appendChild(makeDownloadAction('从列表移除', 'trash', async (e) => {
      e.stopPropagation();
      await api.deleteDownload(item.id);
      await loadDownloads();
    }));

    row.appendChild(icon);
    row.appendChild(body);
    row.appendChild(actions);

    // 右键菜单：重新开始 / 复制下载链接 / 打开文件 / 在文件夹中显示 / 从列表移除
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showDownloadContextMenu(e.clientX, e.clientY, item);
    });

    return row;
  }

  // 增量更新已渲染的下载项（实时进度，避免全量重建导致进度条动画从 0 重置）
  function updateDownloadRow(item) {
    if (dom.downloadPanel.hidden) return false;
    const row = dom.downloadList.querySelector(`.download-item[data-id="${CSS.escape(item.id)}"]`);
    if (!row) return false;

    // 暂停：低频操作，重建整行（「暂停」按钮切换为「继续」+ 进度条暂停样式）
    if (item.state === 'paused') {
      const newRow = buildDownloadRow(item);
      if (newRow) row.replaceWith(newRow);
      return true;
    }

    // 下载中：增量更新进度条 + 信息（避免全量重建导致进度条从 0 重新动画）
    if (item.state === 'in_progress') {
      // 兜底：数据已 100% 接收但状态未切换为 completed，直接重建（buildDownloadRow 会按已完成展示）
      if (item.totalBytes > 0 && item.receivedBytes >= item.totalBytes) {
        const newRow = buildDownloadRow(item);
        if (newRow) row.replaceWith(newRow);
        return true;
      }
      // 若行内仍是「继续」按钮（刚从暂停恢复），先重建切换为「暂停」
      if (row.querySelector('.download-item__action--play')) {
        const newRow = buildDownloadRow(item);
        if (newRow) row.replaceWith(newRow);
        return true;
      }
      const bar = row.querySelector('.download-item__progress-bar');
      const info = row.querySelector('.download-item__progress-info');
      const percent = item.totalBytes > 0
        ? Math.min(100, Math.round((item.receivedBytes / item.totalBytes) * 100))
        : 0;
      if (bar) {
        // 临时禁用过渡，避免从 0 重新动画
        bar.style.transition = 'none';
        bar.style.width = `${percent}%`;
        requestAnimationFrame(() => { bar.style.transition = ''; });
      }
      if (info) info.textContent = getDownloadProgressInfo(item, percent);
      return true;
    }

    // 状态切换（完成/取消/删除等）：重建该行
    const newRow = buildDownloadRow(item);
    if (newRow) row.replaceWith(newRow);
    return true;
  }

  function renderDownloadPanel() {
    const list = dom.downloadList;
    list.innerHTML = '';

    const query = state.downloadSearchQuery;
    const items = state.downloads.filter((item) => {
      if (!query) return true;
      const f = String(item.filename || '').toLowerCase();
      const u = String(item.url || '').toLowerCase();
      return f.includes(query) || u.includes(query);
    });

    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'download-empty';
      empty.innerHTML = query
        ? '<div class="download-empty__icon">🔍</div><div>没有匹配的下载内容</div>'
        : '<div class="download-empty__icon">📥</div><div>还没有下载内容</div>';
      list.appendChild(empty);
      return;
    }

    // 全量历史：已完成/进行中/已取消/已删除 均展示
    items.forEach((item) => {
      list.appendChild(buildDownloadRow(item));
    });
  }

  function getDownloadSource(item) {
    try {
      if (item && item.url) {
        return new URL(item.url).hostname.replace(/^www\./, '');
      }
    } catch (e) { /* ignore */ }
    return '';
  }

  function getDownloadMeta(item) {
    const source = getDownloadSource(item);
    const parts = [];
    if (source) parts.push(source);

    if (item.state === 'in_progress') {
      const size = item.totalBytes > 0
        ? `${formatBytes(item.receivedBytes)} / ${formatBytes(item.totalBytes)}`
        : formatBytes(item.receivedBytes);
      parts.push(size);
      if (item.speed) parts.push(formatSpeed(item.speed));
    } else if (item.state === 'paused') {
      parts.push(formatBytes(item.receivedBytes));
    } else if (item.state === 'completed') {
      parts.push(formatBytes(item.totalBytes));
      parts.push(new Date(item.endTime || item.startTime).toLocaleString('zh-CN', {
        month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
      }));
    } else if (item.state === 'deleted') {
      parts.push('已删除');
    } else if (item.state === 'failed') {
      parts.push('下载失败');
    } else if (item.state === 'cancelled') {
      parts.push('已取消');
    }
    return parts.join(' · ');
  }

  async function openDownloadPanel() {
    if (state.downloadPanelOpen) return;

    if (IS_OVERLAY) {
      // 覆盖层内：直接在当前覆盖层中显示面板
      state.downloadPanelOpen = true;
      dom.downloadPanel.hidden = false;
      dom.downloadPanel.style.visibility = 'hidden';
      await loadDownloads();
      if (!state.downloadPanelOpen) return;
      positionDownloadPanel();
      dom.downloadPanel.style.visibility = 'visible';
      requestAnimationFrame(positionDownloadPanel);
      return;
    }

    // 主窗口：面板显示到透明覆盖层（叠加在实时页面上，页面不缩放、不暂停）
    if (state.contextMenuOpen) closeContextMenu();
    if (state.historyPanelOpen) closeHistoryPanel();
    if (state.bookmarksPanelOpen) closeBookmarksPanel();
    if (state.extensionPopupOpen) closeExtensionPopup();
    if (dom.bookmarkFolderPopup.style.display === 'block') closeBookmarkFolderPopup();
    const r = dom.btnDownloads.getBoundingClientRect();
    state.downloadPanelOpen = true;
    api.showPanelOverlay({
      type: 'downloads',
      anchor: { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height },
    });
  }

  function closeDownloadPanel() {
    if (!state.downloadPanelOpen) return;
    state.downloadPanelToken++;
    state.downloadPanelOpen = false;
    dom.downloadPanel.hidden = true;
    dom.downloadPanel.style.visibility = '';
    dom.downloadMoreMenu.hidden = true;
    api.hidePanelOverlay();
  }

  function positionDownloadPanel() {
    if (IS_OVERLAY) {
      dom.downloadPanel.style.left = '0';
      dom.downloadPanel.style.top = '0';
      return;
    }
    const rect = getPanelAnchorRect(dom.btnDownloads);
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

  return {
    loadDownloads,
    bindDownloadPanel,
    positionDownloadPanel,
    openDownloadPanel,
    closeDownloadPanel,
    updateDownloadRow,
    renderDownloadPanel,
    updateDownloadButton,
  };
};
