/**
 * 拖拽安装扩展（.crx / .zip，Edge 式全窗口拦截）
 * 由 app.js 调用 window.NeutronExtensionDropInstall(ctx) 创建，ctx 注入共享依赖。
 * 返回公共方法：setupExtensionDropInstall
 */
window.NeutronExtensionDropInstall = function (ctx) {
  'use strict';

  const { state, api, IS_OVERLAY, showToast, loadExtensionPopup } = ctx;

  // 三处入口统一：主窗口 chrome 区域（本函数）、网页区域（polyfill-webnav.js 预加载脚本）、
  // 拖放提示覆盖层（本文件 overlay 模式）。enter/leave 通知主进程显示/隐藏全窗提示覆盖层，
  // drop 时通过 webUtils 桥接取磁盘路径（File.path 在 Electron 32+ 已移除）并统一交给主进程转发安装。
  function setupExtensionDropInstall() {
    const overlay = document.getElementById('dropOverlay');
    let dragCounter = 0;

    const fileNamesOf = (e) => {
      const files = (e && e.dataTransfer && e.dataTransfer.files) || [];
      const names = [];
      for (let i = 0; i < files.length; i++) names.push(String(files[i].name || ''));
      return names;
    };

    // 拖放诊断：所有文件拖放事件上报主进程（写日志 + 回传可见提示）
    const debugEvent = (e, name) => {
      try {
        if (api.logDragDebug) {
          api.logDragDebug({
            source: IS_OVERLAY ? 'overlay' : 'chrome',
            event: name,
            names: fileNamesOf(e),
            types: e && e.dataTransfer && e.dataTransfer.types ? Array.prototype.slice.call(e.dataTransfer.types) : [],
          });
        }
      } catch (err) { /* 忽略 */ }
    };

    // 主进程回传的拖放诊断事件 → 可见提示（真实拖放排查的关键信号）
    if (api.onExtensionDragDebugEvent && !IS_OVERLAY) {
      api.onExtensionDragDebugEvent((payload) => {
        if (!payload || payload.event !== 'dragenter') return;
        const names = payload.names || [];
        showToast('检测到文件拖放: ' + names.slice(0, 3).join('、') + (names.length > 3 ? ' 等' : ''));
      });
    }

    const isExtFileDrag = (e) => {
      if (!e || !e.dataTransfer) return false;
      const files = e.dataTransfer.files || [];
      for (let i = 0; i < files.length; i++) {
        const name = String(files[i].name || '').toLowerCase();
        if (name.endsWith('.crx') || name.endsWith('.zip')) return true;
      }
      return false;
    };

    document.addEventListener('dragenter', (e) => {
      const names = fileNamesOf(e);
      if (names.length === 0) return;
      console.log('[DropInstall][chrome] dragenter');
      debugEvent(e, 'dragenter');
      if (!isExtFileDrag(e)) return;
      dragCounter++;
      if (overlay) overlay.hidden = false;
      if (dragCounter === 1 && api.notifyExtensionDragEnter) api.notifyExtensionDragEnter();
    });
    document.addEventListener('dragleave', (e) => {
      if (!isExtFileDrag(e)) return;
      console.log('[DropInstall][chrome] dragleave');
      dragCounter--;
      if (dragCounter <= 0) {
        dragCounter = 0;
        if (overlay) overlay.hidden = true;
        if (api.notifyExtensionDragLeave) api.notifyExtensionDragLeave();
      }
    });
    document.addEventListener('dragover', (e) => {
      if (!isExtFileDrag(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    });
    document.addEventListener('drop', (e) => {
      if (!isExtFileDrag(e)) return;
      console.log('[DropInstall][chrome] drop');
      debugEvent(e, 'drop');
      e.preventDefault();
      dragCounter = 0;
      if (overlay) overlay.hidden = true;
      const files = e.dataTransfer.files || [];
      const file = Array.from(files).find((f) => {
        const n = String(f.name || '').toLowerCase();
        return n.endsWith('.crx') || n.endsWith('.zip');
      });
      if (!file) return;
      // File.path 已在 Electron 32+ 移除，统一走 webUtils 桥接取磁盘路径
      let filePath = '';
      if (api.getPathForFile) filePath = api.getPathForFile(file);
      if (!filePath && file.path) filePath = file.path;
      if (api.notifyExtensionDrop) {
        // 统一链路：主进程隐藏提示覆盖层并把路径转发回 onExtensionDropFile 执行安装
        api.notifyExtensionDrop(filePath || '');
      } else if (filePath) {
        installDroppedExtensionFile(filePath, file.name);
      } else {
        showToast('无法获取文件路径，安装失败', 'error');
      }
    });

    // 网页内容区 / 拖放提示覆盖层的 drop 由主进程统一转发到这里执行安装
    if (api.onExtensionDropFile) {
      api.onExtensionDropFile(async (filePath) => {
        if (filePath) {
          await installDroppedExtensionFile(filePath, filePath.split(/[\\/]/).pop());
        } else {
          showToast('无法获取文件路径，安装失败', 'error');
        }
      });
    }
  }

  async function installDroppedExtensionFile(filePath, fileName) {
    showToast('正在安装 ' + (fileName || '扩展包') + ' ...');
    try {
      const result = await api.installExtensionFromFile(filePath);
      if (result && result.success) {
        const extName = (result.extension && result.extension.name) || fileName || '扩展';
        showToast('已安装 ' + extName, 'success');
        if (state.extensionPopupOpen) await loadExtensionPopup();
      } else {
        showToast((result && result.message) || '安装失败', 'error');
      }
    } catch (err) {
      showToast('安装失败: ' + (err && err.message || ''), 'error');
    }
  }

  return { setupExtensionDropInstall };
};
