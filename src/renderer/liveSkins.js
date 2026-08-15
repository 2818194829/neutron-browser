/**
 * 沉浸式动态皮肤（Live Skins）
 * 通过 Canvas 在浏览器 chrome 区域（标题栏 / 工具栏 / 书签栏 / 状态栏）绘制实时动画背景。
 *
 * 皮肤列表：
 *   aurora    极光     —— 流动的极光幕布（鼠标横向偏移）
 *   nebula    星云     —— 深空粒子星云 + 粒子连线（鼠标排斥）
 *   ripple    水波     —— 多层流动波面 + 波峰高光
 *   ember     余烬     —— 底部火光 + 上升飘散的火星
 *   pixelrain 像素雨   —— 赛博像素雨滴（Matrix 风格）
 *
 * 由 app.js 在非覆盖层模式下创建：window.NeutronLiveSkins({ canvas })
 * 返回 { init, setSkin, setTheme, destroy }
 *
 * 设计要点：
 * - 画布置于 chrome 栏之下（z-index 0），chrome 栏（titlebar/toolbar 等）透明后透出动画
 * - 内容区被原生 BrowserView 覆盖，画布仅在顶部 / 底部 chrome 区域可见
 * - 尊重 prefers-reduced-motion：仅绘制一帧静态背景，不跑动画
 * - 窗口隐藏 / 失焦时暂停动画，节省 CPU/GPU
 */
window.NeutronLiveSkins = function (opts) {
  'use strict';

  const canvas = opts && opts.canvas;
  if (!canvas || typeof canvas.getContext !== 'function') return null;
  const ctx = canvas.getContext('2d');

  let skin = 'none';
  let theme = 'light';
  let renderer = null;
  let rafId = 0;
  let running = false;
  let lastT = 0;
  let width = 0;
  let height = 0;
  let dpr = 1;
  let destroyed = false;

  const mouse = { x: -9999, y: -9999, active: false };
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ==================== 渲染器注册表 ====================
  const renderers = {
    aurora: createAurora,
    nebula: createNebula,
    ripple: createRipple,
    ember: createEmber,
    pixelrain: createPixelRain,
    snow: createSnow,
    rain: createRain,
    fireflies: createFireflies,
    clouds: createClouds,
    comet: createComet,
  };

  function isLive(name) {
    return Object.prototype.hasOwnProperty.call(renderers, name);
  }

  /** 背景：深色底（保证 chrome 白字可读） */
  function paintBase(top, bottom) {
    const g = ctx.createLinearGradient(0, 0, 0, height);
    g.addColorStop(0, top);
    g.addColorStop(1, bottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, height);
  }

  /** 顶部压暗：保证 chrome 文字在动画上可读 */
  function paintTopScrim() {
    const g = ctx.createLinearGradient(0, 0, 0, height * 0.45);
    g.addColorStop(0, 'rgba(0, 0, 0, 0.42)');
    g.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, height * 0.45);
  }

  // ---- 极光 ----
  function createAurora() {
    const bands = [];
    for (let i = 0; i < 3; i++) {
      bands.push({
        hue: 150 + i * 65,              // 青绿 → 蓝 → 紫
        yBase: 0.34 + i * 0.05,
        amp: 24 + i * 14,
        speed: 0.45 + i * 0.22,
        phase: Math.random() * Math.PI * 2,
      });
    }
    return {
      resize() {},
      frame(t) {
        paintBase(theme === 'dark' ? '#070c1c' : '#0e1a3a', theme === 'dark' ? '#10182f' : '#28375c');
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (const b of bands) {
          const baseY = height * b.yBase;
          ctx.beginPath();
          ctx.moveTo(0, height);
          for (let x = 0; x <= width; x += 6) {
            let yy = baseY
              + Math.sin(x * 0.008 + t * b.speed + b.phase) * b.amp
              + Math.sin(x * 0.02 - t * b.speed * 0.55 + b.phase) * b.amp * 0.4;
            if (mouse.active) yy += Math.max(-34, Math.min(34, (mouse.x / width - 0.5) * 44));
            ctx.lineTo(x, yy);
          }
          ctx.lineTo(width, height);
          ctx.closePath();
          const ag = ctx.createLinearGradient(0, baseY - b.amp * 2.2, 0, height);
          ag.addColorStop(0, `hsla(${b.hue}, 95%, 62%, 0.5)`);
          ag.addColorStop(1, `hsla(${b.hue}, 95%, 42%, 0)`);
          ctx.fillStyle = ag;
          ctx.fill();
        }
        ctx.restore();
        paintTopScrim();
      },
    };
  }

  // ---- 星云粒子 ----
  function createNebula() {
    const N = Math.min(150, Math.max(60, Math.floor((width * height) / 9000)));
    const pts = [];
    for (let i = 0; i < N; i++) {
      pts.push({
        x: Math.random(), y: Math.random(),
        vx: (Math.random() - 0.5) * 0.02,
        vy: (Math.random() - 0.5) * 0.015,
        r: 0.8 + Math.random() * 1.6,
        hue: 200 + Math.random() * 130,
        tw: Math.random() * Math.PI * 2,
      });
    }
    return {
      resize() {},
      frame(t, dt) {
        const g = ctx.createRadialGradient(width / 2, height * 0.4, 0, width / 2, height * 0.4, Math.max(width, height) * 0.8);
        if (theme === 'dark') { g.addColorStop(0, '#151d3d'); g.addColorStop(1, '#070a18'); }
        else { g.addColorStop(0, '#263358'); g.addColorStop(1, '#0d1226'); }
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, width, height);

        for (const p of pts) {
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          if (p.x < 0) p.x = 1; if (p.x > 1) p.x = 0;
          if (p.y < 0) p.y = 1; if (p.y > 1) p.y = 0;
          if (mouse.active) {
            const dx = p.x * width - mouse.x;
            const dy = p.y * height - mouse.y;
            const d2 = dx * dx + dy * dy;
            if (d2 < 130 * 130 && d2 > 1) {
              const d = Math.sqrt(d2);
              p.x += (dx / d) * 0.0012;
              p.y += (dy / d) * 0.0012;
            }
          }
        }

        // 粒子连线（近距星网）
        ctx.lineWidth = 1;
        for (let i = 0; i < pts.length; i++) {
          for (let j = i + 1; j < pts.length; j++) {
            const a = pts[i];
            const b = pts[j];
            const dx = (a.x - b.x) * width;
            const dy = (a.y - b.y) * height;
            const d2 = dx * dx + dy * dy;
            if (d2 < 100 * 100) {
              ctx.globalAlpha = 0.65 * (1 - Math.sqrt(d2) / 100);
              ctx.strokeStyle = 'rgba(150, 170, 255, 1)';
              ctx.beginPath();
              ctx.moveTo(a.x * width, a.y * height);
              ctx.lineTo(b.x * width, b.y * height);
              ctx.stroke();
            }
          }
        }
        ctx.globalAlpha = 1;

        for (const p of pts) {
          ctx.globalAlpha = 0.55 + 0.45 * Math.sin(t * 2 + p.tw);
          ctx.fillStyle = `hsla(${p.hue}, 85%, 78%, 0.95)`;
          ctx.beginPath();
          ctx.arc(p.x * width, p.y * height, p.r, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        paintTopScrim();
      },
    };
  }

  // ---- 水波 ----
  function createRipple() {
    const layers = [];
    for (let i = 0; i < 4; i++) {
      layers.push({
        yBase: 0.5 + i * 0.11,
        amp: 5 + i * 2.5,
        freq: 0.012 + i * 0.003,
        speed: 0.5 + i * 0.16,
        phase: Math.random() * Math.PI * 2,
        hue: 180 + i * 14,
      });
    }
    return {
      resize() {},
      frame(t) {
        paintBase(theme === 'dark' ? '#071e2b' : '#0d3a52', theme === 'dark' ? '#061722' : '#0a2c40');
        for (const L of layers) {
          const baseY = height * L.yBase;
          // 波面填充
          ctx.beginPath();
          ctx.moveTo(0, height);
          for (let x = 0; x <= width; x += 6) {
            ctx.lineTo(x, baseY + Math.sin(x * L.freq + t * L.speed + L.phase) * L.amp);
          }
          ctx.lineTo(width, height);
          ctx.closePath();
          ctx.fillStyle = `hsla(${L.hue}, 70%, 52%, 0.09)`;
          ctx.fill();
          // 波峰高光线
          ctx.beginPath();
          ctx.moveTo(0, baseY);
          for (let x = 0; x <= width; x += 6) {
            ctx.lineTo(x, baseY + Math.sin(x * L.freq + t * L.speed + L.phase) * L.amp);
          }
          ctx.strokeStyle = `hsla(${L.hue}, 95%, 76%, 0.22)`;
          ctx.lineWidth = 1.4;
          ctx.stroke();
        }
        paintTopScrim();
      },
    };
  }

  // ---- 余烬 ----
  function createEmber() {
    const embers = [];
    function spawn() {
      embers.push({
        x: Math.random(),
        y: 0.92 + Math.random() * 0.08,
        vx: (Math.random() - 0.5) * 0.06,
        vy: -(0.05 + Math.random() * 0.09),
        size: 1.2 + Math.random() * 2.2,
        hue: 8 + Math.random() * 32,
        life: 1,
        decay: 0.35 + Math.random() * 0.55,
        phase: Math.random() * Math.PI * 2,
      });
    }
    return {
      resize() {},
      frame(t, dt) {
        paintBase(theme === 'dark' ? '#160d08' : '#241008', theme === 'dark' ? '#241008' : '#33160a');
        // 底部火光
        const fg = ctx.createRadialGradient(width / 2, height * 1.05, 0, width / 2, height * 1.05, height * 0.7);
        fg.addColorStop(0, 'rgba(255, 120, 30, 0.3)');
        fg.addColorStop(1, 'rgba(255, 120, 30, 0)');
        ctx.fillStyle = fg;
        ctx.fillRect(0, 0, width, height);

        if (embers.length < 70 && Math.random() < 0.28) spawn();
        for (let i = embers.length - 1; i >= 0; i--) {
          const e = embers[i];
          e.x += (e.vx + Math.sin(t * 1.6 + e.phase) * 0.008) * dt;
          e.y += e.vy * dt;
          e.life -= e.decay * dt;
          if (e.life <= 0 || e.y < -0.03) { embers.splice(i, 1); continue; }
          const px = e.x * width;
          const py = e.y * height;
          const glow = ctx.createRadialGradient(px, py, 0, px, py, e.size * 7);
          glow.addColorStop(0, `hsla(${e.hue}, 100%, 72%, ${0.55 * e.life})`);
          glow.addColorStop(1, 'hsla(20, 100%, 50%, 0)');
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(px, py, e.size * 7, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = `hsla(${e.hue}, 100%, 82%, ${e.life})`;
          ctx.beginPath();
          ctx.arc(px, py, e.size, 0, Math.PI * 2);
          ctx.fill();
        }
        paintTopScrim();
      },
    };
  }

  // ---- 像素雨 ----
  function createPixelRain() {
    const cols = 46;
    const drops = [];
    for (let i = 0; i < cols; i++) {
      drops.push({
        x: (i + 0.5) / cols,
        y: Math.random(),
        speed: 0.1 + Math.random() * 0.22,
        len: 6 + Math.floor(Math.random() * 14),
        hue: 150 + Math.random() * 60,
      });
    }
    return {
      resize() {},
      frame(t, dt) {
        paintBase(theme === 'dark' ? '#041009' : '#07271a', theme === 'dark' ? '#020a06' : '#041710');
        const cellW = width / cols;
        for (const d of drops) {
          d.y += d.speed * dt;
          if (d.y > 1.18) d.y = -0.12;
          const x = d.x * width;
          const endY = d.y * height;
          const lenPx = d.len * cellW * 0.9;
          const grad = ctx.createLinearGradient(0, endY - lenPx, 0, endY);
          grad.addColorStop(0, `hsla(${d.hue}, 90%, 55%, 0)`);
          grad.addColorStop(0.65, `hsla(${d.hue}, 90%, 60%, 0.3)`);
          grad.addColorStop(1, `hsla(${d.hue}, 95%, 74%, 0.95)`);
          ctx.fillStyle = grad;
          ctx.fillRect(x, endY - lenPx, cellW * 0.72, lenPx);
        }
        paintTopScrim();
      },
    };
  }

  // ---- 飘雪 ----
  function createSnow() {
    const N = Math.min(120, Math.max(50, Math.floor((width * height) / 12000)));
    const flakes = [];
    for (let i = 0; i < N; i++) {
      flakes.push({
        x: Math.random(),
        y: Math.random(),
        vy: 0.01 + Math.random() * 0.03,
        drift: 0.004 + Math.random() * 0.012,
        phase: Math.random() * Math.PI * 2,
        r: 1 + Math.random() * 2.2,
      });
    }
    return {
      resize() {},
      frame(t, dt) {
        paintBase(theme === 'dark' ? '#0e1626' : '#1c2b45', theme === 'dark' ? '#0a101c' : '#141f36');
        for (const f of flakes) {
          f.y += f.vy * dt;
          f.x += Math.sin(t * 0.8 + f.phase) * f.drift * dt;
          if (f.y > 1.02) { f.y = -0.02; f.x = Math.random(); }
          ctx.globalAlpha = 0.5 + 0.5 * Math.sin(t * 1.5 + f.phase);
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(f.x * width, f.y * height, f.r, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        paintTopScrim();
      },
    };
  }

  // ---- 雨幕 ----
  function createRain() {
    const N = Math.min(140, Math.max(60, Math.floor(width / 8)));
    const drops = [];
    for (let i = 0; i < N; i++) {
      drops.push({
        x: Math.random(),
        y: Math.random(),
        len: 0.02 + Math.random() * 0.03,
        speed: 0.5 + Math.random() * 0.5,
        slant: (Math.random() - 0.5) * 0.02,
      });
    }
    return {
      resize() {},
      frame(t, dt) {
        paintBase(theme === 'dark' ? '#0a1118' : '#14222e', theme === 'dark' ? '#060b10' : '#0d161f');
        ctx.lineWidth = 1;
        for (const d of drops) {
          d.y += d.speed * dt;
          d.x += d.slant * dt;
          if (d.y > 1.05) { d.y = -0.02; d.x = Math.random(); }
          ctx.globalAlpha = 0.3 + 0.45 * Math.abs(Math.sin(t * 2 + d.x * 40));
          ctx.strokeStyle = 'rgba(190, 210, 235, 0.6)';
          ctx.beginPath();
          ctx.moveTo(d.x * width, d.y * height);
          ctx.lineTo(d.x * width - d.slant * 9, d.y * height - d.len * height);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        paintTopScrim();
      },
    };
  }

  // ---- 萤火虫 ----
  function createFireflies() {
    const N = Math.min(40, Math.max(20, Math.floor((width * height) / 30000)));
    const flies = [];
    for (let i = 0; i < N; i++) {
      flies.push({
        x: Math.random(),
        y: 0.3 + Math.random() * 0.6,
        vx: (Math.random() - 0.5) * 0.012,
        vy: (Math.random() - 0.5) * 0.012,
        r: 1 + Math.random() * 1.6,
        hue: 50 + Math.random() * 40,
        phase: Math.random() * Math.PI * 2,
        tw: 0.5 + Math.random() * 0.5,
      });
    }
    return {
      resize() {},
      frame(t, dt) {
        paintBase(theme === 'dark' ? '#0b1526' : '#122038', theme === 'dark' ? '#050b16' : '#0a1224');
        for (const f of flies) {
          f.x += f.vx * dt;
          f.y += f.vy * dt;
          if (f.x < 0) f.x = 1; if (f.x > 1) f.x = 0;
          if (f.y < 0) f.y = 1; if (f.y > 1) f.y = 0;
          const glow = 0.5 + 0.5 * Math.sin(t * f.tw * 2 + f.phase);
          const px = f.x * width;
          const py = f.y * height;
          const g = ctx.createRadialGradient(px, py, 0, px, py, f.r * 12);
          g.addColorStop(0, `hsla(${f.hue}, 100%, 70%, ${0.5 * glow})`);
          g.addColorStop(1, 'hsla(60, 100%, 60%, 0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(px, py, f.r * 12, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = `hsla(${f.hue}, 100%, 85%, ${glow})`;
          ctx.beginPath();
          ctx.arc(px, py, f.r, 0, Math.PI * 2);
          ctx.fill();
        }
        paintTopScrim();
      },
    };
  }

  // ---- 云海 ----
  function createClouds() {
    const layers = [];
    for (let i = 0; i < 4; i++) {
      layers.push({
        index: i,
        speed: 0.02 + i * 0.012,
        offset: Math.random() * 2,
        alpha: 0.06 + i * 0.025,
        hue: 205 + i * 18,
      });
    }
    return {
      resize() {},
      frame(t) {
        const h = height;
        paintBase(theme === 'dark' ? '#0a0f1f' : '#16213a', theme === 'dark' ? '#131a2e' : '#26365c');
        // 地平线暖光
        const fg = ctx.createLinearGradient(0, h * 0.7, 0, h);
        fg.addColorStop(0, 'rgba(255, 150, 80, 0)');
        fg.addColorStop(1, theme === 'dark' ? 'rgba(255, 120, 60, 0.18)' : 'rgba(255, 140, 70, 0.22)');
        ctx.fillStyle = fg;
        ctx.fillRect(0, 0, width, h);
        for (const L of layers) {
          const y = h * (0.6 + L.index * 0.11);
          const wave = (x) => (
            y
            + Math.sin(x * 0.006 * 8 * L.speed + t * L.speed + L.offset) * 14
            + Math.sin(x * 0.013 - t * L.speed * 0.6 + L.offset) * 8
          );
          ctx.beginPath();
          for (let x = 0; x <= width; x += 8) ctx.lineTo(x, wave(x));
          ctx.strokeStyle = `hsla(${L.hue}, 60%, 70%, ${L.alpha})`;
          ctx.lineWidth = 1.2;
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(0, h);
          for (let x = 0; x <= width; x += 8) ctx.lineTo(x, wave(x));
          ctx.lineTo(width, h);
          ctx.closePath();
          ctx.fillStyle = `hsla(${L.hue}, 50%, 60%, ${L.alpha * 0.4})`;
          ctx.fill();
        }
        paintTopScrim();
      },
    };
  }

  // ---- 流星雨 ----
  function createComet() {
    const N = Math.min(160, Math.max(60, Math.floor((width * height) / 12000)));
    const stars = [];
    for (let i = 0; i < N; i++) {
      stars.push({ x: Math.random(), y: Math.random(), r: 0.4 + Math.random() * 1.2, tw: Math.random() * Math.PI * 2 });
    }
    const comets = [];
    let next = 1 + Math.random() * 4;
    return {
      resize() {},
      frame(t, dt) {
        paintBase(theme === 'dark' ? '#05060f' : '#0b0f22', theme === 'dark' ? '#0a0c18' : '#111530');
        for (const s of stars) {
          ctx.globalAlpha = 0.3 + 0.7 * Math.abs(Math.sin(t * 0.8 + s.tw));
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(s.x * width, s.y * height, s.r, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        next -= dt;
        if (next <= 0 && comets.length < 2) {
          comets.push({
            x: Math.random() * 0.8,
            y: Math.random() * 0.2,
            vx: 0.25 + Math.random() * 0.2,
            vy: 0.12 + Math.random() * 0.1,
            life: 2,
          });
          next = 3 + Math.random() * 5;
        }
        for (let i = comets.length - 1; i >= 0; i--) {
          const c = comets[i];
          c.x += c.vx * dt;
          c.y += c.vy * dt;
          c.life -= dt;
          if (c.life <= 0 || c.x > 1.2 || c.y > 0.9) { comets.splice(i, 1); continue; }
          const px = c.x * width;
          const py = c.y * height;
          const tail = 0.12;
          const g = ctx.createLinearGradient(px, py, px - c.vx * width * tail, py - c.vy * height * tail);
          g.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
          g.addColorStop(0.3, 'rgba(180, 200, 255, 0.5)');
          g.addColorStop(1, 'rgba(180, 200, 255, 0)');
          ctx.strokeStyle = g;
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(px - c.vx * width * tail, py - c.vy * height * tail);
          ctx.stroke();
        }
        paintTopScrim();
      },
    };
  }

  // ==================== 引擎 ====================
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
  }

  function drawStatic() {
    if (!renderer) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    renderer.frame(1.7, 0.016);
  }

  function frame(now) {
    if (destroyed || !running) return;
    const dt = Math.min((now - lastT) / 1000, 0.05) || 0.016;
    lastT = now;
    if (renderer) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      renderer.frame(now / 1000, dt);
    }
    rafId = requestAnimationFrame(frame);
  }

  function start() {
    if (running || destroyed) return;
    running = true;
    lastT = 0;
    rafId = requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }

  function setSkin(name) {
    if (destroyed) return;
    const live = isLive(name);
    skin = live ? name : 'none';
    document.documentElement.classList.toggle('skin-live', live);
    if (!live) {
      stop();
      renderer = null;
      canvas.style.display = 'none';
      return;
    }
    renderer = renderers[skin]();
    canvas.style.display = 'block';
    resize();
    if (prefersReduced) {
      stop();
      drawStatic();
    } else {
      start();
    }
  }

  function setTheme(t) {
    theme = t === 'dark' ? 'dark' : 'light';
  }

  function onVisibility() {
    if (document.hidden) stop();
    else if (renderer && !prefersReduced) start();
  }

  function onFocus() {
    if (renderer && !prefersReduced && !document.hidden) start();
  }

  function onMouseMove(e) {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    mouse.active = true;
  }

  function onMouseLeave() {
    mouse.active = false;
    mouse.x = -9999;
    mouse.y = -9999;
  }

  function init() {
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', stop);
    window.addEventListener('focus', onFocus);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseleave', onMouseLeave);
  }

  function destroy() {
    destroyed = true;
    stop();
    window.removeEventListener('resize', resize);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('blur', stop);
    window.removeEventListener('focus', onFocus);
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseleave', onMouseLeave);
  }

  return { init, setSkin, setTheme, destroy };
};
