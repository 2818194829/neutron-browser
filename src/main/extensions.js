/**
 * 扩展管理模块
 * 支持安装 .zip/.crx、加载已解压扩展，并通过 Electron session 实际启用扩展
 */
const { app, session, net, dialog } = require('electron');
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

function readArchiveBuffer(filePath) {
  const buffer = fs.readFileSync(filePath);

  if (buffer.length > 12 && buffer.toString('latin1', 0, 4) === 'Cr24') {
    const headerSize = buffer.readUInt32LE(8);
    const zipStart = 12 + headerSize;
    if (zipStart >= buffer.length) {
      throw new Error('CRX 文件头无效');
    }
    return buffer.subarray(zipStart);
  }

  if (buffer.length > 4 && buffer.toString('latin1', 0, 2) === 'PK') {
    return buffer;
  }

  throw new Error('请选择有效的 .zip 或 .crx 扩展包');
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
    try {
      await session.defaultSession.removeExtension(loaded.id);
    } catch (e) { /* 忽略未加载状态 */ }
    if (existing.path && existing.path !== extRoot) {
      removeInstalledDirectory(existing.path);
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

  const response = await net.fetch(downloadUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36 Edg/120.0.0.0',
    },
  });

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
    .filter((ext) => ext.enabled && ext.path && fs.existsSync(path.join(ext.path, 'manifest.json')))
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
        const accel = (cmd.suggested_key && cmd.suggested_key.default) || '';
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

module.exports = {
  initExtensions,
  getInstalledExtensions,
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
};
