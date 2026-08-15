/**
 * 扩展图标右键菜单（对齐 Edge）
 * 由 app.js 调用 window.NeutronExtensionContextMenu(ctx) 创建，ctx 注入共享依赖。
 * 返回公共方法：showExtensionContextMenu
 */
window.NeutronExtensionContextMenu = function (ctx) {
  'use strict';

  const {
    state, dom, api,
    showToast, closeContextMenu, closeExtensionPopup, openContextMenu,
  } = ctx;

  /**
   * 打开扩展图标右键菜单：
   * 网站访问权限（仅在单击时允许/当前网站/所有网站）· 扩展选项 · 删除 ·
   * 取消固定 · 管理扩展 · 查看 Web 权限 · 检查弹出窗口
   */
  async function showExtensionContextMenu(x, y, action) {
    if (state.contextMenuOpen) closeContextMenu();
    // 对齐 Edge/Chromium：右键菜单与扩展 Popup 互斥，两者绝不同时显示。
    // Chromium 中 Popup 是 close-on-deactivate 气泡，右键菜单抢走焦点后气泡自动关闭
    // （extensions_toolbar_desktop.cc 在 macOS 上还会显式 HideActivePopup()）。
    // 本浏览器 Popup 是 BrowserView 原生层（永远盖在主窗口 DOM 之上），
    // 必须在打开菜单前主动移除，否则两层窗口同时出现并互相遮挡。
    if (state.extensionPopupOpen) closeExtensionPopup();
    api.hideExtensionPopup();

    let meta = null;
    try {
      meta = await api.getExtensionMenuMeta(action.id);
    } catch (e) {
      meta = null;
    }
    if (!meta) {
      meta = {
        id: action.id,
        name: action.name,
        siteAccess: 'all',
        pinned: true,
        hasOptionsPage: false,
        hasPopup: !!action.popup,
        hasHostAccess: false,
      };
    }

    // 当前活动标签页的站点（用于"允许在 xxx 上使用"）
    const activeTab = state.tabs.find((t) => t.id === state.activeTabId);
    let currentHost = '';
    let isHttpPage = false;
    try {
      const u = new URL(activeTab && activeTab.url ? activeTab.url : '');
      if (u.protocol === 'http:' || u.protocol === 'https:') {
        currentHost = u.hostname;
        isHttpPage = true;
      }
    } catch (e) { /* 忽略 */ }

    dom.contextMenu.innerHTML = '';
    dom.contextMenu.classList.add('context-menu--ext');

    const svg = (inner) =>
      `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
    const ICONS = {
      check: svg('<polyline points="20 6 9 17 4 12"/>'),
      options: svg('<circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M1 12h4M19 12h4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/>'),
      trash: svg('<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>'),
      unpin: svg('<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1z"/><line x1="2" y1="2" x2="22" y2="22"/>'),
      puzzle: svg('<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v2a2 2 0 0 0 4 0v11a2 2 0 0 1-2 2z"/><path d="M10 3v3M7 6h6"/>'),
      shield: svg('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>'),
      inspect: svg('<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>'),
    };

    const appendGroupHeader = (label) => {
      const el = document.createElement('div');
      el.className = 'context-menu__group-header';
      el.textContent = label;
      dom.contextMenu.appendChild(el);
    };

    const appendSeparator = () => {
      const sep = document.createElement('div');
      sep.className = 'context-menu__separator';
      dom.contextMenu.appendChild(sep);
    };

    const appendItem = (config) => {
      const disabled = config.enabled === false;
      const el = document.createElement('div');
      el.className = 'context-menu__item' +
        (disabled ? ' context-menu__item--disabled' : '') +
        (config.cls ? ' ' + config.cls : '');
      el.innerHTML =
        `<span class="context-menu__item-icon">${config.icon || ''}</span>` +
        `<span class="context-menu__item-label">${config.label}</span>`;
      if (!disabled && config.action) {
        el.addEventListener('click', () => {
          closeContextMenu();
          config.action();
        });
      }
      dom.contextMenu.appendChild(el);
      return el;
    };

    const appendCheckItem = (config) => {
      const el = document.createElement('div');
      el.className = 'context-menu__item' +
        (config.enabled === false ? ' context-menu__item--disabled' : '');
      el.innerHTML =
        `<span class="context-menu__item-icon">${config.checked ? ICONS.check : ''}</span>` +
        `<span class="context-menu__item-label">${config.label}</span>`;
      if (config.enabled !== false && config.action) {
        el.addEventListener('click', () => {
          closeContextMenu();
          config.action();
        });
      }
      dom.contextMenu.appendChild(el);
      return el;
    };

    // ===== 网站访问权限 =====
    appendGroupHeader('网站访问权限');
    const modeOptions = [
      { mode: 'on_click', label: '仅在单击时允许' },
      {
        mode: 'specific',
        label: isHttpPage ? `允许在 ${currentHost} 上使用` : '允许在指定网站上使用',
        enabled: isHttpPage,
      },
      { mode: 'all', label: '允许在所有网站上使用' },
    ];
    modeOptions.forEach((opt) => {
      appendCheckItem({
        checked: meta.siteAccess === opt.mode,
        label: opt.label,
        enabled: opt.enabled !== false,
        action: async () => {
          const res = await api.setExtensionSiteAccess(
            meta.id,
            opt.mode,
            opt.mode === 'specific' ? currentHost : ''
          );
          if (res && res.success) {
            showToast(`已更新“${meta.name}”的网站访问权限`, 'success');
          } else {
            showToast((res && res.message) || '设置失败', 'error');
          }
        },
      });
    });

    appendSeparator();

    // ===== 扩展选项 =====
    appendItem({
      icon: ICONS.options,
      label: '扩展选项',
      enabled: meta.hasOptionsPage,
      action: async () => {
        const res = await api.openExtensionOptions(meta.id);
        if (res && !res.success) showToast(res.message || '无法打开选项页', 'error');
      },
    });

    // ===== 删除 / 取消固定 =====
    appendItem({
      icon: ICONS.trash,
      label: '从 Neutron 浏览器中删除',
      cls: 'context-menu__item--danger',
      action: async () => {
        if (!confirm(`确定要卸载扩展“${meta.name}”吗？`)) return;
        const res = await api.uninstallExtension(meta.id);
        if (res && res.success) {
          showToast(`已卸载“${meta.name}”`, 'success');
        } else {
          showToast((res && res.message) || '卸载失败', 'error');
        }
      },
    });
    appendItem({
      icon: ICONS.unpin,
      label: meta.pinned ? '从工具栏取消固定' : '固定到工具栏',
      action: async () => {
        const res = await api.setExtensionPinned(meta.id, !meta.pinned);
        if (res && res.success) {
          showToast(
            res.meta && res.meta.pinned
              ? `已将“${meta.name}”固定到工具栏`
              : `已从工具栏取消固定“${meta.name}”（可在管理扩展页重新固定）`,
            'success'
          );
        } else {
          showToast((res && res.message) || '操作失败', 'error');
        }
      },
    });

    appendSeparator();

    // ===== 管理扩展 / 查看 Web 权限 / 检查弹出窗口 =====
    appendItem({
      icon: ICONS.puzzle,
      label: '管理扩展',
      action: () => api.createTab('neutron://extensions'),
    });
    appendItem({
      icon: ICONS.shield,
      label: '查看 Web 权限',
      action: () => api.viewExtensionWebPermissions(meta.id),
    });
    appendItem({
      icon: ICONS.inspect,
      label: meta.hasPopup ? '检查弹出窗口' : '检查扩展后台页',
      action: () => {
        if (meta.hasPopup && action.popup) {
          const btn = dom.extensionToolbarIcons.querySelector(
            `[data-ext-id="${CSS.escape(meta.id)}"]`
          );
          const rect = btn ? btn.getBoundingClientRect() : null;
          api.openExtensionPopup({
            id: meta.id,
            popup: action.popup,
            anchor: rect
              ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height }
              : undefined,
          });
          // Popup 加载后再打开 DevTools（主进程按 URL 匹配 Popup 视图）
          setTimeout(() => api.inspectExtensionView(meta.id, action.popup), 400);
        } else {
          api.inspectExtensionView(meta.id);
        }
      },
    });

    openContextMenu();
    dom.contextMenu.style.left = Math.max(0, Math.min(x, window.innerWidth - 280)) + 'px';
    dom.contextMenu.style.top = Math.max(0, Math.min(y, window.innerHeight - 560)) + 'px';
  }

  return { showExtensionContextMenu };
};
