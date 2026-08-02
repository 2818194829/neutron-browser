/**
 * IPC 处理器注册
 * 处理来自渲染进程的所有 IPC 请求
 */
const { ipcMain, dialog, shell, app, Menu, clipboard } = require('electron');
const https = require('https');
const path = require('path');
const fs = require('fs');
const { IPC_CHANNELS, INTERNAL_PAGES, DEFAULT_SETTINGS } = require('../shared/constants');
const { getStore } = require('./storage');
const { normalizeHistoryTitle, sanitizeFavicon, sanitizeBookmarks, sanitizeHistory } = require('../shared/siteMeta');
const {
  getInstalledExtensions,
  installExtensionFile,
  installUnpackedExtension,
  installFromEdgeStore,
  setExtensionEnabled,
  uninstallExtension,
} = require('./extensions');

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
      .map(tab => tab.url)
      .filter(url => url && !url.startsWith('neutron://'));
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

    wm.mainWindow.webContents.send(IPC_CHANNELS.BOOKMARKS_FOLDER_MENU_OPEN, {
      folderId: folder.id,
      folderTitle: folder.title || '未命名文件夹',
      x: payload.x,
      y: payload.y,
      items: buildItems(folder),
    });
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
    if (result.canceled) return { success: false, message: '用户取消' };
    // TODO: 实现 HTML 书签导入
    return { success: true, message: '书签导入功能开发中' };
  });

  ipcMain.handle(IPC_CHANNELS.BOOKMARKS_EXPORT, async () => {
    const result = await dialog.showSaveDialog({
      filters: [{ name: '书签文件', extensions: ['html'] }],
      defaultPath: 'bookmarks.html',
    });
    if (result.canceled) return { success: false, message: '用户取消' };
    // TODO: 实现 HTML 书签导出
    return { success: true, message: '书签导出功能开发中' };
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
    try {
      const extension = await installExtensionFile(filePath);
      return { success: true, extension };
    } catch (e) {
      return { success: false, message: e.message || '安装失败' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.EXTENSIONS_INSTALL_UNPACKED, async () => {
    const result = await dialog.showOpenDialog({
      title: '加载已解压的扩展',
      properties: ['openDirectory'],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, message: '用户取消' };
    }

    try {
      const extension = await installUnpackedExtension(result.filePaths[0]);
      return { success: true, extension };
    } catch (e) {
      return { success: false, message: e.message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.EXTENSIONS_INSTALL_FROM_EDGE, async (event, input) => {
    try {
      const extension = await installFromEdgeStore(input);
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
      return { success: true, extension: updated };
    } catch (e) {
      return { success: false, message: e.message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.EXTENSIONS_UNINSTALL, async (event, { id }) => {
    try {
      return await uninstallExtension(id);
    } catch (e) {
      return { success: false, message: e.message };
    }
  });
}

module.exports = { registerIpcHandlers };
