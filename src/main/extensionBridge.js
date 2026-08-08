/**
 * 扩展真实 API 桥接模块（对齐 Edge）
 *
 * 通过 IPC 把扩展后台页（chrome-extension://）的 chrome.webRequest / notifications /
 * cookies / contextMenus 桥接到 Electron 主进程的真实能力：
 * - webRequest：session.webRequest 真实拦截（广告拦截等）
 * - notifications：系统 Notification 通知
 * - cookies：session.cookies 真实读写
 * - contextMenus：右键菜单注册表（由 windowManager 在网页右键时构建原生菜单）
 *
 * 扩展后台页通过 polyfill-webnav.js 的 __neutronExtBridge 调用这里注册的 IPC。
 */
const { session, Notification, ipcMain, BrowserView } = require('electron');
const path = require('path');
const fs = require('fs');
const { IPC_CHANNELS } = require('../shared/constants');
const { getStore } = require('./storage');

// ==================== webRequest 注册表 ====================
// extId -> { events: { onBeforeRequest: { hasListener }, ... } }
const webRequestRegistry = new Map();
let webRequestInited = false;

// 支持的事件（key 与 chrome.webRequest 一致，value 为 Electron session.webRequest 事件名）
const WEBREQUEST_EVENTS = [
  'onBeforeRequest',
  'onBeforeSendHeaders',
  'onSendHeaders',
  'onHeadersReceived',
  'onAuthRequired',
  'onResponseStarted',
  'onCompleted',
  'onErrorOccurred',
];

/** 将 Electron details 转换为接近 Chrome 的 webRequest details */
function toChromeWebRequestDetails(details) {
  return {
    url: details.url || '',
    method: details.method || 'GET',
    frameId: details.frame && details.frame !== -1 ? 0 : 0,
    parentFrameId: -1,
    requestId: String(details.id || details.webContentsId || ''),
    timeStamp: Date.now(),
    type: details.resourceType || 'other',
    tabId: -1,
    initiator: details.referrer || '',
    requestHeaders: details.requestHeaders || undefined,
    responseHeaders: details.responseHeaders || undefined,
    statusCode: details.statusCode || 0,
    fromCache: !!details.fromCache,
    error: details.error || undefined,
    redirectUrl: details.redirectURL || undefined,
    ip: undefined,
  };
}

/** 为每个事件注册一个全局 session.webRequest 监听，内部路由到所有已注册扩展 */
function ensureWebRequestInit() {
  if (webRequestInited) return;
  webRequestInited = true;
  const s = session.defaultSession.webRequest;
  for (const evt of WEBREQUEST_EVENTS) {
    if (typeof s[evt] !== 'function') continue;
    try {
      // Electron 的 webRequest 是直接调用形式：webRequest.onBeforeRequest(filter, listener)
      s[evt]({ urls: ['*://*/*'] }, createWebRequestHandler(evt));
    } catch (e) { /* 忽略：可能已注册或不可用 */ }
  }
}

function createWebRequestHandler(evt) {
  return async (details, callback) => {
    const targets = [];
    webRequestRegistry.forEach((reg, extId) => {
      if (reg.events && reg.events[evt] && reg.events[evt].hasListener) targets.push(extId);
    });
    if (targets.length === 0) {
      if (callback) callback({});
      return;
    }

    // 扩展后台脚本必须真实存在才能执行过滤
    const { findExtensionBackgroundWebContents } = require('./extensions');
    const chromeDetails = toChromeWebRequestDetails(details);
    const results = [];
    for (const extId of targets) {
      const wc = findExtensionBackgroundWebContents(extId);
      if (!wc || wc.isDestroyed()) continue;
      try {
        const res = await wc.executeJavaScript(
          `window.__neutronWebRequestFire && window.__neutronWebRequestFire(${JSON.stringify(evt)}, ${JSON.stringify(chromeDetails)})`
        );
        if (res && typeof res === 'object') results.push(res);
      } catch (e) { /* 后台脚本异常忽略 */ }
    }

    // 合并各扩展的 blockingResponse
    const merged = {};
    for (const res of results) {
      if (res.cancel) merged.cancel = true;
      if (res.redirectUrl && !merged.redirectUrl) merged.redirectUrl = res.redirectUrl;
      if (res.requestHeaders && !merged.requestHeaders) merged.requestHeaders = res.requestHeaders;
      if (res.responseHeaders && !merged.responseHeaders) merged.responseHeaders = res.responseHeaders;
      if (res.authCredentials && !merged.authCredentials) merged.authCredentials = res.authCredentials;
      if (res.upgradeToSecure) merged.upgradeToSecure = true;
    }
    if (callback) callback(merged);
  };
}

function webRequestRegister(extId, evt, hasListener) {
  ensureWebRequestInit();
  let reg = webRequestRegistry.get(extId);
  if (!reg) {
    reg = { events: {} };
    webRequestRegistry.set(extId, reg);
  }
  reg.events[evt] = { hasListener: !!hasListener };
}

function webRequestUnregister(extId, evt) {
  const reg = webRequestRegistry.get(extId);
  if (reg && reg.events) delete reg.events[evt];
  if (reg && Object.keys(reg.events).length === 0) webRequestRegistry.delete(extId);
}

// ==================== contextMenus 注册表 ====================
// extId -> Map(menuId -> { title, contexts, enabled })
const contextMenuRegistry = new Map();

function contextMenuRegister(extId, menuId, props) {
  let map = contextMenuRegistry.get(extId);
  if (!map) {
    map = new Map();
    contextMenuRegistry.set(extId, map);
  }
  map.set(menuId, {
    title: props && props.title ? String(props.title) : '',
    contexts: Array.isArray(props && props.contexts) ? props.contexts : ['all'],
    enabled: !(props && props.enabled === false),
  });
}

function contextMenuUnregister(extId, menuId) {
  const map = contextMenuRegistry.get(extId);
  if (!map) return;
  map.delete(menuId);
  if (map.size === 0) contextMenuRegistry.delete(extId);
}

function contextMenuUnregisterAll(extId) {
  contextMenuRegistry.delete(extId);
}

/**
 * 构建扩展右键菜单项（由 windowManager 在 webContents 'context-menu' 事件时调用）
 * @param {Object} params - Electron context-menu 事件参数（linkURL/selectionText/editable/mediaType...）
 * @param {function} onSelect - (extId, menuId, info) 菜单被点击时回调
 * @returns {Array<Object>} Electron Menu 模板项
 */
function buildExtensionContextMenuItems(params, onSelect) {
  const items = [];
  const pageUrl = params && params.pageURL ? String(params.pageURL) : '';
  const linkUrl = params && params.linkURL ? String(params.linkURL) : '';
  const selection = params && params.selectionText ? String(params.selectionText) : '';

  const matchesContext = (ctxList) => {
    if (!ctxList || ctxList.includes('all')) return true;
    const kind = linkUrl ? 'link' : (selection ? 'selection' : 'page');
    const editable = !!(params && params.isEditable);
    const mediaType = params && params.mediaType ? String(params.mediaType) : '';
    if (editable && ctxList.includes('editable')) return true;
    if (mediaType === 'image' && ctxList.includes('image')) return true;
    if (mediaType === 'video' && ctxList.includes('video')) return true;
    if (mediaType === 'audio' && ctxList.includes('audio')) return true;
    return ctxList.includes(kind);
  };

  contextMenuRegistry.forEach((map, extId) => {
    map.forEach((item, menuId) => {
      if (!item.title || !item.enabled) return;
      if (!matchesContext(item.contexts)) return;
      items.push({
        label: item.title,
        click: () => {
          const info = {
            pageUrl,
            linkUrl,
            selectionText: selection,
            editable: !!(params && params.isEditable),
            mediaType: params && params.mediaType ? String(params.mediaType) : '',
            srcUrl: params && params.srcURL ? String(params.srcURL) : '',
          };
          if (onSelect) onSelect(extId, menuId, info);
        },
      });
    });
  });

  return items;
}

// ==================== IPC 注册 ====================

function registerExtensionBridgeIpc() {
  // ---- webRequest ----
  ipcMain.on(IPC_CHANNELS.EXT_WEBREQUEST_REGISTER, (event, { id, evt, hasListener }) => {
    if (!id || !evt || !WEBREQUEST_EVENTS.includes(evt)) return;
    webRequestRegister(id, evt, hasListener);
  });
  ipcMain.on(IPC_CHANNELS.EXT_WEBREQUEST_UNREGISTER, (event, { id, evt }) => {
    if (!id || !evt) return;
    webRequestUnregister(id, evt);
  });

  // ---- notifications ----
  ipcMain.handle(IPC_CHANNELS.EXT_NOTIFICATIONS_CREATE, (event, { id, options }) => {
    const opt = options || {};
    let iconPath = opt.iconUrl || '';
    if (iconPath && iconPath.startsWith('chrome-extension://')) {
      // chrome-extension://id/xxx → 本地路径
      try {
        const u = new URL(iconPath);
        const extId = u.hostname;
        const rel = decodeURIComponent(u.pathname.replace(/^\/+/, ''));
        const { getInstalledExtensions } = require('./extensions');
        const ext = getInstalledExtensions().find((x) => x.id === extId);
        if (ext && ext.path) {
          const candidate = require('path').join(ext.path, rel);
          if (require('fs').existsSync(candidate)) iconPath = candidate;
        }
      } catch (e) { iconPath = ''; }
    }
    const nid = typeof opt.notificationId === 'string' ? opt.notificationId : '';
    try {
      const n = new Notification({
        title: String(opt.title || '通知'),
        body: String(opt.message || opt.body || ''),
        icon: iconPath || undefined,
      });
      n.on('click', () => {
        // 触发扩展 notifications.onClicked
        const { findExtensionBackgroundWebContents } = require('./extensions');
        const wc = findExtensionBackgroundWebContents(id);
        if (wc && !wc.isDestroyed()) {
          wc.executeJavaScript(
            `window.__neutronFireNotification && window.__neutronFireNotification('clicked', ${JSON.stringify(nid || '')})`
          ).catch(() => {});
        }
      });
      n.show();
      return Promise.resolve(nid);
    } catch (e) {
      return Promise.resolve(nid);
    }
  });
  ipcMain.on(IPC_CHANNELS.EXT_NOTIFICATIONS_CLEAR, (event, { id, notificationId }) => {
    // Electron Notification 无法按 ID 关闭，空操作
  });

  // ---- cookies ----
  ipcMain.handle(IPC_CHANNELS.EXT_COOKIES_GET, async (event, { url, name }) => {
    try {
      const cookies = await session.defaultSession.cookies.get({ url });
      return cookies.find((c) => c.name === name) || null;
    } catch (e) {
      return null;
    }
  });
  ipcMain.handle(IPC_CHANNELS.EXT_COOKIES_GET_ALL, async (event, { url }) => {
    try {
      const cookies = await session.defaultSession.cookies.get(url ? { url } : {});
      return cookies.map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        hostOnly: false,
        path: c.path || '/',
        secure: !!c.secure,
        httpOnly: !!c.httpOnly,
        sameSite: c.sameSite === 'no_restriction' ? 'no_restriction' : (c.sameSite || 'unspecified'),
        session: !!c.session,
        expirationDate: c.expirationDate || undefined,
      }));
    } catch (e) {
      return [];
    }
  });
  ipcMain.handle(IPC_CHANNELS.EXT_COOKIES_SET, async (event, { details }) => {
    try {
      const d = details || {};
      await session.defaultSession.cookies.set({
        url: d.url || '',
        name: d.name || '',
        value: d.value || '',
        domain: d.domain || undefined,
        path: d.path || undefined,
        secure: d.secure,
        httpOnly: d.httpOnly,
        expirationDate: d.expirationDate,
        sameSite: d.sameSite,
      });
      return true;
    } catch (e) {
      return false;
    }
  });
  ipcMain.handle(IPC_CHANNELS.EXT_COOKIES_REMOVE, async (event, { url, name }) => {
    try {
      await session.defaultSession.cookies.remove(url || '', name || '');
      return true;
    } catch (e) {
      return false;
    }
  });

  // ---- contextMenus ----
  ipcMain.on(IPC_CHANNELS.EXT_CONTEXTMENU_REGISTER, (event, { id, menuId, props }) => {
    if (!id || menuId === undefined || menuId === null) return;
    contextMenuRegister(id, menuId, props || {});
  });
  ipcMain.on(IPC_CHANNELS.EXT_CONTEXTMENU_UNREGISTER, (event, { id, menuId, all }) => {
    if (!id) return;
    if (all) contextMenuUnregisterAll(id);
    else if (menuId !== undefined && menuId !== null) contextMenuUnregister(id, menuId);
  });

  // ---- bookmarks / history / commands 真实数据桥接 ----
  ipcMain.handle(IPC_CHANNELS.EXT_BOOKMARKS, (event, { method, args }) => {
    try {
      return handleBookmarksRequest(method, args || []);
    } catch (e) {
      return null;
    }
  });
  ipcMain.handle(IPC_CHANNELS.EXT_HISTORY, (event, { method, args }) => {
    try {
      return handleHistoryRequest(method, args || []);
    } catch (e) {
      return undefined;
    }
  });
  ipcMain.handle(IPC_CHANNELS.EXT_COMMANDS_GET_ALL, (event, { id }) => {
    return handleCommandsGetAll(id);
  });

  // ---- tabs / windows / scripting ----
  ipcMain.handle(IPC_CHANNELS.EXT_TABS, (event, { method, args }) => {
    try {
      return handleTabsRequest(method, args || []);
    } catch (e) {
      return [];
    }
  });
  ipcMain.handle(IPC_CHANNELS.EXT_WINDOWS, (event, { method, args }) => {
    try {
      return handleWindowsRequest(method, args || []);
    } catch (e) {
      return null;
    }
  });
  ipcMain.handle(IPC_CHANNELS.EXT_SCRIPTING, async (event, { method, args, id }) => {
    try {
      return await handleScriptingRequest(method, args || [], id);
    } catch (e) {
      return [];
    }
  });

  // ---- storage 兜底桥接（Electron 原生 storage 异步就绪的兜底） ----
  ipcMain.handle(IPC_CHANNELS.EXT_STORAGE, (event, payload) => {
    try {
      return handleExtensionStorage(event, payload || {});
    } catch (e) {
      return null;
    }
  });
}

// ==================== tabs / windows 桥接（对齐 Edge：chrome.tabs / chrome.windows） ====================

/** 内部标签页 id（"tab_1"）→ Chrome 整数 id（1） */
function tabToChromeId(tabId) {
  return Number(String(tabId).replace(/^tab_/, '')) || -1;
}

function chromeIdToTab(wm, chromeId) {
  return wm.tabs.find((t) => tabToChromeId(t.id) === Number(chromeId)) || null;
}

function tabToChrome(tab, index) {
  const wm = global.windowManager;
  return {
    id: tabToChromeId(tab.id),
    index: index || 0,
    windowId: 1,
    highlighted: wm ? tab.id === wm.activeTabId : false,
    active: wm ? tab.id === wm.activeTabId : false,
    pinned: !!tab.isPinned,
    muted: !!tab.isMuted,
    audible: !!tab.isAudible,
    url: tab.url || '',
    title: tab.title || '',
    favIconUrl: tab.favicon || '',
    status: tab.isLoading ? 'loading' : 'complete',
    incognito: false,
  };
}

function windowToChrome(wm) {
  const bounds = wm.mainWindow ? wm.mainWindow.getBounds() : { width: 0, height: 0 };
  return {
    id: 1,
    focused: wm.mainWindow ? wm.mainWindow.isFocused() : false,
    top: bounds.y || 0,
    left: bounds.x || 0,
    width: bounds.width || 0,
    height: bounds.height || 0,
    type: 'normal',
    state: wm.isMaximized ? 'maximized' : 'normal',
    alwaysOnTop: wm.mainWindow ? wm.mainWindow.isAlwaysOnTop() : false,
  };
}

function handleTabsRequest(method, args) {
  const wm = global.windowManager;
  if (!wm || !wm.mainWindow || wm.mainWindow.isDestroyed()) return [];
  switch (method) {
    case 'query': {
      const q = args[0] || {};
      let tabs = wm.tabs.slice();
      if (q.active !== undefined) {
        tabs = tabs.filter((t) => (t.id === wm.activeTabId) === !!q.active);
      }
      if (q.pinned !== undefined) {
        tabs = tabs.filter((t) => !!t.isPinned === !!q.pinned);
      }
      if (q.url) {
        const urls = Array.isArray(q.url) ? q.url : [q.url];
        tabs = tabs.filter((t) => urls.some((u) => {
          const pat = String(u);
          if (pat.includes('*')) {
            const re = new RegExp('^' + pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
            return re.test(t.url || '');
          }
          return t.url === pat;
        }));
      }
      if (q.title) {
        const pat = String(q.title).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
        const re = new RegExp('^' + pat + '$', 'i');
        tabs = tabs.filter((t) => re.test(String(t.title || '')));
      }
      if (q.lastFocusedWindow) {
        tabs = tabs.filter((t) => t.id === wm.activeTabId);
      }
      return tabs.map((t, i) => tabToChrome(t, i));
    }
    case 'get': {
      const tab = chromeIdToTab(wm, args[0]);
      if (!tab) return { error: 'No tab with id: ' + args[0] };
      return tabToChrome(tab, wm.tabs.indexOf(tab));
    }
    case 'create': {
      const props = args[0] || {};
      const id = wm.createTab(props.url || '', props.active !== false);
      const tab = wm.tabs.find((t) => t.id === id);
      return tab ? tabToChrome(tab, wm.tabs.indexOf(tab)) : null;
    }
    case 'update': {
      const props = args[1] || {};
      const tab = chromeIdToTab(wm, args[0]);
      if (!tab) return { error: 'No tab with id: ' + args[0] };
      if (props.url) {
        const url = wm.resolveUrl ? wm.resolveUrl(props.url) : props.url;
        tab.view.webContents.loadURL(url);
        tab.url = url;
      }
      if (props.active) wm.switchTab(tab.id);
      if (props.muted !== undefined) tab.isMuted = !!props.muted;
      return tabToChrome(tab, wm.tabs.indexOf(tab));
    }
    case 'remove': {
      const ids = Array.isArray(args[0]) ? args[0] : [args[0]];
      ids.forEach((cid) => {
        const tab = chromeIdToTab(wm, cid);
        if (tab && !tab.isPinned) wm.closeTab(tab.id);
      });
      return undefined;
    }
    case 'reload': {
      const tab = chromeIdToTab(wm, args[0]);
      if (tab && tab.view) tab.view.webContents.reload();
      return undefined;
    }
    case 'getCurrent':
    case 'getSelected': {
      const tab = wm.tabs.find((t) => t.id === wm.activeTabId);
      return tab ? tabToChrome(tab, wm.tabs.indexOf(tab)) : null;
    }
    case 'duplicate': {
      const tab = chromeIdToTab(wm, args[0]);
      if (!tab) return null;
      const id = wm.createTab(tab.url || '', true);
      const newTab = wm.tabs.find((t) => t.id === id);
      return newTab ? tabToChrome(newTab, wm.tabs.indexOf(newTab)) : null;
    }
    default:
      return undefined;
  }
}

function handleWindowsRequest(method, args) {
  const wm = global.windowManager;
  if (!wm || !wm.mainWindow || wm.mainWindow.isDestroyed()) return null;
  switch (method) {
    case 'getAll':
    case 'getCurrent':
    case 'getLastFocused':
    case 'get': {
      if (method === 'getAll') {
        const opts = args[0] || {};
        const win = windowToChrome(wm);
        if (opts.populate) {
          win.tabs = wm.tabs.map((t, i) => tabToChrome(t, i));
        }
        return [win];
      }
      const win = windowToChrome(wm);
      if (args[0] && args[0].populate) {
        win.tabs = wm.tabs.map((t, i) => tabToChrome(t, i));
      }
      return win;
    }
    case 'create': {
      const props = args[0] || {};
      if (props.url) {
        const urls = Array.isArray(props.url) ? props.url : [props.url];
        urls.forEach((u, i) => wm.createTab(u, i === 0));
      } else {
        wm.createTab('', true);
      }
      const win = windowToChrome(wm);
      if (props.populate) win.tabs = wm.tabs.map((t, i) => tabToChrome(t, i));
      return win;
    }
    case 'update': {
      const props = args[1] || {};
      if (props.focused) wm.mainWindow.focus();
      if (props.state === 'minimized') wm.mainWindow.minimize();
      else if (props.state === 'maximized') wm.mainWindow.maximize();
      else if (props.state === 'normal') wm.mainWindow.unmaximize();
      return windowToChrome(wm);
    }
    case 'remove':
      wm.mainWindow.close();
      return undefined;
    default:
      return null;
  }
}

// ==================== scripting 桥接（对齐 Edge：chrome.scripting 动态注入） ====================

async function handleScriptingRequest(method, args, extId) {
  const wm = global.windowManager;
  if (!wm || !wm.mainWindow || wm.mainWindow.isDestroyed()) return [];
  const details = args[0] || {};
  const target = details.target || {};
  let tabId = target.tabId;
  if (tabId === undefined) {
    const active = wm.tabs.find((t) => t.id === wm.activeTabId);
    tabId = active ? tabToChromeId(active.id) : -1;
  }
  const tab = chromeIdToTab(wm, tabId);
  if (!tab || !tab.view || !tab.view.webContents) return [];
  const wc = tab.view.webContents;
  const { getInstalledExtensions } = require('./extensions');
  const ext = extId ? getInstalledExtensions().find((e) => e.id === extId) : null;

  try {
    switch (method) {
      case 'executeScript': {
        // 注入扩展文件
        if (details.files && details.files.length && ext && ext.path) {
          const results = [];
          for (const f of details.files) {
            const filePath = path.join(ext.path, String(f).replace(/^\/+/, ''));
            if (!fs.existsSync(filePath)) continue;
            const content = fs.readFileSync(filePath, 'utf8');
            try {
              const r = await wc.executeJavaScript(content);
              results.push({ result: r });
            } catch (e) {
              results.push({ result: undefined });
            }
          }
          return results;
        }
        // 注入函数
        if (details.func) {
          const fnSrc = String(details.func);
          const argsJson = JSON.stringify(details.args || []).replace(/</g, '\\u003c');
          const code = '(function(){ try { return (' + fnSrc + ').apply(null, ' + argsJson + '); } catch(e) { return { __neutronErr: String((e && e.message) || e) }; } })()';
          try {
            const r = await wc.executeJavaScript(code);
            if (r && r.__neutronErr) return [{ result: undefined }];
            return [{ result: r }];
          } catch (e) {
            return [];
          }
        }
        return [];
      }
      case 'insertCSS': {
        if (details.files && details.files.length && ext && ext.path) {
          for (const f of details.files) {
            const filePath = path.join(ext.path, String(f).replace(/^\/+/, ''));
            if (!fs.existsSync(filePath)) continue;
            await wc.insertCSS(fs.readFileSync(filePath, 'utf8'));
          }
        } else if (details.css) {
          await wc.insertCSS(details.css);
        }
        return [];
      }
      case 'removeCSS': {
        if (details.files && details.files.length && ext && ext.path) {
          for (const f of details.files) {
            const filePath = path.join(ext.path, String(f).replace(/^\/+/, ''));
            if (!fs.existsSync(filePath)) continue;
            await wc.removeInsertedCSS(fs.readFileSync(filePath, 'utf8'));
          }
        } else if (details.css) {
          await wc.removeInsertedCSS(details.css);
        }
        return [];
      }
      default:
        return [];
    }
  } catch (e) {
    return [];
  }
}

// ==================== bookmarks 真实数据桥接（对齐 Edge：chrome.bookmarks） ====================

/** 将内部书签节点转为 Chrome bookmark 节点 */
function toChromeBookmarkNode(node, parentId) {
  if (!node) return null;
  const out = {
    id: String(node.id || ''),
    parentId: String(parentId || ''),
    title: node.title || '',
    dateAdded: node.dateAdded || 0,
  };
  if (node.type === 'bookmark') out.url = node.url || '';
  if (node.type === 'folder') {
    out.children = (node.children || []).map((c) => toChromeBookmarkNode(c, node.id));
  }
  return out;
}

function saveBookmarks(bookmarks) {
  for (const key of Object.keys(bookmarks)) {
    getStore('bookmarks').set(key, bookmarks[key]);
  }
  try {
    const wm = global.windowManager;
    if (wm && wm.mainWindow && !wm.mainWindow.isDestroyed()) {
      wm.mainWindow.webContents.send(IPC_CHANNELS.BOOKMARKS_REFRESH);
    }
  } catch (e) { /* 忽略 */ }
}

function findBookmarkNode(bookmarks, id) {
  const walk = (folder) => {
    if (!folder) return null;
    if (folder.id === id) return folder;
    for (const child of (folder.children || [])) {
      if (child.id === id) return child;
      if (child.type === 'folder') {
        const found = walk(child);
        if (found) return found;
      }
    }
    return null;
  };
  for (const key of Object.keys(bookmarks)) {
    if (bookmarks[key] && bookmarks[key].type === 'folder') {
      const found = walk(bookmarks[key]);
      if (found) return found;
    }
  }
  return null;
}

function findBookmarkParent(bookmarks, id) {
  const walk = (folder, parentId) => {
    if (!folder) return null;
    if (folder.id === id) return { parentId, parent: folder };
    for (const child of (folder.children || [])) {
      if (child.id === id) return { parentId: folder.id, parent: folder };
      if (child.type === 'folder') {
        const found = walk(child, folder.id);
        if (found) return found;
      }
    }
    return null;
  };
  for (const key of Object.keys(bookmarks)) {
    if (bookmarks[key] && bookmarks[key].type === 'folder') {
      const found = walk(bookmarks[key], key);
      if (found) return found;
    }
  }
  return null;
}

function collectBookmarks(bookmarks, out, parentId) {
  for (const key of Object.keys(bookmarks)) {
    const root = bookmarks[key];
    if (root && root.type === 'folder') {
      const walk = (folder, pid) => {
        for (const c of (folder.children || [])) {
          out.push({ node: c, parentId: pid });
          if (c.type === 'folder') walk(c, c.id);
        }
      };
      walk(root, key);
    }
  }
  return out;
}

function handleBookmarksRequest(method, args) {
  const bookmarks = getStore('bookmarks').getAll();
  switch (method) {
    case 'getTree': {
      const roots = Object.keys(bookmarks)
        .filter((k) => bookmarks[k] && bookmarks[k].type === 'folder')
        .map((k) => toChromeBookmarkNode(bookmarks[k], '0'));
      return [{ id: '0', title: '', children: roots }];
    }
    case 'get': {
      const id = args[0];
      if (id === undefined || id === null) {
        return collectBookmarks(bookmarks, []).map((x) => toChromeBookmarkNode(x.node, x.parentId));
      }
      const ids = Array.isArray(id) ? id : [id];
      return ids
        .map((x) => {
          const node = findBookmarkNode(bookmarks, String(x));
          if (!node) return null;
          const p = findBookmarkParent(bookmarks, node.id);
          return toChromeBookmarkNode(node, p ? p.parentId : '0');
        })
        .filter(Boolean);
    }
    case 'getChildren': {
      const id = String(args[0] || '');
      if (id === '0') {
        return Object.keys(bookmarks)
          .filter((k) => bookmarks[k] && bookmarks[k].type === 'folder')
          .map((k) => toChromeBookmarkNode(bookmarks[k], '0'));
      }
      const node = findBookmarkNode(bookmarks, id);
      if (!node || node.type !== 'folder') return [];
      return (node.children || []).map((c) => toChromeBookmarkNode(c, node.id));
    }
    case 'getRecent': {
      const n = Number(args[0]) > 0 ? Number(args[0]) : 20;
      return collectBookmarks(bookmarks, [])
        .sort((a, b) => (b.node.dateAdded || 0) - (a.node.dateAdded || 0))
        .slice(0, n)
        .map((x) => toChromeBookmarkNode(x.node, x.parentId));
    }
    case 'search': {
      const query = String((args[0] && (args[0].query || args[0].title)) || '').toLowerCase();
      if (!query) return [];
      return collectBookmarks(bookmarks, [])
        .filter((x) =>
          String(x.node.title || '').toLowerCase().includes(query) ||
          String(x.node.url || '').toLowerCase().includes(query)
        )
        .map((x) => toChromeBookmarkNode(x.node, x.parentId));
    }
    case 'create': {
      const props = args[0] || {};
      const parentId = props.parentId || 'bookmark_bar';
      const isFolder = !props.url;
      const node = {
        id: 'bm_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
        title: props.title || (isFolder ? '未命名文件夹' : '未命名书签'),
        url: isFolder ? '' : (props.url || ''),
        type: isFolder ? 'folder' : 'bookmark',
        parentId,
        dateAdded: Date.now(),
        favicon: '',
      };
      if (isFolder) node.children = [];
      const target = findBookmarkNode(bookmarks, parentId);
      if (!target || target.type !== 'folder') return null;
      if (!target.children) target.children = [];
      const idx = props.index !== undefined && props.index >= 0
        ? Math.min(Number(props.index), target.children.length)
        : target.children.length;
      target.children.splice(idx, 0, node);
      saveBookmarks(bookmarks);
      return toChromeBookmarkNode(node, parentId);
    }
    case 'update': {
      const id = String(args[0] || '');
      const changes = args[1] || {};
      const node = findBookmarkNode(bookmarks, id);
      if (!node) return null;
      if (changes.title !== undefined) node.title = changes.title;
      if (changes.url !== undefined) node.url = changes.url;
      saveBookmarks(bookmarks);
      const p = findBookmarkParent(bookmarks, id);
      return toChromeBookmarkNode(node, p ? p.parentId : '0');
    }
    case 'move': {
      const id = String(args[0] || '');
      const dest = args[1] || {};
      const found = findBookmarkParent(bookmarks, id);
      if (!found) return null;
      const idx = found.parent.children.findIndex((c) => c.id === id);
      if (idx === -1) return null;
      const node = found.parent.children[idx];
      found.parent.children.splice(idx, 1);
      const targetId = dest.parentId || found.parentId;
      const target = findBookmarkNode(bookmarks, targetId);
      if (!target || target.type !== 'folder') {
        found.parent.children.splice(idx, 0, node);
        return null;
      }
      node.parentId = target.id;
      if (!target.children) target.children = [];
      const insIdx = dest.index !== undefined && dest.index >= 0
        ? Math.min(Number(dest.index), target.children.length)
        : target.children.length;
      target.children.splice(insIdx, 0, node);
      saveBookmarks(bookmarks);
      return toChromeBookmarkNode(node, target.id);
    }
    case 'remove':
    case 'removeTree': {
      const id = String(args[0] || '');
      const found = findBookmarkParent(bookmarks, id);
      if (!found) return null;
      found.parent.children = found.parent.children.filter((c) => c.id !== id);
      saveBookmarks(bookmarks);
      return null;
    }
    default:
      return null;
  }
}

// ==================== history 真实数据桥接（对齐 Edge：chrome.history） ====================

function handleHistoryRequest(method, args) {
  const store = getStore('history');
  const visits = store.get('visits', []);
  switch (method) {
    case 'search': {
      const opt = args[0] || {};
      const query = String(opt.text || '').toLowerCase();
      const maxResults = Number(opt.maxResults) > 0 ? Number(opt.maxResults) : 100;
      let filtered = visits;
      if (opt.startTime) filtered = filtered.filter((v) => v.lastVisitTime >= opt.startTime);
      if (opt.endTime) filtered = filtered.filter((v) => v.lastVisitTime <= opt.endTime);
      if (query) {
        filtered = filtered.filter((v) =>
          String(v.title || '').toLowerCase().includes(query) ||
          String(v.url || '').toLowerCase().includes(query)
        );
      }
      return filtered.slice(0, maxResults).map(toChromeHistoryItem);
    }
    case 'getVisits': {
      const url = args[0] && args[0].url;
      if (!url) return [];
      return visits
        .filter((v) => v.url === url)
        .map((v) => ({
          id: String(v.id || ('hist_' + v.lastVisitTime)),
          visitId: String(v.id || v.lastVisitTime),
          visitTime: v.lastVisitTime || 0,
          referringVisitId: '0',
          transition: 'typed',
        }));
    }
    case 'addUrl': {
      const url = args[0] && args[0].url;
      const title = args[0] && args[0].title;
      if (!url) return;
      const existing = visits.find((v) => v.url === url);
      if (existing) {
        existing.visitCount = (existing.visitCount || 1) + 1;
        existing.lastVisitTime = Date.now();
        if (title) existing.title = title;
      } else {
        visits.unshift({
          id: 'hist_' + Date.now(),
          url,
          title: title || '',
          favicon: '',
          visitCount: 1,
          firstVisitTime: Date.now(),
          lastVisitTime: Date.now(),
        });
      }
      store.set('visits', visits);
      return;
    }
    case 'deleteUrl': {
      const url = args[0] && args[0].url;
      if (!url) return;
      store.set('visits', visits.filter((v) => v.url !== url));
      return;
    }
    case 'deleteAll':
      store.set('visits', []);
      return;
    case 'deleteRange': {
      const opt = args[0] || {};
      store.set('visits', visits.filter((v) => {
        if (opt.startTime && v.lastVisitTime < opt.startTime) return false;
        if (opt.endTime && v.lastVisitTime > opt.endTime) return false;
        return true;
      }));
      return;
    }
    default:
      return;
  }
}

function toChromeHistoryItem(v) {
  return {
    id: String(v.id || ('hist_' + v.lastVisitTime)),
    url: v.url || '',
    title: v.title || '',
    lastVisitTime: v.lastVisitTime || 0,
    visitCount: v.visitCount || 1,
    typedCount: 0,
  };
}

// ==================== commands.getAll 真实化 ====================

function handleCommandsGetAll(extId) {
  if (!extId) return [];
  try {
    const { getInstalledExtensions } = require('./extensions');
    const ext = getInstalledExtensions().find((e) => e.id === extId);
    if (!ext || !ext.path || !fs.existsSync(path.join(ext.path, 'manifest.json'))) return [];
    const manifest = JSON.parse(fs.readFileSync(path.join(ext.path, 'manifest.json'), 'utf8'));
    const commands = manifest.commands || {};
    return Object.keys(commands).map((name) => {
      const cmd = commands[name] || {};
      return {
        name,
        description: cmd.description || '',
        shortcut: (cmd.suggested_key && cmd.suggested_key.default) || '',
      };
    });
  } catch (e) {
    return [];
  }
}

// ==================== chrome.storage 兜底桥接 ====================
// Electron 原生 chrome.storage 在扩展后台页脚本执行时可能尚未就绪（异步初始化），
// 导致依赖 storage 的扩展（如 uBlock Origin）初始化崩溃。这里提供基于主进程的
// 真实 storage 实现：数据持久化到 store 'extensionStorage'，polyfill 在原生
// storage 缺失时接管。
const extensionStorageData = new Map(); // `${extId}:${area}` -> { key: value }
let extensionStorageLoaded = false;

function ensureExtensionStorageLoaded() {
  if (extensionStorageLoaded) return;
  extensionStorageLoaded = true;
  try {
    const store = getStore('extensionStorage');
    const raw = store.get('data');
    if (raw && typeof raw === 'object') {
      Object.keys(raw).forEach((k) => extensionStorageData.set(k, raw[k]));
    }
  } catch (e) { /* 忽略：store 不可用 */ }
}

function saveExtensionStorage() {
  try {
    const store = getStore('extensionStorage');
    const data = {};
    extensionStorageData.forEach((v, k) => { data[k] = v; });
    store.set('data', data);
  } catch (e) { /* 忽略 */ }
}

function extensionStorageGet(extId, area, keys) {
  ensureExtensionStorageLoaded();
  const full = extensionStorageData.get(`${extId}:${area}`) || {};
  if (keys === undefined || keys === null) return Object.assign({}, full);
  let select;
  if (typeof keys === 'string') select = [keys];
  else if (Array.isArray(keys)) select = keys;
  else if (typeof keys === 'object') {
    // { key: default } 形式
    const out = {};
    Object.keys(keys).forEach((k) => {
      out[k] = Object.prototype.hasOwnProperty.call(full, k) ? full[k] : keys[k];
    });
    return out;
  }
  const out = {};
  (select || []).forEach((k) => {
    if (Object.prototype.hasOwnProperty.call(full, k)) out[k] = full[k];
  });
  return out;
}

function extensionStorageSet(extId, area, items) {
  ensureExtensionStorageLoaded();
  const key = `${extId}:${area}`;
  const full = extensionStorageData.get(key) || {};
  Object.keys(items || {}).forEach((k) => { full[k] = items[k]; });
  extensionStorageData.set(key, full);
  saveExtensionStorage();
}

function extensionStorageRemove(extId, area, keys) {
  ensureExtensionStorageLoaded();
  const key = `${extId}:${area}`;
  const full = extensionStorageData.get(key);
  if (!full) return;
  const list = typeof keys === 'string' ? [keys] : (Array.isArray(keys) ? keys : []);
  list.forEach((k) => { delete full[k]; });
  if (Object.keys(full).length === 0) extensionStorageData.delete(key);
  saveExtensionStorage();
}

function extensionStorageClear(extId, area) {
  ensureExtensionStorageLoaded();
  extensionStorageData.delete(`${extId}:${area}`);
  saveExtensionStorage();
}

function handleExtensionStorage(event, { method, id, area, args }) {
  const a = area === 'sync' || area === 'managed' ? area : 'local';
  switch (method) {
    case 'get':
      return extensionStorageGet(id, a, args && args.keys);
    case 'set':
      extensionStorageSet(id, a, args && args.items);
      return true;
    case 'remove':
      extensionStorageRemove(id, a, args && args.keys);
      return true;
    case 'clear':
      extensionStorageClear(id, a);
      return true;
    default:
      return null;
  }
}

// ==================== MV3 模拟后台（参考 Edge ServiceWorkerTaskQueue） ====================
// Electron 43 加载 MV3 扩展但**不运行 service worker**。这里为每个已启用 MV3 扩展创建一个
// 隐藏的 chrome-extension:// 宿主页（有完整 chrome.* API 上下文），把 service_worker 脚本
// 当作普通脚本执行——行为等价于 Edge 的"常驻后台"，使 webRequest（强制走我们的桥接）、
// storage、runtime 消息、onClicked 等可用。
const mv3BackgroundViews = []; // { extId, view }

/** 为所有已启用 MV3 扩展创建模拟后台宿主页 */
function ensureMv3Backgrounds() {
  let list = [];
  try {
    const { getInstalledExtensions } = require('./extensions');
    list = getInstalledExtensions().filter(
      (e) => e.enabled && e.backgroundType === 'service_worker' &&
        e.path && fs.existsSync(path.join(e.path, 'manifest.json'))
    );
  } catch (e) {
    return;
  }

  for (const ext of list) {
    if (mv3BackgroundViews.some((v) => v.extId === ext.id)) continue;
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(ext.path, 'manifest.json'), 'utf8'));
      const swPath = manifest.background && manifest.background.service_worker;
      if (!swPath) continue;

      const view = new BrowserView({
        webPreferences: { session: session.defaultSession, sandbox: false, contextIsolation: true },
      });
      mv3BackgroundViews.push({ extId: ext.id, view });

      // 宿主页用 manifest.json（文本展示，不会自动执行脚本）；SW 脚本统一由我们接管后执行一次
      const hostUrl = `chrome-extension://${ext.id}/manifest.json`;
      view.webContents.loadURL(hostUrl).then(async () => {
        try {
          // 强制接管 chrome.webRequest（Electron 原生对模拟后台不生效）
          await view.webContents.executeJavaScript(
            'window.__neutronTakeoverWebRequest ? (window.__neutronTakeoverWebRequest(), true) : true'
          );
          // 执行 service_worker 脚本（模拟后台运行）
          const swFile = path.join(ext.path, String(swPath).replace(/^\/+/, ''));
          if (fs.existsSync(swFile)) {
            await view.webContents.executeJavaScript(fs.readFileSync(swFile, 'utf8'));
          }
        } catch (e) { /* 忽略：宿主页加载或脚本执行失败 */ }
      }).catch(() => { /* 宿主页加载失败忽略 */ });
    } catch (e) { /* 忽略损坏的扩展 */ }
  }
}

/** 查找 MV3 模拟后台的 webContents */
function findMv3BackgroundWebContents(extId) {
  const entry = mv3BackgroundViews.find((v) => v.extId === extId);
  if (!entry || !entry.view) return null;
  try {
    return entry.view.webContents.isDestroyed() ? null : entry.view.webContents;
  } catch (e) {
    return null;
  }
}

/** 销毁所有 MV3 模拟后台（应用退出时） */
function destroyMv3Backgrounds() {
  for (const entry of mv3BackgroundViews) {
    try {
      if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close();
    } catch (e) { /* 忽略 */ }
  }
  mv3BackgroundViews.length = 0;
}

module.exports = {
  registerExtensionBridgeIpc,
  buildExtensionContextMenuItems,
  contextMenuUnregisterAll,
  ensureWebRequestInit,
  handleBookmarksRequest,
  handleHistoryRequest,
  handleCommandsGetAll,
  handleTabsRequest,
  handleWindowsRequest,
  handleScriptingRequest,
  ensureMv3Backgrounds,
  findMv3BackgroundWebContents,
  destroyMv3Backgrounds,
};
