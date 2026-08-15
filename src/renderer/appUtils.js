/**
 * 渲染层通用工具函数
 * 由 app.html 在 app.js 之前加载，挂载到 window.NeutronUtils。
 * 从 app.js 抽离的纯工具函数，不依赖 app 闭包状态。
 */
(function () {
  'use strict';

  function formatBytes(bytes) {
    const value = Number(bytes) || 0;
    if (value <= 0) return '未知大小';
    const units = ['B', 'KB', 'MB', 'GB'];
    const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
    return `${parseFloat((value / Math.pow(1024, index)).toFixed(1))} ${units[index]}`;
  }

  function formatSpeed(bytesPerSecond) {
    return `${formatBytes(bytesPerSecond)}/s`;
  }

  function escapeHtmlAttr(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  window.NeutronUtils = { formatBytes, formatSpeed, escapeHtmlAttr };
})();
