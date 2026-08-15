/**
 * 扩展 API Polyfill 注入模块
 * 通过 session.setPreloads 为扩展页面（chrome-extension://）注入
 * Electron 未实现的扩展 API stub（webNavigation/commands/browserAction/action）。
 * 必须在 initExtensions() 之前调用，保证扩展后台页创建时 polyfill 已就位。
 */
const { session } = require('electron');
const path = require('path');

function setupExtensionPolyfills() {
  try {
    const preload = path.join(__dirname, 'polyfill-webnav.js');
    const edgeStorePreload = path.join(__dirname, 'edgeStorePatchPreload.js');
    session.defaultSession.setPreloads([preload, edgeStorePreload]);
    console.log('[ExtensionPolyfills] 已注入扩展 API polyfill + Edge 商店兼容补丁');
  } catch (e) {
    console.error('[ExtensionPolyfills] 注入失败:', e.message);
  }
}

module.exports = { setupExtensionPolyfills };
