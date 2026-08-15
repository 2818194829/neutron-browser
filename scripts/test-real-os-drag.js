/**
 * 真实系统级文件拖放 E2E 测试（Windows 资源管理器拖拽的等价模拟）
 *
 * 通过 WinForms DoDragDrop 发起真正的 OLE FileDrop 拖拽（与资源管理器完全同源），
 * 把 .zip 扩展包拖到浏览器窗口上，验证：
 *   A. 拖到网页内容区（新标签页）→ 扩展被安装
 *   B. 拖到浏览器 chrome 区（工具栏）→ 扩展被安装
 *
 * 诊断信号：
 *   EFFECT=1（Copy）说明目标窗口接受了拖放（有 dragover preventDefault）
 *   EFFECT=0（None）说明拖放事件没有被任何目标处理
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync, spawn } = require('child_process');
const AdmZip = require('adm-zip');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const HELPER = path.join(__dirname, 'drag-drop-helper.ps1');
const CAPTURE = path.join(__dirname, 'capture-screen.ps1');

function makeExtensionZip(name) {
  const zip = new AdmZip();
  zip.addFile('manifest.json', Buffer.from(JSON.stringify({
    manifest_version: 3,
    name,
    version: '1.0.0',
    description: 'OS drag test extension',
  }), 'utf8'));
  return zip.toBuffer();
}

async function main() {
  const { _electron } = require('playwright-core');

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'neutron-osdrag-'));
  const userDataDir = path.join(tmpRoot, 'userData');
  const zipA = path.join(tmpRoot, 'DragExtContent.zip');
  const zipB = path.join(tmpRoot, 'DragExtChrome.zip');
  fs.writeFileSync(zipA, makeExtensionZip('DragExtContent'));
  fs.writeFileSync(zipB, makeExtensionZip('DragExtChrome'));

  const electronApp = await _electron.launch({
    args: ['.', `--user-data-dir=${userDataDir}`],
    cwd: PROJECT_ROOT,
    executablePath: path.join(PROJECT_ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'),
    env: { ...process.env, NEUTRON_SKIP_EXT_CONFIRM: '1' },
  });

  // 收集主进程 stdout（含 [DropInstall] 日志与网页 console 转发）
  const mainLogs = [];
  electronApp.process().stdout.on('data', (d) => {
    String(d).split(/\r?\n/).forEach((l) => { if (l.trim()) mainLogs.push(l.trim()); });
  });

  // 让所有 webContents（含网页标签页与后创建的覆盖层）console 转发到主进程 stdout
  await electronApp.evaluate(async ({ app, webContents }) => {
    const attach = (wc) => {
      if (wc.__logAttached) return;
      wc.__logAttached = true;
      wc.on('console-message', function (e, level, message) {
        const msg = (typeof message === 'string' && message)
          || (e && typeof e.message === 'string' && e.message)
          || '';
        if (msg && msg.indexOf('[DropInstall]') !== -1) {
          console.log('[WC] ' + msg);
        }
      });
    };
    webContents.getAllWebContents().forEach(attach);
    app.on('web-contents-created', (e, wc) => attach(wc));
  });

  // 等主窗口就绪
  let mainPage = null;
  for (let i = 0; i < 50 && !mainPage; i++) {
    for (const page of electronApp.windows()) {
      if (page.url().includes('app.html')) { mainPage = page; break; }
    }
    if (!mainPage) await new Promise((r) => setTimeout(r, 200));
  }
  if (!mainPage) throw new Error('未找到主窗口');
  await new Promise((r) => setTimeout(r, 1500));

  // 固定窗口位置并获取 DPI 缩放，计算目标屏幕坐标。
  // 注意：桌面可能被全屏透明窗口（如桌面整理类软件）覆盖，且后台启动的进程
  // 无法抢前台焦点，必须用 setAlwaysOnTop 保证窗口位于光标下。
  const geo = await electronApp.evaluate(async ({ screen }) => {
    const wm = global.windowManager;
    const win = wm.mainWindow;
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setPosition(100, 100);
    win.show();
    win.focus();
    const b = win.getBounds();
    const scale = screen.getPrimaryDisplay().scaleFactor;
    return { x: b.x, y: b.y, width: b.width, height: b.height, scale };
  });
  await new Promise((r) => setTimeout(r, 800));

  const winState = await electronApp.evaluate(async () => {
    const win = global.windowManager.mainWindow;
    return {
      visible: win.isVisible(),
      top: win.isAlwaysOnTop(),
      pos: win.getPosition(),
      bounds: win.getBounds(),
    };
  });
  console.log('[WinState]', JSON.stringify(winState));

  // 调试：探测窗口应处位置下实际的顶层窗口
  const probeScript = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class WinProbe {
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(int x, int y);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder sb, int n);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, StringBuilder sb, int n);
}
"@
foreach ($pt in $args[0].Split('|')) {
  $xy = $pt.Split(',')
  $h = [WinProbe]::WindowFromPoint([int]$xy[0], [int]$xy[1])
  $t = New-Object System.Text.StringBuilder 256
  $c = New-Object System.Text.StringBuilder 256
  $null = [WinProbe]::GetWindowText($h, $t, 256)
  $null = [WinProbe]::GetClassName($h, $c, 256)
  Write-Output ("PROBE($pt)=class=" + $c.ToString() + " title=" + $t.ToString())
}
`;
  const probePts = [
    Math.round(geo.x * geo.scale) + ',' + Math.round(geo.y * geo.scale),
    Math.round((geo.x + 200) * geo.scale) + ',' + Math.round((geo.y + 200) * geo.scale),
    Math.round((geo.x + geo.width / 2) * geo.scale) + ',' + Math.round((geo.y + 236) * geo.scale),
  ].join('|');
  const probeOut = spawnSync('powershell.exe', ['-NoProfile', '-Command', probeScript, probePts], { encoding: 'utf8', timeout: 30000 });
  console.log('[Probe]', (probeOut.stdout || '').replace(/\s+/g, ' ').trim(), (probeOut.stderr || '').replace(/\s+/g, ' ').trim());

  const results = [];
  const check = (name, ok, detail = '') => {
    results.push({ name, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' - ' + detail : ''}`);
  };

  const runDrag = (screenX, screenY, zipPath, captureDuring = null) => {
    const child = spawn('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', HELPER,
      '-X', String(Math.round(screenX)), '-Y', String(Math.round(screenY)),
      '-Path', zipPath, '-HoldMs', '1500',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += String(d); });
    child.stderr.on('data', (d) => { out += String(d); });

    // 拖拽悬停期间截屏，诊断是否显示了全窗拖放提示
    if (captureDuring) {
      setTimeout(() => {
        spawnSync('powershell.exe', [
          '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', CAPTURE,
          '-Out', captureDuring,
        ], { stdio: 'ignore', timeout: 30000 });
      }, 1700);
    }

    return new Promise((resolve) => {
      child.on('exit', () => resolve(out));
    });
  };

  // ==================== A. 拖到扩展管理页内容区（用户复现场景） ====================
  await mainPage.evaluate(async () => {
    await window.NeutronBrowser.createTab('neutron://extensions');
  });
  await new Promise((r) => setTimeout(r, 3500));

  const shotA = path.join(tmpRoot, 'during-drag-ext-page.png');
  const contentTarget = {
    x: (geo.x + geo.width / 2) * geo.scale,
    y: (geo.y + 116 + 160) * geo.scale,
  };
  const outA = await runDrag(contentTarget.x, contentTarget.y, zipA, shotA);
  console.log('[DragA]', outA.replace(/\s+/g, ' ').trim());
  check('A1 OLE 拖放目标接受（EFFECT=Copy）', outA.includes('EFFECT=1'), outA.match(/EFFECT=\d+/) || 'no-effect');
  check('A2 拖放悬停期间截屏已生成', fs.existsSync(shotA), shotA);

  await new Promise((r) => setTimeout(r, 3000));
  const extListA = await mainPage.evaluate(async () => await window.NeutronBrowser.getExtensions());
  check('A3 扩展页拖放后扩展已安装', Array.isArray(extListA) && extListA.some((e) => e.name === 'DragExtContent'),
    JSON.stringify((extListA || []).map((e) => e.name)));

  const activeTabA = await electronApp.evaluate(async () => {
    const wm = global.windowManager;
    const tab = wm.tabs.find((t) => t.id === wm.activeTabId);
    return tab ? tab.url : '';
  });
  check('A4 活动标签页未被拖放导航到 file://', !(activeTabA || '').startsWith('file://'), activeTabA);

  // ==================== B. 拖到工具栏 chrome 区 ====================
  const chromeTarget = {
    x: (geo.x + geo.width / 2) * geo.scale,
    y: (geo.y + 60) * geo.scale,
  };
  const outB = await runDrag(chromeTarget.x, chromeTarget.y, zipB);
  console.log('[DragB]', outB.replace(/\s+/g, ' ').trim());
  check('B1 chrome 区 OLE 拖放目标接受（EFFECT=Copy）', outB.includes('EFFECT=1'), outB.match(/EFFECT=\d+/) || 'no-effect');

  await new Promise((r) => setTimeout(r, 3000));
  const extListB = await mainPage.evaluate(async () => await window.NeutronBrowser.getExtensions());
  check('B2 chrome 区拖放后扩展已安装', Array.isArray(extListB) && extListB.some((e) => e.name === 'DragExtChrome'),
    JSON.stringify((extListB || []).map((e) => e.name)));

  // ==================== 诊断日志 ====================
  const dropLogs = mainLogs.filter((l) => l.includes('[DropInstall]') || l.includes('[WC] [DropInstall]'));
  console.log('\n--- DropInstall 诊断日志 ---');
  dropLogs.forEach((l) => console.log(l));
  console.log('---------------------------\n');
  check('C1 拖放诊断日志完整（page/chrome → main → drop）',
    dropLogs.some((l) => l.includes('dragEnter')) && dropLogs.some((l) => l.includes('dragDrop')),
    dropLogs.length + ' 条日志');

  await electronApp.close();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n结果：${results.length - failed.length}/${results.length} 通过`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error('E2E 失败:', err);
  process.exitCode = 1;
});
