/**
 * 领域模型类型定义（主进程与渲染进程共享）
 * 渐进式 TypeScript 迁移的第一步：先统一核心数据结构。
 */

/** 明暗模式 */
export type ThemeMode = 'light' | 'dark' | 'system';

/** 强调色 */
export type AccentColor =
  | 'blue' | 'red' | 'green' | 'purple' | 'orange' | 'pink' | 'teal';

/** 主题皮肤 */
export type ThemeSkin =
  | 'default' | 'ocean' | 'forest' | 'sunset' | 'midnight' | 'rose'
  | 'wave' | 'checker' | 'starfield' | 'sakura' | 'mint' | 'dusk';

/** 书签节点（文件夹或书签） */
export interface BookmarkNode {
  id: string;
  title: string;
  type: 'folder' | 'bookmark';
  url?: string;
  favicon?: string;
  dateAdded?: number;
  parentId?: string;
  children?: BookmarkNode[];
}

/** 书签根容器（bookmark_bar / other / mobile） */
export interface BookmarkData {
  [rootKey: string]: BookmarkNode | undefined;
}

/** 历史访问记录 */
export interface HistoryVisit {
  id: string;
  url: string;
  title: string;
  favicon: string;
  visitCount: number;
  firstVisitTime: number;
  lastVisitTime: number;
}

/** 下载记录（持久化形态） */
export interface DownloadRecord {
  id: string;
  url: string;
  sourceUrl?: string;
  filename: string;
  path?: string;
  savePath?: string;
  state: string;
  receivedBytes?: number;
  received?: number;
  totalBytes?: number;
  total?: number;
  error?: string;
}

/** 扩展记录（extensions.json installed 项） */
export interface ExtensionRecord {
  id: string;
  name: string;
  version: string;
  description: string;
  path: string;
  icon: string;
  enabled: boolean;
  installedAt: number;
  source: 'edge_store' | 'local' | string;
  installSource: string;
  backgroundType: string;
  viewInfo: string;
  permissions: string[];
  pinned?: boolean;
  siteAccess?: 'on_click' | 'specific' | 'all';
  siteAccessSite?: string;
  clickGrantedSite?: string;
  clickGrantedAt?: number;
  grantedPermissions?: string[];
  grantedOrigins?: string[];
}

/** 应用设置（DEFAULT_SETTINGS + 运行时扩展字段） */
export interface Settings {
  theme: ThemeMode;
  accentColor: AccentColor;
  themeSkin: ThemeSkin;
  searchEngine: string;
  searchEngines: Array<{ id: string; name: string; url: string }>;
  homePage: string;
  showHomeButton: boolean;
  homeButtonTarget: string;
  newTabPage: string;
  newTabCustomUrl: string;
  preloadNewTabPage: boolean;
  launchAtLogin: boolean;
  showBookmarkBar: boolean;
  showBookmarksButton: boolean;
  downloadPath: string;
  askDownloadPath: boolean;
  startupBehavior: string;
  startupPages: string[];
  fontSize: string;
  enableJavaScript: boolean;
  enableImages: boolean;
  enablePopups: boolean;
  doNotTrack: boolean;
  clearOnExit: boolean;
  siteExtensionPermissions: Record<string, unknown>;
  verifyServerUrl: string;
  developerMode?: boolean;
  windowState?: unknown;
  windowAlwaysOnTop?: boolean;
  [key: string]: unknown;
}

/** 渲染层标签页展示结构（TAB_LIST_UPDATED） */
export interface TabDisplayInfo {
  id: string;
  url: string;
  title: string;
  favicon: string;
  isPinned: boolean;
  isMuted: boolean;
  isAudible: boolean;
  isLoading: boolean;
  loadingProgress: number;
  securityState: string;
}
