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
const { session, Notification, ipcMain, BrowserView, powerMonitor, app, dialog } = require('electron');
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

/** Electron 请求头对象 → Chrome 数组 [{name, value}] */
function headersToChromeArray(headers) {
  if (!headers) return undefined;
  if (Array.isArray(headers)) return headers;
  return Object.keys(headers).map((name) => ({ name, value: String(headers[name]) }));
}

/** Chrome 请求头数组 [{name, value}] → Electron 对象 {name: value} */
function headersFromChromeArray(headers) {
  if (!headers) return undefined;
  if (!Array.isArray(headers)) return headers;
  const out = {};
  for (const h of headers) {
    if (h && h.name !== undefined) out[h.name] = h.value;
  }
  return out;
}

/** 根据 webContentsId 反查真实标签页 id（chrome.tabs 风格整数 id） */
function resolveTabIdForRequest(details) {
  try {
    const wm = global.windowManager;
    if (wm && details && details.webContentsId) {
      const tab = wm.tabs && wm.tabs.find((t) =>
        t.view && t.view.webContents && t.view.webContents.id === details.webContentsId
      );
      if (tab) return Number(String(tab.id).replace(/^tab_/, '')) || -1;
    }
  } catch (e) { /* 忽略 */ }
  return -1;
}

/** 将 Electron details 转换为接近 Chrome 的 webRequest details */
function toChromeWebRequestDetails(details) {
  return {
    url: details.url || '',
    method: details.method || 'GET',
    frameId: 0,
    parentFrameId: -1,
    requestId: String(details.id || details.webContentsId || ''),
    timeStamp: Date.now(),
    type: details.resourceType || 'other',
    tabId: resolveTabIdForRequest(details),
    initiator: details.referrer || '',
    requestHeaders: headersToChromeArray(details.requestHeaders),
    responseHeaders: headersToChromeArray(details.responseHeaders),
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

/** 将 Chrome match pattern 转换为 RegExp（支持 * 通配符与 <all_urls>） */
function matchPatternToRegExp(pattern) {
  if (pattern === '<all_urls>') return /^(https?|file|ftp|ws|wss):\/\//i;
  const parts = String(pattern).split('://');
  if (parts.length !== 2) return null;
  const scheme = parts[0].replace(/\*/g, '[a-z0-9+.-]*');
  let rest = parts[1];
  let hostPart = rest;
  let pathPart = '*';
  const slash = rest.indexOf('/');
  if (slash !== -1) {
    hostPart = rest.slice(0, slash);
    pathPart = rest.slice(slash);
  }
  hostPart = hostPart.replace(/\*/g, '[^/]*');
  pathPart = pathPart.replace(/\*/g, '.*');
  return new RegExp('^' + scheme + '://' + hostPart + pathPart + '$', 'i');
}

function urlMatchesAnyPattern(url, patterns) {
  if (!Array.isArray(patterns) || patterns.length === 0) return true;
  for (const p of patterns) {
    const re = matchPatternToRegExp(p);
    if (re && re.test(url)) return true;
  }
  return false;
}

function typeMatchesAny(resourceType, types) {
  if (!Array.isArray(types) || types.length === 0) return true;
  return types.includes(resourceType);
}

function createWebRequestHandler(evt) {
  return async (details, callback) => {
    // 1) DNR 规则评估（所有已启用扩展，独立于 webRequest 监听器）。
    // 仅对可阻塞/可改头的事件评估，非阻塞事件跳过以避免无谓的规则匹配开销。
    let dnrResp = {};
    if (['onBeforeRequest', 'onBeforeSendHeaders', 'onHeadersReceived', 'onAuthRequired'].includes(evt)) {
      try {
        const { evaluateAllDnr } = require('./declarativeNetRequest');
        dnrResp = evaluateAllDnr(evt, details) || {};
      } catch (e) { /* 忽略 */ }
    }

    // 1.5) 内置跟踪器拦截（隐私保护）：仅 onBeforeRequest，且仅子资源请求。
    if (evt === 'onBeforeRequest') {
      try {
        const { getStore } = require('./storage');
        if (getStore('settings').get('trackingProtection', true) !== false) {
          const { evaluateTrackingProtection } = require('./trackingProtection');
          const tp = evaluateTrackingProtection(details);
          if (tp && tp.cancel) dnrResp.cancel = true;
        }
      } catch (e) { /* 忽略 */ }
    }

    const { isSiteAccessAllowed } = require('./extensions');
    const targets = [];
    webRequestRegistry.forEach((reg, extId) => {
      if (reg.events && reg.events[evt] && reg.events[evt].hasListener &&
          isSiteAccessAllowed(extId, details.url)) {
        // 按扩展声明的 filter（urls / types）过滤，对齐 Chrome webRequest
        const f = reg.events[evt].filter || {};
        if (!urlMatchesAnyPattern(details.url, f.urls)) return;
        if (!typeMatchesAny(details.resourceType, f.types)) return;
        targets.push(extId);
      }
    });
    if (targets.length === 0) {
      if (callback) callback(dnrResp);
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

    // 合并各扩展的 blockingResponse（扩展返回 Chrome 格式 → 转换为 Electron 格式）
    const merged = {};
    for (const res of results) {
      if (res.cancel) merged.cancel = true;
      // Chrome redirectUrl → Electron redirectURL
      if (res.redirectUrl && !merged.redirectURL) merged.redirectURL = res.redirectUrl;
      // Chrome 数组头 → Electron 对象头
      const rh = headersFromChromeArray(res.requestHeaders);
      if (rh && !merged.requestHeaders) merged.requestHeaders = rh;
      const rsh = headersFromChromeArray(res.responseHeaders);
      if (rsh && !merged.responseHeaders) merged.responseHeaders = rsh;
      // Chrome authCredentials → Electron username/password
      if (res.authCredentials && !merged.username) {
        merged.username = res.authCredentials.username;
        merged.password = res.authCredentials.password;
      }
      if (res.upgradeToSecure) merged.upgradeToSecure = true;
    }

    // 合并 DNR 结果（DNR 优先级更高）
    if (dnrResp.cancel) merged.cancel = true;
    if (dnrResp.redirectURL && !merged.redirectURL) merged.redirectURL = dnrResp.redirectURL;
    if (dnrResp.requestHeaders && !merged.requestHeaders) merged.requestHeaders = dnrResp.requestHeaders;
    if (dnrResp.responseHeaders && !merged.responseHeaders) merged.responseHeaders = dnrResp.responseHeaders;

    if (callback) callback(merged);
  };
}

function webRequestRegister(extId, evt, hasListener, filter) {
  ensureWebRequestInit();
  let reg = webRequestRegistry.get(extId);
  if (!reg) {
    reg = { events: {} };
    webRequestRegistry.set(extId, reg);
  }
  reg.events[evt] = { hasListener: !!hasListener, filter: filter || {} };
}

function webRequestUnregister(extId, evt) {
  const reg = webRequestRegistry.get(extId);
  if (reg && reg.events) delete reg.events[evt];
  if (reg && Object.keys(reg.events).length === 0) webRequestRegistry.delete(extId);
}

// ==================== contextMenus 注册表 ====================
// extId -> Map(menuId -> { title, contexts, enabled })
const contextMenuRegistry = new Map();

// ==================== 通知管理（notifications.clear 支持按 ID 关闭） ====================
const activeNotifications = new Map(); // `${extId}:${notificationId}` -> Notification

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
    parentId: props && props.parentId !== undefined && props.parentId !== null ? String(props.parentId) : '',
    type: (props && props.type) || 'normal',
    checked: !!(props && props.checked),
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

  // 收集命中上下文的菜单项（含父项），并按 parentId 建立层级
  const nodes = new Map();
  contextMenuRegistry.forEach((map, extId) => {
    map.forEach((item, menuId) => {
      if (!item.title || !item.enabled) return;
      if (!matchesContext(item.contexts)) return;
      nodes.set(String(menuId), {
        extId,
        menuId: String(menuId),
        item,
        parentId: item.parentId || '',
        children: [],
      });
    });
  });

  const roots = [];
  nodes.forEach((node) => {
    if (node.parentId && nodes.has(node.parentId)) {
      nodes.get(node.parentId).children.push(node);
    } else {
      roots.push(node);
    }
  });

  const render = (node) => {
    const t = { label: node.item.title };
    if (node.item.type === 'checkbox') { t.type = 'checkbox'; t.checked = !!node.item.checked; }
    else if (node.item.type === 'radio') { t.type = 'radio'; t.checked = !!node.item.checked; }
    if (node.children.length > 0) {
      t.submenu = node.children.map(render);
    } else {
      t.click = () => {
        const info = {
          menuItemId: node.menuId,
          parentId: node.parentId || undefined,
          pageUrl,
          linkUrl,
          selectionText: selection,
          editable: !!(params && params.isEditable),
          mediaType: params && params.mediaType ? String(params.mediaType) : '',
          srcUrl: params && params.srcURL ? String(params.srcURL) : '',
          checked: !!node.item.checked,
        };
        if (onSelect) onSelect(node.extId, node.menuId, info);
      };
    }
    return t;
  };

  return roots.map(render);
}

// ==================== IPC 注册 ====================

function registerExtensionBridgeIpc() {
  // ---- declarativeNetRequest ----
  try {
    const { registerDnrIpc } = require('./declarativeNetRequest');
    registerDnrIpc();
  } catch (e) { /* 忽略 */ }

  // ---- webRequest ----
  ipcMain.on(IPC_CHANNELS.EXT_WEBREQUEST_REGISTER, (event, { id, evt, hasListener, filter }) => {
    if (!id || !evt || !WEBREQUEST_EVENTS.includes(evt)) return;
    webRequestRegister(id, evt, hasListener, filter);
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
      const key = `${id}:${nid}`;
      activeNotifications.set(key, n);
      n.on('close', () => {
        activeNotifications.delete(key);
        // 通知关闭（用户点击/系统关闭）→ 触发 notifications.onClosed
        try {
          const { findExtensionBackgroundWebContents } = require('./extensions');
          const wc = findExtensionBackgroundWebContents(id);
          if (wc && !wc.isDestroyed()) {
            wc.executeJavaScript(
              `window.__neutronFireNotification && window.__neutronFireNotification('closed', ${JSON.stringify(nid || '')})`
            ).catch(() => {});
          }
        } catch (e) { /* 忽略 */ }
      });
      n.show();
      return Promise.resolve(nid);
    } catch (e) {
      return Promise.resolve(nid);
    }
  });
  ipcMain.on(IPC_CHANNELS.EXT_NOTIFICATIONS_CLEAR, (event, { id, notificationId }) => {
    // 按 ID 关闭通知（Electron Notification 支持 close()）
    try {
      const key = `${id}:${notificationId}`;
      const n = activeNotifications.get(key);
      if (n) {
        try { n.close(); } catch (e) { /* 忽略 */ }
        activeNotifications.delete(key);
      }
    } catch (e) { /* 忽略 */ }
  });

  // ---- cookies ----
  /** 从 IPC sender（扩展页面 webContents）提取扩展 ID */
  function extIdFromSender(sender) {
    try {
      const url = sender && sender.getURL ? sender.getURL() : '';
      const m = /^chrome-extension:\/\/([a-p]{32})\//.exec(url);
      return m ? m[1] : '';
    } catch (e) {
      return '';
    }
  }

  /** cookies 桥接的站点访问检查（无扩展 ID 时放行，向后兼容） */
  function isCookieAccessAllowed(sender, url) {
    const extId = extIdFromSender(sender);
    if (!extId) return true;
    const { isSiteAccessAllowed, getExtensionMenuMeta } = require('./extensions');
    if (!url) {
      // 无 URL 的 getAll：仅全站点模式允许
      const meta = getExtensionMenuMeta(extId);
      return !meta || meta.siteAccess === 'all';
    }
    return isSiteAccessAllowed(extId, url);
  }

  ipcMain.handle(IPC_CHANNELS.EXT_COOKIES_GET, async (event, { url, name }) => {
    try {
      if (!isCookieAccessAllowed(event.sender, url)) return null;
      const cookies = await session.defaultSession.cookies.get({ url });
      return cookies.find((c) => c.name === name) || null;
    } catch (e) {
      return null;
    }
  });
  ipcMain.handle(IPC_CHANNELS.EXT_COOKIES_GET_ALL, async (event, { url }) => {
    try {
      if (!isCookieAccessAllowed(event.sender, url)) return [];
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
      if (!isCookieAccessAllowed(event.sender, d.url || d.domain)) return false;
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
      emitCookieEvent('onChanged', {
        cookie: {
          name: d.name || '',
          value: d.value || '',
          domain: d.domain || (d.url ? new URL(d.url).hostname : ''),
          path: d.path || '/',
          secure: !!d.secure,
          httpOnly: !!d.httpOnly,
        },
        cause: 'explicit',
        removed: false,
      });
      return true;
    } catch (e) {
      return false;
    }
  });
  ipcMain.handle(IPC_CHANNELS.EXT_COOKIES_REMOVE, async (event, { url, name }) => {
    try {
      if (!isCookieAccessAllowed(event.sender, url)) return false;
      await session.defaultSession.cookies.remove(url || '', name || '');
      emitCookieEvent('onChanged', {
        cookie: {
          name: name || '',
          value: '',
          domain: url ? new URL(url).hostname : '',
          path: '/',
          secure: false,
          httpOnly: false,
        },
        cause: 'explicit',
        removed: true,
      });
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

  // ---- i18n ----
  ipcMain.handle(IPC_CHANNELS.EXT_I18N, (event, { id, method, args }) => {
    try {
      return handleI18nRequest(id, method, args || []);
    } catch (e) {
      return method === 'getUILanguage' ? 'en' : '';
    }
  });
  // 同步取词（getMessage/getUILanguage 在 Chrome 中是同步 API，用 sendSync 保持一致语义）
  ipcMain.on(IPC_CHANNELS.EXT_I18N_SYNC, (event, { id }) => {
    try {
      const locale = app.getLocale() || 'en-US';
      event.returnValue = {
        uiLanguage: String(locale).replace(/-/g, '_'),
        messages: readExtI18nMessages(id, locale),
      };
    } catch (e) {
      event.returnValue = { uiLanguage: 'en_US', messages: {} };
    }
  });

  // ---- alarms ----
  ipcMain.handle(IPC_CHANNELS.EXT_ALARMS, (event, { id, method, args }) => {
    try {
      return handleAlarmsRequest(id, method, args || []);
    } catch (e) {
      return null;
    }
  });

  // ---- downloads ----
  ipcMain.handle(IPC_CHANNELS.EXT_DOWNLOADS, async (event, { method, args }) => {
    try {
      return await handleDownloadsRequest(method, args || []);
    } catch (e) {
      return null;
    }
  });

  // ---- topSites ----
  ipcMain.handle(IPC_CHANNELS.EXT_TOPSITES, () => {
    try {
      return handleTopSitesRequest();
    } catch (e) {
      return [];
    }
  });

  // ---- idle ----
  ipcMain.handle(IPC_CHANNELS.EXT_IDLE, (event, { method, args }) => {
    try {
      return handleIdleRequest(method, args || []);
    } catch (e) {
      return null;
    }
  });
  setupIdleListener();

  // ---- permissions ----
  ipcMain.handle(IPC_CHANNELS.EXT_PERMISSIONS, async (event, { id, method, args }) => {
    try {
      return await handlePermissionsRequest(id, method, args || []);
    } catch (e) {
      return method === 'getAll' ? { permissions: [], origins: [] } : false;
    }
  });

  // ---- sessions ----
  ipcMain.handle(IPC_CHANNELS.EXT_SESSIONS, (event, { method, args }) => {
    try {
      return handleSessionsRequest(method, args || []);
    } catch (e) {
      return method === 'getRecentlyClosed' ? [] : null;
    }
  });

  // ---- management ----
  ipcMain.handle(IPC_CHANNELS.EXT_MANAGEMENT, (event, { method, args }) => {
    try {
      return handleManagementRequest(method, args || []);
    } catch (e) {
      return method === 'getAll' ? [] : null;
    }
  });

  // ---- browsingData ----
  ipcMain.handle(IPC_CHANNELS.EXT_BROWSING_DATA, async (event, { method, args }) => {
    try {
      return await handleBrowsingDataRequest(method, args || []);
    } catch (e) {
      return undefined;
    }
  });

  // ---- chrome.runtime 消息桥接 ----
  // 扩展页面 → 后台（或跨扩展）
  ipcMain.handle(IPC_CHANNELS.EXT_RUNTIME_SEND_MESSAGE, async (event, { extId, message, targetExtId }) => {
    try {
      const target = targetExtId || extId;
      return await sendToExtensionBackground(target, message, { id: extId });
    } catch (e) {
      return undefined;
    }
  });

  // 后台 → 内容脚本（chrome.tabs.sendMessage）
  ipcMain.handle(IPC_CHANNELS.EXT_TABS_SEND_MESSAGE, async (event, { extId, tabId, message }) => {
    try {
      return await dispatchToContentScript(tabId, message, { id: extId });
    } catch (e) {
      return undefined;
    }
  });

  // 内容脚本 → 后台
  ipcMain.handle(IPC_CHANNELS.EXT_CS_SEND_MESSAGE, async (event, { extId, tabId, message }) => {
    try {
      let realTabId = tabId;
      const wm = global.windowManager;
      if (wm && event.sender) {
        const t = wm.tabs.find((x) => x.view && x.view.webContents && x.view.webContents.id === event.sender.id);
        if (t) realTabId = Number(String(t.id).replace(/^tab_/, '')) || tabId;
      }
      return await sendToExtensionBackground(extId, message, {
        id: extId,
        tab: { id: realTabId, url: '', title: '' },
      });
    } catch (e) {
      return undefined;
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

/** 安全解析扩展内相对路径，拒绝 .. 路径穿越 */
function resolveExtFile(extRoot, rel) {
  const root = path.resolve(extRoot);
  const target = path.resolve(root, String(rel || '').replace(/^[/\\]+/, ''));
  if (target !== root && !target.startsWith(root + path.sep)) return null;
  return target;
}

/** 扩展内容脚本隔离世界 id */
const EXT_ISOLATED_WORLD_ID = 999;

/** 按 world 参数在指定上下文执行脚本（ISOLATED 走隔离世界，MAIN 走主世界） */
function executeInWorld(wc, code, world) {
  if (world === 'ISOLATED' && typeof wc.executeJavaScriptInIsolatedWorld === 'function') {
    return wc.executeJavaScriptInIsolatedWorld(EXT_ISOLATED_WORLD_ID, [{ code }]);
  }
  return wc.executeJavaScript(code);
}

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
        const world = details.world || 'ISOLATED';
        const shim = (world === 'ISOLATED' && extId) ? buildContentScriptRuntimeShim(extId) : '';
        // 注入扩展文件
        if (details.files && details.files.length && ext && ext.path) {
          const results = [];
          for (const f of details.files) {
            const filePath = resolveExtFile(ext.path, f);
            if (!filePath || !fs.existsSync(filePath)) continue;
            const content = fs.readFileSync(filePath, 'utf8');
            try {
              const r = await executeInWorld(wc, shim + content, world);
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
          const code = shim + '(function(){ try { return (' + fnSrc + ').apply(null, ' + argsJson + '); } catch(e) { return { __neutronErr: String((e && e.message) || e) }; } })()';
          try {
            const r = await executeInWorld(wc, code, world);
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
            const filePath = resolveExtFile(ext.path, f);
            if (!filePath || !fs.existsSync(filePath)) continue;
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
            const filePath = resolveExtFile(ext.path, f);
            if (!filePath || !fs.existsSync(filePath)) continue;
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
  const walk = (folder) => {
    if (!folder) return null;
    for (const child of (folder.children || [])) {
      if (child.id === id) return { parentId: folder.id, parent: folder };
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
      // Chrome 语义：未指定 parentId 时默认放入「其他书签」(other)
      const parentId = props.parentId || 'other';
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
      emitBookmarkEvent('onCreated', node.id, toChromeBookmarkNode(node, parentId));
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
      const changeInfo = {};
      if (changes.title !== undefined) changeInfo.title = changes.title;
      if (changes.url !== undefined) changeInfo.url = changes.url;
      emitBookmarkEvent('onChanged', id, changeInfo);
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
      emitBookmarkEvent('onMoved', id, {
        parentId: target.id, index: insIdx, oldParentId: found.parentId, oldIndex: idx,
      });
      return toChromeBookmarkNode(node, target.id);
    }
    case 'remove':
    case 'removeTree': {
      const id = String(args[0] || '');
      const found = findBookmarkParent(bookmarks, id);
      if (!found) return null;
      const rmIdx = found.parent.children.findIndex((c) => c.id === id);
      found.parent.children = found.parent.children.filter((c) => c.id !== id);
      saveBookmarks(bookmarks);
      emitBookmarkEvent('onRemoved', id, { parentId: found.parentId, index: rmIdx });
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
      const item = existing || visits[0];
      if (item) emitHistoryEvent('onVisited', toChromeHistoryItem(item));
      return;
    }
    case 'deleteUrl': {
      const url = args[0] && args[0].url;
      if (!url) return;
      store.set('visits', visits.filter((v) => v.url !== url));
      emitHistoryEvent('onVisitRemoved', { allHistory: false, urls: [url] });
      return;
    }
    case 'deleteAll':
      store.set('visits', []);
      emitHistoryEvent('onVisitRemoved', { allHistory: true, urls: [] });
      return;
    case 'deleteRange': {
      const opt = args[0] || {};
      // 删除 [startTime, endTime] 区间内的记录，保留区间外
      const keep = [];
      const removedUrls = [];
      for (const v of visits) {
        const inRange = (!opt.startTime || v.lastVisitTime >= opt.startTime) &&
          (!opt.endTime || v.lastVisitTime <= opt.endTime);
        if (inRange) removedUrls.push(v.url); else keep.push(v);
      }
      store.set('visits', keep);
      emitHistoryEvent('onVisitRemoved', { allHistory: false, urls: removedUrls });
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
    const platform = process.platform;
    const platformKey = platform === 'darwin' ? 'mac'
      : (platform === 'win32' ? 'windows' : 'linux');
    return Object.keys(commands).map((name) => {
      const cmd = commands[name] || {};
      const sk = cmd.suggested_key || {};
      return {
        name,
        description: cmd.description || '',
        shortcut: sk[platformKey] || sk.default || '',
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
  const changes = {};
  Object.keys(items || {}).forEach((k) => {
    const oldValue = full[k];
    const newValue = items[k];
    full[k] = newValue;
    changes[k] = { oldValue, newValue };
  });
  extensionStorageData.set(key, full);
  saveExtensionStorage();
  if (Object.keys(changes).length > 0) emitStorageEvent('onChanged', changes, area);
}

function extensionStorageRemove(extId, area, keys) {
  ensureExtensionStorageLoaded();
  const key = `${extId}:${area}`;
  const full = extensionStorageData.get(key);
  if (!full) return;
  const list = typeof keys === 'string' ? [keys] : (Array.isArray(keys) ? keys : []);
  const changes = {};
  list.forEach((k) => {
    if (Object.prototype.hasOwnProperty.call(full, k)) {
      changes[k] = { oldValue: full[k], newValue: undefined };
      delete full[k];
    }
  });
  if (Object.keys(full).length === 0) extensionStorageData.delete(key);
  saveExtensionStorage();
  if (Object.keys(changes).length > 0) emitStorageEvent('onChanged', changes, area);
}

function extensionStorageClear(extId, area) {
  ensureExtensionStorageLoaded();
  const key = `${extId}:${area}`;
  const full = extensionStorageData.get(key) || {};
  const changes = {};
  Object.keys(full).forEach((k) => { changes[k] = { oldValue: full[k], newValue: undefined }; });
  extensionStorageData.delete(key);
  saveExtensionStorage();
  if (Object.keys(changes).length > 0) emitStorageEvent('onChanged', changes, area);
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

// ==================== chrome.i18n ====================

function readExtI18nMessages(extId, locale) {
  try {
    const { getInstalledExtensions } = require('./extensions');
    const ext = getInstalledExtensions().find((e) => e.id === extId);
    if (!ext || !ext.path) return {};
    const manifest = JSON.parse(fs.readFileSync(path.join(ext.path, 'manifest.json'), 'utf8'));
    const defaultLocale = manifest.default_locale || '';
    let messages = {};
    const tryLocale = (loc) => {
      if (!loc) return;
      const file = path.join(ext.path, '_locales', loc, 'messages.json');
      if (fs.existsSync(file)) {
        try { messages = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { /* 忽略 */ }
      }
    };
    if (locale && locale !== defaultLocale) tryLocale(locale);
    if (Object.keys(messages).length === 0) tryLocale(defaultLocale);
    return messages;
  } catch (e) {
    return {};
  }
}

function handleI18nRequest(extId, method, args) {
  if (method === 'getUILanguage') {
    return String(app.getLocale() || 'en-US').replace(/-/g, '_');
  }
  if (method === 'getAcceptLanguages') {
    return [app.getLocale() || 'en-US'];
  }
  // getMessage(messageName, substitutions)
  const locale = app.getLocale() || 'en-US';
  const messages = readExtI18nMessages(extId, locale);
  const name = String(args[0] || '');
  const entry = messages[name];
  if (!entry || entry.message === undefined) return '';
  const subs = Array.isArray(args[1]) ? args[1] : [];
  return String(entry.message)
    .replace(/\$\$/g, '\u0000')
    .replace(/\$(\d)/g, (m, n) => {
      const i = Number(n) - 1;
      return i < subs.length ? String(subs[i]) : '';
    })
    .replace(/\u0000/g, '$');
}

// ==================== chrome.alarms ====================
const alarmStore = new Map();  // `${extId}:${name}` -> alarm 对象
const alarmTimers = new Map(); // `${extId}:${name}` -> timeout

function fireAlarm(extId, name) {
  try {
    const { findExtensionBackgroundWebContents } = require('./extensions');
    const wc = findExtensionBackgroundWebContents(extId);
    if (!wc || wc.isDestroyed()) return;
    wc.executeJavaScript(
      `window.__neutronFireAlarm && window.__neutronFireAlarm(${JSON.stringify({ name })})`
    ).catch(() => {});
  } catch (e) { /* 忽略 */ }
}

function scheduleAlarm(extId, name, alarm) {
  const key = `${extId}:${name}`;
  const old = alarmTimers.get(key);
  if (old) { clearTimeout(old); alarmTimers.delete(key); }
  if (!alarm) return;
  const delay = Math.max(0, (alarm.scheduledTime || Date.now()) - Date.now());
  const timer = setTimeout(() => {
    alarmTimers.delete(key);
    fireAlarm(extId, name);
    if (alarm.periodInMinutes && alarm.periodInMinutes > 0) {
      const next = { ...alarm, scheduledTime: Date.now() + alarm.periodInMinutes * 60 * 1000 };
      alarmStore.set(key, next);
      scheduleAlarm(extId, name, next);
    } else {
      alarmStore.delete(key);
    }
  }, delay);
  alarmTimers.set(key, timer);
}

function alarmToChrome(alarm) {
  return {
    name: alarm.name,
    scheduledTime: alarm.scheduledTime || Date.now(),
    periodInMinutes: alarm.periodInMinutes,
  };
}

function clearAlarmsForExt(extId) {
  for (const key of Array.from(alarmStore.keys())) {
    if (key.startsWith(`${extId}:`)) {
      const t = alarmTimers.get(key);
      if (t) { clearTimeout(t); alarmTimers.delete(key); }
      alarmStore.delete(key);
    }
  }
}

function handleAlarmsRequest(extId, method, args) {
  const normName = (v) => (v === undefined || v === null || v === '' ? '' : String(v));
  switch (method) {
    case 'create': {
      const name = normName(args[0]);
      const info = args[1] || {};
      let scheduledTime = Date.now();
      if (info.when) scheduledTime = Number(info.when);
      else if (info.delayInMinutes) scheduledTime = Date.now() + Number(info.delayInMinutes) * 60 * 1000;
      const alarm = {
        name,
        scheduledTime,
        periodInMinutes: info.periodInMinutes ? Number(info.periodInMinutes) : undefined,
      };
      alarmStore.set(`${extId}:${name}`, alarm);
      scheduleAlarm(extId, name, alarm);
      return undefined;
    }
    case 'get': {
      const alarm = alarmStore.get(`${extId}:${normName(args[0])}`);
      return alarm ? alarmToChrome(alarm) : undefined;
    }
    case 'getAll': {
      const out = [];
      alarmStore.forEach((alarm, key) => {
        if (key.startsWith(`${extId}:`)) out.push(alarmToChrome(alarm));
      });
      return out;
    }
    case 'clear': {
      const name = normName(args[0]);
      const key = `${extId}:${name}`;
      const existed = alarmStore.has(key);
      const t = alarmTimers.get(key);
      if (t) { clearTimeout(t); alarmTimers.delete(key); }
      alarmStore.delete(key);
      return existed;
    }
    case 'clearAll': {
      let cleared = false;
      for (const key of Array.from(alarmStore.keys())) {
        if (key.startsWith(`${extId}:`)) {
          cleared = true;
          const t = alarmTimers.get(key);
          if (t) { clearTimeout(t); alarmTimers.delete(key); }
          alarmStore.delete(key);
        }
      }
      return cleared;
    }
    default:
      return undefined;
  }
}

// ==================== chrome.downloads ====================

function handleDownloadsRequest(method, args) {
  const { getStore } = require('./storage');
  const wm = global.windowManager;
  const store = getStore('downloads');
  const items = store.get('items', []);
  const indexOfId = (id) => items.findIndex((it, i) => (i + 1) === Number(id));

  switch (method) {
    case 'download': {
      const url = args[0] && args[0].url;
      if (!url) return -1;
      let wc = null;
      if (wm && wm.activeTabId) {
        const tab = wm.tabs.find((t) => t.id === wm.activeTabId);
        if (tab && tab.view && tab.view.webContents && !tab.view.webContents.isDestroyed()) wc = tab.view.webContents;
      }
      if (!wc && wm && wm.mainWindow && !wm.mainWindow.isDestroyed()) wc = wm.mainWindow.webContents;
      if (wc) wc.downloadURL(url);
      return items.length + 1;
    }
    case 'search': {
      return items.map((it, i) => ({
        id: i + 1,
        url: it.url || it.sourceUrl || '',
        filename: it.path || it.savePath || it.filename || '',
        state: it.state === 'completed' ? 'complete' : (it.state || 'in_progress'),
        bytesReceived: it.receivedBytes || it.received || 0,
        totalBytes: it.totalBytes || it.total || 0,
        exists: true,
      }));
    }
    case 'erase': {
      const idx = indexOfId(args[0]);
      if (idx !== -1) {
        const next = items.slice();
        next.splice(idx, 1);
        store.set('items', next);
      }
      return undefined;
    }
    case 'cancel':
    case 'pause':
    case 'resume': {
      const idx = indexOfId(args[0]);
      const item = idx !== -1 ? items[idx] : null;
      const fnName = method + 'Download';
      if (item && wm && typeof wm[fnName] === 'function') {
        wm[fnName](String(item.id));
      }
      return undefined;
    }
    default:
      return undefined;
  }
}

// ==================== chrome.topSites ====================

function handleTopSitesRequest() {
  const { getStore } = require('./storage');
  const visits = getStore('history').get('visits', []);
  const byUrl = new Map();
  for (const v of visits) {
    if (!v || !/^https?:/i.test(v.url || '')) continue;
    const cur = byUrl.get(v.url);
    if (!cur || (v.visitCount || 1) > (cur.visitCount || 1)) byUrl.set(v.url, v);
  }
  return Array.from(byUrl.values())
    .sort((a, b) => (b.visitCount || 1) - (a.visitCount || 1))
    .slice(0, 20)
    .map((v) => ({ url: v.url, title: v.title || '' }));
}

// ==================== chrome.idle ====================
let idleListenerSetup = false;

function setupIdleListener() {
  if (idleListenerSetup) return;
  idleListenerSetup = true;
  try {
    powerMonitor.on('lock-screen', () => emitIdleEvent('onStateChanged', 'locked'));
    powerMonitor.on('unlock-screen', () => emitIdleEvent('onStateChanged', 'active'));
    powerMonitor.on('suspend', () => emitIdleEvent('onStateChanged', 'locked'));
    powerMonitor.on('resume', () => emitIdleEvent('onStateChanged', 'active'));
  } catch (e) { /* 忽略 */ }
}

function handleIdleRequest(method, args) {
  if (method === 'queryState') {
    const secs = Number(args[0]) || 60;
    try {
      const state = powerMonitor.getSystemIdleState(secs);
      if (state === 'locked') return 'locked';
      if (state === 'idle') return 'idle';
      return 'active';
    } catch (e) {
      return 'active';
    }
  }
  if (method === 'setDetectionInterval') return undefined;
  return undefined;
}

// ==================== chrome.permissions ====================

function readManifestForExt(ext) {
  try {
    if (!ext || !ext.path) return {};
    return JSON.parse(fs.readFileSync(path.join(ext.path, 'manifest.json'), 'utf8'));
  } catch (e) {
    return {};
  }
}

async function handlePermissionsRequest(extId, method, args) {
  const { getInstalledExtensions } = require('./extensions');
  const ext = getInstalledExtensions().find((e) => e.id === extId);
  if (!ext) return method === 'getAll' ? { permissions: [], origins: [] } : false;
  const manifest = readManifestForExt(ext);
  const manifestPerms = Array.isArray(manifest.permissions) ? manifest.permissions : [];
  const manifestOrigins = Array.isArray(manifest.host_permissions) ? manifest.host_permissions : [];
  const granted = Array.isArray(ext.grantedPermissions) ? ext.grantedPermissions : [];
  const grantedOrigins = Array.isArray(ext.grantedOrigins) ? ext.grantedOrigins : [];

  const save = () => {
    const installed = getInstalledExtensions();
    const target = installed.find((e) => e.id === extId);
    if (target) {
      target.grantedPermissions = granted;
      target.grantedOrigins = grantedOrigins;
      getStore('extensions').set('installed', installed);
    }
  };

  switch (method) {
    case 'contains': {
      const req = args[0] || {};
      const list = [...(req.permissions || []), ...(req.origins || [])];
      const all = new Set([...manifestPerms, ...manifestOrigins, ...granted, ...grantedOrigins]);
      return list.every((p) => all.has(p));
    }
    case 'getAll': {
      return {
        permissions: [...new Set([...manifestPerms, ...granted])],
        origins: [...new Set([...manifestOrigins, ...grantedOrigins])],
      };
    }
    case 'request': {
      const req = args[0] || {};
      const list = [...(req.permissions || []), ...(req.origins || [])].filter(Boolean);
      if (list.length === 0) return true;
      const wm = global.windowManager;
      const parent = wm && wm.mainWindow && !wm.mainWindow.isDestroyed() ? wm.mainWindow : undefined;
      const { response } = await dialog.showMessageBox(parent, {
        type: 'info',
        title: `“${ext.name || '扩展'}”请求额外权限`,
        message: '允许此扩展获取以下权限吗？',
        detail: list.map((p) => `•  ${p}`).join('\n'),
        buttons: ['取消', '允许'],
        defaultId: 1,
        cancelId: 0,
        noLink: true,
      });
      if (response !== 1) return false;
      for (const p of list) {
        if (p.includes('://') || p.startsWith('<all_urls>') || p.startsWith('*://')) {
          if (!grantedOrigins.includes(p)) grantedOrigins.push(p);
        } else if (!granted.includes(p)) {
          granted.push(p);
        }
      }
      save();
      return true;
    }
    case 'remove': {
      const req = args[0] || {};
      const list = [...(req.permissions || []), ...(req.origins || [])];
      for (const p of list) {
        const pi = granted.indexOf(p); if (pi !== -1) granted.splice(pi, 1);
        const oi = grantedOrigins.indexOf(p); if (oi !== -1) grantedOrigins.splice(oi, 1);
      }
      save();
      return true;
    }
    default:
      return false;
  }
}

// ==================== chrome.sessions / management / browsingData ====================

function handleSessionsRequest(method, args) {
  const wm = global.windowManager;
  switch (method) {
    case 'getRecentlyClosed': {
      if (!wm) return [];
      const maxResults = args[0] && args[0].maxResults ? Number(args[0].maxResults) : 25;
      return (wm.recentlyClosed || []).slice(0, maxResults).map((t) => ({
        tab: {
          sessionId: String(t.id),
          tabId: Number(String(t.id).replace(/^tab_/, '')) || 0,
          windowId: 1,
          url: t.url || '',
          title: t.title || '',
          lastModified: t.closedAt || Date.now(),
        },
        lastModified: t.closedAt || Date.now(),
      }));
    }
    case 'restore': {
      if (!wm) return null;
      const item = (wm.recentlyClosed || []).find((t) => String(t.id) === String(args[0]));
      if (!item) return null;
      wm.restoreRecentlyClosed(item.id);
      return { sessionId: String(item.id), windowId: 1 };
    }
    default:
      return [];
  }
}

function managementItem(ext) {
  const manifest = readManifestForExt(ext);
  return {
    id: ext.id,
    name: ext.name,
    description: ext.description || '',
    version: ext.version || '',
    enabled: !!ext.enabled,
    installType: ext.source === 'edge_store' ? 'normal' : 'development',
    mayDisable: true,
    optionsUrl: manifest.options_page || (manifest.options_ui && manifest.options_ui.page) || '',
    homepageUrl: manifest.homepage_url || manifest.homepage || '',
  };
}

function handleManagementRequest(method, args) {
  const { getInstalledExtensions } = require('./extensions');
  const exts = getInstalledExtensions();
  switch (method) {
    case 'getAll':
      return exts.map(managementItem);
    case 'get': {
      const ext = exts.find((e) => e.id === args[0]);
      return ext ? managementItem(ext) : null;
    }
    default:
      return null;
  }
}

function handleBrowsingDataRequest(method, args) {
  const { getStore } = require('./storage');
  switch (method) {
    case 'remove': {
      const dataTypes = args[0] || {};
      const options = args[1] || {};
      const since = Number(options.since) || 0;
      if (dataTypes.history) {
        const visits = getStore('history').get('visits', []);
        getStore('history').set('visits', visits.filter((v) => (v.lastVisitTime || 0) < since));
      }
      if (dataTypes.cookies) {
        session.defaultSession.clearStorageData({ storages: ['cookies'] }).catch(() => {});
      }
      if (dataTypes.cache) {
        session.defaultSession.clearCache().catch(() => {});
      }
      if (dataTypes.downloads) {
        getStore('downloads').set('items', []);
      }
      return undefined;
    }
    default:
      return undefined;
  }
}

// ==================== chrome.runtime 消息桥接 ====================

/** 生成内容脚本 chrome.runtime shim（注入隔离世界，extId 内嵌用于归属路由） */
function buildContentScriptRuntimeShim(extId) {
  const extIdJson = JSON.stringify(extId || '');
  return `(function () {
  if (window.__neutronCsRuntime) return;
  var extId = ${extIdJson};
  var pending = {};
  var msgSeq = 0;
  var onMessageListeners = [];
  function post(data) { try { window.postMessage({ __neutronCsMsg: data }, '*'); } catch (e) {} }
  window.addEventListener('message', function (e) {
    try {
      var d = e.data;
      if (!d || !d.__neutronCsResp) return;
      var p = pending[d.id];
      if (p) { delete pending[d.id]; if (d.error) p.reject(new Error(d.error)); else p.resolve(d.result); }
    } catch (err) {}
  });
  var chrome = window.chrome || (window.chrome = {});
  var runtime = chrome.runtime || (chrome.runtime = {});
  runtime.sendMessage = function (message, callback) {
    var id = ++msgSeq;
    var pr = new Promise(function (resolve, reject) {
      pending[id] = { resolve: resolve, reject: reject };
      post({ type: 'sendMessage', id: id, extId: extId, message: message });
    });
    if (typeof callback === 'function') { pr.then(function (r) { callback(r); }, function () {}); return; }
    return pr;
  };
  runtime.onMessage = {
    addListener: function (fn) { if (onMessageListeners.indexOf(fn) === -1) onMessageListeners.push(fn); },
    removeListener: function (fn) { var i = onMessageListeners.indexOf(fn); if (i >= 0) onMessageListeners.splice(i, 1); },
    hasListener: function (fn) { return onMessageListeners.indexOf(fn) >= 0; }
  };
  window.__neutronDispatchRuntimeMessage = function (message, sender) {
    var results = [];
    onMessageListeners.slice().forEach(function (fn) {
      try {
        var r = fn(message, sender || {}, function (resp) { results.push(resp); });
        if (r && typeof r.then === 'function') results.push(r);
        else if (r !== undefined) results.push(r);
      } catch (err) {}
    });
    var hasPromise = results.some(function (x) { return x && typeof x.then === 'function'; });
    if (!hasPromise) return results.length > 0 ? results[0] : undefined;
    return Promise.all(results.map(function (x) { return x && typeof x.then === 'function' ? x : Promise.resolve(x); }))
      .then(function (arr) { return arr.length > 0 ? arr[0] : undefined; });
  };
  window.__neutronCsRuntime = true;
})();`;
}

/** 向指定标签页的内容脚本派发消息（隔离世界 999），返回响应 */
async function dispatchToContentScript(tabId, message, sender) {
  const wm = global.windowManager;
  if (!wm) return undefined;
  const chromeId = Number(tabId);
  const tab = wm.tabs.find((t) => Number(String(t.id).replace(/^tab_/, '')) === chromeId);
  if (!tab || !tab.view || tab.view.webContents.isDestroyed()) return undefined;
  const wc = tab.view.webContents;
  if (typeof wc.executeJavaScriptInIsolatedWorld !== 'function') return undefined;
  const code = `window.__neutronDispatchRuntimeMessage && window.__neutronDispatchRuntimeMessage(${JSON.stringify(message)}, ${JSON.stringify(sender || {})})`;
  try {
    return await wc.executeJavaScriptInIsolatedWorld(EXT_ISOLATED_WORLD_ID, [{ code }]);
  } catch (e) {
    return undefined;
  }
}

/** 向扩展后台派发消息（content script 或扩展页面 → 后台），返回响应 */
async function sendToExtensionBackground(extId, message, sender) {
  try {
    const { findExtensionBackgroundWebContents } = require('./extensions');
    const wc = findExtensionBackgroundWebContents(extId);
    if (!wc || wc.isDestroyed()) return undefined;
    const code = `window.__neutronFireRuntimeMessage && window.__neutronFireRuntimeMessage(${JSON.stringify(message)}, ${JSON.stringify(sender || {})})`;
    return await wc.executeJavaScript(code);
  } catch (e) {
    return undefined;
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
        webPreferences: {
          session: session.defaultSession,
          sandbox: false,
          contextIsolation: true,
          backgroundThrottling: false, // 后台页永不显示，避免定时器被节流
        },
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

/** 销毁指定扩展的 MV3 模拟后台（禁用/卸载时调用，避免后台脚本泄漏继续运行） */
function destroyMv3Background(extId) {
  const idx = mv3BackgroundViews.findIndex((v) => v.extId === extId);
  if (idx === -1) return;
  const entry = mv3BackgroundViews[idx];
  try {
    if (entry.view && entry.view.webContents && !entry.view.webContents.isDestroyed()) {
      entry.view.webContents.close();
    }
  } catch (e) { /* 忽略 */ }
  mv3BackgroundViews.splice(idx, 1);
}

// ==================== tabs / windows 事件派发（对齐 Edge：chrome.tabs/chrome.windows 事件） ====================
// Electron 原生不会向扩展后台派发标签页/窗口生命周期事件，这里由 windowManager 在各生命周期
// 回调中主动广播，polyfill-webnav.js 的 __neutronFireTabEvent/__neutronFireWindowEvent 触发监听器。

// namespace -> 扩展页面主世界 fire 函数名（由 polyfill-webnav.js 定义）
const EVENT_FN_MAP = {
  tabs: '__neutronFireTabEvent',
  windows: '__neutronFireWindowEvent',
  bookmarks: '__neutronFireBookmarkEvent',
  history: '__neutronFireHistoryEvent',
  cookies: '__neutronFireCookieEvent',
  storage: '__neutronFireStorageEvent',
  idle: '__neutronFireIdleEvent',
};

function emitExtensionEvent(namespace, eventName, argsArray) {
  try {
    const fnName = EVENT_FN_MAP[namespace];
    if (!fnName) return;
    const { getInstalledExtensions, findExtensionBackgroundWebContents } = require('./extensions');
    for (const ext of getInstalledExtensions().filter((e) => e.enabled)) {
      const wc = findExtensionBackgroundWebContents(ext.id);
      if (!wc || wc.isDestroyed()) continue;
      wc.executeJavaScript(
        `window.${fnName} && window.${fnName}(${JSON.stringify(eventName)}, ${JSON.stringify(argsArray || [])})`
      ).catch(() => {});
    }
  } catch (e) { /* 忽略 */ }
}

function emitTabEvent(eventName, ...args) { emitExtensionEvent('tabs', eventName, args); }
function emitWindowEvent(eventName, ...args) { emitExtensionEvent('windows', eventName, args); }
function emitBookmarkEvent(eventName, ...args) { emitExtensionEvent('bookmarks', eventName, args); }
function emitHistoryEvent(eventName, ...args) { emitExtensionEvent('history', eventName, args); }
function emitCookieEvent(eventName, ...args) { emitExtensionEvent('cookies', eventName, args); }
function emitStorageEvent(eventName, ...args) { emitExtensionEvent('storage', eventName, args); }
function emitIdleEvent(eventName, ...args) { emitExtensionEvent('idle', eventName, args); }

function notifyTabCreated(tab) {
  const wm = global.windowManager;
  if (!wm) return;
  emitTabEvent('onCreated', tabToChrome(tab, wm.tabs.indexOf(tab)));
}

function notifyTabRemoved(tabId, isWindowClosing = false) {
  emitTabEvent('onRemoved', tabToChromeId(tabId), { windowId: 1, isWindowClosing });
}

function notifyTabActivated(tabId) {
  emitTabEvent('onActivated', { tabId: tabToChromeId(tabId), windowId: 1 });
}

function notifyTabUpdated(tab, changeInfo) {
  const wm = global.windowManager;
  if (!wm) return;
  emitTabEvent('onUpdated', tabToChromeId(tab.id), changeInfo || {}, tabToChrome(tab, wm.tabs.indexOf(tab)));
}

function notifyWindowCreated() {
  const wm = global.windowManager;
  if (!wm) return;
  emitWindowEvent('onCreated', windowToChrome(wm));
}

function notifyTabMoved(tabId, fromIndex, toIndex) {
  emitTabEvent('onMoved', tabToChromeId(tabId), { windowId: 1, fromIndex, toIndex });
}

function notifyWindowFocused() {
  emitWindowEvent('onFocusChanged', 1);
}

function notifyWindowBoundsChanged() {
  const wm = global.windowManager;
  if (!wm) return;
  emitWindowEvent('onBoundsChanged', windowToChrome(wm));
}

function notifyWindowRemoved() {
  emitWindowEvent('onRemoved', 1);
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
  destroyMv3Background,
  notifyTabCreated,
  notifyTabRemoved,
  notifyTabActivated,
  notifyTabUpdated,
  notifyWindowCreated,
  notifyTabMoved,
  notifyWindowFocused,
  notifyWindowBoundsChanged,
  notifyWindowRemoved,
  clearAlarmsForExt,
};
