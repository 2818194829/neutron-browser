/**
 * DOM 级拖放链路 E2E 测试
 *
 * 真实资源管理器拖放最终就是在目标页面派发 dragenter/dragover/drop DOM 事件
 * （dataTransfer.files 含磁盘文件）。本测试合成这些事件（文件名 .crx/.zip），
 * 验证应用侧完整链路：监听器注册 -> 覆盖层显示 -> 主进程转发 -> 安装入口。
 * 注：JS 构造的 File 无磁盘路径，getPathForFile 返回 ''，安装环节会走到
 * 「无法获取文件路径」提示 —— 这正是链路被完整触发的证据。
 */
const path = require('path');
const fs = require('fs');
const os = require('os');

const PROJECT_ROOT = path.resolve(__dirname, '..');

const SYNTHETIC_DROP_SNIPPET = `(() => {
  const dt = new DataTransfer();
  dt.items.add(new File(['fake'], 'test-extension.crx', { type: 'application/x-chrome-extension' }));
  document.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }));
  document.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
  document.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  return true;
})()`;

async function main() {
  const { _electron } = require('playwright-core');
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'neutron-domdrag-'));
  const userDataDir = path.join(tmpRoot, 'userData');

  const electronApp = await _electron.launch({
    args: ['.', `--user-data-dir=${userDataDir}`],
    cwd: PROJECT_ROOT,
    executablePath: path.join(PROJECT_ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'),
    env: { ...process.env, NEUTRON_SKIP_EXT_CONFIRM: '1' },
  });

  const mainLogs = [];
  electronApp.process().stdout.on('data', (d) => {
    String(d).split(/\r?\n/).forEach((l) => { if (l.trim()) mainLogs.push(l.trim()); });
  });

  // 所有 webContents 的 [DropInstall] 日志转发到主进程 stdout
  await electronApp.evaluate(async ({ app, webContents }) => {
    const attach = (wc) => {
      if (wc.__logAttached) return;
      wc.__logAttached = true;
      wc.on('console-message', function (e, level, message) {
        const msg = (typeof message === 'string' && message)
          || (e && typeof e.message === 'string' && e.message) || '';
        if (msg.indexOf('[DropInstall]') !== -1) console.log('[WC] ' + msg);
      });
    };
    webContents.getAllWebContents().forEach(attach);
    app.on('web-contents-created', (e, wc) => attach(wc));
  });

  let mainPage = null;
  for (let i = 0; i < 50 && !mainPage; i++) {
    for (const page of electronApp.windows()) {
      if (page.url().includes('app.html')) { mainPage = page; break; }
    }
    if (!mainPage) await new Promise((r) => setTimeout(r, 200));
  }
  if (!mainPage) throw new Error('未找到主窗口');
  await new Promise((r) => setTimeout(r, 1500));

  const results = [];
  const check = (name, ok, detail = '') => {
    results.push({ name, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' - ' + detail : ''}`);
  };

  // ==================== A. 主窗口 chrome 区合成拖放 ====================
  await mainPage.evaluate(async ({ snip }) => { await eval(snip); }, { snip: SYNTHETIC_DROP_SNIPPET });
  await new Promise((r) => setTimeout(r, 2500));

  const chromeLogs = mainLogs.filter((l) => l.includes('[DropInstall][chrome]'));
  check('A1 chrome 区 dragenter 监听器触发', chromeLogs.some((l) => l.includes('dragenter')), chromeLogs.join(' | '));
  check('A2 chrome 区 drop 监听器触发', chromeLogs.some((l) => l.includes('drop')));

  const mainDragLogs = mainLogs.filter((l) => l.includes('[DropInstall][main]'));
  check('A3 主进程收到 dragEnter（覆盖层显示）', mainDragLogs.some((l) => l.includes('dragEnter')), mainDragLogs.join(' | '));
  check('A4 主进程收到 dragDrop 并转发', mainDragLogs.some((l) => l.includes('dragDrop')));

  const overlayState = await electronApp.evaluate(async () => {
    const wm = global.windowManager;
    const views = wm.mainWindow ? wm.mainWindow.getBrowserViews() : [];
    return { depth: wm.extensionDragDepth, inWindow: views.some((v) => v === wm.extensionDropView) };
  });
  check('A5 drop 后覆盖层关闭、计数归零', overlayState.depth === 0 && !overlayState.inWindow, JSON.stringify(overlayState));

  const toast = await mainPage.evaluate(() => {
    const el = document.getElementById('toast');
    return el ? el.textContent : '';
  });
  check('A6 无路径文件走到「无法获取文件路径」提示（链路完整证据）', toast.includes('无法获取文件路径'), toast);

  // ==================== B. 网页内容区合成拖放 ====================
  await mainPage.evaluate(async () => {
    await window.NeutronBrowser.createTab('https://example.com');
  });
  await new Promise((r) => setTimeout(r, 3500));

  // 在活动网页（example.com）里合成拖放，验证 polyfill 拦截
  const pageDropOk = await electronApp.evaluate(async () => {
    const wm = global.windowManager;
    const tab = wm.tabs.find((t) => t.id === wm.activeTabId);
    if (!tab || !tab.view) return 'NO-TAB ' + (tab ? tab.url : '');
    const wc = tab.view.webContents;
    return await wc.executeJavaScript(`(() => {
      const dt = new DataTransfer();
      dt.items.add(new File(['fake'], 'another-extension.zip'));
      document.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }));
      document.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
      document.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
      return 'OK';
    })()`);
  });
  await new Promise((r) => setTimeout(r, 2500));

  const pageLogs = mainLogs.filter((l) => l.includes('[DropInstall][page]'));
  check('B1 网页区域 polyfill dragenter 触发', pageLogs.some((l) => l.includes('dragenter')), pageLogs.join(' | '));
  check('B2 网页区域 polyfill drop 触发', pageLogs.some((l) => l.includes('drop path')));

  const mainDragLogs2 = mainLogs.filter((l) => l.includes('[DropInstall][main] dragDrop'));
  check('B3 网页 drop 经主进程转发到安装链路', mainDragLogs2.length >= 2, mainDragLogs2.join(' | '));

  const toast2 = await mainPage.evaluate(() => {
    const el = document.getElementById('toast');
    return el ? el.textContent : '';
  });
  check('B4 主窗口显示「无法获取文件路径」提示', toast2.includes('无法获取文件路径'), toast2);

  console.log('\n--- 全部 [DropInstall] 日志 ---');
  mainLogs.filter((l) => l.includes('[DropInstall]')).forEach((l) => console.log(l));

  await electronApp.close();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n结果：${results.length - failed.length}/${results.length} 通过`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error('E2E 失败:', err);
  process.exitCode = 1;
});
