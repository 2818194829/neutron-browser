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

  /** 解析 CSS 颜色字符串，按书写顺序 alpha 混合，返回代表色 [r,g,b] */
  function parseAndComposite(text) {
    let base = null;
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
      if (!c) continue;
      a = Math.max(0, Math.min(1, a));
      if (a === 0) continue;
      if (base === null) {
        base = c.map((v) => v * a);
      } else {
        for (let i = 0; i < 3; i++) base[i] = base[i] * (1 - a) + c[i] * a;
      }
    }
    return base;
  }

  /** WCAG 相对亮度 */
  function luminance(rgb) {
    const lin = (c) => {
      c /= 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
  }

  /** 白/深前景取对比度更高者 */
  function bestForeground(L) {
    const ratioWhite = 1.05 / (L + 0.05);
    const ratioDark = (L + 0.05) / 0.05;
    return ratioWhite >= ratioDark ? '#ffffff' : '#202124';
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
      chromeRgb = parseAndComposite(toolbarBg + ' ' + titlebarBg);
      if (!chromeRgb) chromeRgb = parseAndComposite(rootStyle.getPropertyValue('--bg-primary').trim());
    }

    if (chromeRgb) {
      const fg = bestForeground(luminance(chromeRgb));
      document.documentElement.style.setProperty('--chrome-fg', fg);
      document.documentElement.style.setProperty('--chrome-fg-hover', fg);
    }

    // 2) 地址栏前景（相对地址栏自身背景：半透明则叠在 chrome 背景上）
    let addrRgb = parseAndComposite(addressBg);
    if (addrRgb && chromeRgb && /rgba?\(/.test(addressBg)) {
      // 地址栏半透明：与 chrome 背景混合（近似，取工具栏代表色）
      const aMatch = addressBg.match(/rgba?\(([^)]+)\)/);
      if (aMatch) {
        const parts = aMatch[1].split(/[\s,]+/).filter(Boolean).map(parseFloat);
        const a = parts.length >= 4 ? Math.max(0, Math.min(1, parts[3])) : 1;
        for (let i = 0; i < 3; i++) addrRgb[i] = addrRgb[i] * a + chromeRgb[i] * (1 - a);
      }
    }
    if (addrRgb) {
      document.documentElement.style.setProperty('--address-bar-fg', bestForeground(luminance(addrRgb)));
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
