/**
 * 数据存储模块（SQLite 实现）
 *
 * 使用 Node 内置 node:sqlite（DatabaseSync，同步 API），替代原先的 JSON 文件存储。
 * - 单一 data.db 数据库，一张 kv 表（store, key, value），value 存 JSON 字符串。
 * - 对外接口与旧 JsonStore 完全一致：get / set / getAll / delete / _ensureLoaded。
 * - 首次启动时若对应 store 为空且存在旧 JSON 文件，自动迁移导入，保证用户数据不丢。
 */
import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import fs from 'fs';
import { DEFAULT_BOOKMARKS, DEFAULT_SETTINGS } from '../../shared/constants';

type JsonValue = Record<string, unknown>;

export class SqliteStore {
  constructor(
    private db: DatabaseSync,
    private name: string,
    defaults: JsonValue = {},
    legacyJsonPath?: string,
  ) {
    // 迁移：该 store 为空且存在旧 JSON 文件时，导入旧数据
    const countRow = this.db
      .prepare('SELECT COUNT(*) AS c FROM kv WHERE store = ?')
      .get(this.name);
    const count = countRow ? Number(countRow.c) : 0;
    if (count === 0 && legacyJsonPath && fs.existsSync(legacyJsonPath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(legacyJsonPath, 'utf-8')) as JsonValue;
        const insert = this.db.prepare('INSERT INTO kv (store, key, value) VALUES (?, ?, ?)');
        for (const [k, v] of Object.entries(raw)) {
          insert.run(this.name, k, JSON.stringify(v));
        }
        console.log(`[Storage] 已从 ${path.basename(legacyJsonPath)} 迁移 ${Object.keys(raw).length} 项到 SQLite`);
      } catch (e) {
        console.error(`[Storage] 迁移 ${legacyJsonPath} 失败:`, (e as Error).message);
      }
    }

    // 种子默认值（INSERT OR IGNORE：不覆盖已有/已迁移的键，同时补齐新增的默认键）
    const seed = this.db.prepare('INSERT OR IGNORE INTO kv (store, key, value) VALUES (?, ?, ?)');
    for (const [k, v] of Object.entries(defaults)) {
      seed.run(this.name, k, JSON.stringify(v));
    }
  }

  get(key: string, defaultValue?: unknown): unknown {
    const row = this.db
      .prepare('SELECT value FROM kv WHERE store = ? AND key = ?')
      .get(this.name, key);
    if (row && typeof row.value === 'string') {
      try {
        return JSON.parse(row.value);
      } catch (e) {
        return defaultValue;
      }
    }
    return defaultValue;
  }

  set(key: string, value: unknown): void {
    this.db
      .prepare('INSERT OR REPLACE INTO kv (store, key, value) VALUES (?, ?, ?)')
      .run(this.name, key, JSON.stringify(value));
  }

  getAll(): JsonValue {
    const rows = this.db
      .prepare('SELECT key, value FROM kv WHERE store = ? ORDER BY rowid')
      .all(this.name);
    const out: JsonValue = {};
    for (const row of rows) {
      if (typeof row.value === 'string') {
        try {
          out[String(row.key)] = JSON.parse(row.value);
        } catch (e) { /* 忽略损坏项 */ }
      }
    }
    return out;
  }

  delete(key: string): void {
    this.db
      .prepare('DELETE FROM kv WHERE store = ? AND key = ?')
      .run(this.name, key);
  }

  _ensureLoaded(): void {
    // SQLite 同步加载，无需额外动作（兼容旧 JsonStore 接口）
  }
}

// 兼容旧导出名（外部代码如需引用 JsonStore 类）
export { SqliteStore as JsonStore };

// ==================== 存储实例 ====================
let db: DatabaseSync | null = null;
const stores: Record<string, SqliteStore> = {};

/**
 * 初始化存储系统
 * @param userDataPath Electron userData 路径
 */
export async function initStorage(userDataPath: string): Promise<void> {
  const dataDir = path.join(userDataPath, 'NeutronBrowser');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const dbPath = path.join(dataDir, 'data.db');
  db = new DatabaseSync(dbPath);
  db.exec(
    'CREATE TABLE IF NOT EXISTS kv (' +
    'store TEXT NOT NULL, key TEXT NOT NULL, value TEXT, ' +
    'PRIMARY KEY (store, key))'
  );

  const legacy = (file: string) => path.join(dataDir, file);

  stores.bookmarks = new SqliteStore(db, 'bookmarks', DEFAULT_BOOKMARKS as JsonValue, legacy('bookmarks.json'));
  stores.history = new SqliteStore(db, 'history', { visits: [] }, legacy('history.json'));
  stores.downloads = new SqliteStore(db, 'downloads', { items: [] }, legacy('downloads.json'));
  stores.settings = new SqliteStore(db, 'settings', DEFAULT_SETTINGS as JsonValue, legacy('settings.json'));
  stores.extensions = new SqliteStore(db, 'extensions', { installed: [] }, legacy('extensions.json'));
  stores.extensionStorage = new SqliteStore(db, 'extensionStorage', { data: {} }, legacy('extensionStorage.json'));
  stores.dnrDynamic = new SqliteStore(db, 'dnrDynamic', { dynamic: {}, enabledRulesets: {} }, legacy('dnr.json'));

  console.log('[Storage] 数据目录:', dataDir, '(SQLite: data.db)');
}

/**
 * 获取指定存储实例
 * @param name 存储名
 * @returns SqliteStore
 */
export function getStore(name: string): SqliteStore {
  if (!stores[name]) {
    throw new Error(`存储 "${name}" 未初始化`);
  }
  return stores[name];
}

/**
 * 关闭数据库连接（应用退出时调用，可选）
 */
export function closeStorage(): void {
  if (db) {
    try {
      db.close();
    } catch (e) { /* 忽略已关闭 */ }
    db = null;
  }
}
