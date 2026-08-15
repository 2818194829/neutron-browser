/**
 * 扩展 API Polyfill（系统性全覆盖，注入到 chrome-extension:// 页面）
 *
 * Electron 只实现了 Chrome 扩展 API 的有限子集。不同扩展依赖不同的 API，
 * 依赖未实现 API 的扩展会后台脚本崩溃 / 选项页空白（如 Adblock Plus 用
 * chrome.webNavigation）。此脚本对 Electron 缺失的常见扩展 API 提供安全
 * 的 stub，保证扩展能正常加载、选项页能打开，尽量提升兼容范围。
 *
 * 设计原则：
 * - 只补 Electron 未提供的 API/方法（ensure 逐项检查，不覆盖已有实现）
 * - 所有方法同时支持 callback 形式（MV2）与 Promise 形式（webextension-polyfill）
 * - 查询类返回空结果，操作类空操作，事件提供 listener 对象
 * - 仅对 chrome-extension: 协议页面生效（由 session.setPreloads 注入）
 */
const { webFrame, contextBridge, ipcRenderer, webUtils } = require('electron');
// sandbox preload 无法 require 相对路径模块（Electron 创建的扩展页面默认 sandbox），
// 这里内联 IPC 频道名，必须与 src/shared/constants.js 保持一致。
const IPC_CHANNELS = {
  EXTENSIONS_ACTION_BADGE: 'extensions:actionBadge',
  EXT_WEBREQUEST_REGISTER: 'ext:webRequestRegister',
  EXT_WEBREQUEST_UNREGISTER: 'ext:webRequestUnregister',
  EXT_NOTIFICATIONS_CREATE: 'ext:notificationsCreate',
  EXT_NOTIFICATIONS_CLEAR: 'ext:notificationsClear',
  EXT_COOKIES_GET: 'ext:cookiesGet',
  EXT_COOKIES_GET_ALL: 'ext:cookiesGetAll',
  EXT_COOKIES_SET: 'ext:cookiesSet',
  EXT_COOKIES_REMOVE: 'ext:cookiesRemove',
  EXT_CONTEXTMENU_REGISTER: 'ext:contextMenuRegister',
  EXT_CONTEXTMENU_UNREGISTER: 'ext:contextMenuUnregister',
  EXT_BOOKMARKS: 'ext:bookmarks',
  EXT_HISTORY: 'ext:history',
  EXT_COMMANDS_GET_ALL: 'ext:commandsGetAll',
  EXT_TABS: 'ext:tabs',
  EXT_WINDOWS: 'ext:windows',
  EXT_SCRIPTING: 'ext:scripting',
  EXT_STORAGE: 'ext:storage',
  EXT_I18N: 'ext:i18n',
  EXT_I18N_SYNC: 'ext:i18nSync',
  EXT_DNR: 'ext:dnr',
  EXT_SESSIONS: 'ext:sessions',
  EXT_MANAGEMENT: 'ext:management',
  EXT_BROWSING_DATA: 'ext:browsingData',
  EXT_RUNTIME_SEND_MESSAGE: 'ext:runtimeSendMessage',
  EXT_TABS_SEND_MESSAGE: 'ext:tabsSendMessage',
  EXT_CS_SEND_MESSAGE: 'ext:csSendMessage',
  EXT_ALARMS: 'ext:alarms',
  EXT_DOWNLOADS: 'ext:downloads',
  EXT_TOPSITES: 'ext:topSites',
  EXT_IDLE: 'ext:idle',
  EXT_PERMISSIONS: 'ext:permissions',
};

if (location.protocol === 'chrome-extension:') {
  const extId = location.host;

  // 为扩展页面暴露真实桥接：browserAction/action / webRequest / notifications / cookies / contextMenus → 主进程
  const neutronExtBridge = {
    // browserAction / action
    setBadgeText: (text) =>
      ipcRenderer.send(IPC_CHANNELS.EXTENSIONS_ACTION_BADGE, { id: extId, patch: { text: text || '' } }),
    setBadgeBackgroundColor: (color) =>
      ipcRenderer.send(IPC_CHANNELS.EXTENSIONS_ACTION_BADGE, { id: extId, patch: { color: color || '#666666' } }),
    setTitle: (title) =>
      ipcRenderer.send(IPC_CHANNELS.EXTENSIONS_ACTION_BADGE, { id: extId, patch: { title: title || '' } }),
    // webRequest（真实拦截）
    webRequestRegister: (evt, hasListener, filter) =>
      ipcRenderer.send(IPC_CHANNELS.EXT_WEBREQUEST_REGISTER, { id: extId, evt, hasListener, filter }),
    webRequestUnregister: (evt) =>
      ipcRenderer.send(IPC_CHANNELS.EXT_WEBREQUEST_UNREGISTER, { id: extId, evt }),
    // notifications（真实通知）
    notificationsCreate: (options) =>
      ipcRenderer.invoke(IPC_CHANNELS.EXT_NOTIFICATIONS_CREATE, { id: extId, options }),
    notificationsClear: (notificationId) =>
      ipcRenderer.send(IPC_CHANNELS.EXT_NOTIFICATIONS_CLEAR, { id: extId, notificationId }),
    // cookies（真实读写）
    cookiesGet: (url, name) =>
      ipcRenderer.invoke(IPC_CHANNELS.EXT_COOKIES_GET, { url, name }),
    cookiesGetAll: (url) =>
      ipcRenderer.invoke(IPC_CHANNELS.EXT_COOKIES_GET_ALL, { url }),
    cookiesSet: (details) =>
      ipcRenderer.invoke(IPC_CHANNELS.EXT_COOKIES_SET, { details }),
    cookiesRemove: (url, name) =>
      ipcRenderer.invoke(IPC_CHANNELS.EXT_COOKIES_REMOVE, { url, name }),
    // contextMenus（右键菜单）
    contextMenuRegister: (menuId, props) =>
      ipcRenderer.send(IPC_CHANNELS.EXT_CONTEXTMENU_REGISTER, { id: extId, menuId, props }),
    contextMenuUnregister: (menuId, all) =>
      ipcRenderer.send(IPC_CHANNELS.EXT_CONTEXTMENU_UNREGISTER, { id: extId, menuId, all }),
    // bookmarks / history（真实数据）
    bookmarksInvoke: (method, args) =>
      ipcRenderer.invoke(IPC_CHANNELS.EXT_BOOKMARKS, { method, args }),
    historyInvoke: (method, args) =>
      ipcRenderer.invoke(IPC_CHANNELS.EXT_HISTORY, { method, args }),
    // commands
    commandsGetAll: () =>
      ipcRenderer.invoke(IPC_CHANNELS.EXT_COMMANDS_GET_ALL, { id: extId }),
    // tabs / windows / scripting
    tabsInvoke: (method, args) =>
      ipcRenderer.invoke(IPC_CHANNELS.EXT_TABS, { method, args }),
    windowsInvoke: (method, args) =>
      ipcRenderer.invoke(IPC_CHANNELS.EXT_WINDOWS, { method, args }),
    scriptingInvoke: (method, args) =>
      ipcRenderer.invoke(IPC_CHANNELS.EXT_SCRIPTING, { method, args, id: extId }),
    // storage 兜底（Electron 原生 storage 异步就绪时接管）
    storageGet: (area, keys) =>
      ipcRenderer.invoke(IPC_CHANNELS.EXT_STORAGE, { method: 'get', id: extId, area, args: { keys } }),
    storageSet: (area, items) =>
      ipcRenderer.invoke(IPC_CHANNELS.EXT_STORAGE, { method: 'set', id: extId, area, args: { items } }),
    storageRemove: (area, keys) =>
      ipcRenderer.invoke(IPC_CHANNELS.EXT_STORAGE, { method: 'remove', id: extId, area, args: { keys } }),
    storageClear: (area) =>
      ipcRenderer.invoke(IPC_CHANNELS.EXT_STORAGE, { method: 'clear', id: extId, area, args: {} }),
    // i18n / alarms / downloads / topSites / idle / permissions
    i18nInvoke: (method, args) =>
      ipcRenderer.invoke(IPC_CHANNELS.EXT_I18N, { id: extId, method, args }),
    alarmsInvoke: (method, args) =>
      ipcRenderer.invoke(IPC_CHANNELS.EXT_ALARMS, { id: extId, method, args }),
    downloadsInvoke: (method, args) =>
      ipcRenderer.invoke(IPC_CHANNELS.EXT_DOWNLOADS, { id: extId, method, args }),
    topSitesGet: () =>
      ipcRenderer.invoke(IPC_CHANNELS.EXT_TOPSITES),
    idleInvoke: (method, args) =>
      ipcRenderer.invoke(IPC_CHANNELS.EXT_IDLE, { id: extId, method, args }),
    permissionsInvoke: (method, args) =>
      ipcRenderer.invoke(IPC_CHANNELS.EXT_PERMISSIONS, { id: extId, method, args }),
    dnrInvoke: (method, args) =>
      ipcRenderer.invoke(IPC_CHANNELS.EXT_DNR, { id: extId, method, args }),
    sessionsInvoke: (method, args) =>
      ipcRenderer.invoke(IPC_CHANNELS.EXT_SESSIONS, { id: extId, method, args }),
    managementInvoke: (method, args) =>
      ipcRenderer.invoke(IPC_CHANNELS.EXT_MANAGEMENT, { id: extId, method, args }),
    browsingDataInvoke: (method, args) =>
      ipcRenderer.invoke(IPC_CHANNELS.EXT_BROWSING_DATA, { id: extId, method, args }),
    runtimeSendMessage: (message, targetExtId) =>
      ipcRenderer.invoke(IPC_CHANNELS.EXT_RUNTIME_SEND_MESSAGE, { extId, message, targetExtId }),
    tabsSendMessage: (tabId, message) =>
      ipcRenderer.invoke(IPC_CHANNELS.EXT_TABS_SEND_MESSAGE, { extId, tabId, message }),
    csSendMessage: (message) =>
      ipcRenderer.invoke(IPC_CHANNELS.EXT_CS_SEND_MESSAGE, { extId, message }),
  };
  // Electron 原生扩展页面（MV2 后台页等）contextIsolation 关闭，contextBridge 会静默失效：
  // 此时 preload 与主世界共享 window，直接赋值即可被扩展脚本看到。
  // 自定义 BrowserView（contextIsolation 开启）则必须用 contextBridge 暴露到主世界。
  if (process.contextIsolated && typeof contextBridge.exposeInMainWorld === 'function') {
    try {
      contextBridge.exposeInMainWorld('__neutronExtBridge', neutronExtBridge);
    } catch (e) {
      window.__neutronExtBridge = neutronExtBridge;
    }
  } else {
    window.__neutronExtBridge = neutronExtBridge;
  }

  try {
    webFrame.executeJavaScript(`
      (function () {
        if (window.__extPolyfilled) return;

        /* ---------- 通用工具 ---------- */
        function makeListener() {
          var handlers = [];
          return {
            addListener: function (h) { if (handlers.indexOf(h) === -1) handlers.push(h); },
            removeListener: function (h) { var i = handlers.indexOf(h); if (i >= 0) handlers.splice(i, 1); },
            hasListener: function (h) { return handlers.indexOf(h) >= 0; },
            trigger: function () { var a = arguments; handlers.slice().forEach(function (h) { try { h.apply(null, a); } catch (e) {} }); },
          };
        }
        function ensure(obj, name, fn) {
          if (obj && obj[name] === undefined) obj[name] = fn;
        }
        // 查询类 stub：返回固定结果，同时支持 callback 与 Promise
        function emptyResult(result) {
          return function () {
            var args = Array.prototype.slice.call(arguments);
            var cb = typeof args[args.length - 1] === 'function' ? args.pop() : null;
            if (cb) { cb(result); return; }
            return Promise.resolve(result);
          };
        }
        // 操作类 stub：空操作，同时支持 callback 与 Promise
        function emptyAction() {
          return function () {
            var args = Array.prototype.slice.call(arguments);
            var cb = typeof args[args.length - 1] === 'function' ? args.pop() : null;
            if (cb) { cb(); return; }
            return Promise.resolve();
          };
        }
        function addListeners(obj, names) {
          names.forEach(function (n) { ensure(obj, n, makeListener()); });
        }

        var c = window.chrome || (window.chrome = {});

        /* ---------- chrome.i18n（真实：同步取 _locales 消息） ---------- */
        var _i18nCache = null;
        function _loadI18n() {
          if (_i18nCache !== null) return _i18nCache;
          try {
            _i18nCache = ipcRenderer.sendSync(IPC_CHANNELS.EXT_I18N_SYNC, { id: extId }) || {};
          } catch (e) {
            _i18nCache = { uiLanguage: 'en_US', messages: {} };
          }
          return _i18nCache;
        }
        var i18nApi = c.i18n || (c.i18n = {});
        ensure(i18nApi, 'getMessage', function (name, subs) {
          var messages = _loadI18n().messages || {};
          var entry = messages[String(name || '')];
          if (!entry || entry.message === undefined) return '';
          var text = String(entry.message);
          var arr = subs || [];
          if (Array.isArray(arr) && arr.length > 0) {
            text = text.replace(/\$\$/g, '\u0000').replace(/\$(\d)/g, function (m, n) {
              var i = Number(n) - 1;
              return i < arr.length ? String(arr[i]) : '';
            }).replace(/\u0000/g, '$');
          }
          return text;
        });
        ensure(i18nApi, 'getUILanguage', function () { return _loadI18n().uiLanguage || 'en_US'; });
        ensure(i18nApi, 'getAcceptLanguages', function () {
          var bridge = window.__neutronExtBridge;
          var p = bridge ? bridge.i18nInvoke('getAcceptLanguages', []) : Promise.resolve([_loadI18n().uiLanguage || 'en-US']);
          return p;
        });

        /* ---------- chrome.runtime 消息桥接（sendMessage / onMessage） ---------- */
        function makeRespondingListener() {
          var handlers = [];
          var obj = {
            addListener: function (h) { if (handlers.indexOf(h) === -1) handlers.push(h); },
            removeListener: function (h) { var i = handlers.indexOf(h); if (i >= 0) handlers.splice(i, 1); },
            hasListener: function (h) { return handlers.indexOf(h) >= 0; },
            dispatch: function (message, sender) {
              var results = [];
              handlers.slice().forEach(function (h) {
                try {
                  var r = h(message, sender || {}, function (resp) { results.push(resp); });
                  if (r && typeof r.then === 'function') results.push(r);
                  else if (r !== undefined) results.push(r);
                } catch (e) {}
              });
              var hasPromise = results.some(function (x) { return x && typeof x.then === 'function'; });
              if (!hasPromise) return results.length > 0 ? results[0] : undefined;
              return Promise.all(results.map(function (x) { return x && typeof x.then === 'function' ? x : Promise.resolve(x); }))
                .then(function (arr) { return arr.length > 0 ? arr[0] : undefined; });
            }
          };
          return obj;
        }
        var rt = c.runtime || (c.runtime = {});
        rt.onMessage = makeRespondingListener();
        rt.sendMessage = function (extensionId, message, options, callback) {
          // 兼容多种签名：sendMessage(message, cb) / sendMessage(extId, message, cb)
          if (typeof extensionId !== 'string') { callback = options; options = message; message = extensionId; extensionId = undefined; }
          var bridge = window.__neutronExtBridge;
          var p = bridge ? bridge.runtimeSendMessage(message, extensionId) : Promise.resolve(undefined);
          if (typeof callback === 'function') { p.then(function (r) { callback(r); }); return; }
          return p;
        };
        // 主进程派发入口（content script / 扩展页面 → 后台）
        window.__neutronFireRuntimeMessage = function (message, sender) {
          return rt.onMessage.dispatch(message, sender);
        };

        /* ---------- chrome.storage 兜底（Electron 原生 storage 可能异步就绪，早期不可用） ---------- */
        // 提供基于主进程 IPC 的真实 storage 实现；仅当原生 storage 区域缺失时接管。
        // 注意：即使 storage 对象存在但 local/sync 为 undefined（如 uBlock 后台页早期），
        // 也立即接管，保证扩展脚本同步可用。
        function makeNeutronStorageArea(areaName, quota) {
          var bridge = window.__neutronExtBridge;
          return {
            QUOTA_BYTES: quota,
            get: function (keys, cb) {
              var p = bridge ? bridge.storageGet(areaName, keys) : Promise.resolve({});
              if (cb) { p.then(function (r) { cb(r || {}); }); return; }
              return p;
            },
            set: function (items, cb) {
              var p = bridge ? bridge.storageSet(areaName, items) : Promise.resolve(true);
              if (cb) { p.then(function () { cb && cb(); }); return; }
              return p;
            },
            remove: function (keys, cb) {
              var p = bridge ? bridge.storageRemove(areaName, keys) : Promise.resolve(true);
              if (cb) { p.then(function () { cb && cb(); }); return; }
              return p;
            },
            clear: function (cb) {
              var p = bridge ? bridge.storageClear(areaName) : Promise.resolve(true);
              if (cb) { p.then(function () { cb && cb(); }); return; }
              return p;
            },
            getBytesInUse: function (keys, cb) {
              var p = Promise.resolve(0);
              if (cb) { p.then(function (n) { cb(n); }); return; }
              return p;
            },
          };
        }
        try {
          var stQuotas2 = { local: 10485760, sync: 102400, managed: 5242880 }; // local 10MB / sync 100KB / managed 5MB
          ['local', 'sync', 'managed'].forEach(function (k) {
            if (!c.storage) c.storage = {};
            var area = c.storage[k];
            if (!area) {
              // 原生缺失 → 接管
              c.storage[k] = makeNeutronStorageArea(k, stQuotas2[k]);
            } else if (area.QUOTA_BYTES === undefined) {
              area.QUOTA_BYTES = stQuotas2[k];
            }
          });
          // storage.onChanged（数据变化广播）
          if (!c.storage.onChanged) c.storage.onChanged = makeListener();
        } catch (e) { /* 忽略：storage 不可用时 */ }

        /* ---------- chrome.webNavigation（Electron 不支持） ---------- */
        var wn = c.webNavigation || (c.webNavigation = {});
        addListeners(wn, ['onBeforeNavigate','onCommitted','onCompleted','onErrorOccurred',
          'onDOMContentLoaded','onReferenceFragmentUpdated','onHistoryStateUpdated','onTabReplaced',
          'onCreatedNavigationTarget']);
        ensure(wn, 'getAllFrames', emptyResult([]));
        ensure(wn, 'getFrame', emptyResult(null));

        /* ---------- chrome.webRequest（真实拦截：桥接 session.webRequest，广告拦截可用） ---------- */
        var WR_EVENTS = ['onBeforeRequest','onBeforeSendHeaders','onSendHeaders','onHeadersReceived',
          'onAuthRequired','onResponseStarted','onCompleted','onErrorOccurred'];
        var wr = c.webRequest || (c.webRequest = {});
        var wrListeners = {};  // evt -> [listener]
        var wrNotified = {};   // evt -> 是否已通知主进程
        function wrFire(evt, details) {
          var list = wrListeners[evt] || [];
          if (list.length === 0) return null;
          var tasks = [];
          list.forEach(function (fn) {
            try {
              var r = fn(details, {});
              if (r && typeof r.then === 'function') tasks.push(r);
              else if (r) tasks.push(Promise.resolve(r));
              else tasks.push(Promise.resolve(null));
            } catch (e) { tasks.push(Promise.resolve(null)); }
          });
          return Promise.all(tasks).then(function (arr) {
            var merged = null;
            arr.forEach(function (res) {
              if (!res || typeof res !== 'object') return;
              if (!merged) merged = {};
              if (res.cancel) merged.cancel = true;
              if (res.redirectUrl) merged.redirectUrl = res.redirectUrl;
              if (res.requestHeaders) merged.requestHeaders = res.requestHeaders;
              if (res.responseHeaders) merged.responseHeaders = res.responseHeaders;
              if (res.authCredentials) merged.authCredentials = res.authCredentials;
              if (res.upgradeToSecure) merged.upgradeToSecure = true;
            });
            return merged;
          });
        }
        window.__neutronWebRequestFire = wrFire;
        // 安装 webRequest 桥接（强制覆盖 chrome.webRequest 事件对象）
        function installWrBridge() {
          WR_EVENTS.forEach(function (evt) {
            wr[evt] = {
              addListener: function (listener, filter, opt) {
                (wrListeners[evt] = wrListeners[evt] || []).push(listener);
                if (!wrNotified[evt]) {
                  wrNotified[evt] = true;
                  var bridge = window.__neutronExtBridge;
                  if (bridge) bridge.webRequestRegister(evt, true, {
                    urls: filter && filter.urls ? filter.urls : null,
                    types: filter && filter.types ? filter.types : null,
                  });
                }
              },
              removeListener: function (listener) {
                var arr = wrListeners[evt];
                if (arr) {
                  var i = arr.indexOf(listener);
                  if (i >= 0) arr.splice(i, 1);
                }
                if (!arr || arr.length === 0) {
                  var bridge = window.__neutronExtBridge;
                  if (bridge) bridge.webRequestUnregister(evt);
                }
              },
              hasListener: function (listener) { return (wrListeners[evt] || []).indexOf(listener) >= 0; },
            };
          });
        }
        // 供主进程在 MV3 模拟后台强制接管（Electron 原生对模拟后台不生效）
        window.__neutronTakeoverWebRequest = installWrBridge;
        // MV2 后台页：Electron 原生 chrome.webRequest 已实现且生效 → 保留原生，不覆盖
        if (!wr.onBeforeRequest) installWrBridge();

        /* ---------- chrome.commands（真实：manifest.commands） ---------- */
        var cmds = c.commands || (c.commands = {});
        ensure(cmds, 'getAll', function (cb) {
          var args = Array.prototype.slice.call(arguments);
          var cb2 = typeof args[args.length - 1] === 'function' ? args.pop() : null;
          var bridge = window.__neutronExtBridge;
          var p = bridge ? bridge.commandsGetAll() : Promise.resolve([]);
          if (cb2) { p.then(function (r) { cb2(r || []); }); return; }
          return p;
        });
        ensure(cmds, 'update', emptyAction());
        ensure(cmds, 'reset', emptyAction());
        ensure(cmds, 'onCommand', makeListener());

        /* ---------- chrome.browserAction / chrome.action（工具栏图标，真实桥接） ---------- */
        function bridgeCall(fnName) {
          return function () {
            var args = Array.prototype.slice.call(arguments);
            var cb = typeof args[args.length - 1] === 'function' ? args.pop() : null;
            var details = args[0] || {};
            var bridge = window.__neutronExtBridge;
            if (bridge && bridge[fnName]) {
              if (fnName === 'setBadgeText') bridge.setBadgeText(details.text || '');
              else if (fnName === 'setTitle') bridge.setTitle(details.title || '');
              else if (fnName === 'setBadgeBackgroundColor') {
                var color = details.color;
                // 兼容 Chrome 的 color 字符串与 [r,g,b,a] 数组两种形式（alpha 0-255 正确换算）
                var arr = Array.isArray(details.color) ? details.color
                  : (Array.isArray(details.colorArray) ? details.colorArray : null);
                if (arr) {
                  var a = arr;
                  var alpha = a.length > 3 ? (Number(a[3]) / 255) : 1;
                  color = 'rgba(' + a[0] + ',' + a[1] + ',' + a[2] + ',' + alpha + ')';
                }
                bridge.setBadgeBackgroundColor(color || '#666666');
              }
            }
            if (cb) { cb(); return; }
            return Promise.resolve();
          };
        }
        ['browserAction','action'].forEach(function (key) {
          var ba = c[key] || (c[key] = {});
          ensure(ba, 'getPopup', emptyResult(''));
          ensure(ba, 'setPopup', emptyAction());
          ensure(ba, 'getTitle', emptyResult(''));
          ensure(ba, 'setTitle', bridgeCall('setTitle'));
          ensure(ba, 'setBadgeText', bridgeCall('setBadgeText'));
          ensure(ba, 'setBadgeBackgroundColor', bridgeCall('setBadgeBackgroundColor'));
          ensure(ba, 'setIcon', emptyAction());
          ensure(ba, 'onClicked', makeListener());
        });

        /* ---------- chrome.contextMenus（真实：主进程原生右键菜单） ---------- */
        var cm = c.contextMenus || (c.contextMenus = {});
        var menuCounter = 0;
        var menuClickHandlers = {}; // menuId -> onclick 回调
        var menuOnClicked = makeListener();
        ensure(cm, 'onClicked', menuOnClicked);
        ensure(cm, 'create', function () {
          var args = Array.prototype.slice.call(arguments);
          var cb = typeof args[args.length - 1] === 'function' ? args.pop() : null;
          var props = args[0] || {};
          var id = (props.id !== undefined && props.id !== null) ? String(props.id) : ('menu_' + (++menuCounter));
          if (props.onclick) menuClickHandlers[id] = props.onclick;
          var bridge = window.__neutronExtBridge;
          if (bridge) bridge.contextMenuRegister(id, {
            title: props.title || '',
            contexts: props.contexts || ['all'],
            enabled: props.enabled !== false,
            parentId: props.parentId,
            type: props.type,
            checked: props.checked,
          });
          if (cb) { cb(id); return; }
          return Promise.resolve(id);
        });
        ensure(cm, 'update', function () {
          var args = Array.prototype.slice.call(arguments);
          var cb = typeof args[args.length - 1] === 'function' ? args.pop() : null;
          var id = args[0];
          var props = args[1] || {};
          if (props.onclick) menuClickHandlers[id] = props.onclick;
          var bridge = window.__neutronExtBridge;
          if (bridge && (props.title !== undefined || props.enabled !== undefined ||
              props.checked !== undefined || props.type !== undefined ||
              props.parentId !== undefined || props.contexts !== undefined)) {
            bridge.contextMenuRegister(id, {
              title: props.title !== undefined ? props.title : '',
              contexts: props.contexts || ['all'],
              enabled: props.enabled !== false,
              parentId: props.parentId,
              type: props.type,
              checked: props.checked,
            });
          }
          if (cb) { cb(); return; }
          return Promise.resolve();
        });
        ensure(cm, 'remove', function () {
          var args = Array.prototype.slice.call(arguments);
          var cb = typeof args[args.length - 1] === 'function' ? args.pop() : null;
          var id = args[0];
          delete menuClickHandlers[id];
          var bridge = window.__neutronExtBridge;
          if (bridge) bridge.contextMenuUnregister(id, false);
          if (cb) { cb(); return; }
          return Promise.resolve();
        });
        ensure(cm, 'removeAll', function () {
          var args = Array.prototype.slice.call(arguments);
          var cb = typeof args[args.length - 1] === 'function' ? args.pop() : null;
          menuClickHandlers = {};
          var bridge = window.__neutronExtBridge;
          if (bridge) bridge.contextMenuUnregister(null, true);
          if (cb) { cb(); return; }
          return Promise.resolve();
        });
        // 主进程点击菜单项 → 触发菜单 onclick 或 onClicked
        window.__neutronFireContextMenuClick = function (menuId, info) {
          var fn = menuClickHandlers[menuId];
          var safeInfo = info || {};
          if (fn) {
            try { fn(safeInfo, { id: -1, url: safeInfo.pageUrl || '' }); } catch (e) {}
          } else {
            menuOnClicked.trigger({
              menuItemId: menuId,
              pageUrl: safeInfo.pageUrl || '',
              linkUrl: safeInfo.linkUrl || '',
              selectionText: safeInfo.selectionText || '',
            });
          }
        };

        /* ---------- chrome.cookies（真实：session.cookies） ---------- */
        var ck = c.cookies || (c.cookies = {});
        addListeners(ck, ['onChanged']);
        ensure(ck, 'get', function () {
          var args = Array.prototype.slice.call(arguments);
          var cb = typeof args[args.length - 1] === 'function' ? args.pop() : null;
          var details = args[0] || {};
          var bridge = window.__neutronExtBridge;
          var p = bridge ? bridge.cookiesGet(details.url || '', details.name || '') : Promise.resolve(null);
          if (cb) { p.then(function (r) { cb(r); }); return; }
          return p;
        });
        ensure(ck, 'getAll', function () {
          var args = Array.prototype.slice.call(arguments);
          var cb = typeof args[args.length - 1] === 'function' ? args.pop() : null;
          var details = args[0] || {};
          var bridge = window.__neutronExtBridge;
          var p = bridge ? bridge.cookiesGetAll(details.url || '') : Promise.resolve([]);
          if (cb) { p.then(function (r) { cb(r || []); }); return; }
          return p;
        });
        ensure(ck, 'set', function () {
          var args = Array.prototype.slice.call(arguments);
          var cb = typeof args[args.length - 1] === 'function' ? args.pop() : null;
          var details = args[0] || {};
          var bridge = window.__neutronExtBridge;
          var p = bridge ? bridge.cookiesSet(details) : Promise.resolve(null);
          if (cb) { p.then(function (ok) { cb(ok ? details : null); }); return; }
          return p.then(function (ok) { return ok ? details : null; });
        });
        ensure(ck, 'remove', function () {
          var args = Array.prototype.slice.call(arguments);
          var cb = typeof args[args.length - 1] === 'function' ? args.pop() : null;
          var details = args[0] || {};
          var bridge = window.__neutronExtBridge;
          var p = bridge ? bridge.cookiesRemove(details.url || '', details.name || '') : Promise.resolve(null);
          var result = p.then(function (ok) { return ok ? { url: details.url || '', name: details.name || '' } : null; });
          if (cb) { result.then(function (r) { cb(r); }); return; }
          return result;
        });

        /* ---------- chrome.notifications（真实：系统通知） ---------- */
        var ntf = c.notifications || (c.notifications = {});
        addListeners(ntf, ['onClicked','onClosed','onButtonClicked']);
        ensure(ntf, 'create', function () {
          var args = Array.prototype.slice.call(arguments);
          var id = typeof args[0] === 'string' ? args[0] : ((args[0] && (args[0].notificationId || args[0].id)) || '');
          var options = typeof args[0] === 'string' ? (args[1] || {}) : (args[0] || {});
          var cb = typeof args[args.length - 1] === 'function' ? args[args.length - 1] : null;
          options.notificationId = id;
          var bridge = window.__neutronExtBridge;
          var p = bridge ? bridge.notificationsCreate(options) : Promise.resolve(id);
          if (cb) { p.then(function (nid) { cb(nid); }); return; }
          return p;
        });
        ensure(ntf, 'clear', function () {
          var args = Array.prototype.slice.call(arguments);
          var cb = typeof args[args.length - 1] === 'function' ? args.pop() : null;
          var nid = typeof args[0] === 'string' ? args[0] : '';
          var bridge = window.__neutronExtBridge;
          if (bridge && bridge.notificationsClear) bridge.notificationsClear(nid);
          if (cb) { cb(true); return; }
          return Promise.resolve(true);
        });
        ensure(ntf, 'getAll', emptyResult({}));
        // 主进程通知点击 → 触发 onClicked
        window.__neutronFireNotification = function (eventName, nid) {
          var key = 'on' + eventName.charAt(0).toUpperCase() + eventName.slice(1);
          var evt = ntf[key];
          if (evt && evt.trigger) evt.trigger(nid);
        };

        /* ---------- chrome.history（真实：本浏览器历史） ---------- */
        var hist = c.history || (c.history = {});
        function histCall(method) {
          var args = Array.prototype.slice.call(arguments, 1);
          var cb = typeof args[args.length - 1] === 'function' ? args.pop() : null;
          var bridge = window.__neutronExtBridge;
          var p = bridge ? bridge.historyInvoke(method, args) : Promise.resolve(null);
          if (cb) { p.then(function (r) { cb(r); }); return; }
          return p;
        }
        addListeners(hist, ['onVisited','onVisitRemoved']);
        ensure(hist, 'search', function (opt, cb) { return histCall('search', opt, cb); });
        ensure(hist, 'getVisits', function (opt, cb) { return histCall('getVisits', opt, cb); });
        ensure(hist, 'addUrl', function (opt, cb) { return histCall('addUrl', opt, cb); });
        ensure(hist, 'deleteUrl', function (opt, cb) { return histCall('deleteUrl', opt, cb); });
        ensure(hist, 'deleteRange', function (opt, cb) { return histCall('deleteRange', opt, cb); });
        ensure(hist, 'deleteAll', function (cb) { return histCall('deleteAll', cb); });

        /* ---------- chrome.bookmarks（真实：本浏览器书签） ---------- */
        var bm = c.bookmarks || (c.bookmarks = {});
        function bmCall(method) {
          var args = Array.prototype.slice.call(arguments, 1);
          var cb = typeof args[args.length - 1] === 'function' ? args.pop() : null;
          var bridge = window.__neutronExtBridge;
          var p = bridge ? bridge.bookmarksInvoke(method, args) : Promise.resolve(null);
          if (cb) { p.then(function (r) { cb(r); }); return; }
          return p;
        }
        addListeners(bm, ['onCreated','onRemoved','onChanged','onMoved','onChildrenReordered','onImportBegan','onImportEnded']);
        ensure(bm, 'getTree', function (cb) { return bmCall('getTree', cb); });
        ensure(bm, 'get', function (id, cb) {
          var args = Array.prototype.slice.call(arguments);
          var cb2 = typeof args[args.length - 1] === 'function' ? args.pop() : null;
          return bmCall('get', args[0], cb2);
        });
        ensure(bm, 'getChildren', function (id, cb) { return bmCall('getChildren', id, cb); });
        ensure(bm, 'getRecent', function (n, cb) { return bmCall('getRecent', n, cb); });
        ensure(bm, 'search', function (query, cb) { return bmCall('search', query, cb); });
        ensure(bm, 'create', function (props, cb) { return bmCall('create', props, cb); });
        ensure(bm, 'update', function (id, changes, cb) { return bmCall('update', id, changes, cb); });
        ensure(bm, 'move', function (id, dest, cb) { return bmCall('move', id, dest, cb); });
        ensure(bm, 'remove', function (id, cb) { return bmCall('remove', id, cb); });
        ensure(bm, 'removeTree', function (id, cb) { return bmCall('removeTree', id, cb); });

        /* ---------- chrome.downloads（真实：本浏览器下载） ---------- */
        var dls = c.downloads || (c.downloads = {});
        function dlCall(method) {
          var args = Array.prototype.slice.call(arguments, 1);
          var cb = typeof args[args.length - 1] === 'function' ? args.pop() : null;
          var bridge = window.__neutronExtBridge;
          var p = bridge ? bridge.downloadsInvoke(method, args) : Promise.resolve(undefined);
          if (cb) { p.then(function (r) { cb(r); }); return; }
          return p;
        }
        addListeners(dls, ['onCreated','onChanged','onErased','onDeterminingFilename']);
        ensure(dls, 'download', function (opts, cb) { return dlCall('download', opts, cb); });
        ensure(dls, 'search', function (query, cb) { return dlCall('search', query, cb); });
        ensure(dls, 'pause', function (id, cb) { return dlCall('pause', id, cb); });
        ensure(dls, 'resume', function (id, cb) { return dlCall('resume', id, cb); });
        ensure(dls, 'cancel', function (id, cb) { return dlCall('cancel', id, cb); });
        ensure(dls, 'erase', function (query, cb) {
          var id = query && (query.id !== undefined ? query.id : query);
          return dlCall('erase', id, cb);
        });
        ensure(dls, 'removeFile', function (id, cb) { return dlCall('erase', id, cb); });
        ensure(dls, 'open', emptyAction());
        ensure(dls, 'show', emptyAction());
        ensure(dls, 'showDefaultFolder', emptyAction());
        ensure(dls, 'getFileIcon', emptyResult(''));
        ensure(dls, 'acceptDanger', emptyAction());
        ensure(dls, 'setShelfEnabled', emptyAction());

        /* ---------- chrome.tabs（真实：本浏览器标签页） ---------- */
        // 保留 Electron 原生实现（若有），仅补充缺失方法，避免整体覆盖丢失原生能力
        var tabsApi = c.tabs || (c.tabs = {});
        function tabCall(method) {
          var args = Array.prototype.slice.call(arguments, 1);
          var cb = typeof args[args.length - 1] === 'function' ? args.pop() : null;
          var bridge = window.__neutronExtBridge;
          var p = bridge ? bridge.tabsInvoke(method, args) : Promise.resolve([]);
          if (cb) { p.then(function (r) { cb(r); }); return; }
          return p;
        }
        addListeners(tabsApi, ['onActivated','onUpdated','onRemoved','onCreated','onMoved','onHighlighted','onDetached','onAttached','onReplaced','onZoomChange']);
        tabsApi.query = function (q, cb) { return tabCall('query', q, cb); };
        tabsApi.get = function (id, cb) { return tabCall('get', id, cb); };
        tabsApi.getCurrent = function (cb) { return tabCall('getCurrent', cb); };
        tabsApi.getSelected = function (winId, cb) { return tabCall('getSelected', cb); };
        tabsApi.create = function (opts, cb) { return tabCall('create', opts, cb); };
        tabsApi.update = function (id, opts, cb) { return tabCall('update', id, opts, cb); };
        tabsApi.remove = function (id, cb) { return tabCall('remove', id, cb); };
        tabsApi.reload = function (id, opts, cb) { return tabCall('reload', id, cb); };
        tabsApi.duplicate = function (id, cb) { return tabCall('duplicate', id, cb); };
        tabsApi.sendMessage = function (tabId, message, options, cb) {
          if (typeof options === 'function') { cb = options; options = undefined; }
          var bridge = window.__neutronExtBridge;
          var p = bridge ? bridge.tabsSendMessage(tabId, message) : Promise.resolve(undefined);
          if (typeof cb === 'function') { p.then(function (r) { cb(r); }); return; }
          return p;
        };

        /* ---------- chrome.windows（真实：本浏览器窗口） ---------- */
        var wins = c.windows || (c.windows = {});
        function winCall(method) {
          var args = Array.prototype.slice.call(arguments, 1);
          var cb = typeof args[args.length - 1] === 'function' ? args.pop() : null;
          var bridge = window.__neutronExtBridge;
          var p = bridge ? bridge.windowsInvoke(method, args) : Promise.resolve(null);
          if (cb) { p.then(function (r) { cb(r); }); return; }
          return p;
        }
        addListeners(wins, ['onCreated','onRemoved','onFocusChanged','onBoundsChanged']);
        wins.get = function (id, opts, cb) { return winCall('get', id, opts, cb); };
        wins.getCurrent = function (opts, cb) { return winCall('getCurrent', opts, cb); };
        wins.getLastFocused = function (opts, cb) { return winCall('getLastFocused', opts, cb); };
        wins.getAll = function (opts, cb) { return winCall('getAll', opts, cb); };
        wins.create = function (opts, cb) { return winCall('create', opts, cb); };
        wins.update = function (id, opts, cb) { return winCall('update', id, opts, cb); };
        wins.remove = function (id, cb) { return winCall('remove', id, cb); };

        /* ---------- chrome.omnibox ---------- */
        var omni = c.omnibox || (c.omnibox = {});
        addListeners(omni, ['onInputStarted','onInputChanged','onInputEntered','onInputCancelled','onDeleteSuggestion']);
        ensure(omni, 'setDefaultSuggestion', emptyAction());

        /* ---------- chrome.proxy ---------- */
        var proxy = c.proxy || (c.proxy = {});
        if (!proxy.settings) proxy.settings = {};
        ensure(proxy.settings, 'get', emptyResult({ value: { mode: 'system' } }));
        ensure(proxy.settings, 'set', emptyAction());
        ensure(proxy.settings, 'clear', emptyAction());
        ensure(proxy.settings, 'onChange', makeListener());
        addListeners(proxy, ['onRequest','onError']);

        /* ---------- chrome.topSites（真实：历史高频站点） ---------- */
        var ts = c.topSites || (c.topSites = {});
        ensure(ts, 'get', function (cb) {
          var bridge = window.__neutronExtBridge;
          var p = bridge ? bridge.topSitesGet() : Promise.resolve([]);
          if (cb) { p.then(function (r) { cb(r || []); }); return; }
          return p;
        });

        /* ---------- chrome.browsingData（真实：remove 清理历史/Cookie/缓存/下载） ---------- */
        var bd = c.browsingData || (c.browsingData = {});
        function bdCall(method) {
          var args = Array.prototype.slice.call(arguments, 1);
          var cb = typeof args[args.length - 1] === 'function' ? args.pop() : null;
          var bridge = window.__neutronExtBridge;
          var p = bridge ? bridge.browsingDataInvoke(method, args) : Promise.resolve();
          if (cb) { p.then(function () { cb && cb(); }); return; }
          return p;
        }
        ensure(bd, 'remove', function (dataTypes, options, cb) {
          var args = Array.prototype.slice.call(arguments);
          var cb2 = typeof args[args.length - 1] === 'function' ? args.pop() : null;
          return bdCall('remove', args[0], args[1], cb2);
        });
        var bdMap = { removeCache: { cache: true }, removeCookies: { cookies: true },
          removeDownloads: { downloads: true }, removeHistory: { history: true },
          removeLocalStorage: { localStorage: true }, removePasswords: { passwords: true },
          removeFormData: { formData: true }, removeIndexedDB: { indexedDB: true },
          removeAppcache: { appcache: true }, removeWebSQL: { webSQL: true },
          removePluginData: { pluginData: true }, removeFileSystems: { fileSystems: true },
          removeServiceWorkers: { serviceWorkers: true } };
        Object.keys(bdMap).forEach(function (m) {
          ensure(bd, m, function (options, cb) {
            var args = Array.prototype.slice.call(arguments);
            var cb2 = typeof args[args.length - 1] === 'function' ? args.pop() : null;
            return bdCall('remove', bdMap[m], args[0], cb2);
          });
        });

        /* ---------- chrome.declarativeNetRequest（真实：DNR 规则引擎） ---------- */
        var dnrApi = c.declarativeNetRequest || (c.declarativeNetRequest = {});
        function dnrCall(method) {
          var args = Array.prototype.slice.call(arguments, 1);
          var cb = typeof args[args.length - 1] === 'function' ? args.pop() : null;
          var bridge = window.__neutronExtBridge;
          var p = bridge ? bridge.dnrInvoke(method, args) : Promise.resolve(undefined);
          if (cb) { p.then(function (r) { cb(r); }); return; }
          return p;
        }
        ensure(dnrApi, 'updateDynamicRules', function (opts, cb) { return dnrCall('updateDynamicRules', opts, cb); });
        ensure(dnrApi, 'getDynamicRules', function (cb) { return dnrCall('getDynamicRules', cb); });
        ensure(dnrApi, 'updateSessionRules', function (opts, cb) { return dnrCall('updateSessionRules', opts, cb); });
        ensure(dnrApi, 'getSessionRules', function (cb) { return dnrCall('getSessionRules', cb); });
        ensure(dnrApi, 'getAvailableStaticRuleCount', function (cb) {
          var bridge = window.__neutronExtBridge;
          var p = bridge ? bridge.dnrInvoke('getAvailableStaticRuleCount', []) : Promise.resolve(0);
          if (cb) { p.then(function (r) { cb(r); }); return; }
          return p;
        });
        ensure(dnrApi, 'getEnabledRulesets', function (cb) {
          var bridge = window.__neutronExtBridge;
          var p = bridge ? bridge.dnrInvoke('getEnabledRulesets', []) : Promise.resolve([]);
          if (cb) { p.then(function (r) { cb(r); }); return; }
          return p;
        });
        ensure(dnrApi, 'updateEnabledRulesets', function (opts, cb) { return dnrCall('updateEnabledRulesets', opts, cb); });
        ensure(dnrApi, 'setExtensionActionOptions', emptyAction());
        ensure(dnrApi, 'getMatchedRules', emptyResult([]));
        ensure(dnrApi, 'onRuleMatchedDebug', makeListener());

        /* ---------- chrome.scripting（真实：动态脚本注入） ---------- */
        var scr = c.scripting || (c.scripting = {});
        function scrCall(method) {
          var args = Array.prototype.slice.call(arguments, 1);
          var cb = typeof args[args.length - 1] === 'function' ? args.pop() : null;
          var bridge = window.__neutronExtBridge;
          var p = bridge ? bridge.scriptingInvoke(method, args) : Promise.resolve([]);
          if (cb) { p.then(function (r) { cb(r || []); }); return; }
          return p;
        }
        ensure(scr, 'executeScript', function (details, cb) {
          var d = details || {};
          if (typeof d.func === 'function') d.func = String(d.func);
          return scrCall('executeScript', d, cb);
        });
        ensure(scr, 'insertCSS', function (details, cb) { return scrCall('insertCSS', details, cb); });
        ensure(scr, 'removeCSS', function (details, cb) { return scrCall('removeCSS', details, cb); });
        ensure(scr, 'registerContentScripts', emptyResult([]));
        ensure(scr, 'unregisterContentScripts', emptyAction());
        ensure(scr, 'getRegisteredContentScripts', emptyResult([]));
        ensure(scr, 'updateContentScripts', emptyAction());

        /* ---------- chrome.alarms（真实：主进程定时器） ---------- */
        var al = c.alarms || (c.alarms = {});
        function alarmCall(method) {
          var args = Array.prototype.slice.call(arguments, 1);
          var cb = typeof args[args.length - 1] === 'function' ? args.pop() : null;
          var bridge = window.__neutronExtBridge;
          var p = bridge ? bridge.alarmsInvoke(method, args) : Promise.resolve(undefined);
          if (cb) { p.then(function (r) { cb(r); }); return; }
          return p;
        }
        ensure(al, 'create', function (name, info, cb) {
          var args = Array.prototype.slice.call(arguments);
          var cb2 = typeof args[args.length - 1] === 'function' ? args.pop() : null;
          var bridge = window.__neutronExtBridge;
          var p = bridge ? bridge.alarmsInvoke('create', [args[0], args[1] || {}]) : Promise.resolve();
          if (cb2) { p.then(function () { cb2 && cb2(); }); return; }
          return p;
        });
        ensure(al, 'get', function (name, cb) { return alarmCall('get', name, cb); });
        ensure(al, 'getAll', function (cb) { return alarmCall('getAll', cb); });
        ensure(al, 'clear', function (name, cb) { return alarmCall('clear', name, cb); });
        ensure(al, 'clearAll', function (cb) { return alarmCall('clearAll', cb); });
        ensure(al, 'onAlarm', makeListener());

        /* ---------- chrome.idle（真实：powerMonitor） ---------- */
        var idle = c.idle || (c.idle = {});
        function idleCall(method) {
          var args = Array.prototype.slice.call(arguments, 1);
          var cb = typeof args[args.length - 1] === 'function' ? args.pop() : null;
          var bridge = window.__neutronExtBridge;
          var p = bridge ? bridge.idleInvoke(method, args) : Promise.resolve(undefined);
          if (cb) { p.then(function (r) { cb(r); }); return; }
          return p;
        }
        ensure(idle, 'queryState', function (t, cb) {
          var args = Array.prototype.slice.call(arguments);
          var cb2 = typeof args[args.length - 1] === 'function' ? args.pop() : null;
          return idleCall('queryState', args[0], cb2);
        });
        ensure(idle, 'setDetectionInterval', function (t, cb) {
          var args = Array.prototype.slice.call(arguments);
          var cb2 = typeof args[args.length - 1] === 'function' ? args.pop() : null;
          return idleCall('setDetectionInterval', args[0], cb2);
        });
        ensure(idle, 'onStateChanged', makeListener());

        /* ---------- chrome.privacy（补齐 setting 对象，如 networkPredictionEnabled） ---------- */
        // 扩展（如 uBlock）会直接访问 chrome.privacy.network.networkPredictionEnabled 等
        // setting 对象（{ get, set, clear }），Electron 原生可能缺失 → 补空实现。
        var priv = c.privacy || (c.privacy = {});
        var privSettings = {
          network: ['networkPredictionEnabled', 'webRTCIPHandlingPolicy'],
          websites: ['hyperlinkAuditingEnabled'],
          services: ['alternateErrorPagesEnabled', 'autofillEnabled', 'passwordSavingEnabled',
            'safeBrowsingEnabled', 'searchSuggestEnabled', 'spellingServiceEnabled', 'translationServiceEnabled'],
        };
        Object.keys(privSettings).forEach(function (sec) {
          if (!priv[sec]) priv[sec] = {};
          privSettings[sec].forEach(function (setting) {
            if (priv[sec][setting] === undefined) {
              priv[sec][setting] = {
                get: emptyResult({ value: null }),
                set: emptyAction(),
                clear: emptyAction(),
              };
            }
          });
        });
        ['network','services','websites'].forEach(function (sec) {
          if (!priv[sec]) priv[sec] = {};
          ensure(priv[sec], 'get', emptyResult({ value: null }));
          ensure(priv[sec], 'set', emptyAction());
          ensure(priv[sec], 'clear', emptyAction());
          ensure(priv[sec], 'onChange', makeListener());
        });

        /* ---------- chrome.sessions（真实：最近关闭标签页） ---------- */
        var sess = c.sessions || (c.sessions = {});
        function sessCall(method) {
          var args = Array.prototype.slice.call(arguments, 1);
          var cb = typeof args[args.length - 1] === 'function' ? args.pop() : null;
          var bridge = window.__neutronExtBridge;
          var p = bridge ? bridge.sessionsInvoke(method, args) : Promise.resolve(null);
          if (cb) { p.then(function (r) { cb(r); }); return; }
          return p;
        }
        ensure(sess, 'getRecentlyClosed', function (filter, cb) { return sessCall('getRecentlyClosed', filter, cb); });
        ensure(sess, 'restore', function (sessionId, cb) { return sessCall('restore', sessionId, cb); });
        ensure(sess, 'getDevices', emptyResult([]));
        ensure(sess, 'onChanged', makeListener());

        /* ---------- chrome.permissions（真实：清单 + 已授予权限） ---------- */
        var perm = c.permissions || (c.permissions = {});
        function permCall(method) {
          var args = Array.prototype.slice.call(arguments, 1);
          var cb = typeof args[args.length - 1] === 'function' ? args.pop() : null;
          var bridge = window.__neutronExtBridge;
          var p = bridge ? bridge.permissionsInvoke(method, args) : Promise.resolve(undefined);
          if (cb) { p.then(function (r) { cb(r); }); return; }
          return p;
        }
        ensure(perm, 'contains', function (perms, cb) { return permCall('contains', perms, cb); });
        ensure(perm, 'request', function (perms, cb) { return permCall('request', perms, cb); });
        ensure(perm, 'remove', function (perms, cb) { return permCall('remove', perms, cb); });
        ensure(perm, 'getAll', function (cb) { return permCall('getAll', cb); });
        addListeners(perm, ['onAdded','onRemoved']);

        /* ---------- chrome.management（真实：已安装扩展列表） ---------- */
        var mgmt = c.management || (c.management = {});
        function mgmtCall(method) {
          var args = Array.prototype.slice.call(arguments, 1);
          var cb = typeof args[args.length - 1] === 'function' ? args.pop() : null;
          var bridge = window.__neutronExtBridge;
          var p = bridge ? bridge.managementInvoke(method, args) : Promise.resolve(null);
          if (cb) { p.then(function (r) { cb(r); }); return; }
          return p;
        }
        ensure(mgmt, 'getAll', function (cb) { return mgmtCall('getAll', cb); });
        ensure(mgmt, 'get', function (id, cb) { return mgmtCall('get', id, cb); });

        /* ---------- 主进程触发入口（executeJavaScript 调用） ---------- */
        // 工具栏图标被点击（无 Popup）→ 触发 browserAction/action onClicked
        window.__neutronFireActionClicked = function () {
          var c2 = window.chrome || {};
          var tab = { id: -1, url: '', title: '' };
          ['browserAction','action'].forEach(function (key) {
            var ba = c2[key];
            if (ba && ba.onClicked && ba.onClicked.trigger) ba.onClicked.trigger(tab);
          });
        };
        // 快捷键触发 → 触发 commands.onCommand
        window.__neutronFireCommand = function (name) {
          var c2 = window.chrome || {};
          if (c2.commands && c2.commands.onCommand && c2.commands.onCommand.trigger) {
            c2.commands.onCommand.trigger(name);
          }
        };
        // 标签页/窗口生命周期事件派发（主进程 broadcast 调用）
        window.__neutronFireTabEvent = function (eventName, argsArray) {
          var c2 = window.chrome || {};
          var evt = c2.tabs && c2.tabs[eventName];
          if (evt && evt.trigger) evt.trigger.apply(null, argsArray || []);
        };
        window.__neutronFireWindowEvent = function (eventName, argsArray) {
          var c2 = window.chrome || {};
          var evt = c2.windows && c2.windows[eventName];
          if (evt && evt.trigger) evt.trigger.apply(null, argsArray || []);
        };
        // 书签/历史/Cookie/storage/idle 事件派发
        function fireNsEvent(ns, eventName, argsArray) {
          var c2 = window.chrome || {};
          var evt = c2[ns] && c2[ns][eventName];
          if (evt && evt.trigger) evt.trigger.apply(null, argsArray || []);
        }
        window.__neutronFireBookmarkEvent = function (eventName, argsArray) { fireNsEvent('bookmarks', eventName, argsArray); };
        window.__neutronFireHistoryEvent = function (eventName, argsArray) { fireNsEvent('history', eventName, argsArray); };
        window.__neutronFireCookieEvent = function (eventName, argsArray) { fireNsEvent('cookies', eventName, argsArray); };
        window.__neutronFireStorageEvent = function (eventName, argsArray) { fireNsEvent('storage', eventName, argsArray); };
        window.__neutronFireIdleEvent = function (eventName, argsArray) { fireNsEvent('idle', eventName, argsArray); };
        // 闹钟触发 → chrome.alarms.onAlarm
        window.__neutronFireAlarm = function (alarm) {
          var c2 = window.chrome || {};
          if (c2.alarms && c2.alarms.onAlarm && c2.alarms.onAlarm.trigger) c2.alarms.onAlarm.trigger(alarm);
        };

        window.__extPolyfilled = true;
      })();
    `);
  } catch (e) { /* 忽略 */ }
} else {
  // ==================== 普通网页：扩展包拖放安装拦截（Edge 式全窗口） ====================
  // 本脚本由 session.setPreloads 注入所有 webContents（含网页标签页与内部页面）。
  // 在这里拦截 .crx/.zip 文件的拖放：网页自己处理 drop（preventDefault）或导航到
  // file:// 都不影响安装——路径通过 webUtils.getPathForFile 获取（File.path 在
  // Electron 32+ 已移除），并通知主进程显示全窗提示覆盖层 / 执行安装。
  // 频道名与 src/shared/constants.js 的 EXTENSIONS_DRAG_* 保持一致（sandbox preload 内联）。
  (function () {
    // 仅顶层 frame；app.html 由 preload.js + app.js 自行处理（避免重复计数）
    try {
      if (window !== window.top) return;
    } catch (e) { return; }
    if (/\/app\.html(\?|$)/.test(location.href)) return;

    function isExtFileDrag(e) {
      const dt = e && e.dataTransfer;
      if (!dt || !dt.files) return false;
      for (let i = 0; i < dt.files.length; i++) {
        const name = String(dt.files[i].name || '').toLowerCase();
        if (name.endsWith('.crx') || name.endsWith('.zip')) return true;
      }
      return false;
    }

    // 拖放诊断：所有文件拖放事件上报主进程（写日志 + 主窗口可见提示）
    function debugEvent(e, name) {
      try {
        const dt = e && e.dataTransfer;
        const names = [];
        if (dt && dt.files) {
          for (let i = 0; i < dt.files.length; i++) names.push(String(dt.files[i].name || ''));
        }
        if (names.length === 0) return;
        ipcRenderer.send('extensions:dragDebug', {
          source: 'page',
          event: name,
          names: names,
          types: dt && dt.types ? Array.prototype.slice.call(dt.types) : [],
          url: location.href,
        });
      } catch (err) { /* 忽略 */ }
    }

    let dragDepth = 0;

    window.addEventListener('dragenter', (e) => {
      debugEvent(e, 'dragenter');
      if (!isExtFileDrag(e)) return;
      console.log('[DropInstall][page] dragenter', location.href);
      dragDepth++;
      if (dragDepth === 1) ipcRenderer.send('extensions:dragEnter');
    }, true);

    window.addEventListener('dragleave', (e) => {
      if (!isExtFileDrag(e)) return;
      console.log('[DropInstall][page] dragleave', location.href);
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) ipcRenderer.send('extensions:dragLeave');
    }, true);

    window.addEventListener('dragover', (e) => {
      if (!isExtFileDrag(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    }, true);

    window.addEventListener('drop', (e) => {
      debugEvent(e, 'drop');
      if (!isExtFileDrag(e)) return;
      console.log('[DropInstall][page] drop', location.href);
      e.preventDefault();
      e.stopPropagation();
      dragDepth = 0;
      let target = null;
      const files = e.dataTransfer.files;
      for (let i = 0; i < files.length; i++) {
        const name = String(files[i].name || '').toLowerCase();
        if (name.endsWith('.crx') || name.endsWith('.zip')) { target = files[i]; break; }
      }
      let filePath = '';
      if (target) {
        try { filePath = webUtils.getPathForFile(target); } catch (err) { /* 忽略 */ }
      }
      console.log('[DropInstall][page] drop path =', filePath);
      ipcRenderer.send('extensions:dragDrop', { path: filePath });
    }, true);
  })();

  // ==================== 内容脚本 → 后台 消息中继 ====================
  // scripting.executeScript 注入的隔离世界（999）通过 window.postMessage 送达本 preload，
  // 由这里经 ipcRenderer 转发到主进程 → 扩展后台；响应原路 postMessage 返回。
  window.addEventListener('message', (e) => {
    try {
      const d = e.data;
      if (!d || !d.__neutronCsMsg) return;
      const msg = d.__neutronCsMsg;
      if (msg && msg.type === 'sendMessage') {
        ipcRenderer.invoke('ext:csSendMessage', { extId: msg.extId, message: msg.message })
          .then((result) => {
            try { window.postMessage({ __neutronCsResp: { id: msg.id, result } }, '*'); } catch (err) {}
          })
          .catch((err) => {
            try { window.postMessage({ __neutronCsResp: { id: msg.id, error: String((err && err.message) || err) } }, '*'); } catch (e2) {}
          });
      }
    } catch (err) { /* 忽略 */ }
  });
}
