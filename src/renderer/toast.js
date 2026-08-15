/**
 * 全局 Toast 提示
 * 由 app.html 在 app.js 之前加载，挂载到 window.NeutronToast。
 */
(function () {
  'use strict';

  function showToast(message, type) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.className = 'toast' + (type ? ' toast--' + type : '');
    toast.hidden = false;
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => { toast.hidden = true; }, 3500);
  }

  window.NeutronToast = { showToast };
})();
