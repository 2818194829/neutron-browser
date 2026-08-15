/**
 * Chrome 按钮前景自适应（Adaptive Chrome Contrast）
 *
 * 核心思路：不同主题的 chrome 背景（标题栏/工具栏/地址栏）颜色差异很大，
 * 固定写死的前景色（白色系）在浅色花纹皮肤（樱花/薄荷/黄昏等）上几乎不可见。
 * 这里动态计算背景的实际颜色 → 计算 WCAG 相对亮度 → 自动选择
 * 「白色」或「深色」中对比度更高的作为按钮前景，实时写入 CSS 变量：
 *
 *   --chrome-fg       工具栏/标题栏按钮图标前景
 *   --chrome-fg-hover 同区域 hover 前景
 *   --address-bar-fg  地址栏内部图标前景（相对地址栏自身背景）
 *
 * 实现要点：
 * - 静态皮肤：解析 --toolbar-bg/--titlebar-bg/--address-bar-bg 的 CSS 颜色
 *   （hex/rgb(a)/hsl(a)），按书写顺序做 alpha 混合，得到代表色
 * - 动态皮肤（背景 transparent）：直接从 liveSkins 画布采样实际像素
 * - 前景选择：WCAG 对比度公式，白/深两者取比值更高者
 */
window.NeutronChromeContrast = function (opts) {
  'use strict';

  const canvas = opts && opts.canvas;
  let timer = 0;

  // ==================== 颜色工具 ====================
  function hslToRgb(h, s, l) {
    h = ((h % 360) + 360) % 360 / 360;
    s = Math.max(0, Math.min(1, s / 100));
    l = Math.max(0, Math.min(1, l / 100));
    if (s === 0) {
      const v = Math.round(l * 255);
      return [v, v, v];
    }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const hue2rgb = (t) => {
      let tt = t;
      if (tt < 0) tt += 1;
      if (tt > 1) tt -= 1;
      if (tt < 1 / 6) return p + (q - p) * 6 * tt;
      if (tt < 1 / 2) return q;
      if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
      return p;
    };
    return [
      Math.round(hue2rgb(h + 1 / 3) * 255),
      Math.round(hue2rgb(h) * 255),
      Math.round(hue2rgb(h - 1 / 3) * 255),
    ];
  }

  /** 提取文本中所有颜色为 {r,g,b,a}（hex/rgb(a)/hsl(a)） */
  function extractColors(text) {
    const out = [];
    const re = /#([0-9a-f]{3,8})\b|rgba?\(([^)]+)\)|hsla?\(([^)]+)\)/gi;
    let m;
    while ((m = re.exec(text))) {
      let c = null;
      let a = 1;
      if (m[1]) {
        let hex = m[1];
        if (hex.length === 3 || hex.length === 4) hex = hex.split('').map((ch) => ch + ch).join('');
        if (hex.length >= 8) { a = parseInt(hex.slice(6, 8), 16) / 255; hex = hex.slice(0, 6); }
        if (hex.length === 6) {
          c = [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
        }
      } else if (m[2]) {
        const parts = m[2].split(/[\s,]+/).filter(Boolean).map(parseFloat);
        if (parts.length >= 4) a = parts[3];
        if (parts.length >= 3) c = [parts[0], parts[1], parts[2]];
      } else if (m[3]) {
        const parts = m[3].split(/[\s,]+/).filter(Boolean).map(parseFloat);
        if (parts.length >= 4) a = parts[3];
        if (parts.length >= 3) c = hslToRgb(parts[0], parts[1], parts[2]);
      }
      if (c) out.push({ r: c[0], g: c[1], b: c[2], a: Math.max(0, Math.min(1, a)) });
    }
    return out;
  }

  /**
   * 取背景代表色：
   * - 多层背景（逗号分隔）只取最底层（基色层），图案点阵等装饰层不参与
   * - 渐变取首尾两色平均（近似整体色调）
   */
  function representativeColor(text) {
    if (!text) return null;
    let layer = text;
    let depth = 0;
    let lastComma = -1;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      else if (ch === ',' && depth === 0) lastComma = i;
    }
    if (lastComma >= 0) layer = text.slice(lastComma + 1);
    const colors = extractColors(layer);
    if (!colors.length) return null;
    // 平均该层全部色标（多色标渐变如黄昏的浅橙中间色不能被首尾平均漏掉）
    let r = 0, g = 0, b = 0, a = 0;
    for (const c of colors) { r += c.r; g += c.g; b += c.b; a += c.a; }
    const n = colors.length;
    return { r: r / n, g: g / n, b: b / n, a: a / n };
  }

  /** WCAG 相对亮度 */
  function luminance(rgb) {
    const lin = (c) => {
      c /= 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
  }

  /** 前景选择：背景偏浅（L>0.36）用深色，背景偏深用白色——「深底浅字、浅底深字」 */
  function bestForeground(L) {
    return L > 0.36 ? '#202124' : '#ffffff';
  }

  /** 从动态皮肤画布采样 chrome 区域实际像素（含顶部压暗效果） */
  function sampleCanvas() {
    if (!canvas || typeof canvas.getContext !== 'function') return null;
    const c = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    if (!w || !h) return null;
    // 采样标题栏/工具栏/书签栏（按窗口高度比例换算到画布）
    const winH = window.innerHeight || 900;
    const yFracs = [18 / winH, 58 / winH, 108 / winH];
    const xFracs = [0.15, 0.5, 0.85];
    let r = 0, g = 0, b = 0, n = 0;
    for (const fy of yFracs) {
      for (const fx of xFracs) {
        const x = Math.min(w - 1, Math.max(0, Math.round(fx * w)));
        const y = Math.min(h - 1, Math.max(0, Math.round(fy * h)));
        try {
          const d = c.getImageData(x, y, 1, 1).data;
          if (d[3] > 0) { r += d[0]; g += d[1]; b += d[2]; n++; }
        } catch (e) { /* 忽略 */ }
      }
    }
    return n ? [r / n, g / n, b / n] : null;
  }

  // ==================== 自适应计算 ====================
  function refresh() {
    const rootStyle = getComputedStyle(document.documentElement);
    const toolbarBg = rootStyle.getPropertyValue('--toolbar-bg').trim();
    const titlebarBg = rootStyle.getPropertyValue('--titlebar-bg').trim();
    const addressBg = rootStyle.getPropertyValue('--address-bar-bg').trim();

    // 1) chrome 区域代表色
    let chromeRgb = null;
    // 精确判断动态皮肤：只有整个值恰为 transparent（花纹皮肤的渐变里含 transparent 关键字，勿误判）
    const isLive = toolbarBg === 'transparent' && titlebarBg === 'transparent';
    if (isLive) {
      chromeRgb = sampleCanvas();
      if (!chromeRgb) {
        // 画布尚未绘制第一帧：保持 CSS 默认（动态皮肤为白色前景），不强行覆盖
        return;
      }
    } else {
      // 工具栏与标题栏代表色取平均：单看其一会在边界色（如薄荷）上误判
      const repT = representativeColor(toolbarBg);
      const repB = representativeColor(titlebarBg);
      let rep = null;
      if (repT && repB) {
        rep = { r: (repT.r + repB.r) / 2, g: (repT.g + repB.g) / 2, b: (repT.b + repB.b) / 2 };
      } else {
        rep = repT || repB;
      }
      if (rep) chromeRgb = [rep.r, rep.g, rep.b];
      if (!chromeRgb) {
        const bgRep = representativeColor(rootStyle.getPropertyValue('--bg-primary').trim());
        if (bgRep) chromeRgb = [bgRep.r, bgRep.g, bgRep.b];
      }
    }

    if (chromeRgb) {
      const fg = bestForeground(luminance(chromeRgb));
      const soft = fg === '#ffffff' ? 'rgba(255, 255, 255, 0.78)' : 'rgba(32, 33, 36, 0.78)';
      document.documentElement.style.setProperty('--chrome-fg', fg);
      document.documentElement.style.setProperty('--chrome-fg-hover', fg);
      // chrome 文字（标签标题/分组头/书签文字）：与按钮前景同规则——深底浅字、浅底深字
      document.documentElement.style.setProperty('--chrome-text', fg);
      document.documentElement.style.setProperty('--statusbar-fg', soft);
    }

    // 状态栏：有独立背景色时按自身背景自适应（透明/动态皮肤沿用 chrome 前景）
    const statusBg = rootStyle.getPropertyValue('--statusbar-bg').trim();
    if (statusBg && statusBg !== 'transparent') {
      const rep = representativeColor(statusBg);
      if (rep) {
        const sf = bestForeground(luminance([rep.r, rep.g, rep.b]));
        document.documentElement.style.setProperty(
          '--statusbar-fg',
          sf === '#ffffff' ? 'rgba(255, 255, 255, 0.78)' : 'rgba(32, 33, 36, 0.78)'
        );
      }
    }

    // 2) 地址栏前景（相对地址栏自身背景：半透明则叠在 chrome 背景上）
    const addrRep = representativeColor(addressBg);
    if (addrRep) {
      let r = addrRep.r;
      let g = addrRep.g;
      let b = addrRep.b;
      if (addrRep.a < 1 && chromeRgb) {
        r = r * addrRep.a + chromeRgb[0] * (1 - addrRep.a);
        g = g * addrRep.a + chromeRgb[1] * (1 - addrRep.a);
        b = b * addrRep.a + chromeRgb[2] * (1 - addrRep.a);
      }
      document.documentElement.style.setProperty('--address-bar-fg', bestForeground(luminance([r, g, b])));
    }
  }

  /** 动态皮肤活跃时：延迟重采样（等待画布首帧）并周期重采样（动画底色稳定，低频即可） */
  function setLive(active) {
    if (timer) { clearInterval(timer); timer = 0; }
    if (active) {
      setTimeout(refresh, 150);
      timer = setInterval(refresh, 1500);
    }
  }

  return { refresh, setLive };
};
