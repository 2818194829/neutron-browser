/**
 * Edge 商店兼容补丁（session 级 preload，在页面任何脚本执行前注入主世界）
 *
 * 商店 JS 判定"真正的 Edge 浏览器"依赖：
 * 1. navigator.userAgentData.brands 含 "Microsoft Edge"
 * 2. navigator.userAgentData.getHighEntropyValues(['uaFullVersion',...]) 返回 Edge 版本
 * 3. chrome.webstorePrivate 存在（否则 pt() = d(chrome) || d(chrome.webstorePrivate)
 *    → "与你的浏览器不兼容" + 禁用安装按钮）
 * 4. "获取"安装通过 chrome.webstorePrivate.beginInstallWithManifest3
 *
 * Electron 均不满足（userAgentData 是 Chromium 的、无 getHighEntropyValues、
 * 无 webstorePrivate），且 dom-ready 时注入太晚（React 已用旧结果渲染）。
 * preload 在文档创建时执行、先于一切页面脚本，因此在这里注入。
 */
const { webFrame } = require('electron');

const EDGE_STORE_HOSTS = ['microsoftedge.microsoft.com', 'edge.microsoft.com'];

if (EDGE_STORE_HOSTS.includes(location.hostname)) {
  const chromeVersion =
    (typeof process !== 'undefined' && process.versions && process.versions.chrome) || '150.0.0.0';
  const major = String(chromeVersion).split('.')[0] || '150';

  const patch = `
(function () {
  // ---------- 1. 伪装 userAgentData（brands + getHighEntropyValues） ----------
  if (!navigator.userAgentData || !(navigator.userAgentData.brands || []).some(function (b) { return b.brand === 'Microsoft Edge'; })) {
    const edgeBrands = [
      { brand: "Microsoft Edge", version: "${major}" },
      { brand: "Not=A?Brand", version: "99" },
      { brand: "Chromium", version: "${major}" }
    ];
    const edgeFullVersionList = [
      { brand: "Microsoft Edge", version: "${chromeVersion}" },
      { brand: "Not=A?Brand", version: "99.0.0.0" },
      { brand: "Chromium", version: "${chromeVersion}" }
    ];
    Object.defineProperty(navigator, 'userAgentData', {
      get: function () {
        return {
          brands: edgeBrands,
          mobile: false,
          platform: "Windows",
          getHighEntropyValues: function (hints) {
            const map = {
              architecture: "x86",
              bitness: "64",
              model: "",
              platform: "Windows",
              platformVersion: "10.0.0",
              uaFullVersion: "${chromeVersion}",
              wow64: false,
              brands: edgeBrands,
              mobile: false,
              fullVersionList: edgeFullVersionList
            };
            const out = {};
            (hints || []).forEach(function (h) { if (h in map) out[h] = map[h]; });
            return Promise.resolve(out);
          }
        };
      },
      configurable: true,
      enumerable: true
    });
  }

  // ---------- 2. 补 Edge 商店私有 API chrome.webstorePrivate ----------
  const ch = window.chrome || (window.chrome = {});
  // 商店代码访问 chrome.runtime.lastError：Electron 普通网页的 chrome.runtime 可能不存在
  if (!ch.runtime) {
    ch.runtime = { lastError: undefined };
  } else if (!('lastError' in ch.runtime)) {
    try { Object.defineProperty(ch.runtime, 'lastError', { get: function () { return undefined; } }); } catch (e) { /* 忽略 */ }
  }
  if (!ch.webstorePrivate) {
    ch.webstorePrivate = {
      beginInstallWithManifest3: function (data, callback) {
        const finish = function (errMsg) { if (typeof callback === 'function') callback(errMsg || ''); };
        let input = '';
        if (typeof data === 'string') input = data;
        else if (data && typeof data === 'object') {
          input = data.crxId || data.id || data.url ||
            (data.manifest && data.manifest.update_url) || location.href;
        }
        if (!input) input = location.href;
        if (window.NeutronBrowser && window.NeutronBrowser.installFromEdgeStore) {
          window.NeutronBrowser.installFromEdgeStore(input).then(function (r) {
            finish(r && r.success ? 'success' : ((r && r.message) || 'install failed'));
          }).catch(function (e) { finish(String((e && e.message) || e)); });
        } else {
          finish('no install bridge');
        }
      },
      install: function (url, onSuccess, onFailure) {
        if (window.NeutronBrowser && window.NeutronBrowser.installFromEdgeStore) {
          window.NeutronBrowser.installFromEdgeStore(url || location.href).then(function (r) {
            if (r && r.success) { if (typeof onSuccess === 'function') onSuccess(); }
            else if (typeof onFailure === 'function') onFailure((r && r.message) || 'install failed');
          }).catch(function (e) { if (typeof onFailure === 'function') onFailure(String((e && e.message) || e)); });
        }
      },
      // 商店在 beginInstallWithManifest3 成功后调用 completeInstall 完成收尾。
      // 本浏览器安装已在 beginInstallWithManifest3 里完成，这里直接回调成功。
      completeInstall: function () {
        const args = Array.prototype.slice.call(arguments);
        const cb = args.find(function (a) { return typeof a === 'function'; });
        if (cb) cb('success');
        return Promise.resolve('success');
      },
      getBrowserLogin: function (callback) {
        if (typeof callback === 'function') {
          callback({ account_type: 'MSA', account_location: 'CN', age_group_type: 3 });
        }
      },
      getPreferences: function (callback) {
        if (typeof callback === 'function') {
          callback({ is_edge_feedback_enabled: false, aadc_age_group: 'Adult' });
        }
      },
      showFeedbackDialog: function () { /* 本浏览器无此功能，空操作 */ }
    };
  }
})();
`;

  try {
    webFrame.executeJavaScript(patch, true);
  } catch (e) { /* 忽略：某些页面上下文可能无法注入 */ }
}
