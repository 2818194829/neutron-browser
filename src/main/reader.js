/**
 * 阅读模式（沉浸式阅读器）
 * 从当前标签页提取正文内容，并将页面替换为干净的阅读视图。
 * 提取采用启发式（优先 <article>/<main>，兜底取文本最多的块），非完整 Readability。
 */

/** 注入页面提取正文的脚本 */
const EXTRACT_SCRIPT = `(function () {
  try {
    function getMainContent() {
      const sels = ['article', 'main', '[role="main"]'];
      for (const sel of sels) {
        const el = document.querySelector(sel);
        if (el && el.innerText && el.innerText.trim().length > 200) return el;
      }
      let best = null, bestLen = 0;
      document.querySelectorAll('div, section').forEach((el) => {
        const len = (el.innerText || '').trim().length;
        if (len > bestLen) { best = el; bestLen = len; }
      });
      return best;
    }
    function clean(node) {
      const clone = node.cloneNode(true);
      clone.querySelectorAll(
        'script, style, nav, aside, footer, iframe, form, button, input, select, textarea, ' +
        '.ad, .ads, .advertisement, [class*="ad-"], [class*="ads-"], [id*="ad-"], [class*="banner"], [class*="share"], [class*="social"]'
      ).forEach((el) => el.remove());
      return clone.innerHTML;
    }
    const content = getMainContent();
    if (!content) return null;
    const h1 = document.querySelector('h1');
    const title = (h1 && h1.textContent.trim()) || document.title || '';
    return JSON.stringify({ title: title, content: clean(content), url: location.href });
  } catch (e) { return null; }
})()`;

/** 生成替换页面为阅读视图的脚本 */
function renderReaderScript(article) {
  const title = String(article && article.title || '');
  const content = String(article && article.content || '');
  // 标题用 JSON 字符串转义注入，避免 XSS
  const titleJson = JSON.stringify(title);
  return `(function () {
    if (window.__neutronReaderActive) return;
    window.__neutronReaderActive = true;
    const css = 'body{margin:0!important;background:#f8f5f0!important}' +
      '.nr{max-width:680px;margin:0 auto;padding:48px 24px;font-family:Georgia,"Songti SC",serif;color:#2b2b2b;line-height:1.8}' +
      '.nr h1{font-size:34px;line-height:1.3;margin:0 0 24px}' +
      '.nr .c{font-size:19px}.nr .c img{max-width:100%;height:auto}.nr .c p{margin:0 0 1.2em}' +
      '.nr .c a{color:#0067c0}.nr .c pre,.nr .c code{background:#eee;border-radius:4px;padding:2px 6px}' +
      '.nr .nr-exit{position:fixed;top:16px;right:16px;background:#0067c0;color:#fff;border:none;border-radius:6px;padding:8px 14px;font-size:14px;cursor:pointer}';
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    document.body.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'nr';
    const h = document.createElement('h1');
    h.textContent = ${titleJson};
    const c = document.createElement('div');
    c.className = 'c';
    c.innerHTML = ${JSON.stringify(content)};
    const exit = document.createElement('button');
    exit.className = 'nr-exit';
    exit.textContent = '退出阅读模式';
    exit.addEventListener('click', () => { window.location.reload(); });
    wrap.appendChild(h);
    wrap.appendChild(c);
    wrap.appendChild(exit);
    document.body.appendChild(wrap);
  })()`;
}

/** 提取当前标签页正文 */
async function extractArticle(webContents) {
  if (!webContents || webContents.isDestroyed()) return null;
  try {
    const raw = await webContents.executeJavaScript(EXTRACT_SCRIPT);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

/**
 * 切换当前窗口活动标签页的阅读模式：
 * - 未开启 → 提取正文并渲染阅读视图
 * - 已开启 → 退出（刷新页面）
 */
async function toggleReader(wm) {
  if (!wm || !wm.activeTabId) return { ok: false, reason: 'no-tab' };
  const tab = wm.tabs.find((t) => t.id === wm.activeTabId);
  if (!tab || !tab.view || tab.view.webContents.isDestroyed()) {
    return { ok: false, reason: 'no-tab' };
  }
  const wc = tab.view.webContents;

  // 已处于阅读模式 → 退出
  const active = await wc.executeJavaScript('!!window.__neutronReaderActive').catch(() => false);
  if (active) {
    wc.reload();
    return { ok: true, mode: 'off' };
  }

  // 提取正文
  const article = await extractArticle(wc);
  if (!article || !article.content || article.content.trim().length < 100) {
    return { ok: false, reason: 'no-content' };
  }

  await wc.executeJavaScript(renderReaderScript(article)).catch(() => {});
  return { ok: true, mode: 'on' };
}

module.exports = { toggleReader, extractArticle };
