/**
 * 扩展管理模块
 * 支持安装 .zip/.crx、加载已解压扩展，并通过 Electron session 实际启用扩展
 */
const { app, session, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { getStore } = require('./storage');

function extensionsRoot() {
  return path.join(app.getPath('userData'), 'NeutronBrowser', 'extensions');
}

function getInstalledExtensions() {
  return getStore('extensions').get('installed', []);
}

function saveInstalledExtensions(installed) {
  getStore('extensions').set('installed', installed);
}

function getExtension(id) {
  return getInstalledExtensions().find(ext => ext.id === id);
}

/**
 * 解析扩展包缓冲区：识别 CRX（版本 2/3）与 zip，返回 zip 内容。
 * @param {Buffer} buffer 文件内容
 * @returns {Buffer} zip 内容（AdmZip 可直接解压）
 */
function parseArchiveBuffer(buffer) {
  // CRX 文件头：魔数 Cr24（4 字节）+ 版本号（4 字节）
  if (buffer.length > 16 && buffer.toString('latin1', 0, 4) === 'Cr24') {
    const version = buffer.readUInt32LE(4);
    let zipStart;

    if (version === 2) {
      // CRX2：魔数(4) + 版本(4) + 公钥长度(4) + 签名长度(4) = 16 字节头，
      // 其后依次是公钥、签名，zip 内容在 16 + pubkeyLen + sigLen 处
      const pubkeyLen = buffer.readUInt32LE(8);
      const sigLen = buffer.readUInt32LE(12);
      zipStart = 16 + pubkeyLen + sigLen;
      if (zipStart >= buffer.length) {
        throw new Error('CRX 文件头无效');
      }
    } else if (version >= 3) {
      // CRX3：魔数(4) + 版本(4) + 头长度(4)，zip 内容在 12 + headerSize 处
      const headerSize = buffer.readUInt32LE(8);
      zipStart = 12 + headerSize;
      if (headerSize === 0 || zipStart >= buffer.length) {
        throw new Error('CRX 文件头无效');
      }
    } else {
      throw new Error(`不支持的 CRX 版本: ${version}`);
    }

    return buffer.subarray(zipStart);
  }

  if (buffer.length > 4 && buffer.toString('latin1', 0, 2) === 'PK') {
    return buffer;
  }

  throw new Error('请选择有效的 .zip 或 .crx 扩展包');
}

function readArchiveBuffer(filePath) {
  return parseArchiveBuffer(fs.readFileSync(filePath));
}

function findManifestDir(root) {
  if (fs.existsSync(path.join(root, 'manifest.json'))) {
    return root;
  }

  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const nested = path.join(root, entry.name, 'manifest.json');
    if (fs.existsSync(nested)) {
      return path.join(root, entry.name);
    }
  }

  throw new Error('扩展包内未找到 manifest.json');
}

function readManifest(extRoot) {
  return JSON.parse(fs.readFileSync(path.join(extRoot, 'manifest.json'), 'utf8'));
}

// ==================== 安装权限确认（对齐 Edge） ====================

// 常见无害/低敏感权限，安装时不逐项提示
const QUIET_PERMISSIONS = new Set([
  'storage', 'activeTab', 'alarms', 'notifications',
  'unlimitedStorage', 'background', 'scripting',
]);

/** 人性化权限名称映射（未映射的原样显示） */
const PERMISSION_NAMES = {
  tabs: '读取浏览记录',
  cookies: '读取和更改 Cookie',
  history: '读取浏览历史',
  bookmarks: '读取和更改书签',
  downloads: '管理下载',
  webRequest: '拦截并修改网络请求',
  webNavigation: '读取导航记录',
  clipboardRead: '读取剪贴板',
  clipboardWrite: '写入剪贴板',
  geolocation: '访问位置信息',
  contextMenus: '在右键菜单中添加项目',
  management: '管理其它扩展',
  proxy: '更改代理设置',
  'declarativeNetRequest': '拦截并修改网络请求',
  '<all_urls>': '在所有网站上读取和更改数据',
};

/**
 * 安装前权限确认。返回 true 允许安装，false 用户取消。
 * 环境变量 NEUTRON_SKIP_EXT_CONFIRM=1 可跳过（自动化/测试用）。
 * @param {Object} manifest
 */
async function confirmExtensionPermissions(manifest) {
  if (process.env.NEUTRON_SKIP_EXT_CONFIRM === '1') return true;
  const collected = [
    ...(Array.isArray(manifest.permissions) ? manifest.permissions : []),
    ...(Array.isArray(manifest.host_permissions) ? manifest.host_permissions : []),
  ].filter((p) => !QUIET_PERMISSIONS.has(p));

  if (collected.length === 0) return true;

  const list = collected
    .map((p) => `•  ${PERMISSION_NAMES[p] || p}`)
    .join('\n');

  const parent = (global.windowManager && global.windowManager.mainWindow) || undefined;
  const { response } = await dialog.showMessageBox(parent, {
    type: 'info',
    title: '安装扩展',
    message: `添加“${manifest.name || '未命名扩展'}”？`,
    detail: `此扩展将能够：\n${list}\n\n仅安装您信任的扩展。`,
    buttons: ['取消', '添加扩展'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  });
  return response === 1;
}

function resolveSource(manifest) {
  if (manifest && manifest.update_url) {
    const updateUrl = String(manifest.update_url);
    if (updateUrl.includes('edge.microsoft.com') || updateUrl.includes('microsoftedge')) {
      return 'edge_store';
    }
  }
  return 'local';
}

function resolveBackgroundInfo(manifest) {
  if (manifest.background) {
    if (manifest.background.service_worker) {
      return { backgroundType: 'service_worker', viewInfo: 'service_worker' };
    }
    if (manifest.background.page) {
      return { backgroundType: 'background_page', viewInfo: manifest.background.page };
    }
    if (Array.isArray(manifest.background.scripts) && manifest.background.scripts.length > 0) {
      return { backgroundType: 'background_page', viewInfo: manifest.background.scripts[0] };
    }
  }
  return { backgroundType: '', viewInfo: '' };
}

function resolveIcon(manifest, extRoot) {
  const iconEntries = Object.entries(manifest.icons || {})
    .sort((a, b) => Number(b[0]) - Number(a[0]));

  for (const [, relPath] of iconEntries) {
    const candidate = path.join(extRoot, relPath);
    if (fs.existsSync(candidate)) return candidate;
  }

  for (const relPath of ['icons/128.png', 'icons/128x128.png', 'icons/icon128.png', 'icons/48.png', 'icons/icon.png', 'icons/16.png']) {
    const candidate = path.join(extRoot, relPath);
    if (fs.existsSync(candidate)) return candidate;
  }

  return '';
}

function copyDirectory(source, target) {
  fs.cpSync(source, target, { recursive: true });
}

function removeDirectory(target) {
  fs.rmSync(target, { recursive: true, force: true });
}

function removeInstalledDirectory(target) {
  const root = path.resolve(extensionsRoot());
  const resolved = path.resolve(target);
  if (resolved === root || resolved.startsWith(root + path.sep)) {
    removeDirectory(resolved);
  }
}

async function registerExtension(extRoot, installSource) {
  const manifest = readManifest(extRoot);
  if (!manifest.name || !manifest.version) {
    throw new Error('manifest.json 缺少 name 或 version');
  }

  let loaded;
  try {
    loaded = await session.defaultSession.loadExtension(extRoot);
  } catch (e) {
    throw new Error(`扩展加载失败: ${e.message}`);
  }

  let source = installSource;
  if (!source) {
    source = resolveSource(manifest);
  }

  const background = resolveBackgroundInfo(manifest);
  const permissions = Array.isArray(manifest.permissions) ? manifest.permissions : [];

  const extension = {
    id: loaded.id,
    name: loaded.name || manifest.name,
    version: loaded.version || manifest.version,
    description: manifest.description || '',
    path: extRoot,
    icon: resolveIcon(manifest, extRoot),
    enabled: true,
    installedAt: Date.now(),
    source: source,
    installSource: source,
    backgroundType: background.backgroundType,
    viewInfo: background.viewInfo,
    permissions: permissions,
  };

  const installed = getInstalledExtensions();
  const existingIndex = installed.findIndex(ext => ext.id === loaded.id);
  if (existingIndex !== -1) {
    const existing = installed[existingIndex];
    // 同 ID 重装：若路径不同，先卸载旧实例、删除旧目录，再重新加载新路径
    // （首个 loadExtension 可能返回缓存的旧实例，需重新加载新文件才能生效）
    if (existing.path && existing.path !== extRoot) {
      try {
        await session.defaultSession.removeExtension(loaded.id);
      } catch (e) { /* 忽略未加载状态 */ }
      removeInstalledDirectory(existing.path);
      loaded = await session.defaultSession.loadExtension(extRoot);
    }
    installed.splice(existingIndex, 1);
  }

  installed.push(extension);
  saveInstalledExtensions(installed);
  return extension;
}

async function installFromArchiveBuffer(buffer, source) {
  const tempDir = fs.mkdtempSync(path.join(app.getPath('temp'), 'neutron-ext-'));

  try {
    const zip = new AdmZip(buffer);
    zip.extractAllTo(tempDir, true);

    const sourceRoot = findManifestDir(tempDir);

    // 安装前权限确认（对齐 Edge）
    if (!(await confirmExtensionPermissions(readManifest(sourceRoot)))) {
      throw new Error('已取消安装');
    }

    const destDir = path.join(extensionsRoot(), `ext_${Date.now()}`);
    copyDirectory(sourceRoot, destDir);

    try {
      return await registerExtension(destDir, source || 'local');
    } catch (e) {
      removeDirectory(destDir);
      throw e;
    }
  } finally {
    removeDirectory(tempDir);
  }
}

async function installExtensionFile(filePath, source) {
  fs.mkdirSync(extensionsRoot(), { recursive: true });
  return installFromArchiveBuffer(readArchiveBuffer(filePath), source || 'local');
}

/**
 * 开发者模式开关（对齐 Edge：edge://extensions 的 Developer mode）
 * 关闭时禁止侧载（拖放安装 / 加载已解压扩展），商店安装不受影响。
 * 默认开启：本浏览器定位侧载友好，用户可自行关闭。
 * @returns {boolean}
 */
function isDeveloperMode() {
  try {
    return getStore('settings').get('developerMode', true) !== false;
  } catch (e) {
    return true;
  }
}

async function installUnpackedExtension(dirPath) {
  fs.mkdirSync(extensionsRoot(), { recursive: true });

  const sourceRoot = findManifestDir(dirPath);

  // 安装前权限确认（对齐 Edge）
  if (!(await confirmExtensionPermissions(readManifest(sourceRoot)))) {
    throw new Error('已取消安装');
  }

  const destDir = path.join(extensionsRoot(), `ext_${Date.now()}`);
  copyDirectory(sourceRoot, destDir);

  try {
    return await registerExtension(destDir, 'local');
  } catch (e) {
    removeDirectory(destDir);
    throw e;
  }
}

function parseEdgeCrxId(input) {
  const trimmed = String(input || '').trim();

  if (/^[a-p]{32}$/i.test(trimmed)) {
    return trimmed.toLowerCase();
  }

  try {
    const parsed = new URL(trimmed);
    const segments = parsed.pathname.split('/').filter(Boolean);
    const last = segments[segments.length - 1] || '';
    if (/^[a-p]{32}$/i.test(last)) {
      return last.toLowerCase();
    }
  } catch (e) { /* 保留下方错误 */ }

  throw new Error('无法识别 Edge 扩展 ID，请粘贴扩展详情页链接或 32 位扩展 ID');
}

async function installFromEdgeStore(input) {
  const crxId = parseEdgeCrxId(input);
  const downloadUrl =
    'https://edge.microsoft.com/extensionwebstorebase/v1/crx' +
    '?response=redirect&prod=CHROMECRX' +
    `&x=id%3D${encodeURIComponent(crxId)}%26installsource%3Dondemand%26uc`;

  const chromeVersion = process.versions.chrome || '120.0.0.0';
  const userAgent =
    `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ` +
    `Chrome/${chromeVersion} Safari/537.36 Edg/${chromeVersion}`;

  // 扩展语言自动跟随系统：Edge 商店根据 Accept-Language 返回对应语言包的 CRX。
  // 下载走 Node fetch（不经过 Chromium），必须显式带上系统语言，
  // 否则 undici 默认发 `accept-language: *`，商店会返回英文默认语言包。
  const locale = app.getLocale() || 'zh-CN';
  const baseLang = locale.split(/[-_]/)[0] || 'en';
  const acceptLanguage = `${locale},${baseLang};q=0.9,en;q=0.8`;

  let lastError = null;
  // 下载可能因网络/CDN 挂起或失败，超时后重试一次。
  // 用 Node 原生 fetch（而非 net.fetch/session.fetch）：Chromium 网络栈受系统代理
  // 与 webRequest 监听器影响，偶发挂起（实测 Node fetch 680ms 而 session.fetch 曾 90s+ 不返回）
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);
    try {
      const response = await fetch(downloadUrl, {
        headers: {
          'User-Agent': userAgent,
          'Accept-Language': acceptLanguage,
        },
        signal: controller.signal,
        redirect: 'follow',
      });
      clearTimeout(timer);

      if (!response.ok) {
        throw new Error(`Edge 商店下载失败: HTTP ${response.status}`);
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length < 12 || buffer.toString('latin1', 0, 4) !== 'Cr24') {
        throw new Error('Edge 商店返回的不是有效的 CRX 文件');
      }

      const tempFile = path.join(app.getPath('temp'), `neutron-edge-${crxId}-${Date.now()}.crx`);
      fs.writeFileSync(tempFile, buffer);

      try {
        return await installExtensionFile(tempFile, 'edge_store');
      } finally {
        fs.rmSync(tempFile, { force: true });
      }
    } catch (e) {
      clearTimeout(timer);
      lastError = e;
      if (attempt === 0) {
        console.warn(`[Extensions] Edge 商店下载失败，重试一次: ${crxId}`, e.message);
      }
    }
  }
  throw lastError || new Error('Edge 商店下载失败');
}

async function initExtensions() {
  fs.mkdirSync(extensionsRoot(), { recursive: true });

  const installed = getInstalledExtensions();
  for (const ext of installed) {
    if (!ext.enabled) continue;
    if (!ext.path || !fs.existsSync(ext.path)) {
      ext.enabled = false;
      continue;
    }

    try {
      const loaded = await session.defaultSession.loadExtension(ext.path);
      if (loaded) ext.id = loaded.id;
    } catch (e) {
      console.warn(`[Extensions] 加载扩展失败: ${ext.name || ext.id}`, e.message);
      ext.enabled = false;
    }
  }

  saveInstalledExtensions(installed);
}

async function setExtensionEnabled(id, enabled) {
  const ext = getExtension(id);
  if (!ext) throw new Error('扩展不存在');

  if (enabled) {
    if (!ext.path || !fs.existsSync(ext.path)) {
      throw new Error('扩展目录不存在');
    }
    const loaded = await session.defaultSession.loadExtension(ext.path);
    ext.id = loaded.id;
  } else {
    try {
      await session.defaultSession.removeExtension(ext.id);
    } catch (e) { /* 忽略未加载状态 */ }
    // 禁用后清理：模拟后台、徽章状态、右键菜单注册（避免残留继续运行/显示）
    try {
      const { destroyMv3Background, contextMenuUnregisterAll, clearAlarmsForExt } = require('./extensionBridge');
      const { clearDnrForExt } = require('./declarativeNetRequest');
      destroyMv3Background(id);
      contextMenuUnregisterAll(id);
      clearAlarmsForExt(id);
      clearDnrForExt(id);
    } catch (e) { /* 忽略 */ }
    const states = getBadgeStates();
    if (states[id]) {
      delete states[id];
      saveBadgeStates(states);
    }
  }

  ext.enabled = enabled;
  saveInstalledExtensions(getInstalledExtensions());
  return ext;
}

async function uninstallExtension(id) {
  const ext = getExtension(id);
  if (!ext) return { success: false, message: '扩展不存在' };

  try {
    await session.defaultSession.removeExtension(id);
  } catch (e) { /* 忽略未加载状态 */ }

  // 卸载后销毁 MV3 模拟后台（否则后台脚本继续运行）
  try {
    const { destroyMv3Background, clearAlarmsForExt } = require('./extensionBridge');
    const { clearDnrForExt } = require('./declarativeNetRequest');
    destroyMv3Background(id);
    clearAlarmsForExt(id);
    clearDnrForExt(id);
  } catch (e) { /* 忽略 */ }

  const installed = getInstalledExtensions().filter(item => item.id !== id);
  saveInstalledExtensions(installed);

  if (ext.path) {
    removeInstalledDirectory(ext.path);
  }

  // 清理该扩展的徽章状态
  const states = getBadgeStates();
  if (states[id]) {
    delete states[id];
    saveBadgeStates(states);
  }

  // 清理该扩展的右键菜单注册
  try {
    const { contextMenuUnregisterAll } = require('./extensionBridge');
    contextMenuUnregisterAll(id);
  } catch (e) { /* 忽略 */ }

  return { success: true };
}

// ==================== 扩展动作（工具栏图标/徽章/Popup，对齐 Edge） ====================

/** 徽章状态持久化（extensions.json 的 badgeStates 字段） */
function getBadgeStates() {
  return getStore('extensions').get('badgeStates', {});
}

function saveBadgeStates(states) {
  getStore('extensions').set('badgeStates', states);
}

/** 从 manifest 解析动作配置（browser_action / action） */
function resolveActionConfig(ext, manifest) {
  const action = manifest.browser_action || manifest.action || null;
  if (!action) return null;

  let iconRel = '';
  const icon = action.default_icon;
  if (typeof icon === 'string') {
    iconRel = icon;
  } else if (icon && typeof icon === 'object') {
    const entries = Object.entries(icon).sort((a, b) => Number(b[0]) - Number(a[0]));
    if (entries.length > 0) iconRel = entries[0][1];
  }
  let iconPath = '';
  if (iconRel) {
    const candidate = path.join(ext.path, iconRel);
    if (fs.existsSync(candidate)) iconPath = candidate;
  }
  if (!iconPath) iconPath = resolveIcon(manifest, ext.path);

  return {
    defaultTitle: action.default_title || ext.name || '扩展',
    defaultPopup: action.default_popup || '',
    defaultIcon: iconPath,
  };
}

/** 获取所有已启用扩展的动作配置（含徽章状态），供工具栏渲染 */
function getExtensionActions() {
  const installed = getInstalledExtensions();
  const badgeStates = getBadgeStates();
  return installed
    .filter((ext) => ext.enabled && ext.pinned !== false &&
      ext.path && fs.existsSync(path.join(ext.path, 'manifest.json')))
    .map((ext) => {
      try {
        const manifest = JSON.parse(fs.readFileSync(path.join(ext.path, 'manifest.json'), 'utf8'));
        const action = resolveActionConfig(ext, manifest);
        if (!action) return null;
        const badge = badgeStates[ext.id] || {};
        return {
          id: ext.id,
          name: ext.name,
          icon: action.defaultIcon,
          title: badge.title || action.defaultTitle,
          popup: action.defaultPopup,
          badgeText: badge.text || '',
          badgeColor: badge.color || '#666666',
        };
      } catch (e) {
        return null;
      }
    })
    .filter(Boolean);
}

/**
 * 设置扩展徽章/标题（由 polyfill 的 browserAction/action API 调用）。
 * @param {string} extId
 * @param {{text?:string, color?:string, title?:string}} patch
 */
function setExtensionBadge(extId, patch) {
  const states = getBadgeStates();
  const cur = states[extId] || {};
  if (patch && patch.text !== undefined) cur.text = String(patch.text || '');
  if (patch && patch.color !== undefined) cur.color = patch.color || '#666666';
  if (patch && patch.title !== undefined) cur.title = String(patch.title || '');
  states[extId] = cur;
  saveBadgeStates(states);
  return { id: extId, ...cur };
}

/** 收集扩展的键盘命令（manifest.commands），供快捷键注册 */
function collectExtensionCommands() {
  const installed = getInstalledExtensions().filter((ext) => ext.enabled);
  const result = [];
  for (const ext of installed) {
    if (!ext.path || !fs.existsSync(path.join(ext.path, 'manifest.json'))) continue;
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(ext.path, 'manifest.json'), 'utf8'));
      const commands = manifest.commands || {};
      for (const [name, cmd] of Object.entries(commands)) {
        // 优先平台特定键位（windows/mac/linux），缺省回退 default
        const sk = cmd.suggested_key || {};
        const platformKey = process.platform === 'darwin' ? 'mac'
          : (process.platform === 'win32' ? 'windows' : 'linux');
        const accel = sk[platformKey] || sk.default || '';
        if (!accel) continue;
        result.push({
          extId: ext.id,
          extName: ext.name,
          name,
          description: cmd.description || name,
          accelerator: accel,
        });
      }
    } catch (e) { /* 忽略损坏的 manifest */ }
  }
  return result;
}

/** 查找扩展的后台 webContents（MV2 后台页；MV3 用模拟后台宿主页） */
function findExtensionBackgroundWebContents(extId) {
  const { webContents } = require('electron');
  const all = webContents.getAllWebContents();
  const candidates = all.filter((wc) => {
    const url = wc.getURL();
    return url.includes(`chrome-extension://${extId}/`) &&
      (url.includes('_generated_background_page') || /background/i.test(url));
  });
  // 优先精确匹配 MV2 后台页
  const bg = candidates.find((wc) => wc.getURL().includes('_generated_background_page')) || candidates[0];
  if (bg) return bg;
  // 其次查找 MV3 模拟后台宿主页
  try {
    const { findMv3BackgroundWebContents } = require('./extensionBridge');
    const mv3 = findMv3BackgroundWebContents(extId);
    if (mv3) return mv3;
  } catch (e) { /* 忽略 */ }
  return null;
}

/** 触发扩展后台的 browserAction/action onClicked 事件 */
function triggerExtensionActionClicked(extId) {
  const wc = findExtensionBackgroundWebContents(extId);
  if (!wc || wc.isDestroyed()) return false;
  wc.executeJavaScript(
    'window.__neutronFireActionClicked && window.__neutronFireActionClicked()'
  ).catch(() => {});
  return true;
}

/** 触发扩展后台的 commands.onCommand 事件 */
function triggerExtensionCommand(extId, commandName) {
  const wc = findExtensionBackgroundWebContents(extId);
  if (!wc || wc.isDestroyed()) return false;
  wc.executeJavaScript(
    `window.__neutronFireCommand && window.__neutronFireCommand(${JSON.stringify(commandName)})`
  ).catch(() => {});
  return true;
}

// ==================== 扩展右键菜单（网站访问权限/工具栏固定，对齐 Edge） ====================

/** 读取扩展 manifest（损坏时返回空对象） */
function readExtManifest(ext) {
  try {
    if (!ext || !ext.path) return {};
    return JSON.parse(fs.readFileSync(path.join(ext.path, 'manifest.json'), 'utf8'));
  } catch (e) {
    return {};
  }
}

/** 从 manifest 推断默认站点访问模式（仅当记录中无 siteAccess 时） */
function inferSiteAccess(ext, manifest) {
  const hosts = Array.isArray(manifest.host_permissions) ? manifest.host_permissions : [];
  if (hosts.length > 0) return 'all';
  const perms = Array.isArray(manifest.permissions) ? manifest.permissions : [];
  if (perms.includes('activeTab')) return 'on_click';
  return 'all';
}

/** 人性化 host 权限列表（查看 Web 权限） */
function humanizeHostPermissions(hosts) {
  return (Array.isArray(hosts) ? hosts : []).map((h) => {
    if (h === '<all_urls>') return '在所有网站上读取和更改数据';
    const m = /^https?:\/\/([^/:*]+)/.exec(h);
    if (m) return `在 ${m[1]} 上读取和更改数据`;
    return h;
  });
}

/** 解析 URL/站点字符串为 hostname（无协议时按 https 处理） */
function toHostname(value) {
  if (!value) return '';
  try {
    return new URL(value.includes('://') ? value : `https://${value}`).hostname;
  } catch (e) {
    return String(value).trim();
  }
}

/** 获取扩展右键菜单所需元数据 */
function getExtensionMenuMeta(id) {
  const ext = getExtension(id);
  if (!ext) return null;
  const manifest = readExtManifest(ext);
  const hostPermissions = Array.isArray(manifest.host_permissions) ? manifest.host_permissions : [];
  const hasHostAccess = hostPermissions.length > 0;
  const action = manifest.browser_action || manifest.action || null;
  const optionsPage = (manifest.options_ui && manifest.options_ui.page) || manifest.options_page || '';
  return {
    id: ext.id,
    name: ext.name,
    siteAccess: ext.siteAccess || inferSiteAccess(ext, manifest),
    siteAccessSite: ext.siteAccessSite || '',
    pinned: ext.pinned !== false,
    hasOptionsPage: !!optionsPage,
    optionsPage,
    hasPopup: !!(action && action.default_popup),
    hasHostAccess,
    hostPermissions: humanizeHostPermissions(hostPermissions),
    permissions: (Array.isArray(manifest.permissions) ? manifest.permissions : [])
      .map((p) => PERMISSION_NAMES[p] || p),
  };
}

/**
 * 设置扩展站点访问模式（对齐 Edge：on_click / specific / all）。
 * 实际过滤在 extensionBridge 的 webRequest/桥接层生效。
 */
function setExtensionSiteAccess(id, mode, site) {
  const ext = getExtension(id);
  if (!ext) throw new Error('扩展不存在');
  if (!['on_click', 'specific', 'all'].includes(mode)) throw new Error('无效的访问模式');

  ext.siteAccess = mode;
  ext.siteAccessSite = mode === 'specific' ? toHostname(site) : '';
  // 切换模式时清除点击授予
  ext.clickGrantedSite = '';
  ext.clickGrantedAt = 0;
  saveInstalledExtensions(getInstalledExtensions());
  return getExtensionMenuMeta(id);
}

/** 设置扩展工具栏固定状态（取消固定后图标隐藏，管理页可重新固定） */
function setExtensionPinned(id, pinned) {
  const ext = getExtension(id);
  if (!ext) throw new Error('扩展不存在');
  ext.pinned = !!pinned;
  saveInstalledExtensions(getInstalledExtensions());
  return getExtensionMenuMeta(id);
}

/**
 * 判断某 URL 是否在该扩展的站点访问许可内（webRequest/桥接层调用）。
 * - all: 全部放行
 * - specific: 仅匹配指定站点
 * - on_click: 仅在点击图标授予的站点（15 分钟内）放行
 * - 旧记录（无 siteAccess）: 默认全访问，向后兼容
 */
function isSiteAccessAllowed(extId, url) {
  if (!url) return true;
  const ext = getExtension(extId);
  if (!ext || !ext.siteAccess) return true;

  const mode = ext.siteAccess;
  if (mode === 'all') return true;

  const host = toHostname(url);
  if (!host) return true;

  if (mode === 'specific') {
    const siteHost = ext.siteAccessSite || '';
    if (!siteHost) return false;
    return host === siteHost || host.endsWith('.' + siteHost);
  }

  // on_click：点击授予的站点 15 分钟内有效（activeTab 语义近似）
  if (ext.clickGrantedSite && ext.clickGrantedAt &&
      Date.now() - ext.clickGrantedAt < 15 * 60 * 1000) {
    const grantedHost = toHostname(ext.clickGrantedSite);
    if (grantedHost && (host === grantedHost || host.endsWith('.' + grantedHost))) {
      return true;
    }
  }
  return false;
}

/** 点击工具栏图标时，对 on_click 模式扩展授予当前标签页站点访问 */
function grantSiteAccessOnClick(extId, url) {
  if (!url) return;
  const ext = getExtension(extId);
  if (!ext || (ext.siteAccess || 'all') !== 'on_click') return;
  ext.clickGrantedSite = url;
  ext.clickGrantedAt = Date.now();
  saveInstalledExtensions(getInstalledExtensions());
}

module.exports = {
  initExtensions,
  getInstalledExtensions,
  isDeveloperMode,
  readArchiveBuffer,
  parseArchiveBuffer,
  installExtensionFile,
  installUnpackedExtension,
  installFromEdgeStore,
  setExtensionEnabled,
  uninstallExtension,
  getExtensionActions,
  setExtensionBadge,
  collectExtensionCommands,
  findExtensionBackgroundWebContents,
  triggerExtensionActionClicked,
  triggerExtensionCommand,
  getExtensionMenuMeta,
  setExtensionSiteAccess,
  setExtensionPinned,
  isSiteAccessAllowed,
  grantSiteAccessOnClick,
};
