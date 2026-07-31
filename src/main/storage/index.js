/**
 * 数据存储模块
 * 使用 electron-store 管理持久化数据
 */
const path = require('path');
const fs = require('fs');

// 简单的 JSON 文件存储（替代 electron-store，减少依赖问题）
class JsonStore {
  constructor(filePath, defaults = {}) {
    this.filePath = filePath;
    this.data = { ...defaults };
    this._loaded = false;
    this._saveTimer = null;
  }

  _ensureLoaded() {
    if (this._loaded) return;
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        this.data = { ...this.data, ...JSON.parse(raw) };
      }
    } catch (e) {
      console.error(`[Storage] 加载 ${this.filePath} 失败:`, e.message);
    }
    this._loaded = true;
  }

  _save() {
    // 防抖保存：150ms 内多次修改只保存一次
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      try {
        const dir = path.dirname(this.filePath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8');
      } catch (e) {
        console.error(`[Storage] 保存 ${this.filePath} 失败:`, e.message);
      }
    }, 150);
  }

  get(key, defaultValue) {
    this._ensureLoaded();
    return key in this.data ? this.data[key] : defaultValue;
  }

  set(key, value) {
    this._ensureLoaded();
    this.data[key] = value;
    this._save();
  }

  getAll() {
    this._ensureLoaded();
    return { ...this.data };
  }

  delete(key) {
    this._ensureLoaded();
    delete this.data[key];
    this._save();
  }
}

// ==================== 存储实例 ====================
let stores = {};

/**
 * 初始化存储系统
 * @param {string} userDataPath - Electron userData 路径
 */
async function initStorage(userDataPath) {
  const dataDir = path.join(userDataPath, 'NeutronBrowser');

  const { DEFAULT_BOOKMARKS, DEFAULT_SETTINGS } = require('../../shared/constants');

  stores.bookmarks = new JsonStore(
    path.join(dataDir, 'bookmarks.json'),
    DEFAULT_BOOKMARKS
  );

  stores.history = new JsonStore(
    path.join(dataDir, 'history.json'),
    { visits: [] }
  );

  stores.downloads = new JsonStore(
    path.join(dataDir, 'downloads.json'),
    { items: [] }
  );

  stores.settings = new JsonStore(
    path.join(dataDir, 'settings.json'),
    DEFAULT_SETTINGS
  );

  stores.extensions = new JsonStore(
    path.join(dataDir, 'extensions.json'),
    { installed: [] }
  );

  // 确保文件被加载
  Object.values(stores).forEach(s => s._ensureLoaded());

  console.log('[Storage] 数据目录:', dataDir);
}

/**
 * 获取指定存储实例
 * @param {'bookmarks'|'history'|'downloads'|'settings'|'extensions'} name
 * @returns {JsonStore}
 */
function getStore(name) {
  if (!stores[name]) {
    throw new Error(`存储 "${name}" 未初始化`);
  }
  return stores[name];
}

module.exports = { initStorage, getStore, JsonStore };
