/**
 * 扩展弹窗（工具栏拼图图标 → 已安装扩展列表 + 站点权限）
 * 由 app.js 调用 window.NeutronExtensionPopup(ctx) 创建，ctx 注入共享依赖。
 * 返回公共方法：bindExtensionPopup / openExtensionPopup / closeExtensionPopup /
 *              positionExtensionPopup / loadExtensionPopup
 */
window.NeutronExtensionPopup = function (ctx) {
  'use strict';

  const {
    state, dom, api, IS_OVERLAY,
    closeContextMenu, closeDownloadPanel, closeHistoryPanel, closeBookmarksPanel,
    getPanelAnchorRect,
  } = ctx;

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
    if (IS_OVERLAY) {
      // 覆盖层内：直接在当前覆盖层中显示面板
      state.extensionPopupOpen = true;
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
      if (!state.extensionPopupOpen) return;
      positionExtensionPopup();
      dom.extensionPopup.style.visibility = 'visible';
      requestAnimationFrame(positionExtensionPopup);
      return;
    }

    // 主窗口：面板显示到透明覆盖层（叠加在实时页面上，页面不缩放、不暂停）
    if (state.contextMenuOpen) closeContextMenu();
    if (state.downloadPanelOpen) closeDownloadPanel();
    if (state.historyPanelOpen) closeHistoryPanel();
    if (state.bookmarksPanelOpen) closeBookmarksPanel();
    const r = dom.btnExtensions.getBoundingClientRect();
    state.extensionPopupOpen = true;
    api.showPanelOverlay({
      type: 'extensions',
      anchor: { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height },
    });
  }

  function closeExtensionPopup() {
    if (!state.extensionPopupOpen) return;
    state.extensionPopupToken++;
    state.extensionPopupOpen = false;
    dom.extensionPopup.hidden = true;
    document.querySelectorAll('.extension-more-menu').forEach((menu) => {
      menu.hidden = true;
    });
    api.hidePanelOverlay();
  }

  function positionExtensionPopup() {
    if (IS_OVERLAY) {
      dom.extensionPopup.style.left = '0';
      dom.extensionPopup.style.top = '0';
      return;
    }
    const rect = getPanelAnchorRect(dom.btnExtensions);
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
      // 扩展自带选项页时，提供「扩展选项」入口（打开 chrome-extension:// 选项页，与 Edge 一致）
      if (ext.optionsUrl) {
        moreMenu.appendChild(createExtensionMenuAction('扩展选项', () => {
          closeExtensionPopup();
          const optionsPath = String(ext.optionsUrl).replace(/^\/+/, '');
          api.createTab(`chrome-extension://${ext.id}/${optionsPath}`);
        }));
      }
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

  return {
    bindExtensionPopup,
    openExtensionPopup,
    closeExtensionPopup,
    positionExtensionPopup,
    loadExtensionPopup,
  };
};
