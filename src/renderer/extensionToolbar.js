/**
 * 工具栏扩展图标（对齐 Edge）
 * 由 app.js 调用 window.NeutronExtensionToolbar(ctx) 创建，ctx 注入共享依赖。
 * 返回公共方法：bindExtensionToolbar
 */
window.NeutronExtensionToolbar = function (ctx) {
  'use strict';

  const {
    state, dom, api,
    showToast, showExtensionContextMenu,
    closeDownloadPanel, closeHistoryPanel, closeBookmarksPanel,
    closeExtensionPopup, closeContextMenu,
  } = ctx;

  function bindExtensionToolbar() {
    refreshExtensionToolbarIcons();

    // 徽章变化 / 扩展增删启停 → 实时刷新工具栏图标
    if (api.onExtensionActionChanged) {
      const unsub = api.onExtensionActionChanged((data) => {
        if (!data) return;
        if (data.refresh) {
          refreshExtensionToolbarIcons();
          return;
        }
        if (data.id) updateExtensionIconBadge(data);
      });
      state.unsubscribers.push(unsub);
    }

    // 全局点击：点击工具栏其它按钮时关闭扩展 Popup
    document.addEventListener('mousedown', (e) => {
      if (!dom.extensionToolbarIcons.contains(e.target) &&
          !e.target.closest('#extensionPopup')) {
        api.hideExtensionPopup();
      }
    });

    // 主进程广播：扩展 Popup 已关闭（含加载失败）→ 同步开关状态并提示
    if (api.onExtensionPopupClosed) {
      const unsub = api.onExtensionPopupClosed((data) => {
        state.extensionPopupOpenId = null;
        if (data && data.failed) {
          showToast('扩展弹出窗口加载失败', 'error');
        }
      });
      state.unsubscribers.push(unsub);
    }
  }

  async function refreshExtensionToolbarIcons() {
    try {
      state.extensionActions = (await api.getExtensionActions()) || [];
    } catch (e) {
      state.extensionActions = [];
    }
    renderExtensionToolbarIcons();
  }

  function renderExtensionToolbarIcons() {
    const container = dom.extensionToolbarIcons;
    if (!container) return;
    container.innerHTML = '';
    const actions = state.extensionActions || [];
    if (actions.length === 0) {
      container.style.display = 'none';
      return;
    }
    container.style.display = '';
    actions.forEach((action) => {
      container.appendChild(buildExtensionIconBtn(action));
    });
  }

  function buildExtensionIconBtn(action) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ext-tool-btn';
    btn.title = action.title || action.name;
    btn.dataset.extId = action.id;
    btn.setAttribute('aria-label', action.name);

    if (action.icon) {
      const img = document.createElement('img');
      img.className = 'ext-tool-btn__icon';
      img.src = 'file:///' + String(action.icon).replace(/\\/g, '/');
      img.alt = '';
      img.draggable = false;
      img.addEventListener('error', () => {
        const fallback = document.createElement('span');
        fallback.className = 'ext-tool-btn__fallback';
        fallback.textContent = '🧩';
        img.replaceWith(fallback);
      });
      btn.appendChild(img);
    } else {
      const fallback = document.createElement('span');
      fallback.className = 'ext-tool-btn__fallback';
      fallback.textContent = '🧩';
      btn.appendChild(fallback);
    }

    if (action.badgeText) {
      const badge = document.createElement('span');
      badge.className = 'ext-tool-btn__badge';
      badge.textContent = action.badgeText;
      badge.style.background = action.badgeColor || '#666666';
      btn.appendChild(badge);
    }

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      handleExtensionActionClick(action, btn);
    });

    // 右键：对齐 Edge 的扩展上下文菜单
    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showExtensionContextMenu(e.clientX, e.clientY, action);
    });

    return btn;
  }

  function updateExtensionIconBadge(data) {
    const btn = dom.extensionToolbarIcons.querySelector(`[data-ext-id="${CSS.escape(data.id)}"]`);
    if (!btn) return;
    const old = btn.querySelector('.ext-tool-btn__badge');
    if (old) old.remove();
    if (data.text) {
      const badge = document.createElement('span');
      badge.className = 'ext-tool-btn__badge';
      badge.textContent = data.text;
      badge.style.background = data.color || '#666666';
      btn.appendChild(badge);
    }
    if (data.title) btn.title = data.title;
    const idx = state.extensionActions.findIndex((a) => a.id === data.id);
    if (idx !== -1) {
      state.extensionActions[idx].badgeText = data.text || '';
      state.extensionActions[idx].badgeColor = data.color || state.extensionActions[idx].badgeColor;
      state.extensionActions[idx].title = data.title || state.extensionActions[idx].title;
    }
  }

  async function handleExtensionActionClick(action, btn) {
    // 同扩展再次点击 → 关闭弹窗（对齐 Edge 的开关行为）
    if (state.extensionPopupOpenId === action.id) {
      api.hideExtensionPopup();
      state.extensionPopupOpenId = null;
      return;
    }

    // 关闭其它悬浮面板
    if (state.downloadPanelOpen) closeDownloadPanel();
    if (state.historyPanelOpen) closeHistoryPanel();
    if (state.bookmarksPanelOpen) closeBookmarksPanel();
    if (state.extensionPopupOpen) closeExtensionPopup();
    if (state.contextMenuOpen) closeContextMenu();
    api.hideExtensionPopup();
    state.extensionPopupOpenId = null;

    if (action.popup) {
      const rect = btn.getBoundingClientRect();
      let result = { ok: false, reason: 'no-window' };
      try {
        result = (await api.openExtensionPopup({
          id: action.id,
          popup: action.popup,
          anchor: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height },
        })) || { ok: false, reason: 'unknown' };
      } catch (e) {
        result = { ok: false, reason: 'ipc-error' };
      }
      if (result && result.ok) {
        state.extensionPopupOpenId = action.id;
      } else {
        const reason = (result && result.reason) || '';
        showToast(
          reason === 'popup-missing' ? '此扩展的弹出窗口文件不存在，可能扩展已更新' :
          reason === 'not-installed' ? '扩展不存在或已被移除' :
          '扩展弹出窗口打开失败', 'error');
      }
    } else {
      api.triggerExtensionAction(action.id);
    }
  }

  return { bindExtensionToolbar };
};
