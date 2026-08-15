/**
 * E2E：HTML5 视频全屏进出后的窗口状态恢复（真实 requestFullscreen 路径）
 *
 * 修复的 bug：Windows 上 Electron 对 HTML5 全屏会「先自动把窗口改成全屏尺寸」
 * 再触发 enter-html-full-screen 事件（无法 preventDefault），导致退出全屏后
 * 窗口停留在全屏尺寸 / 变成最大化。修复：preload 在主世界拦截 requestFullscreen，
 * 在窗口被改之前同步保存窗口状态，退出时据此还原。
 *
 * 验证：
 *   A. 普通窗口：全屏进出后还原到初始尺寸，不变成最大化
 *   B. 最大化窗口：全屏进出后保持最大化，且「还原」边界与进入前一致
 *
 * 运行：node scripts/test-fullscreen-restore-e2e.js
 */
const path = require('path');
const fs = require('fs');

let playwright;
try { playwright = require('playwright-core'); }
catch (e) { playwright = require(path.join(process.env.APPDATA, 'npm', 'node_modules', 'playwright-core')); }
const { _electron } = playwright;

const APP_DIR = path.join(__dirname, '..');
const USER_DATA = path.join(APP_DIR, '.e2e-tmp-fullscreen');

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok });
  console.log((ok ? '✅' : '❌') + ' ' + name + (detail ? ' — ' + detail : ''));
}

const normEqual = (x, y) => Math.abs(x.x - y.x) <= 2 && Math.abs(x.y - y.y) <= 2 &&
  Math.abs(x.width - y.width) <= 2 && Math.abs(x.height - y.height) <= 2;

async function main() {
  fs.rmSync(USER_DATA, { recursive: true, force: true });

  const electronApp = await _electron.launch({
    executablePath: path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe'),
    args: [APP_DIR, `--user-data-dir=${USER_DATA}`],
    env: { ...process.env },
  });
  await new Promise(r => setTimeout(r, 3000));

  let page = null;
  for (const w of await electronApp.windows()) {
    if (String(w.url()).includes('app.html')) { page = w; break; }
  }
  if (!page) throw new Error('main window (app.html) not found');

  const run = (script) => electronApp.evaluate(`(async function(){ ${script} })()`);
  const wait = (ms) => new Promise(r => setTimeout(r, ms));

  const snap = `(function(){
    const w = global.windowManager.mainWindow;
    return { maximized: w.isMaximized(), bounds: w.getBounds(), normal: w.getNormalBounds() };
  })()`;

  // 进入/退出真实 HTML5 全屏（通过页面 API 触发 enter/leave-html-full-screen）
  async function fullscreenRoundTrip(extraBefore, waitMs) {
    return run(`
      ${extraBefore || ''}
      const tab = global.windowManager.tabs.find(t => t.id === global.windowManager.activeTabId);
      await tab.view.webContents.executeJavaScript(
        'document.documentElement.requestFullscreen().then(()=>"OK").catch(e=>"ERR:"+e)');
      await new Promise(r=>setTimeout(r,${waitMs || 900}));
      const during = { prev: global.windowManager.htmlFullScreenPrev, ...${snap} };
      await tab.view.webContents.executeJavaScript(
        'document.exitFullscreen().then(()=>"OK").catch(e=>"ERR:"+e)');
      await new Promise(r=>setTimeout(r,${waitMs || 900}));
      return { during, after: ${snap} };
    `);
  }

  // ===== A. 普通窗口全屏进出 =====
  const a = await fullscreenRoundTrip(`
    global.windowManager.mainWindow.unmaximize();
    await new Promise(r=>setTimeout(r,500));
  `);
  console.log('A', JSON.stringify(a));
  check('A1 全屏时保存的初始边界不是全屏尺寸（hook 生效）',
    a.during.prev && a.during.prev.bounds.width < 1500,
    JSON.stringify(a.during.prev));
  check('A2 退出后未变最大化', a.after.maximized === false, JSON.stringify(a.after));
  check('A3 退出后边界还原为初始尺寸（非全屏）',
    a.after.bounds.width < 1500 && a.after.bounds.width > 800,
    `after=${JSON.stringify(a.after.bounds)}`);

  // ===== B. 最大化窗口全屏进出 =====
  const b = await fullscreenRoundTrip(`
    global.windowManager.mainWindow.maximize();
    await new Promise(r=>setTimeout(r,600));
  `);
  console.log('B', JSON.stringify(b));
  const preNormalB = b.during.prev ? b.during.prev.bounds : null;
  check('B1 全屏时保存了最大化的还原边界（非全屏尺寸）',
    b.during.prev && b.during.prev.wasMaximized === true && b.during.prev.bounds.width < 1500,
    JSON.stringify(b.during.prev));
  check('B2 退出后回到原始窗口大小（非最大化）',
    b.after.maximized === false && b.after.bounds.width < 1500 && b.after.bounds.width > 800,
    JSON.stringify(b.after));
  check('B3 退出后尺寸与进入前还原边界一致',
    preNormalB && normEqual(preNormalB, b.after.bounds),
    `pre=${JSON.stringify(preNormalB)} after=${JSON.stringify(b.after.bounds)}`);

  // ===== C. iframe 内全屏进出（视频站内嵌播放器场景） =====
  const TMP = path.join(require('os').tmpdir(), 'neutron-fs-iframe-test');
  fs.mkdirSync(TMP, { recursive: true });
  const PARENT_URL = 'file:///' + path.join(TMP, 'fs-parent.html').replace(/\\/g, '/');
  fs.writeFileSync(path.join(TMP, 'fs-parent.html'), `<!DOCTYPE html><html><head><meta charset="utf-8">
    <style>html,body{margin:0;height:100%}iframe{width:100%;height:100%;border:none}</style>
    </head><body><iframe id="f" src="fs-child.html"></iframe></body></html>`);
  fs.writeFileSync(path.join(TMP, 'fs-child.html'), `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
    <body><video id="v" style="width:640px;height:360px;background:#000"></video>
    <button id="b" onclick="document.getElementById('v').requestFullscreen()">全屏</button></body></html>`);

  const c = await run(`
    global.windowManager.mainWindow.unmaximize();
    await new Promise(r=>setTimeout(r,500));
    const id = global.windowManager.createTab('${PARENT_URL}', true);
    await new Promise(r=>setTimeout(r,2500));
    const tab = global.windowManager.tabs.find(t => t.id === id);
    const click = await tab.view.webContents.executeJavaScript(
      '(function(){ var f=document.getElementById("f"); if(!f||!f.contentDocument) return "NO-IFRAME"; f.contentDocument.getElementById("b").click(); return "CLICKED"; })()');
    await new Promise(r=>setTimeout(r,1000));
    const during = { click, prev: global.windowManager.htmlFullScreenPrev, ...${snap} };
    await tab.view.webContents.executeJavaScript(
      '(function(){ var f=document.getElementById("f"); if(!f||!f.contentDocument) return "NO-IFRAME"; f.contentDocument.exitFullscreen().catch(function(){}); return "EXIT"; })()');
    await new Promise(r=>setTimeout(r,1000));
    return { during, after: ${snap} };
  `);
  console.log('C', JSON.stringify(c));
  check('C1 iframe 点击成功', c.during.click === 'CLICKED', c.during.click);
  check('C2 iframe 全屏时保存的初始边界非全屏尺寸',
    c.during.prev && c.during.prev.bounds.width < 1500,
    JSON.stringify(c.during.prev));
  check('C3 iframe 全屏退出后窗口还原（非全屏）',
    c.after.maximized === false && c.after.bounds.width < 1500 && c.after.bounds.width > 800,
    JSON.stringify(c.after));

  // ===== D. webkitRequestFullscreen（旧前缀 API，老式播放器） =====
  fs.writeFileSync(path.join(TMP, 'fs-webkit.html'), `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
    <body><video id="v" style="width:640px;height:360px;background:#000"></video>
    <button id="b" onclick="run()">全屏</button>
    <script>
    function run() {
      var v = document.getElementById('v');
      if (v.webkitRequestFullscreen) v.webkitRequestFullscreen();
      else if (v.requestFullscreen) v.requestFullscreen();
    }
    </script></body></html>`);
  const WEBKIT_URL = 'file:///' + path.join(TMP, 'fs-webkit.html').replace(/\\/g, '/');

  const d = await run(`
    global.windowManager.mainWindow.unmaximize();
    await new Promise(r=>setTimeout(r,500));
    const id = global.windowManager.createTab('${WEBKIT_URL}', true);
    await new Promise(r=>setTimeout(r,2000));
    const tab = global.windowManager.tabs.find(t => t.id === id);
    await tab.view.webContents.executeJavaScript('document.getElementById("b").click()');
    await new Promise(r=>setTimeout(r,1000));
    const during = { prev: global.windowManager.htmlFullScreenPrev, ...${snap} };
    await tab.view.webContents.executeJavaScript(
      '(function(){ if (document.webkitExitFullscreen) document.webkitExitFullscreen(); else document.exitFullscreen(); return 1; })()');
    await new Promise(r=>setTimeout(r,1000));
    return { during, after: ${snap} };
  `);
  console.log('D', JSON.stringify(d));
  check('D1 webkitRequestFullscreen 时保存的初始边界非全屏尺寸',
    d.during.prev && d.during.prev.bounds.width < 1500,
    JSON.stringify(d.during.prev));
  check('D2 webkitRequestFullscreen 退出后窗口还原（非全屏）',
    d.after.maximized === false && d.after.bounds.width < 1500 && d.after.bounds.width > 800,
    JSON.stringify(d.after));

  // ===== E. hook 完全失效（无 preload 保存，直接调 handleHtmlFullScreen） =====
  // 验证主进程自足：即使页面 hook 全部失效、htmlFullScreenPrev 为 null，
  // 主进程用 windowBounds/isMaximized 镜像也能正确保存并恢复。
  const e = await run(`
    global.windowManager.mainWindow.unmaximize();
    await new Promise(r=>setTimeout(r,500));
    const wm = global.windowManager;
    wm.htmlFullScreenPrev = null;   // 强制模拟 hook 未保存
    const before = { bounds: wm.mainWindow.getBounds(), mirror: wm.windowBounds };
    wm.handleHtmlFullScreen(wm.activeTabId, true);
    await new Promise(r=>setTimeout(r,700));
    const duringPrev = wm.htmlFullScreenPrev;
    wm.handleHtmlFullScreen(wm.activeTabId, false);
    await new Promise(r=>setTimeout(r,700));
    const after = { bounds: wm.mainWindow.getBounds(), maximized: wm.mainWindow.isMaximized() };
    return { before, duringPrev, after };
  `);
  console.log('E', JSON.stringify(e));
  check('E1 无 hook 时主进程镜像保存正确边界',
    e.duringPrev && e.duringPrev.bounds.width < 1500 && e.duringPrev.bounds.width > 800,
    JSON.stringify(e.duringPrev));
  check('E2 无 hook 时退出后窗口还原',
    e.after.maximized === false && e.after.bounds.width < 1500 && e.after.bounds.width > 800,
    JSON.stringify(e.after));

  // ===== F. 最大化窗口 + hook 完全失效（用户原始 bug 场景的极端版） =====
  const f = await run(`
    global.windowManager.mainWindow.maximize();
    await new Promise(r=>setTimeout(r,600));
    const wm = global.windowManager;
    wm.htmlFullScreenPrev = null;
    const preNormal = wm.mainWindow.getNormalBounds();
    const preMax = wm.mainWindow.isMaximized();
    wm.handleHtmlFullScreen(wm.activeTabId, true);
    await new Promise(r=>setTimeout(r,700));
    const duringPrev = wm.htmlFullScreenPrev;
    wm.handleHtmlFullScreen(wm.activeTabId, false);
    await new Promise(r=>setTimeout(r,700));
    const after = { bounds: wm.mainWindow.getBounds(), normal: wm.mainWindow.getNormalBounds(), maximized: wm.mainWindow.isMaximized() };
    return { preNormal, preMax, duringPrev, after };
  `);
  console.log('F', JSON.stringify(f));
  const normEq = (x, y) => Math.abs(x.width - y.width) <= 2 && Math.abs(x.height - y.height) <= 2;
  check('F1 无 hook 时主进程镜像保存了最大化的还原边界',
    f.duringPrev && f.duringPrev.wasMaximized === true && f.duringPrev.bounds.width < 1500,
    JSON.stringify(f.duringPrev));
  check('F2 无 hook 时退出后回到原始窗口大小（非最大化）',
    f.after.maximized === false && f.after.bounds.width < 1500 && f.after.bounds.width > 800,
    JSON.stringify(f.after));
  check('F3 无 hook 时退出后尺寸与进入前还原边界一致',
    f.preNormal && normEq(f.preNormal, f.after.bounds),
    `pre=${JSON.stringify(f.preNormal)} after=${JSON.stringify(f.after.bounds)}`);

  // ===== G. 窗口级全屏（F11/菜单 togglefullscreen，不经过 HTML5 全屏路径） =====
  const g = await run(`
    const wm = global.windowManager;
    const w = wm.mainWindow;
    const out = {};
    // G1: 最大化窗口 F11 全屏退出 → 直接普通窗口
    w.unmaximize(); await new Promise(r=>setTimeout(r,500));
    w.maximize(); await new Promise(r=>setTimeout(r,600));
    out.g1normal = w.getNormalBounds();
    w.setFullScreen(true); await new Promise(r=>setTimeout(r,700));
    w.setFullScreen(false); await new Promise(r=>setTimeout(r,900));
    out.g1after = { max:w.isMaximized(), b:w.getBounds(), normal:w.getNormalBounds() };
    // G2: 普通窗口 F11 全屏退出 → 直接普通窗口
    w.unmaximize(); await new Promise(r=>setTimeout(r,700));
    out.g2before = w.getBounds();
    w.setFullScreen(true); await new Promise(r=>setTimeout(r,700));
    w.setFullScreen(false); await new Promise(r=>setTimeout(r,900));
    out.g2after = { max:w.isMaximized(), b:w.getBounds(), normal:w.getNormalBounds() };
    return out;
  `);
  console.log('G', JSON.stringify(g));
  check('G1 最大化窗口 F11 退出后直接普通窗口（非全屏/非最大化）',
    g.g1after.max === false && g.g1after.b.width < 1500 && g.g1after.b.width > 800,
    JSON.stringify(g.g1after));
  check('G2 最大化窗口 F11 退出后还原边界正确',
    g.g1normal && normEqual(g.g1normal, g.g1after.normal),
    `pre=${JSON.stringify(g.g1normal)} after=${JSON.stringify(g.g1after.normal)}`);
  check('G3 普通窗口 F11 退出后直接普通窗口且边界正确',
    g.g2after.max === false && normEqual(g.g2before, g.g2after.b),
    `pre=${JSON.stringify(g.g2before)} after=${JSON.stringify(g.g2after.b)}`);

  const failed = results.filter(r => !r.ok);
  console.log(failed.length ? `\n❌ FAIL ${failed.length} 项` : '\n✅ ALL PASS');

  await electronApp.close().catch(() => {});
  fs.rmSync(USER_DATA, { recursive: true, force: true });
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
