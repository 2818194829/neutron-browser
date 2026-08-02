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
const { webFrame } = require('electron');

if (location.protocol === 'chrome-extension:') {
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

        /* ---------- chrome.webNavigation（Electron 不支持） ---------- */
        var wn = c.webNavigation || (c.webNavigation = {});
        addListeners(wn, ['onBeforeNavigate','onCommitted','onCompleted','onErrorOccurred',
          'onDOMContentLoaded','onReferenceFragmentUpdated','onHistoryStateUpdated','onTabReplaced']);
        ensure(wn, 'getAllFrames', emptyResult([]));
        ensure(wn, 'getFrame', emptyResult(null));

        /* ---------- chrome.commands ---------- */
        var cmds = c.commands || (c.commands = {});
        ensure(cmds, 'getAll', emptyResult([]));
        ensure(cmds, 'update', emptyAction());
        ensure(cmds, 'reset', emptyAction());
        ensure(cmds, 'onCommand', makeListener());

        /* ---------- chrome.browserAction / chrome.action（工具栏图标） ---------- */
        ['browserAction','action'].forEach(function (key) {
          var ba = c[key] || (c[key] = {});
          ensure(ba, 'getPopup', emptyResult(''));
          ensure(ba, 'setPopup', emptyAction());
          ensure(ba, 'getTitle', emptyResult(''));
          ensure(ba, 'setTitle', emptyAction());
          ensure(ba, 'setBadgeText', emptyAction());
          ensure(ba, 'setBadgeBackgroundColor', emptyAction());
          ensure(ba, 'setIcon', emptyAction());
          ensure(ba, 'onClicked', makeListener());
        });

        /* ---------- chrome.contextMenus ---------- */
        var cm = c.contextMenus || (c.contextMenus = {});
        ensure(cm, 'create', emptyResult(0));
        ensure(cm, 'update', emptyAction());
        ensure(cm, 'remove', emptyAction());
        ensure(cm, 'removeAll', emptyAction());
        ensure(cm, 'onClicked', makeListener());

        /* ---------- chrome.cookies（返回空，避免崩溃） ---------- */
        var ck = c.cookies || (c.cookies = {});
        ensure(ck, 'get', emptyResult(null));
        ensure(ck, 'getAll', emptyResult([]));
        ensure(ck, 'set', emptyResult(null));
        ensure(ck, 'remove', emptyResult(null));
        ensure(ck, 'onChanged', makeListener());

        /* ---------- chrome.notifications ---------- */
        var ntf = c.notifications || (c.notifications = {});
        ensure(ntf, 'create', function () {
          var args = Array.prototype.slice.call(arguments);
          var id = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].id) || '';
          var cb = typeof args[args.length - 1] === 'function' ? args[args.length - 1] : null;
          if (cb) { cb(id); return; }
          return Promise.resolve(id);
        });
        ensure(ntf, 'clear', emptyAction());
        ensure(ntf, 'getAll', emptyResult({}));
        addListeners(ntf, ['onClicked','onClosed','onButtonClicked']);

        /* ---------- chrome.history ---------- */
        var hist = c.history || (c.history = {});
        ensure(hist, 'search', emptyResult([]));
        ensure(hist, 'getVisits', emptyResult([]));
        ensure(hist, 'addUrl', emptyAction());
        ensure(hist, 'deleteUrl', emptyAction());
        ensure(hist, 'deleteRange', emptyAction());
        ensure(hist, 'deleteAll', emptyAction());
        addListeners(hist, ['onVisited','onVisitRemoved']);

        /* ---------- chrome.bookmarks ---------- */
        var bm = c.bookmarks || (c.bookmarks = {});
        ensure(bm, 'getTree', emptyResult([]));
        ensure(bm, 'get', emptyResult([]));
        ensure(bm, 'getChildren', emptyResult([]));
        ensure(bm, 'getRecent', emptyResult([]));
        ensure(bm, 'search', emptyResult([]));
        ensure(bm, 'create', emptyResult(null));
        ensure(bm, 'update', emptyResult(null));
        ensure(bm, 'move', emptyResult(null));
        ensure(bm, 'remove', emptyAction());
        ensure(bm, 'removeTree', emptyAction());
        addListeners(bm, ['onCreated','onRemoved','onChanged','onMoved','onChildrenReordered','onImportBegan','onImportEnded']);

        /* ---------- chrome.windows ---------- */
        var wins = c.windows || (c.windows = {});
        ensure(wins, 'get', emptyResult(null));
        ensure(wins, 'getCurrent', emptyResult(null));
        ensure(wins, 'getLastFocused', emptyResult(null));
        ensure(wins, 'getAll', emptyResult([]));
        ensure(wins, 'create', emptyResult(null));
        ensure(wins, 'update', emptyResult(null));
        ensure(wins, 'remove', emptyAction());
        addListeners(wins, ['onCreated','onRemoved','onFocusChanged','onBoundsChanged']);

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

        /* ---------- chrome.topSites ---------- */
        var ts = c.topSites || (c.topSites = {});
        ensure(ts, 'get', emptyResult([]));

        /* ---------- chrome.browsingData ---------- */
        var bd = c.browsingData || (c.browsingData = {});
        ['remove','removeAppcache','removeCache','removeCookies','removeDownloads','removeFileSystems',
         'removeFormData','removeHistory','removeIndexedDB','removeLocalStorage','removePasswords',
         'removePluginData','removeWebSQL','removeServiceWorkers'].forEach(function (m) {
          ensure(bd, m, emptyAction());
        });

        /* ---------- chrome.scripting ---------- */
        var scr = c.scripting || (c.scripting = {});
        ensure(scr, 'executeScript', emptyResult([]));
        ensure(scr, 'insertCSS', emptyResult([]));
        ensure(scr, 'removeCSS', emptyResult([]));
        ensure(scr, 'registerContentScripts', emptyResult([]));
        ensure(scr, 'unregisterContentScripts', emptyResult([]));
        ensure(scr, 'getRegisteredContentScripts', emptyResult([]));

        /* ---------- chrome.alarms ---------- */
        var al = c.alarms || (c.alarms = {});
        ensure(al, 'create', emptyAction());
        ensure(al, 'get', emptyResult(null));
        ensure(al, 'getAll', emptyResult([]));
        ensure(al, 'clear', emptyResult(false));
        ensure(al, 'clearAll', emptyResult(false));
        ensure(al, 'onAlarm', makeListener());

        /* ---------- chrome.idle ---------- */
        var idle = c.idle || (c.idle = {});
        ensure(idle, 'queryState', function (t, cb) {
          if (typeof cb === 'function') cb('active'); else return Promise.resolve('active');
        });
        ensure(idle, 'setDetectionInterval', emptyAction());
        ensure(idle, 'onStateChanged', makeListener());

        /* ---------- chrome.privacy ---------- */
        var priv = c.privacy || (c.privacy = {});
        ['network','services','websites'].forEach(function (sec) {
          if (!priv[sec]) priv[sec] = {};
          ensure(priv[sec], 'get', emptyResult({ value: null }));
          ensure(priv[sec], 'set', emptyAction());
          ensure(priv[sec], 'clear', emptyAction());
          ensure(priv[sec], 'onChange', makeListener());
        });

        /* ---------- chrome.sessions ---------- */
        var sess = c.sessions || (c.sessions = {});
        ensure(sess, 'getRecentlyClosed', emptyResult([]));
        ensure(sess, 'restore', emptyResult(null));
        ensure(sess, 'getDevices', emptyResult([]));
        ensure(sess, 'onChanged', makeListener());

        /* ---------- chrome.permissions ---------- */
        var perm = c.permissions || (c.permissions = {});
        ensure(perm, 'contains', emptyResult(false));
        ensure(perm, 'request', emptyResult(false));
        ensure(perm, 'remove', emptyResult(false));
        ensure(perm, 'getAll', emptyResult({ permissions: [], origins: [] }));
        addListeners(perm, ['onAdded','onRemoved']);

        /* ---------- chrome.management 补齐（getSelf 已有，补 getAll/get） ---------- */
        var mgmt = c.management || (c.management = {});
        ensure(mgmt, 'getAll', emptyResult([]));
        ensure(mgmt, 'get', emptyResult(null));

        window.__extPolyfilled = true;
      })();
    `);
  } catch (e) { /* 忽略 */ }
}
