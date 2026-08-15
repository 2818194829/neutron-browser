/**
 * 扩展拖放安装 E2E 测试（playwright-core _electron）
 * 验证 v1.10.x 拖拽安装修复：
 *   A. 通过 IPC 安装 .zip 扩展成功
 *   B. 拖放 enter/leave → 全窗提示覆盖层显示/隐藏
 *   C. drop 统一链路（通知主进程 → 转发渲染层 → invoke 安装）成功
 *   D. 开发者模式关闭时侧载被拦截
 * 隔离：--user-data-dir 指向临时目录，不污染真实数据。
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const AdmZip = require('adm-zip');

const PROJECT_ROOT = path.resolve(__dirname, '..');

function makeExtensionZip(name, manifestExtra = {}) {
  const zip = new AdmZip();
  const manifest = {
    manifest_version: 3,
    name,
    version: '1.0.0',
    description: 'E2E test extension',
    ...manifestExtra,
  };
  zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest), 'utf8'));
  if (manifest.background && manifest.background.service_worker) {
    zip.addFile('background.js', Buffer.from('chrome.runtime.onInstalled.addListener(()=>{});', 'utf8'));
  }
  return zip.toBuffer();
}

async function main() {
  const { _electron } = require('playwright-core');

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'neutron-drag-test-'));
  const userDataDir = path.join(tmpRoot, 'userData');
  const zip1Path = path.join(tmpRoot, 'ext-one.zip');
  const zip2Path = path.join(tmpRoot, 'ext-two.zip');
  fs.writeFileSync(zip1Path, makeExtensionZip('DragExtOne'));
  fs.writeFileSync(zip2Path, makeExtensionZip('DragExtTwo'));

  const electronApp = await _electron.launch({
    args: ['.', `--user-data-dir=${userDataDir}`],
    cwd: PROJECT_ROOT,
    // 全局 playwright-core 解析不到项目内 node_modules/electron，显式指定二进制
    executablePath: path.join(PROJECT_ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'),
    env: {
      ...process.env,
      NEUTRON_SKIP_EXT_CONFIRM: '1',
    },
  });

  let mainPage = null;
  const errors = [];
  for (let i = 0; i < 50 && !mainPage; i++) {
    for (const page of electronApp.windows()) {
      if (page.url().includes('app.html')) {
        mainPage = page;
        break;
      }
    }
    if (!mainPage) await new Promise((r) => setTimeout(r, 200));
  }
  if (!mainPage) throw new Error('未找到主窗口');
  mainPage.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  const results = [];
  const check = (name, ok, detail = '') => {
    results.push({ name, ok, detail });
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' - ' + detail : ''}`);
  };

  const appEval = (code) => electronApp.evaluate(async ({ app }, { code }) => {
    // eslint-disable-next-line no-eval
    return await eval(code);
  }, { code });

  // ==================== A. IPC 安装 zip ====================
  const installResult2 = await mainPage.evaluate(async ({ z }) => {
    return await window.NeutronBrowser.installExtensionFromFile(z);
  }, { z: zip1Path });
  check('A1 安装 zip 扩展成功', !!(installResult2 && installResult2.success),
    installResult2 && installResult2.message ? installResult2.message : '');

  const extList = await mainPage.evaluate(async () => {
    return await window.NeutronBrowser.getExtensions();
  });
  check('A2 扩展出现在列表', Array.isArray(extList) && extList.some((e) => e.name === 'DragExtOne'),
    JSON.stringify((extList || []).map((e) => e.name)));

  // ==================== B. 拖放覆盖层显示/隐藏 ====================
  await mainPage.evaluate(() => {
    window.NeutronBrowser.notifyExtensionDragEnter();
  });
  await new Promise((r) => setTimeout(r, 1200));
  const enterState = await appEval(`(() => {
    const wm = global.windowManager;
    const views = wm.mainWindow ? wm.mainWindow.getBrowserViews() : [];
    const overlayUrl = wm.extensionDropView && !wm.extensionDropView.webContents.isDestroyed()
      ? wm.extensionDropView.webContents.getURL() : '';
    return {
      hasView: !!wm.extensionDropView,
      inWindow: views.some((v) => v === wm.extensionDropView),
      overlayUrl,
    };
  })()`);
  check('B1 拖放覆盖层视图已创建并置入窗口', enterState.hasView && enterState.inWindow);
  check('B2 覆盖层加载 extensionDrop 面板', (enterState.overlayUrl || '').includes('panel=extensionDrop'));

  const cardVisible = await appEval(`(() => {
    const wm = global.windowManager;
    if (!wm.extensionDropView || wm.extensionDropView.webContents.isDestroyed()) return 'NO-VIEW';
    return wm.extensionDropView.webContents.executeJavaScript(
      "(() => { const el = document.getElementById('dropOverlay'); return el ? String(!el.hidden) : 'NO-EL'; })()"
    );
  })()`);
  check('B3 提示卡片「松开以安装扩展」已显示', cardVisible === 'true', String(cardVisible));

  await mainPage.evaluate(() => {
    window.NeutronBrowser.notifyExtensionDragLeave();
  });
  await new Promise((r) => setTimeout(r, 300));
  const leaveState = await appEval(`(() => {
    const wm = global.windowManager;
    const views = wm.mainWindow ? wm.mainWindow.getBrowserViews() : [];
    return { depth: wm.extensionDragDepth, inWindow: views.some((v) => v === wm.extensionDropView) };
  })()`);
  check('B4 dragleave 后覆盖层移除、计数归零', leaveState.depth === 0 && !leaveState.inWindow,
    JSON.stringify(leaveState));

  // ==================== C. drop 统一链路端到端 ====================
  await mainPage.evaluate(({ z }) => {
    window.NeutronBrowser.notifyExtensionDragEnter();
    window.NeutronBrowser.notifyExtensionDrop(z);
  }, { z: zip2Path });
  await new Promise((r) => setTimeout(r, 2500));
  const extList2 = await mainPage.evaluate(async () => {
    return await window.NeutronBrowser.getExtensions();
  });
  check('C1 drop 链路安装第二个扩展成功', Array.isArray(extList2) && extList2.some((e) => e.name === 'DragExtTwo'),
    JSON.stringify((extList2 || []).map((e) => e.name)));

  const toastText = await mainPage.evaluate(() => {
    const el = document.getElementById('toast');
    return el ? el.textContent : '';
  });
  check('C2 主窗口显示安装成功 Toast', toastText.includes('已安装'), toastText);

  const afterDrop = await appEval(`(() => {
    const wm = global.windowManager;
    const views = wm.mainWindow ? wm.mainWindow.getBrowserViews() : [];
    return { depth: wm.extensionDragDepth, inWindow: views.some((v) => v === wm.extensionDropView) };
  })()`);
  check('C3 drop 后覆盖层关闭', afterDrop.depth === 0 && !afterDrop.inWindow, JSON.stringify(afterDrop));

  // ==================== D. 开发者模式拦截 ====================
  await mainPage.evaluate(() => {
    window.NeutronBrowser.setSetting('developerMode', false);
  });
  await new Promise((r) => setTimeout(r, 300));
  const devOffResult = await mainPage.evaluate(({ z }) => {
    return window.NeutronBrowser.installExtensionFromFile(z);
  }, { z: zip1Path });
  check('D1 开发者模式关闭时侧载被拦截',
    !!(devOffResult && !devOffResult.success && (devOffResult.message || '').includes('开发者模式')),
    devOffResult && devOffResult.message ? devOffResult.message : '');
  await mainPage.evaluate(() => {
    window.NeutronBrowser.setSetting('developerMode', true);
  });

  // ==================== E. 应用冒烟：标签页加载 + polyfill 不崩溃 ====================
  const extPageOk = await mainPage.evaluate(async () => {
    await window.NeutronBrowser.createTab('neutron://extensions');
    return true;
  });
  check('E1 扩展管理页可打开', extPageOk === true);

  const rendererErrors = errors.filter((t) => !/Electron Security Warning|DevTools|Autofill|GPU|WebGPU/i.test(t));
  check('E2 渲染层无新增错误', rendererErrors.length === 0, rendererErrors.slice(0, 3).join(' | '));

  await electronApp.close();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n结果：${results.length - failed.length}/${results.length} 通过`);
  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('E2E 失败:', err);
  process.exitCode = 1;
});
