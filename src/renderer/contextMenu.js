/**
 * 右键菜单（统一置顶管理）+ 地址栏右键菜单（Edge 风格）
 * 由 app.js 调用 window.NeutronContextMenu(ctx) 创建，ctx 注入共享依赖。
 * 返回公共方法：openContextMenu / closeContextMenu / bindContextMenu /
 *              showAddressBarContextMenu / showTabContextMenu
 */
window.NeutronContextMenu = function (ctx) {
  'use strict';

  const {
    state, dom, api, IS_OVERLAY,
    closeDownloadPanel, closeHistoryPanel, closeExtensionPopup,
    closeBookmarkFolderPopup, closeBookmarkDialog, closeFolderDialog,
    showToast, navigateToUrl,
  } = ctx;

  // BrowserView 是原生视图，永远盖在主窗口 webContents 之上，
  // 因此打开任何悬浮菜单前必须 setModalVisible(true) 移除 BrowserView（显示内容快照），
  // 否则菜单落入内容区时会被网页遮挡；关闭时再恢复。
  function isAnyOverlayOpen() {
    return state.downloadPanelOpen || state.historyPanelOpen || state.extensionPopupOpen ||
      dom.bookmarkDialog.style.display === 'flex' || dom.folderDialog.style.display === 'flex' ||
      dom.bookmarkFolderPopup.style.display === 'block';
  }

  function openContextMenu() {
    // 覆盖层内：右键菜单已在最上层，直接显示（不关闭面板、不调用 setModalVisible）
    if (IS_OVERLAY) {
      state.contextMenuOpen = true;
      dom.contextMenu.style.display = 'block';
      return;
    }
    // 与其他悬浮窗互斥：打开右键菜单前先关闭其他悬浮窗
    if (state.downloadPanelOpen) closeDownloadPanel();
    if (state.historyPanelOpen) closeHistoryPanel();
    if (state.extensionPopupOpen) closeExtensionPopup();
    if (dom.bookmarkFolderPopup.style.display === 'block') closeBookmarkFolderPopup();
    if (dom.bookmarkDialog.style.display === 'flex') closeBookmarkDialog();
    if (dom.folderDialog.style.display === 'flex') closeFolderDialog();
    state.contextMenuOpen = true;
    dom.contextMenu.style.display = 'block';
    api.setModalVisible(true);
  }

  function closeContextMenu() {
    if (!state.contextMenuOpen) return;
    state.contextMenuOpen = false;
    dom.contextMenu.style.display = 'none';
    dom.contextMenu.classList.remove('context-menu--addressbar');
    dom.contextMenu.classList.remove('context-menu--ext');
    // 覆盖层内不调用 setModalVisible（覆盖层本身就是最上层）
    if (!IS_OVERLAY && !isAnyOverlayOpen()) {
      api.setModalVisible(false);
    }
  }

  function bindContextMenu() {
    document.addEventListener('click', (e) => {
      closeContextMenu();

      // Don't close folder popup if clicking inside it or on the folder button that opened it
      if (dom.bookmarkFolderPopup.style.display === 'block') {
        const popup = dom.bookmarkFolderPopup;
        const subPopup = state.subFolderPopupDiv;
        const clickedInsidePopup = popup.contains(e.target);
        const clickedInsideSub = subPopup && subPopup.contains(e.target);
        const clickedOnFolder = e.target.closest('.bookmark-item--folder');
        if (!clickedInsidePopup && !clickedInsideSub && !clickedOnFolder) {
          closeBookmarkFolderPopup();
        }
      }
    });

    // Esc 关闭右键菜单
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && state.contextMenuOpen) {
        closeContextMenu();
      }
    });
  }

  function showAddressBarContextMenu(x, y) {
    const input = dom.addressInput;
    const hasSelection = input.selectionStart !== input.selectionEnd;
    const hasText = input.value.length > 0;

    dom.contextMenu.innerHTML = '';
    dom.contextMenu.classList.add('context-menu--addressbar');

    const makeItem = (config) => {
      const el = document.createElement('div');
      const disabled = config.enabled === false;
      el.className = 'context-menu__item' + (disabled ? ' context-menu__item--disabled' : '');
      el.innerHTML =
        `<span class="context-menu__item-icon">${config.icon || ''}</span>` +
        `<span class="context-menu__item-label">${config.label}</span>` +
        (config.shortcut ? `<span class="context-menu__shortcut">${config.shortcut}</span>` : '');
      if (!disabled && config.action) {
        el.addEventListener('click', () => {
          closeContextMenu();
          config.action();
        });
      }
      return el;
    };

    const appendSeparator = () => {
      const sep = document.createElement('div');
      sep.className = 'context-menu__separator';
      dom.contextMenu.appendChild(sep);
    };

    // 表情符号
    dom.contextMenu.appendChild(makeItem({
      icon: '😀',
      label: '表情符号',
      shortcut: 'Win+句点',
      action: () => api.openEmojiPanel(),
    }));
    // 发送标签页到你的设备（暂无设备同步，给出提示）
    dom.contextMenu.appendChild(makeItem({
      icon: '📤',
      label: '发送标签页到你的设备',
      action: () => showToast('设备同步功能暂未支持，敬请期待'),
    }));
    appendSeparator();

    // 编辑命令
    const editCommands = [
      { label: '撤消', shortcut: 'Ctrl+Z', command: 'undo', enabled: true },
      { label: '恢复', shortcut: 'Ctrl+Y', command: 'redo', enabled: true },
      { label: '剪切', shortcut: 'Ctrl+X', command: 'cut', enabled: hasSelection },
      { label: '复制', shortcut: 'Ctrl+C', command: 'copy', enabled: hasSelection },
      { label: '粘贴', shortcut: 'Ctrl+V', command: 'paste', enabled: true },
    ];
    editCommands.forEach((cmd) => {
      dom.contextMenu.appendChild(makeItem({
        label: cmd.label,
        shortcut: cmd.shortcut,
        enabled: cmd.enabled,
        action: () => runAddressBarEdit(cmd.command),
      }));
    });

    // 粘贴并转到（异步读取剪贴板后填充预览）
    const pasteGoItem = makeItem({
      label: '粘贴并转到',
      shortcut: 'Ctrl+Shift+L',
      enabled: false,
      action: null,
    });
    dom.contextMenu.appendChild(pasteGoItem);
    api.readClipboardText().then((text) => {
      const clip = String(text || '').trim();
      if (!clip || !document.body.contains(pasteGoItem)) return;
      pasteGoItem.classList.remove('context-menu__item--disabled');
      const labelEl = pasteGoItem.querySelector('.context-menu__item-label');
      if (labelEl) {
        const preview = clip.length > 42 ? clip.slice(0, 42) + '…' : clip;
        labelEl.textContent = '粘贴并转到 ' + preview;
      }
      pasteGoItem.addEventListener('click', () => {
        closeContextMenu();
        navigateToUrl(clip);
      });
    }).catch(() => {});

    // 删除
    dom.contextMenu.appendChild(makeItem({
      label: '删除',
      enabled: hasSelection || hasText,
      action: () => runAddressBarEdit('delete'),
    }));
    appendSeparator();

    // 全选
    dom.contextMenu.appendChild(makeItem({
      label: '全选',
      shortcut: 'Ctrl+A',
      enabled: hasText,
      action: () => {
        input.focus();
        input.select();
      },
    }));

    openContextMenu();
    dom.contextMenu.style.left = Math.max(0, Math.min(x, window.innerWidth - 300)) + 'px';
    dom.contextMenu.style.top = Math.max(0, Math.min(y, window.innerHeight - 460)) + 'px';
  }

  function runAddressBarEdit(command) {
    // 点击菜单项后焦点会离开输入框，先重新聚焦再执行编辑命令
    dom.addressInput.focus();
    api.addressBarEdit(command);
  }

  function showTabContextMenu(x, y, tab) {
    dom.contextMenu.innerHTML = '';

    // 统一图标：lucide 风格内联 SVG（与浏览器工具栏/面板图标一致，避免字符/emoji 混用）
    const svg = (inner) =>
      `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
    const ICONS = {
      plus: svg('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>'),
      reload: svg('<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>'),
      copy: svg('<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'),
      pin: svg('<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1z"/>'),
      x: svg('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'),
      closeOthers: svg('<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="9" y1="9" x2="15" y2="15"/><line x1="15" y1="9" x2="9" y2="15"/>'),
      group: svg('<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>'),
      split: svg('<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="12" y1="3" x2="12" y2="21"/>'),
    };

    // 标签分组菜单项
    const groupItems = [];
    if (tab.groupId) {
      groupItems.push({ label: '从分组移除', action: () => api.removeTabFromGroup(tab.id), icon: ICONS.group });
      groupItems.push({ label: '解散分组', action: () => api.ungroupTabs(tab.groupId), icon: ICONS.group });
      groupItems.push({ label: '关闭分组内标签页', action: () => api.closeTabGroup(tab.groupId), icon: ICONS.x, cls: 'context-menu__item--danger' });
    } else {
      groupItems.push({ label: '创建新分组', action: () => api.createTabGroup([tab.id]), icon: ICONS.group });
      for (const g of (state.tabGroups || [])) {
        groupItems.push({ label: '添加到「' + (g.name || '分组') + '」', action: () => api.addTabsToGroup(g.id, [tab.id]), icon: ICONS.group });
      }
    }

    // 分屏菜单项
    const splitItems = [];
    if (state.splitTabId && state.splitTabId === tab.id) {
      splitItems.push({ label: '退出分屏', action: () => api.setSplitTab(null), icon: ICONS.split });
    } else if (tab.id !== state.activeTabId) {
      splitItems.push({ label: '在分屏中打开', action: () => api.setSplitTab(tab.id), icon: ICONS.split });
    }

    const items = [
      { label: '新建标签页', action: () => api.createTab(), icon: ICONS.plus },
      { label: '重新加载', action: () => api.reloadTab(tab.id), icon: ICONS.reload },
      { type: 'separator' },
      { label: '复制标签页', action: () => api.duplicateTab(tab.id), icon: ICONS.copy },
      { label: tab.isPinned ? '取消固定标签页' : '固定标签页', action: () => api.pinTab(tab.id), icon: ICONS.pin },
      { type: 'separator' },
      ...groupItems,
      ...splitItems,
      { type: 'separator' },
      { label: '关闭标签页', action: () => api.closeTab(tab.id), icon: ICONS.x, cls: tab.isPinned ? 'context-menu__item--disabled' : '' },
      { label: '关闭其他标签页', action: () => closeOtherTabs(tab.id), icon: ICONS.closeOthers, cls: 'context-menu__item--danger' },
    ];

    items.forEach((item) => {
      if (item.type === 'separator') {
        const sep = document.createElement('div');
        sep.className = 'context-menu__separator';
        dom.contextMenu.appendChild(sep);
        return;
      }

      const el = document.createElement('div');
      el.className = 'context-menu__item ' + (item.cls || '');
      el.innerHTML =
        `<span class="context-menu__item-icon">${item.icon || ''}</span>` +
        `<span class="context-menu__item-label">${item.label}</span>`;
      el.addEventListener('click', () => {
        closeContextMenu();
        if (item.action) item.action();
      });
      dom.contextMenu.appendChild(el);
    });

    openContextMenu();
    dom.contextMenu.style.left = Math.min(x, window.innerWidth - 220) + 'px';
    dom.contextMenu.style.top = Math.min(y, window.innerHeight - 300) + 'px';
  }

  function closeOtherTabs(tabId) {
    const otherTabs = state.tabs.filter(t => t.id !== tabId && !t.isPinned);
    otherTabs.forEach(t => api.closeTab(t.id));
  }

  return {
    openContextMenu,
    closeContextMenu,
    bindContextMenu,
    showAddressBarContextMenu,
    showTabContextMenu,
  };
};
