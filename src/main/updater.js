/**
 * 自动更新模块（electron-updater）
 * Edge 式自动更新：自动下载安装包 → 静默安装 → 自动重启浏览器
 */
const { autoUpdater } = require('electron-updater');
const { ipcMain } = require('electron');
const { IPC_CHANNELS } = require('../shared/constants');

let initialized = false;
let downloading = false;

/**
 * 初始化自动更新
 * @param {() => object} getWindow - 获取窗口管理器（用于广播事件）
 */
function initUpdater(getWindow) {
  if (initialized) return;
  initialized = true;

  autoUpdater.autoDownload = false;          // 手动触发下载
  autoUpdater.autoInstallOnAppQuit = true;   // 退出应用时安装
  autoUpdater.allowPrerelease = false;

  const send = (data) => {
    const wm = getWindow();
    if (wm && wm.mainWindow && !wm.mainWindow.isDestroyed()) {
      wm.mainWindow.webContents.send(IPC_CHANNELS.UPDATE_EVENT, data);
    }
  };

  autoUpdater.on('checking-for-update', () => send({ type: 'checking' }));
  autoUpdater.on('update-available', (info) => {
    send({ type: 'available', version: String((info && info.version) || '') });
  });
  autoUpdater.on('update-not-available', () => send({ type: 'not-available' }));
  autoUpdater.on('error', (err) => {
    send({ type: 'error', message: err && err.message ? err.message : String(err) });
  });
  autoUpdater.on('download-progress', (progress) => {
    send({
      type: 'progress',
      percent: Math.round(progress.percent || 0),
      transferred: progress.transferred || 0,
      total: progress.total || 0,
      bytesPerSecond: progress.bytesPerSecond || 0,
    });
  });
  autoUpdater.on('update-downloaded', (info) => {
    send({ type: 'downloaded', version: String((info && info.version) || '') });
  });

  // 下载更新
  ipcMain.handle(IPC_CHANNELS.UPDATE_DOWNLOAD, async () => {
    if (downloading) return { ok: true, downloading: true };
    downloading = true;
    try {
      await autoUpdater.downloadUpdate();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    } finally {
      downloading = false;
    }
  });

  // 安装并重启（quitAndInstall 会关闭应用 → 静默安装 → 自动重启）
  ipcMain.handle(IPC_CHANNELS.UPDATE_INSTALL, () => {
    setImmediate(() => {
      try {
        autoUpdater.quitAndInstall();
      } catch (e) {
        console.error('[Updater] quitAndInstall 失败:', e);
      }
    });
    return { ok: true };
  });
}

module.exports = { initUpdater };
