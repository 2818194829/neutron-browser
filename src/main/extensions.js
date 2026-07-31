/**
 * 扩展管理模块
 * 支持安装 .zip/.crx、加载已解压扩展，并通过 Electron session 实际启用扩展
 */
const { app, session } = require('electron');
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

async function registerExtension(extRoot) {
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

  const extension = {
    id: loaded.id,
    name: loaded.name || manifest.name,
    version: loaded.version || manifest.version,
    description: manifest.description || '',
    path: extRoot,
    icon: resolveIcon(manifest, extRoot),
    enabled: true,
    installedAt: Date.now(),
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

async function installFromArchiveBuffer(buffer) {
  const tempDir = fs.mkdtempSync(path.join(app.getPath('temp'), 'neutron-ext-'));

  try {
    const zip = new AdmZip(buffer);
    zip.extractAllTo(tempDir, true);

    const sourceRoot = findManifestDir(tempDir);
    const destDir = path.join(extensionsRoot(), `ext_${Date.now()}`);
    copyDirectory(sourceRoot, destDir);

    try {
      return await registerExtension(destDir);
    } catch (e) {
      removeDirectory(destDir);
      throw e;
    }
  } finally {
    removeDirectory(tempDir);
  }
}

async function installExtensionFile(filePath) {
  fs.mkdirSync(extensionsRoot(), { recursive: true });
  return installFromArchiveBuffer(readArchiveBuffer(filePath));
}

async function installUnpackedExtension(dirPath) {
  fs.mkdirSync(extensionsRoot(), { recursive: true });

  const sourceRoot = findManifestDir(dirPath);
  const destDir = path.join(extensionsRoot(), `ext_${Date.now()}`);
  copyDirectory(sourceRoot, destDir);

  try {
    return await registerExtension(destDir);
  } catch (e) {
    removeDirectory(destDir);
    throw e;
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

  return { success: true };
}

module.exports = {
  initExtensions,
  getInstalledExtensions,
  installExtensionFile,
  installUnpackedExtension,
  setExtensionEnabled,
  uninstallExtension,
};
