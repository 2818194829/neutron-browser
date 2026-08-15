/**
 * IPC 处理器注册
 * 处理来自渲染进程的所有 IPC 请求
 */
const { ipcMain, dialog, shell, app, Menu, clipboard } = require('electron');
const { execFile } = require('child_process');
const https = require('https');
const path = require('path');
const fs = require('fs');
const { IPC_CHANNELS, INTERNAL_PAGES, DEFAULT_SETTINGS } = require('../shared/constants');
const { getStore } = require('./storage');
const { normalizeHistoryTitle, sanitizeFavicon, sanitizeBookmarks, sanitizeHistory } = require('../shared/siteMeta');
const { parseFaviconFromHtml } = require('../shared/faviconHtml');
const {
  getInstalledExtensions,
  isDeveloperMode,
  installExtensionFile,
  installUnpackedExtension,
  installFromEdgeStore,
  setExtensionEnabled,
  uninstallExtension,
  getExtensionActions,
  setExtensionBadge,
  findExtensionBackgroundWebContents,
  triggerExtensionActionClicked,
  triggerExtensionCommand,
  getExtensionMenuMeta,
  setExtensionSiteAccess,
  setExtensionPinned,
  grantSiteAccessOnClick,
} = require('./extensions');
const { sendVerifyCode, checkVerifyCode } = require('./verifyCode');
const { registerExtensionBridgeIpc, ensureMv3Backgrounds } = require('./extensionBridge');
const { logDrag } = require('./dragDebugLog');

// ==================== 书签导入/导出辅助 ====================

/** HTML 实体解码 */
function decodeHtmlEntities(str) {
  return String(str || '')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/&#(\d+);/g, (m, code) => String.fromCharCode(parseInt(code, 10)));
}

/** HTML 属性转义 */
function escapeHtmlAttr(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 生成书签 ID */
let bookmarkIdSeed = 0;
function genBookmarkId() {
  bookmarkIdSeed += 1;
  return `bm_${Date.now()}_${bookmarkIdSeed}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 解析 Netscape 书签 HTML 格式（浏览器导出的标准书签格式）
 * @param {string} html
 * @returns {Array<{type:'folder'|'bookmark', title:string, url?:string, children?:Array}>}
 */
function parseNetscapeBookmarks(html) {
  const root = { type: 'folder', title: '根', children: [] };
  const stack = [root];
  const re = /<DT>\s*<A\s+[^>]*HREF\s*=\s*"([^"]*)"[^>]*>(.*?)<\/A>|<DT>\s*<H3[^>]*>(.*?)<\/H3>|<\/DL>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const token = m[0].toLowerCase();
    if (token.startsWith('<dt>') && token.includes('<a ')) {
      const url = String(m[1] || '').trim();
      if (url) {
        stack[stack.length - 1].children.push({
          type: 'bookmark',
          title: decodeHtmlEntities(m[2]).trim() || url,
          url,
        });
      }
    } else if (token.startsWith('<dt>') && token.includes('<h3')) {
      const folder = {
        type: 'folder',
        title: decodeHtmlEntities(m[3]).trim() || '未命名文件夹',
        children: [],
      };
      stack[stack.length - 1].children.push(folder);
      stack.push(folder);
    } else if (token === '</dl>') {
      if (stack.length > 1) stack.pop();
    }
  }
  return root.children;
}

/** 生成 Netscape 书签 HTML */
function buildNetscapeBookmarksHtml(data) {
  const rootNames = { bookmark_bar: '书签栏', other: '其他书签', mobile: '移动设备书签' };
  let html = '<!DOCTYPE NETSCAPE-Bookmark-file-1>\n'
    + '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n'
    + '<TITLE>书签</TITLE>\n<H1>书签</H1>\n<DL><p>\n';

  const renderFolder = (folder, title) => {
    html += `    <DT><H3>${escapeHtmlAttr(title)}</H3>\n    <DL><p>\n`;
    for (const child of (folder.children || [])) {
      if (child.type === 'folder') {
        renderFolder(child, child.title || '未命名文件夹');
      } else {
        html += `        <DT><A HREF="${escapeHtmlAttr(child.url)}">${escapeHtmlAttr(child.title)}</A>\n`;
      }
    }
    html += '    </DL><p>\n';
  };

  for (const key of Object.keys(data)) {
    if (data[key] && data[key].type === 'folder') {
      renderFolder(data[key], rootNames[key] || data[key].title || key);
    }
  }
  html += '</DL><p>\n';
  return html;
}

function compareVersions(a, b) {
  const pa = String(a || '').replace(/^v/i, '').split('.').map(Number);
  const pb = String(b || '').replace(/^v/i, '').split('.').map(Number);
  const length = Math.max(pa.length, pb.length);
  for (let i = 0; i < length; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

function fetchLatestRelease() {
  return new Promise((resolve, reject) => {
    const request = https.get(
      'https://api.github.com/repos/2818194829/neutron-browser/releases/latest',
      {
        method: 'GET',
        headers: {
          'User-Agent': 'Neutron-Browser',
          Accept: 'application/vnd.github+json',
          'Accept-Encoding': 'identity',
        },
        timeout: 15000,
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(`GitHub API HTTP ${response.statusCode}`));
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(new Error('GitHub API 响应格式无效'));
          }
        });
        response.on('error', reject);
      }
    );

    request.on('timeout', () => {
      request.destroy(new Error('检查更新超时'));
    });
    request.on('error', reject);
  });
}

function registerIpcHandlers() {
  const getWM = () => global.windowManager;
  const sendMenuEvent = (action, data = {}) => {
    const wm = getWM();
    if (wm && wm.mainWindow && !wm.mainWindow.isDestroyed()) {
      wm.mainWindow.webContents.send(IPC_CHANNELS.MENU_EVENT, { action, ...data });
    }
  };
  // 扩展安装/卸载/启停后通知主窗口刷新工具栏扩展图标
  const broadcastExtensionsChanged = () => {
    // 新装/启停的 MV3 扩展需要补建模拟后台
    ensureMv3Backgrounds();
    const wm = getWM();
    if (wm && wm.mainWindow && !wm.mainWindow.isDestroyed()) {
      wm.mainWindow.webContents.send(IPC_CHANNELS.EXTENSIONS_ACTION_CHANGED, { refresh: true });
    }
  };

  // 注册扩展真实 API 桥接（webRequest/notifications/cookies/contextMenus）
  registerExtensionBridgeIpc();
  // 为已加载的 MV3 扩展创建模拟后台（参考 Edge ServiceWorkerTaskQueue）
  ensureMv3Backgrounds();

  // 清理历史遗留的错位 favicon 和默认标题，保证图标只跟随真实页面 URL
  const bookmarksData = sanitizeBookmarks(getStore('bookmarks').getAll());
  Object.keys(bookmarksData).forEach((key) => {
    getStore('bookmarks').set(key, bookmarksData[key]);
  });
  getStore('history').set('visits', sanitizeHistory(getStore('history').get('visits', [])));

  // ==================== 应用信息与更新 ====================
  ipcMain.handle(IPC_CHANNELS.APP_GET_INFO, () => {
    return {
      version: app.getVersion(),
      electron: process.versions.electron || '',
      chrome: process.versions.chrome || '',
    };
  });

  ipcMain.handle(IPC_CHANNELS.APP_CHECK_UPDATE, async () => {
    try {
      const release = await fetchLatestRelease();
      const currentVersion = app.getVersion();
      const latestVersion = String(release.tag_name || '').replace(/^v/i, '');
      const asset = (release.assets || []).find((item) =>
        /Setup.*\.exe$/i.test(item.name || '')
      ) || (release.assets || [])[0];

      return {
        ok: true,
        currentVersion,
        latestVersion,
        updateAvailable: Boolean(latestVersion) && compareVersions(latestVersion, currentVersion) > 0,
        isPackaged: app.isPackaged,
        releaseUrl: release.html_url || '',
        assetUrl: asset && asset.browser_download_url ? asset.browser_download_url : (release.html_url || ''),
        releaseName: release.name || release.tag_name || '',
      };
    } catch (error) {
      return {
        ok: false,
        error: error.message || String(error),
      };
    }
  });

  // ==================== 窗口控制 ====================
  ipcMain.on(IPC_CHANNELS.WINDOW_MINIMIZE, () => {
    const wm = getWM();
    if (wm && wm.mainWindow) wm.mainWindow.minimize();
  });

  ipcMain.on(IPC_CHANNELS.WINDOW_MAXIMIZE, () => {
    const wm = getWM();
    if (wm && wm.mainWindow) {
      if (wm.mainWindow.isMaximized()) {
        wm.mainWindow.unmaximize();
      } else {
        wm.mainWindow.maximize();
      }
    }
  });

  ipcMain.on(IPC_CHANNELS.WINDOW_CLOSE, () => {
    const wm = getWM();
    if (wm && wm.mainWindow) wm.mainWindow.close();
  });

  ipcMain.handle(IPC_CHANNELS.WINDOW_IS_MAXIMIZED, () => {
    const wm = getWM();
    return wm ? wm.mainWindow?.isMaximized() ?? false : false;
  });

  // 页面发起 requestFullscreen 时（preload 同步调用），在窗口被 Electron 自动
  // 改成全屏尺寸之前保存窗口状态，供退出全屏后恢复。
  ipcMain.on(IPC_CHANNELS.WINDOW_SAVE_FULLSCREEN_STATE, (event) => {
    const wm = getWM();
    if (wm && wm.mainWindow && !wm.mainWindow.isDestroyed()) {
      wm.htmlFullScreenPrev = {
        wasMaximized: wm.mainWindow.isMaximized(),
        bounds: wm.mainWindow.isMaximized()
          ? wm.mainWindow.getNormalBounds()
          : wm.mainWindow.getBounds(),
      };
      // ⭐ 关键：若窗口当前是最大化，先取消最大化再让页面进入全屏——让 Electron
      // 记录「普通」作为退出还原目标。否则退出全屏时 Electron 会先把窗口还原成
      // 最大化、再被主进程 setBounds 修正，造成「先最大化再退回原始大小」的
      // 两步跳变。用户期望退出后直接回到原始窗口大小（此时窗口尚未全屏，
      // unmaximize 有效；handleHtmlFullScreen 触发时窗口已全屏则无效）。
      if (wm.mainWindow.isMaximized()) {
        try { wm.mainWindow.unmaximize(); } catch (e) { /* 忽略 */ }
      }
    }
    event.returnValue = true;
  });

  ipcMain.handle(IPC_CHANNELS.WINDOW_SET_ALWAYS_ON_TOP, (event, flag) => {
    const wm = getWM();
    if (wm && wm.setAlwaysOnTop) return wm.setAlwaysOnTop(flag);
    return false;
  });

  ipcMain.handle(IPC_CHANNELS.WINDOW_IS_ALWAYS_ON_TOP, () => {
    const wm = getWM();
    return wm && wm.mainWindow ? wm.mainWindow.isAlwaysOnTop() : false;
  });

  ipcMain.on(IPC_CHANNELS.UI_MODAL_CHANGED, (event, visible) => {
    const wm = getWM();
    if (wm) wm.setModalVisible(visible === true);
  });

  ipcMain.on(IPC_CHANNELS.UI_MODAL_SNAPSHOT_READY, () => {
    const wm = getWM();
    if (wm) wm.resolveModalSnapshot();
  });

  // ==================== 悬浮面板覆盖层 ====================
  ipcMain.on(IPC_CHANNELS.PANEL_OVERLAY_SHOW, (event, payload) => {
    const wm = getWM();
    if (wm && wm.showPanelOverlay) wm.showPanelOverlay(payload || {});
  });

  // 覆盖层请求主窗口执行菜单事件（如收藏夹面板内添加书签/新建文件夹）
  ipcMain.on(IPC_CHANNELS.MENU_EVENT_REQUEST, (event, payload) => {
    if (!payload || !payload.action) return;
    sendMenuEvent(payload.action, payload.data || {});
  });

  ipcMain.on(IPC_CHANNELS.PANEL_OVERLAY_HIDE, () => {
    const wm = getWM();
    if (wm && wm.hidePanelOverlay) wm.hidePanelOverlay();
  });

  ipcMain.handle(IPC_CHANNELS.PANEL_OVERLAY_GET_ANCHOR, () => {
    const wm = getWM();
    return {
      anchor: wm ? wm.panelOverlayAnchor : null,
      contentOffsetY: 84,
      bookmarkFolderData: wm ? (wm._bookmarkFolderData || null) : null,
    };
  });

  // 网页点击通知 → 关闭悬浮面板（由注入脚本 notifyPanelClickOutside 触发）
  ipcMain.on(IPC_CHANNELS.PANEL_OVERLAY_CLICK_OUTSIDE, () => {
    const wm = getWM();
    if (wm && wm.hidePanelOverlay) wm.hidePanelOverlay();
  });

  // ==================== 标签页管理 ====================
  ipcMain.handle(IPC_CHANNELS.TAB_CREATE, (event, { url, active }) => {
    const wm = getWM();
    if (!wm) return null;
    const tabId = wm.createTab(url || INTERNAL_PAGES.NEW_TAB, active !== false);
    return tabId;
  });

  ipcMain.on(IPC_CHANNELS.TAB_CLOSE, (event, { tabId }) => {
    const wm = getWM();
    if (wm) wm.closeTab(tabId);
  });

  ipcMain.on(IPC_CHANNELS.TAB_SWITCH, (event, { tabId }) => {
    const wm = getWM();
    if (wm) wm.switchTab(tabId);
  });

  ipcMain.on(IPC_CHANNELS.TAB_REORDER, (event, { fromIndex, toIndex }) => {
    const wm = getWM();
    if (wm) {
      const [moved] = wm.tabs.splice(fromIndex, 1);
      wm.tabs.splice(toIndex, 0, moved);
      wm.syncTabsToRenderer();
      // 扩展 chrome.tabs.onMoved 事件
      if (moved) {
        try {
          const { notifyTabMoved } = require('./extensionBridge');
          notifyTabMoved(moved.id, fromIndex, toIndex);
        } catch (e) { /* 忽略 */ }
      }
    }
  });

  ipcMain.on(IPC_CHANNELS.TAB_PIN, (event, { tabId }) => {
    const wm = getWM();
    if (wm) {
      const tab = wm.tabs.find(t => t.id === tabId);
      if (tab) {
        tab.isPinned = !tab.isPinned;
        wm.syncTabsToRenderer();
      }
    }
  });

  ipcMain.on(IPC_CHANNELS.TAB_MUTE, (event, { tabId }) => {
    const wm = getWM();
    if (wm) {
      const tab = wm.tabs.find(t => t.id === tabId);
      if (tab && tab.view) {
        tab.isMuted = !tab.isMuted;
        tab.view.webContents.setAudioMuted(tab.isMuted);
        wm.syncTabsToRenderer();
      }
    }
  });

  ipcMain.on(IPC_CHANNELS.TAB_DUPLICATE, (event, { tabId }) => {
    const wm = getWM();
    if (wm) {
      const tab = wm.tabs.find(t => t.id === tabId);
      if (tab) {
        wm.createTab(tab.url);
      }
    }
  });

  ipcMain.on(IPC_CHANNELS.TAB_RELOAD, (event, { tabId, ignoreCache }) => {
    const wm = getWM();
    if (wm) {
      const tab = wm.tabs.find(t => t.id === (tabId || wm.activeTabId));
      if (tab && tab.view) {
        if (ignoreCache) {
          tab.view.webContents.reloadIgnoringCache();
        } else {
          tab.view.webContents.reload();
        }
      }
    }
  });

  ipcMain.handle(IPC_CHANNELS.TABS_GET_CURRENT, () => {
    const wm = getWM();
    if (!wm) return [];
    return wm.tabs
      .map(tab => ({ url: tab.url, title: tab.title || '', favicon: tab.favicon || '' }))
      .filter(t => t.url && !t.url.startsWith('neutron://'));
  });

  // ==================== 垂直标签栏 + 标签分组 ====================
  ipcMain.handle(IPC_CHANNELS.TAB_VERTICAL_TOGGLE, (event, enabled) => {
    const wm = getWM();
    if (!wm) return false;
    const target = typeof enabled === 'boolean' ? enabled : !wm.verticalTabs;
    wm.setVerticalTabs(target);
    return target;
  });

  ipcMain.handle(IPC_CHANNELS.TAB_GROUP_CREATE, (event, { tabIds, name, color }) => {
    const wm = getWM();
    if (!wm) return null;
    return wm.createTabGroup(tabIds, name, color);
  });

  ipcMain.on(IPC_CHANNELS.TAB_GROUP_ADD, (event, { groupId, tabIds }) => {
    const wm = getWM();
    if (wm) wm.addTabsToGroup(groupId, tabIds);
  });

  ipcMain.on(IPC_CHANNELS.TAB_GROUP_REMOVE, (event, { tabId }) => {
    const wm = getWM();
    if (wm) wm.removeTabFromGroup(tabId);
  });

  ipcMain.on(IPC_CHANNELS.TAB_GROUP_UNGROUP, (event, { groupId }) => {
    const wm = getWM();
    if (wm) wm.ungroupGroup(groupId);
  });

  ipcMain.on(IPC_CHANNELS.TAB_GROUP_TOGGLE, (event, { groupId }) => {
    const wm = getWM();
    if (wm) wm.toggleTabGroupCollapsed(groupId);
  });

  ipcMain.on(IPC_CHANNELS.TAB_GROUP_RENAME, (event, { groupId, name }) => {
    const wm = getWM();
    if (wm) wm.renameTabGroup(groupId, name);
  });

  ipcMain.on(IPC_CHANNELS.TAB_GROUP_SET_COLOR, (event, { groupId, color }) => {
    const wm = getWM();
    if (wm) wm.setTabGroupColor(groupId, color);
  });

  ipcMain.on(IPC_CHANNELS.TAB_GROUP_CLOSE, (event, { groupId }) => {
    const wm = getWM();
    if (wm) wm.closeTabGroup(groupId);
  });

  // ==================== 分屏 ====================
  ipcMain.on(IPC_CHANNELS.SPLIT_SET, (event, { tabId }) => {
    const wm = getWM();
    if (wm) wm.setSplitTab(tabId || null);
  });

  // ==================== 侧边栏 ====================
  ipcMain.handle(IPC_CHANNELS.SIDEBAR_TOGGLE, (event, enabled) => {
    const wm = getWM();
    if (!wm) return false;
    const target = typeof enabled === 'boolean' ? enabled : !wm.sidebarOpen;
    wm.setSidebarOpen(target);
    return target;
  });

  // ==================== 导航 ====================
  ipcMain.on(IPC_CHANNELS.NAV_GO, (event, { url }) => {
    const wm = getWM();
    if (wm) {
      const resolvedUrl = wm.resolveUrl(url);
      const activeTab = wm.tabs.find(t => t.id === wm.activeTabId);
      if (activeTab && activeTab.view) {
        activeTab.view.webContents.loadURL(resolvedUrl);
        activeTab.url = resolvedUrl;
        wm.syncTabsToRenderer();
      } else {
        wm.createTab(resolvedUrl);
      }
    }
  });

  ipcMain.on(IPC_CHANNELS.NAV_BACK, () => {
    const wm = getWM();
    if (wm) {
      const activeTab = wm.tabs.find(t => t.id === wm.activeTabId);
      if (activeTab && activeTab.view && activeTab.view.webContents.canGoBack()) {
        activeTab.view.webContents.goBack();
      }
    }
  });

  ipcMain.on(IPC_CHANNELS.NAV_FORWARD, () => {
    const wm = getWM();
    if (wm) {
      const activeTab = wm.tabs.find(t => t.id === wm.activeTabId);
      if (activeTab && activeTab.view && activeTab.view.webContents.canGoForward()) {
        activeTab.view.webContents.goForward();
      }
    }
  });

  ipcMain.on(IPC_CHANNELS.NAV_REFRESH, () => {
    const wm = getWM();
    if (wm) {
      const activeTab = wm.tabs.find(t => t.id === wm.activeTabId);
      if (activeTab && activeTab.view) activeTab.view.webContents.reload();
    }
  });

  ipcMain.on(IPC_CHANNELS.NAV_STOP, () => {
    const wm = getWM();
    if (wm) {
      const activeTab = wm.tabs.find(t => t.id === wm.activeTabId);
      if (activeTab && activeTab.view) activeTab.view.webContents.stop();
    }
  });

  ipcMain.on(IPC_CHANNELS.NAV_HOME, () => {
    const wm = getWM();
    if (wm) {
      const settings = getStore('settings');
      const homePage = settings.get('homePage', 'https://www.google.com');
      const homeButtonTarget = settings.get('homeButtonTarget', 'custom');
      const targetUrl = homeButtonTarget === 'newtab' ? INTERNAL_PAGES.NEW_TAB : homePage;
      const activeTab = wm.tabs.find(t => t.id === wm.activeTabId);
      if (activeTab && activeTab.view) {
        activeTab.view.webContents.loadURL(targetUrl);
      }
    }
  });

  // 阅读模式（沉浸式阅读器）切换
  ipcMain.handle(IPC_CHANNELS.READER_TOGGLE, async () => {
    const wm = getWM();
    if (!wm) return { ok: false, reason: 'no-window' };
    const { toggleReader } = require('./reader');
    try {
      return await toggleReader(wm);
    } catch (e) {
      return { ok: false, reason: (e && e.message) || 'error' };
    }
  });

  // ==================== 书签 ====================
  ipcMain.handle(IPC_CHANNELS.BOOKMARKS_GET_ALL, () => {
    return getStore('bookmarks').getAll();
  });

  ipcMain.on(IPC_CHANNELS.BOOKMARKS_CONTEXT_MENU, (event, payload) => {
    const wm = getWM();
    if (!wm || !wm.mainWindow || !payload || !payload.bookmark) return;

    const bookmark = payload.bookmark;
    const template = [
      { label: '在新标签页中打开', click: () => wm.createTab(bookmark.url) },
      { label: '在新标签页中后台打开', click: () => wm.createTab(bookmark.url, false) },
      { type: 'separator' },
      {
        label: '新建文件夹',
        click: () => sendMenuEvent('createBookmarkFolder', {
          parentId: bookmark.parentId || 'bookmark_bar',
        }),
      },
      {
        label: '编辑',
        click: () => wm.mainWindow.webContents.send(IPC_CHANNELS.MENU_EVENT, {
          action: 'editBookmark',
          bookmark,
        }),
      },
      {
        label: '删除',
        click: () => wm.mainWindow.webContents.send(IPC_CHANNELS.MENU_EVENT, {
          action: 'deleteBookmark',
          bookmarkId: bookmark.id,
        }),
      },
      { type: 'separator' },
      {
        label: '复制链接地址',
        enabled: Boolean(bookmark.url),
        click: () => clipboard.writeText(bookmark.url),
      },
    ];

    const menu = Menu.buildFromTemplate(template);
    menu.popup({ window: wm.mainWindow });
  });

  ipcMain.on(IPC_CHANNELS.BOOKMARKS_FOLDER_MENU, (event, payload) => {
    const wm = getWM();
    if (!wm || !wm.mainWindow || !payload || !payload.folder) return;

    const folder = payload.folder;
    const buildItems = (parent) => {
      return (parent.children || []).map(child => ({
        id: child.id,
        title: child.title || (child.type === 'folder' ? '未命名文件夹' : '未命名书签'),
        url: child.url || '',
        favicon: child.favicon || '',
        type: child.type,
        children: child.type === 'folder' ? buildItems(child) : [],
      }));
    };

    // 使用面板叠加层替代 setModalVisible，避免视频冻结
    wm._bookmarkFolderData = {
      folderId: folder.id,
      folderTitle: folder.title || '未命名文件夹',
      x: payload.x,
      y: payload.y,
      items: buildItems(folder),
    };
    wm.showPanelOverlay({
      type: 'bookmarkFolder',
      anchor: { left: payload.x, top: payload.y, right: payload.x + 10, bottom: payload.y + 10, width: 10, height: 10 },
    });
  });

  // 书签跨窗口拖拽状态
  ipcMain.on(IPC_CHANNELS.BOOKMARK_DRAG_SET, (event, id) => {
    const wm = getWM();
    if (wm) wm._draggedBookmarkId = id || null;
  });
  ipcMain.on(IPC_CHANNELS.BOOKMARK_DRAG_CLEAR, () => {
    const wm = getWM();
    if (wm) wm._draggedBookmarkId = null;
  });
  ipcMain.handle(IPC_CHANNELS.BOOKMARK_DRAG_GET, () => {
    const wm = getWM();
    return wm ? (wm._draggedBookmarkId || null) : null;
  });

  // 刷新打开的文件夹弹出菜单（书签移动后实时更新）
  ipcMain.on(IPC_CHANNELS.BOOKMARK_FOLDER_REFRESH, (event, folderId) => {
    const wm = getWM();
    if (wm && wm.refreshBookmarkFolderPopup) wm.refreshBookmarkFolderPopup(folderId);
  });

  // 书签已变更（叠加层移动书签后，通知主窗口刷新书签栏）
  ipcMain.on(IPC_CHANNELS.BOOKMARKS_CHANGED, () => {
    const wm = getWM();
    if (wm && wm.mainWindow && !wm.mainWindow.isDestroyed()) {
      wm.mainWindow.webContents.send(IPC_CHANNELS.BOOKMARKS_REFRESH);
    }
  });

  ipcMain.on(IPC_CHANNELS.BOOKMARKS_FOLDER_CONTEXT_MENU, (event, payload) => {
    const wm = getWM();
    if (!wm || !wm.mainWindow || !payload || !payload.folder) return;

    const folder = payload.folder;
    const template = [
      {
        label: '新建书签',
        click: () => sendMenuEvent('addBookmarkToFolder', { folderId: folder.id }),
      },
      {
        label: '新建文件夹',
        click: () => sendMenuEvent('createBookmarkFolder', { parentId: folder.id }),
      },
      { type: 'separator' },
      {
        label: '编辑文件夹',
        click: () => sendMenuEvent('editBookmarkFolder', {
          folder: { id: folder.id, title: folder.title },
        }),
      },
      {
        label: '删除文件夹',
        click: () => sendMenuEvent('deleteBookmarkFolder', { folderId: folder.id }),
      },
    ];

    const menu = Menu.buildFromTemplate(template);
    menu.popup({ window: wm.mainWindow, x: payload.x, y: payload.y });
  });

  ipcMain.on(IPC_CHANNELS.BOOKMARKS_BAR_CONTEXT_MENU, (event, payload) => {
    const wm = getWM();
    if (!wm || !wm.mainWindow || !payload) return;

    const template = [
      {
        label: '新建书签',
        click: () => sendMenuEvent('addBookmarkToFolder', { folderId: 'bookmark_bar' }),
      },
      {
        label: '新建文件夹',
        click: () => sendMenuEvent('createBookmarkFolder', { parentId: 'bookmark_bar' }),
      },
    ];

    const menu = Menu.buildFromTemplate(template);
    menu.popup({ window: wm.mainWindow, x: payload.x, y: payload.y });
  });

  ipcMain.handle(IPC_CHANNELS.BOOKMARKS_ADD, (event, bookmark) => {
    const store = getStore('bookmarks');
    const data = store.getAll();
    const input = bookmark || {};
    const isFolder = input.type === 'folder';

    const newBookmark = {
      id: `bm_${Date.now()}`,
      title: input.title || (isFolder ? '未命名文件夹' : '未命名书签'),
      url: isFolder ? '' : (input.url || ''),
      type: isFolder ? 'folder' : 'bookmark',
      parentId: input.parentId || 'bookmark_bar',
      dateAdded: Date.now(),
      favicon: input.favicon || '',
    };
    if (isFolder) newBookmark.children = [];

    // 添加到指定父文件夹
    const addToFolder = (folder) => {
      if (folder.id === newBookmark.parentId) {
        if (!folder.children) folder.children = [];
        folder.children.push(newBookmark);
        return true;
      }
      if (folder.children) {
        for (const child of folder.children) {
          if (child.type === 'folder' && addToFolder(child)) return true;
        }
      }
      return false;
    };

    // 遍历根节点
    for (const key of Object.keys(data)) {
      if (data[key].type === 'folder' && addToFolder(data[key])) break;
    }

    store.set('bookmark_bar', data.bookmark_bar);
    store.set('other', data.other);
    store.set('mobile', data.mobile);
    return newBookmark;
  });

  ipcMain.handle(IPC_CHANNELS.BOOKMARKS_UPDATE, (event, { id, bookmark }) => {
    const store = getStore('bookmarks');
    const data = store.getAll();

    const findItem = (folder, itemId) => {
      if (!folder || !folder.children) return null;
      const index = folder.children.findIndex(child => child.id === itemId);
      if (index !== -1) return { folder, index };
      for (const child of folder.children) {
        if (child.type === 'folder') {
          const found = findItem(child, itemId);
          if (found) return found;
        }
      }
      return null;
    };

    const findFolder = (folder, folderIdToFind) => {
      if (!folder) return null;
      if (folder.id === folderIdToFind) return folder;
      for (const child of (folder.children || [])) {
        if (child.type === 'folder') {
          const found = findFolder(child, folderIdToFind);
          if (found) return found;
        }
      }
      return null;
    };

    const isDescendantOf = (folder, candidateId) => {
      if (!folder) return false;
      if (folder.id === candidateId) return true;
      return (folder.children || []).some(child =>
        child.type === 'folder' && isDescendantOf(child, candidateId)
      );
    };

    let source = null;
    for (const key of Object.keys(data)) {
      if (data[key].type !== 'folder') continue;
      source = source || findItem(data[key], id);
    }

    if (!source) return false;

    const item = source.folder.children[source.index];
    const input = bookmark || {};
    const updates = { ...input };
    delete updates.parentId;

    Object.assign(item, updates, { id: item.id, type: item.type });
    if (item.type === 'folder' && !Array.isArray(item.children)) {
      item.children = [];
    }

    const newParentId = input.parentId;
    if (newParentId && newParentId !== source.folder.id) {
      let targetFolder = null;
      for (const key of Object.keys(data)) {
        if (data[key].type !== 'folder') continue;
        targetFolder = targetFolder || findFolder(data[key], newParentId);
      }

      const canMove = targetFolder &&
        targetFolder.id !== item.id &&
        !(item.type === 'folder' && isDescendantOf(item, targetFolder.id));

      if (canMove) {
        source.folder.children.splice(source.index, 1);
        item.parentId = targetFolder.id;
        if (!Array.isArray(targetFolder.children)) targetFolder.children = [];
        targetFolder.children.push(item);
      }
    }

    store.set('bookmark_bar', data.bookmark_bar);
    store.set('other', data.other);
    store.set('mobile', data.mobile);
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.BOOKMARKS_MOVE, (event, { id, targetId, folderId, position }) => {
    const store = getStore('bookmarks');
    const data = store.getAll();

    const findItem = (folder, itemId) => {
      if (!folder || !folder.children) return null;
      const index = folder.children.findIndex(child => child.id === itemId);
      if (index !== -1) return { folder, index };
      for (const child of folder.children) {
        if (child.type === 'folder') {
          const found = findItem(child, itemId);
          if (found) return found;
        }
      }
      return null;
    };

    const findFolder = (folder, folderIdToFind) => {
      if (!folder) return null;
      if (folder.id === folderIdToFind) return folder;
      for (const child of (folder.children || [])) {
        if (child.type === 'folder') {
          const found = findFolder(child, folderIdToFind);
          if (found) return found;
        }
      }
      return null;
    };

    const isDescendantOf = (folder, candidateId) => {
      if (!folder) return false;
      if (folder.id === candidateId) return true;
      return (folder.children || []).some(child =>
        child.type === 'folder' && isDescendantOf(child, candidateId)
      );
    };

    let source = null;
    for (const key of Object.keys(data)) {
      if (data[key].type !== 'folder') continue;
      source = source || findItem(data[key], id);
    }

    if (!source) return false;
    const moved = source.folder.children[source.index];

    if (folderId) {
      let targetFolder = null;
      for (const key of Object.keys(data)) {
        if (data[key].type !== 'folder') continue;
        targetFolder = targetFolder || findFolder(data[key], folderId);
      }

      if (!targetFolder || targetFolder.id === moved.id) return false;
      if (moved.type === 'folder' && isDescendantOf(moved, targetFolder.id)) return false;

      source.folder.children.splice(source.index, 1);
      moved.parentId = targetFolder.id;
      if (!Array.isArray(targetFolder.children)) targetFolder.children = [];
      targetFolder.children.push(moved);

      for (const key of Object.keys(data)) {
        store.set(key, data[key]);
      }
      return true;
    }

    let target = null;
    for (const key of Object.keys(data)) {
      if (data[key].type !== 'folder') continue;
      target = target || findItem(data[key], targetId);
    }

    if (!target || source.index === target.index && source.folder === target.folder) {
      return false;
    }

    source.folder.children.splice(source.index, 1);
    const insertIndex = target.folder.children.findIndex(child => child.id === targetId);

    if (insertIndex === -1) {
      source.folder.children.splice(source.index, 0, moved);
      return false;
    }

    const finalIndex = position === 'after' ? insertIndex + 1 : insertIndex;
    if (source.folder !== target.folder) {
      moved.parentId = target.folder.id;
    }
    target.folder.children.splice(finalIndex, 0, moved);

    for (const key of Object.keys(data)) {
      store.set(key, data[key]);
    }
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.BOOKMARKS_REMOVE, (event, bookmarkId) => {
    const store = getStore('bookmarks');
    const data = store.getAll();

    const removeFromFolder = (folder) => {
      if (!folder.children) return false;
      const idx = folder.children.findIndex(c => c.id === bookmarkId);
      if (idx !== -1) {
        folder.children.splice(idx, 1);
        return true;
      }
      for (const child of folder.children) {
        if (child.type === 'folder' && removeFromFolder(child)) return true;
      }
      return false;
    };

    for (const key of Object.keys(data)) {
      if (data[key].type === 'folder' && removeFromFolder(data[key])) break;
    }

    store.set('bookmark_bar', data.bookmark_bar);
    store.set('other', data.other);
    store.set('mobile', data.mobile);
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.BOOKMARKS_IS_BOOKMARKED, (event, url) => {
    const store = getStore('bookmarks');
    const data = store.getAll();

    const findInFolder = (folder) => {
      if (!folder.children) return false;
      for (const child of folder.children) {
        if (child.type === 'bookmark' && child.url === url) return true;
        if (child.type === 'folder' && findInFolder(child)) return true;
      }
      return false;
    };

    for (const key of Object.keys(data)) {
      if (data[key].type === 'folder' && findInFolder(data[key])) return true;
    }
    return false;
  });

  ipcMain.handle(IPC_CHANNELS.BOOKMARKS_IMPORT, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: '书签文件', extensions: ['html', 'htm'] }],
    });
    if (result.canceled || !result.filePaths || !result.filePaths[0]) {
      return { success: false, message: '用户取消' };
    }
    try {
      const html = fs.readFileSync(result.filePaths[0], 'utf-8');
      const imported = parseNetscapeBookmarks(html);
      if (imported.length === 0) {
        return { success: false, message: '未找到可导入的书签' };
      }

      const store = getStore('bookmarks');
      const data = store.getAll();
      const rootMap = { '书签栏': 'bookmark_bar', '其他书签': 'other', '移动设备书签': 'mobile' };
      let added = 0;

      const appendImported = (parentFolder, items) => {
        if (!parentFolder.children) parentFolder.children = [];
        for (const item of items) {
          if (item.type === 'folder') {
            const node = {
              id: genBookmarkId(),
              title: item.title || '未命名文件夹',
              type: 'folder',
              parentId: parentFolder.id,
              dateAdded: Date.now(),
              favicon: '',
              children: [],
            };
            parentFolder.children.push(node);
            added++;
            appendImported(node, item.children || []);
          } else if (item.url) {
            parentFolder.children.push({
              id: genBookmarkId(),
              title: item.title || item.url,
              type: 'bookmark',
              url: item.url,
              parentId: parentFolder.id,
              dateAdded: Date.now(),
              favicon: '',
            });
            added++;
          }
        }
      };

      // 顶层文件夹按名称合并到根分区，其余作为新文件夹/书签加入书签栏
      for (const item of imported) {
        if (item.type === 'folder' && rootMap[item.title]) {
          const rootKey = rootMap[item.title];
          if (!data[rootKey]) {
            data[rootKey] = { id: rootKey, title: item.title, type: 'folder', children: [] };
          }
          appendImported(data[rootKey], item.children || []);
        } else {
          appendImported(data.bookmark_bar, [item]);
        }
      }

      for (const key of Object.keys(data)) store.set(key, data[key]);

      // 通知主窗口刷新书签栏
      const wm = global.windowManager;
      if (wm && wm.mainWindow && !wm.mainWindow.isDestroyed()) {
        wm.mainWindow.webContents.send(IPC_CHANNELS.BOOKMARKS_REFRESH);
      }
      return { success: true, message: `已导入 ${added} 个收藏夹项`, added };
    } catch (e) {
      return { success: false, message: '导入失败: ' + ((e && e.message) || e) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.BOOKMARKS_EXPORT, async () => {
    const result = await dialog.showSaveDialog({
      filters: [{ name: '书签文件', extensions: ['html'] }],
      defaultPath: 'bookmarks.html',
    });
    if (result.canceled || !result.filePath) {
      return { success: false, message: '用户取消' };
    }
    try {
      const data = getStore('bookmarks').getAll();
      const html = buildNetscapeBookmarksHtml(data);
      fs.writeFileSync(result.filePath, html, 'utf-8');
      return { success: true, message: '已导出到 ' + result.filePath };
    } catch (e) {
      return { success: false, message: '导出失败: ' + ((e && e.message) || e) };
    }
  });

  // 删除重复书签（按 URL 去重，保留首次出现的）
  ipcMain.handle(IPC_CHANNELS.BOOKMARKS_REMOVE_DUPLICATES, () => {
    const store = getStore('bookmarks');
    const data = store.getAll();
    const seen = new Set();
    const duplicateIds = [];

    const collect = (folder) => {
      if (!folder || !folder.children) return;
      for (const child of folder.children) {
        if (child.type === 'bookmark') {
          const url = String(child.url || '').trim();
          if (url) {
            if (seen.has(url)) {
              duplicateIds.push(child.id);
            } else {
              seen.add(url);
            }
          }
        } else if (child.type === 'folder') {
          collect(child);
        }
      }
    };

    const remove = (folder) => {
      if (!folder || !folder.children) return;
      folder.children = folder.children.filter((child) => {
        if (child.type === 'bookmark' && duplicateIds.includes(child.id)) return false;
        return true;
      });
      for (const child of folder.children) {
        if (child.type === 'folder') remove(child);
      }
    };

    for (const key of Object.keys(data)) {
      if (data[key] && data[key].type === 'folder') collect(data[key]);
    }
    for (const key of Object.keys(data)) {
      if (data[key] && data[key].type === 'folder') remove(data[key]);
    }
    for (const key of Object.keys(data)) store.set(key, data[key]);

    const wm = global.windowManager;
    if (wm && wm.mainWindow && !wm.mainWindow.isDestroyed()) {
      wm.mainWindow.webContents.send(IPC_CHANNELS.BOOKMARKS_REFRESH);
    }
    return { success: true, removed: duplicateIds.length };
  });

  // ==================== 网站图标解析（书签对话框「识别网址图标」用） ====================
  // host → 已解析真实图标（主进程内存缓存；解析失败也缓存空值避免反复抓取）
  const resolvedFaviconCache = new Map();

  ipcMain.handle(IPC_CHANNELS.FAVICON_RESOLVE, async (event, { url } = {}) => {
    try {
      if (!url || !/^https?:\/\//i.test(url)) return { favicon: '' };
      const parsed = new URL(url);
      const host = parsed.hostname;
      if (!host) return { favicon: '' };
      if (resolvedFaviconCache.has(host)) {
        return { favicon: resolvedFaviconCache.get(host) };
      }

      // 主进程抓取页面 HTML 解析 <link rel="icon">（Node fetch 无 CORS 限制）
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      let html = '';
      let fetchedOk = false;
      try {
        const res = await fetch(url, {
          signal: controller.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
            Accept: 'text/html,application/xhtml+xml',
          },
        });
        if (res && res.ok) {
          fetchedOk = true;
          const text = await res.text();
          html = typeof text === 'string' ? text.slice(0, 300000) : '';
        }
      } catch (e) { /* 抓取失败：返回空，渲染层走候选链 */ }
      clearTimeout(timer);

      // 页面抓取成功才解析；解析不到才回退站点根 /favicon.ico。
      // 抓取失败时返回空——避免根目录兜底覆盖渲染层知识库中更准确的真实图标
      const favicon = fetchedOk
        ? (parseFaviconFromHtml(html, parsed.href) || `${parsed.origin}/favicon.ico`)
        : '';
      resolvedFaviconCache.set(host, favicon);
      return { favicon };
    } catch (e) {
      return { favicon: '' };
    }
  });

  // ==================== 历史记录 ====================
  ipcMain.handle(IPC_CHANNELS.HISTORY_GET_ALL, () => {
    return getStore('history').get('visits', []);
  });

  ipcMain.handle(IPC_CHANNELS.HISTORY_SEARCH, (event, query) => {
    const visits = getStore('history').get('visits', []);
    const q = query.toLowerCase();
    return visits.filter(v =>
      v.title.toLowerCase().includes(q) || v.url.toLowerCase().includes(q)
    );
  });

  ipcMain.on(IPC_CHANNELS.HISTORY_ADD, (event, { url, title, favicon }) => {
    const store = getStore('history');
    const visits = store.get('visits', []);
    const safeTitle = normalizeHistoryTitle(title, url);
    const safeFavicon = sanitizeFavicon(favicon, url);

    // 查找今天是否已有相同 URL 的记录
    const today = new Date().toDateString();
    const existing = visits.find(v =>
      v.url === url && new Date(v.lastVisitTime).toDateString() === today
    );

    if (existing) {
      existing.visitCount = (existing.visitCount || 1) + 1;
      existing.lastVisitTime = Date.now();
      existing.title = safeTitle;
      existing.favicon = safeFavicon || sanitizeFavicon(existing.favicon, url);
    } else {
      visits.unshift({
        id: `hist_${Date.now()}`,
        url,
        title: safeTitle,
        favicon: safeFavicon,
        visitCount: 1,
        firstVisitTime: Date.now(),
        lastVisitTime: Date.now(),
      });
    }

    // 限制历史记录数量
    if (visits.length > 10000) {
      visits.splice(10000);
    }

    store.set('visits', visits);
  });

  ipcMain.on(IPC_CHANNELS.HISTORY_CLEAR, () => {
    getStore('history').set('visits', []);
  });

  ipcMain.on(IPC_CHANNELS.HISTORY_DELETE_ITEM, (event, { id }) => {
    const store = getStore('history');
    const visits = store.get('visits', []);
    store.set('visits', visits.filter(v => v.id !== id));
  });

  ipcMain.handle(IPC_CHANNELS.HISTORY_GET_RECENT_CLOSED, () => {
    const wm = getWM();
    return wm ? wm.getRecentlyClosed() : [];
  });

  ipcMain.handle(IPC_CHANNELS.HISTORY_RESTORE_RECENT_CLOSED, (event, { id }) => {
    const wm = getWM();
    return wm ? wm.restoreRecentlyClosed(id) : false;
  });

  // ==================== 下载 ====================
  const resolveDownloadPath = (item) => {
    if (!item || !item.filename) return '';
    if (item.savePath && fs.existsSync(item.savePath)) return item.savePath;

    const settings = getStore('settings');
    const downloadDir = settings.get('downloadPath') || app.getPath('downloads');
    const candidate = path.join(downloadDir, item.filename);
    return fs.existsSync(candidate) ? candidate : '';
  };

  ipcMain.handle(IPC_CHANNELS.DOWNLOADS_GET_ALL, () => {
    return getStore('downloads').get('items', []);
  });

  // 获取文件真实系统图标（资源管理器风格），文件不存在返回 null（渲染层用类型 SVG 兜底）
  ipcMain.handle(IPC_CHANNELS.DOWNLOADS_GET_FILE_ICON, async (event, { id }) => {
    const items = getStore('downloads').get('items', []);
    const item = items.find(d => d.id === id);
    const savePath = resolveDownloadPath(item);
    if (!savePath) return null;
    try {
      const icon = await app.getFileIcon(savePath, { size: 'normal' });
      if (icon && !icon.isEmpty()) return icon.toDataURL();
    } catch (e) { /* 忽略：返回 null 用 SVG 兜底 */ }
    return null;
  });

  ipcMain.handle(IPC_CHANNELS.DOWNLOADS_PAUSE, (event, { id }) => {
    const wm = getWM();
    if (wm && wm.pauseDownload) wm.pauseDownload(id);
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.DOWNLOADS_RESUME, (event, { id }) => {
    const wm = getWM();
    if (wm && wm.resumeDownload) wm.resumeDownload(id);
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.DOWNLOADS_CANCEL, (event, { id }) => {
    const wm = getWM();
    if (wm && wm.cancelDownload) wm.cancelDownload(id);
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.DOWNLOADS_RETRY, (event, { id }) => {
    const wm = getWM();
    return wm && wm.retryDownload ? wm.retryDownload(id) : false;
  });

  ipcMain.handle(IPC_CHANNELS.CLIPBOARD_COPY, (event, text) => {
    clipboard.writeText(String(text || ''));
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.CLIPBOARD_READ, () => clipboard.readText() || '');

  // 地址栏编辑命令（作用于主窗口 webContents 当前聚焦元素 = 地址栏输入框）
  ipcMain.handle(IPC_CHANNELS.ADDRESSBAR_EDIT, (event, command) => {
    const wm = getWM();
    const wc = wm && wm.mainWindow && wm.mainWindow.webContents;
    if (!wc) return false;
    const methods = {
      undo: 'undo',
      redo: 'redo',
      cut: 'cut',
      copy: 'copy',
      paste: 'paste',
      delete: 'delete',
      selectAll: 'selectAll',
    };
    const method = methods[command];
    if (method && typeof wc[method] === 'function') {
      wc[method]();
      return true;
    }
    return false;
  });

  // 打开系统表情面板（模拟 Win+句点 组合键）
  ipcMain.handle(IPC_CHANNELS.ADDRESSBAR_OPEN_EMOJI, () => {
    try {
      const script = [
        "Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class NK{[DllImport(\"user32.dll\")]public static extern void keybd_event(byte bVk,byte bScan,uint dwFlags,IntPtr dwExtraInfo);}';",
        '[NK]::keybd_event(0x5B,0,0,[IntPtr]::Zero);',
        '[NK]::keybd_event(0xBE,0,0,[IntPtr]::Zero);',
        '[NK]::keybd_event(0xBE,0,2,[IntPtr]::Zero);',
        '[NK]::keybd_event(0x5B,0,2,[IntPtr]::Zero);',
      ].join('');
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], (err) => {
        if (err) console.error('[Main] 打开表情面板失败:', err.message);
      });
      return true;
    } catch (e) {
      console.error('[Main] 打开表情面板失败:', e);
      return false;
    }
  });

  ipcMain.handle(IPC_CHANNELS.DOWNLOADS_OPEN_FOLDER, (event, { id }) => {
    const items = getStore('downloads').get('items', []);
    const item = items.find(d => d.id === id);
    const savePath = resolveDownloadPath(item);
    if (!savePath) {
      return { ok: false, error: '文件不存在' };
    }
    shell.showItemInFolder(savePath);
    return { ok: true };
  });

  ipcMain.handle(IPC_CHANNELS.DOWNLOADS_OPEN_FILE, async (event, { id }) => {
    const items = getStore('downloads').get('items', []);
    const item = items.find(d => d.id === id);
    const savePath = resolveDownloadPath(item);
    if (!savePath) {
      return { ok: false, error: '文件不存在' };
    }
    const err = await shell.openPath(savePath);
    if (err) {
      // 打开失败（常见于 .exe 被占用/杀软锁定等）：自动定位到所在文件夹，
      // 避免用户点击后「没反应」
      shell.showItemInFolder(savePath);
      return { ok: false, error: err, fallback: true };
    }
    return { ok: true };
  });

  ipcMain.handle(IPC_CHANNELS.DOWNLOADS_OPEN_DIRECTORY, () => {
    const settings = getStore('settings');
    const downloadPath = settings.get('downloadPath') || app.getPath('downloads');
    shell.openPath(downloadPath);
    return downloadPath;
  });

  ipcMain.handle(IPC_CHANNELS.DOWNLOADS_DELETE, (event, { id }) => {
    const store = getStore('downloads');
    const items = store.get('items', []);
    const item = items.find(d => d.id === id);
    if (item) {
      item.deleted = true;
      item.state = 'deleted';
      item.endTime = Date.now();
      store.set('items', items);
    }
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.DOWNLOADS_CLEAR_COMPLETED, () => {
    const store = getStore('downloads');
    const items = store.get('items', []);
    store.set('items', items.filter(d => d.state !== 'completed' && d.state !== 'deleted'));
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.DOWNLOADS_CLEAR_ALL, () => {
    getStore('downloads').set('items', []);
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.DOWNLOADS_SET_PATH, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: '选择下载目录',
    });
    if (!result.canceled && result.filePaths.length > 0) {
      const downloadPath = result.filePaths[0];
      getStore('settings').set('downloadPath', downloadPath);
      return downloadPath;
    }
    return null;
  });

  // ==================== 设置 ====================
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, (event, key) => {
    return getStore('settings').get(key);
  });

  ipcMain.on(IPC_CHANNELS.SETTINGS_SET, (event, { key, value }) => {
    getStore('settings').set(key, value);
    if (key === 'launchAtLogin') {
      app.setLoginItemSettings({ openAtLogin: value === true });
    }
    const wm = getWM();
    if (wm && wm.mainWindow && !wm.mainWindow.isDestroyed()) {
      wm.mainWindow.webContents.send(IPC_CHANNELS.SETTINGS_CHANGED, { key, value });
    }
  });

  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET_ALL, () => {
    return getStore('settings').getAll();
  });

  // ==================== 验证码（真实发送） ====================
  ipcMain.handle(IPC_CHANNELS.VERIFY_CODE_SEND, async (event, account) => {
    return sendVerifyCode(account);
  });

  ipcMain.handle(IPC_CHANNELS.VERIFY_CODE_CHECK, (event, { account, code }) => {
    return checkVerifyCode(account, code);
  });

  // ==================== 主题 ====================
  ipcMain.handle(IPC_CHANNELS.THEME_GET, () => {
    return getStore('settings').get('theme', 'system');
  });

  ipcMain.on(IPC_CHANNELS.THEME_SET, (event, theme) => {
    getStore('settings').set('theme', theme);
    const wm = getWM();
    if (wm && wm.mainWindow && !wm.mainWindow.isDestroyed()) {
      wm.mainWindow.webContents.send(IPC_CHANNELS.THEME_CHANGED, theme);
    }
  });

  // ==================== 扩展 ====================
  // 计算目录大小（字节）
  function getDirectorySize(dir) {
    let total = 0;
    const walk = (d) => {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.isFile()) total += fs.statSync(full).size;
      }
    };
    try { walk(dir); } catch (e) { /* 忽略 */ }
    return total;
  }

  ipcMain.handle(IPC_CHANNELS.EXTENSIONS_GET_ALL, () => {
    const extensions = getInstalledExtensions();
    // 补充详情字段（主页、站点权限、大小）——manifest 实时读取，无需重装扩展
    return extensions.map((ext) => {
      const enriched = { ...ext };
      try {
        if (ext.path && fs.existsSync(path.join(ext.path, 'manifest.json'))) {
          const manifest = JSON.parse(fs.readFileSync(path.join(ext.path, 'manifest.json'), 'utf8'));
          enriched.homepageUrl = manifest.homepage_url || manifest.homepage || '';
          enriched.hostPermissions = Array.isArray(manifest.host_permissions) ? manifest.host_permissions : [];
          enriched.optionsUrl = manifest.options_page || (manifest.options_ui && manifest.options_ui.page) || '';
          enriched.size = getDirectorySize(ext.path);
        }
      } catch (e) { /* 忽略 */ }
      return enriched;
    });
  });

  ipcMain.handle(IPC_CHANNELS.EXTENSIONS_INSTALL, async () => {
    // 开发者模式关闭时禁止侧载（对齐 Edge：商店外安装需要开发者模式）
    if (!isDeveloperMode()) {
      return { success: false, message: '开发者模式未开启，请在扩展管理页开启“开发者模式”后重试' };
    }
    const result = await dialog.showOpenDialog({
      title: '安装扩展',
      properties: ['openFile'],
      filters: [
        { name: '扩展包', extensions: ['crx', 'zip'] },
      ],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, message: '用户取消' };
    }

    try {
      const extension = await installExtensionFile(result.filePaths[0]);
      broadcastExtensionsChanged();
      return { success: true, extension };
    } catch (e) {
      return { success: false, message: e.message };
    }
  });

  // 拖放/指定文件路径安装扩展（.crx / .zip）
  ipcMain.handle(IPC_CHANNELS.EXTENSIONS_INSTALL_FILE, async (event, { path: filePath }) => {
    if (!filePath || typeof filePath !== 'string') {
      return { success: false, message: '无效的文件路径' };
    }
    if (!isDeveloperMode()) {
      return { success: false, message: '开发者模式未开启，请在扩展管理页开启“开发者模式”后重试' };
    }
    try {
      const extension = await installExtensionFile(filePath);
      broadcastExtensionsChanged();
      return { success: true, extension };
    } catch (e) {
      return { success: false, message: e.message || '安装失败' };
    }
  });

  // ==================== 扩展包拖放安装（Edge 式全窗口拦截） ====================
  // 拖放 enter/leave/drop 可能来自：主窗口渲染层 chrome 区域、网页预加载脚本（polyfill-webnav.js）、
  // 拖放提示覆盖层自身。主进程统一计数并管理全窗提示覆盖层，drop 时转发路径给主窗口执行安装。
  ipcMain.on(IPC_CHANNELS.EXTENSIONS_DRAG_ENTER, () => {
    const wm = getWM();
    if (wm && typeof wm.handleExtensionDragEnter === 'function') {
      wm.handleExtensionDragEnter();
    }
  });

  ipcMain.on(IPC_CHANNELS.EXTENSIONS_DRAG_LEAVE, () => {
    const wm = getWM();
    if (wm && typeof wm.handleExtensionDragLeave === 'function') {
      wm.handleExtensionDragLeave();
    }
  });

  ipcMain.on(IPC_CHANNELS.EXTENSIONS_DRAG_DROP, (event, data) => {
    const wm = getWM();
    const filePath = data && (typeof data === 'string' ? data : data.path);
    if (wm && typeof wm.handleExtensionDragDrop === 'function') {
      wm.handleExtensionDragDrop(filePath);
    }
  });

  // 拖放诊断：渲染层（chrome 区 / 网页区 / 覆盖层）上报事件 → 写日志 → 回传主窗口弹提示
  ipcMain.on(IPC_CHANNELS.EXTENSIONS_DRAG_DEBUG, (event, payload) => {
    const p = payload && typeof payload === 'object' ? payload : {};
    logDrag(p.source || 'renderer', p.event || 'unknown', p);
    const wm = getWM();
    if (wm && wm.mainWindow && !wm.mainWindow.isDestroyed()) {
      wm.mainWindow.webContents.send(IPC_CHANNELS.EXTENSIONS_DRAG_DEBUG_EVENT, p);
    }
  });

  ipcMain.handle(IPC_CHANNELS.EXTENSIONS_INSTALL_UNPACKED, async () => {
    if (!isDeveloperMode()) {
      return { success: false, message: '开发者模式未开启，请在扩展管理页开启“开发者模式”后重试' };
    }
    const result = await dialog.showOpenDialog({
      title: '加载已解压的扩展',
      properties: ['openDirectory'],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, message: '用户取消' };
    }

    try {
      const extension = await installUnpackedExtension(result.filePaths[0]);
      broadcastExtensionsChanged();
      return { success: true, extension };
    } catch (e) {
      return { success: false, message: e.message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.EXTENSIONS_INSTALL_FROM_EDGE, async (event, input) => {
    try {
      const extension = await installFromEdgeStore(input);
      broadcastExtensionsChanged();
      return { success: true, extension };
    } catch (e) {
      return { success: false, message: e.message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.EXTENSIONS_TOGGLE, async (event, { id }) => {
    const extension = getInstalledExtensions().find(ext => ext.id === id);
    if (!extension) return { success: false, message: '扩展不存在' };

    try {
      const updated = await setExtensionEnabled(id, !extension.enabled);
      broadcastExtensionsChanged();
      return { success: true, extension: updated };
    } catch (e) {
      return { success: false, message: e.message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.EXTENSIONS_UNINSTALL, async (event, { id }) => {
    try {
      const result = await uninstallExtension(id);
      broadcastExtensionsChanged();
      return result;
    } catch (e) {
      return { success: false, message: e.message };
    }
  });

  // 工具栏扩展动作（图标/徽章/Popup）
  ipcMain.handle(IPC_CHANNELS.EXTENSIONS_GET_ACTIONS, () => {
    return getExtensionActions();
  });

  // 扩展后台通过 polyfill 设置徽章/标题 → 广播到主窗口工具栏
  ipcMain.on(IPC_CHANNELS.EXTENSIONS_ACTION_BADGE, (event, { id, patch }) => {
    if (!id || !patch) return;
    const badge = setExtensionBadge(id, patch);
    const wm = getWM();
    if (wm && wm.mainWindow && !wm.mainWindow.isDestroyed()) {
      wm.mainWindow.webContents.send(IPC_CHANNELS.EXTENSIONS_ACTION_CHANGED, badge);
    }
  });

  // 点击工具栏扩展图标（无 Popup 时）→ 触发扩展后台 onClicked
  ipcMain.on(IPC_CHANNELS.EXTENSIONS_ACTION_CLICKED, (event, { id }) => {
    if (!id) return;
    // on_click 访问模式：点击图标时授予当前标签页站点访问（activeTab 语义）
    const wm = getWM();
    const activeTab = wm && wm.tabs ? wm.tabs.find((t) => t.id === wm.activeTabId) : null;
    if (activeTab && activeTab.url) {
      grantSiteAccessOnClick(id, activeTab.url);
    }
    triggerExtensionActionClicked(id);
  });

  // 打开/关闭扩展 Popup 覆盖层
  ipcMain.handle(IPC_CHANNELS.EXTENSIONS_ACTION_OPEN_POPUP, async (event, payload) => {
    const wm = getWM();
    if (!wm || !wm.openExtensionPopup) return { ok: false, reason: 'no-window' };
    return await wm.openExtensionPopup(payload || {});
  });
  ipcMain.on(IPC_CHANNELS.EXTENSIONS_ACTION_HIDE_POPUP, () => {
    const wm = getWM();
    if (wm && wm.hideExtensionPopup) wm.hideExtensionPopup();
  });

  // 检查视图（打开扩展后台页/选项页 DevTools，对齐 Edge）
  ipcMain.on(IPC_CHANNELS.EXTENSIONS_INSPECT_VIEW, (event, { id, url }) => {
    if (!id) return;
    const wm = getWM();
    const { webContents } = require('electron');
    let target = findExtensionBackgroundWebContents(id);
    if (url) {
      target = webContents.getAllWebContents().find((wc) => {
        const u = wc.getURL();
        return u.includes(`chrome-extension://${id}/`) && url && u.includes(url);
      }) || target;
    }
    if (target && !target.isDestroyed()) {
      target.openDevTools({ mode: 'detach' });
      return;
    }
    // 未找到后台页：尝试通过窗口管理器打开选项页/默认页面检查
    if (wm && wm.openExtensionInspectView) wm.openExtensionInspectView(id);
  });

  // 触发扩展命令（由快捷键监听调用）
  ipcMain.on(IPC_CHANNELS.EXTENSIONS_COMMANDS, (event, { id, name }) => {
    if (!id || !name) return;
    triggerExtensionCommand(id, name);
  });

  // ==================== 扩展右键菜单（对齐 Edge：网站访问权限/固定/选项） ====================
  ipcMain.handle(IPC_CHANNELS.EXTENSIONS_GET_MENU_META, (event, { id }) => {
    return getExtensionMenuMeta(id);
  });

  ipcMain.handle(IPC_CHANNELS.EXTENSIONS_SET_SITE_ACCESS, (event, { id, mode, site }) => {
    try {
      const meta = setExtensionSiteAccess(id, mode, site);
      return { success: true, meta };
    } catch (e) {
      return { success: false, message: e.message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.EXTENSIONS_SET_PINNED, (event, { id, pinned }) => {
    try {
      const meta = setExtensionPinned(id, pinned);
      // 工具栏图标增删 → 通知主窗口刷新
      broadcastExtensionsChanged();
      return { success: true, meta };
    } catch (e) {
      return { success: false, message: e.message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.EXTENSIONS_OPEN_OPTIONS, (event, { id }) => {
    const wm = getWM();
    if (!wm || !wm.openExtensionOptionsPage) {
      return { success: false, message: '窗口管理器未就绪' };
    }
    return wm.openExtensionOptionsPage(id);
  });

  ipcMain.handle(IPC_CHANNELS.EXTENSIONS_VIEW_WEB_PERMISSIONS, async (event, { id }) => {
    const meta = getExtensionMenuMeta(id);
    if (!meta) return { success: false, message: '扩展不存在' };
    const lines = meta.hostPermissions.length > 0
      ? meta.hostPermissions
      : ['此扩展没有网站访问权限'];
    const wm = getWM();
    await dialog.showMessageBox(wm && wm.mainWindow ? wm.mainWindow : undefined, {
      type: 'info',
      title: `“${meta.name}”的 Web 权限`,
      message: '网站访问权限',
      detail: lines.join('\n'),
      buttons: ['确定'],
      noLink: true,
    });
    return { success: true };
  });
}

module.exports = { registerIpcHandlers };
