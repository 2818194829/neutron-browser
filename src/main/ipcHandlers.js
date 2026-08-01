/**
 * IPC 处理器注册
 * 处理来自渲染进程的所有 IPC 请求
 */
const { ipcMain, dialog, shell, app, Menu, clipboard } = require('electron');
const path = require('path');
const { IPC_CHANNELS, INTERNAL_PAGES, DEFAULT_SETTINGS } = require('../shared/constants');
const { getStore } = require('./storage');
const {
  getInstalledExtensions,
  installExtensionFile,
  installUnpackedExtension,
  installFromEdgeStore,
  setExtensionEnabled,
  uninstallExtension,
} = require('./extensions');

function registerIpcHandlers() {
  const getWM = () => global.windowManager;
  const sendMenuEvent = (action, data = {}) => {
    const wm = getWM();
    if (wm && wm.mainWindow && !wm.mainWindow.isDestroyed()) {
      wm.mainWindow.webContents.send(IPC_CHANNELS.MENU_EVENT, { action, ...data });
    }
  };

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

  ipcMain.on(IPC_CHANNELS.UI_MODAL_CHANGED, (event, visible) => {
    const wm = getWM();
    if (wm) wm.setModalVisible(visible === true);
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
      const activeTab = wm.tabs.find(t => t.id === wm.activeTabId);
      if (activeTab && activeTab.view) {
        activeTab.view.webContents.loadURL(homePage);
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
    const buildFolderItems = (parent) => {
      const items = [];
      for (const child of (parent.children || [])) {
        if (child.type === 'folder') {
          items.push({
            label: child.title || '未命名文件夹',
            submenu: buildFolderItems(child),
          });
        } else if (child.type === 'bookmark') {
          items.push({
            label: child.title || child.url || '未命名书签',
            click: () => wm.createTab(child.url),
          });
        }
      }
      if (items.length === 0) {
        items.push({ label: '空文件夹', enabled: false });
      }
      return items;
    };

    const template = [
      ...buildFolderItems(folder),
      { type: 'separator' },
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
        click: () => sendMenuEvent('editBookmarkFolder', { folder }),
      },
      {
        label: '删除文件夹',
        click: () => sendMenuEvent('deleteBookmarkFolder', { folderId: folder.id }),
      },
    ];

    const menu = Menu.buildFromTemplate(template);
    menu.popup({ window: wm.mainWindow });
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

  ipcMain.on(IPC_CHANNELS.HISTORY_ADD, (event, { url, title }) => {
    const store = getStore('history');
    const visits = store.get('visits', []);

    // 查找今天是否已有相同 URL 的记录
    const today = new Date().toDateString();
    const existing = visits.find(v =>
      v.url === url && new Date(v.lastVisitTime).toDateString() === today
    );

    if (existing) {
      existing.visitCount = (existing.visitCount || 1) + 1;
      existing.lastVisitTime = Date.now();
    } else {
      visits.unshift({
        id: `hist_${Date.now()}`,
        url,
        title: title || url,
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

  // ==================== 下载 ====================
  ipcMain.handle(IPC_CHANNELS.DOWNLOADS_GET_ALL, () => {
    return getStore('downloads').get('items', []);
  });

  ipcMain.handle(IPC_CHANNELS.DOWNLOADS_OPEN_FOLDER, (event, { id }) => {
    const items = getStore('downloads').get('items', []);
    const item = items.find(d => d.id === id);
    if (item) {
      shell.showItemInFolder(item.savePath);
    }
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
  });

  // ==================== 扩展 ====================
  ipcMain.handle(IPC_CHANNELS.EXTENSIONS_GET_ALL, () => {
    return getInstalledExtensions();
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
