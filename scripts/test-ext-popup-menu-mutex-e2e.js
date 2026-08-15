/**
 * E2E：扩展 Popup 与右键菜单互斥（对齐 Edge/Chromium）
 * 场景：先左键点击扩展打开 Popup，再右键点击同一扩展 → Popup 先关闭、菜单后打开，两层绝不共存。
 * 反向：菜单打开时左键点击扩展 → 菜单关闭、Popup 打开。
 *
 * 运行：node scripts/test-ext-popup-menu-mutex-e2e.js
 */
const path = require('path');
const fs = require('fs');
const AdmZip = require(path.join(__dirname, '..', 'node_modules', 'adm-zip'));
let playwright;
try { playwright = require('playwright-core'); }
catch (e) { playwright = require(path.join(process.env.APPDATA, 'npm', 'node_modules', 'playwright-core')); }
const { _electron } = playwright;
const APP_DIR = path.join(__dirname, '..');
const USER_DATA = path.join(APP_DIR, '.e2e-tmp-extmutex');
const SRC_DIR = path.join(APP_DIR, '.e2e-tmp-extmutex-src');

const results = [];
function check(name, ok, detail) { results.push({ name, ok }); console.log((ok ? '✅' : '❌') + ' ' + name + (detail ? ' — ' + detail : '')); }

function buildTestExtensionZip() {
  fs.rmSync(SRC_DIR, { recursive: true, force: true });
  fs.mkdirSync(SRC_DIR, { recursive: true });
  fs.writeFileSync(path.join(SRC_DIR, 'manifest.json'), JSON.stringify({
    manifest_version: 3,
    name: 'Neutron E2E Mutex Test',
    version: '1.0.0',
    description: 'E2E popup/menu mutex test',
    permissions: ['storage'],
    background: { service_worker: 'background.js' },
    action: { default_popup: 'popup.html', default_title: 'Mutex Test' },
  }, null, 2));
  fs.writeFileSync(path.join(SRC_DIR, 'background.js'), 'chrome.runtime.onInstalled.addListener(() => {});');
  fs.writeFileSync(path.join(SRC_DIR, 'popup.html'), '<!DOCTYPE html><html><head><meta charset="utf-8"><title>popup</title></head><body><h1>Mutex Popup</h1></body></html>');
  const zip = new AdmZip();
  zip.addLocalFolder(SRC_DIR);
  const zipPath = path.join(APP_DIR, '.e2e-tmp-extmutex-test.zip');
  zip.writeZip(zipPath);
  return zipPath;
}

async function main() {
  const zipPath = buildTestExtensionZip();
  const electronApp = await _electron.launch({
    executablePath: path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe'),
    args: [APP_DIR, `--user-data-dir=${USER_DATA}`],
    env: { ...process.env, NEUTRON_SKIP_EXT_CONFIRM: '1' },
  });
  await new Promise(r => setTimeout(r, 2500));

  // 安装测试扩展
  const installed = await electronApp.evaluate(`(async function(){
    const wc = global.windowManager.mainWindow.webContents;
    return await wc.executeJavaScript(
      'window.NeutronBrowser.installExtensionFromFile(' + ${JSON.stringify(JSON.stringify(zipPath))} + ')'
    );
  })()`);
  check('测试扩展安装成功', !!(installed && installed.success), (installed && installed.message) || '');
  const extId = installed && installed.extension && installed.extension.id;
  if (!extId) { console.log('无法继续'); process.exit(1); }
  await new Promise(r => setTimeout(r, 1500));

  // 主进程状态读取（evaluate 无 require，走 windowManager）
  const mainState = (extra) => electronApp.evaluate(`(function(){
    const wm = global.windowManager;
    var browsers = [];
    try { browsers = wm.mainWindow.getBrowserViews().map(function(v){ return v === wm.extensionPopupView ? 'POPUP' : 'other'; }); } catch(e) {}
    var b = null;
    try { if (wm.extensionPopupView) b = wm.extensionPopupView.getBounds(); } catch(e) {}
    return { popupId: wm.extensionPopupId, hasPopupView: browsers.indexOf('POPUP') !== -1, popupBounds: b, extra: ${extra || 'null'} };
  })()`);

  const evalInPage = (script) => electronApp.evaluate(`(async function(){
    const wc = global.windowManager.mainWindow.webContents;
    return await wc.executeJavaScript(${JSON.stringify(script)}).catch(function(e){ return { __err: String(e && e.message || e) }; });
  })()`);

  // ===== 1. 左键点击 → Popup 打开 =====
  await evalInPage(`(function(){
    var btn = document.querySelector('.ext-tool-btn[data-ext-id="${extId}"]');
    if (btn) btn.click();
    return !!btn;
  })()`);
  await new Promise(r => setTimeout(r, 1200));
  const afterLeft = await mainState();
  check('左键点击后 Popup 打开（主进程）', afterLeft.popupId === extId, String(afterLeft.popupId));
  check('左键点击后 Popup 视图在窗口中', afterLeft.hasPopupView === true);
  const menuClosedAfterLeft = await evalInPage(`(function(){
    var m = document.getElementById('contextMenu');
    return m.style.display === 'none';
  })()`);
  check('左键点击后右键菜单关闭', menuClosedAfterLeft === true);

  // ===== 2. 右键点击同一扩展 → Popup 关闭 + 菜单打开（互斥） =====
  await evalInPage(`(function(){
    var btn = document.querySelector('.ext-tool-btn[data-ext-id="${extId}"]');
    var r = btn.getBoundingClientRect();
    btn.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 10, clientY: r.top + 10 }));
    return true;
  })()`);
  await new Promise(r => setTimeout(r, 900));
  const afterRight = await mainState();
  const menuAfterRight = await evalInPage(`(function(){
    var m = document.getElementById('contextMenu');
    return {
      open: m.style.display === 'block',
      hasItems: m.querySelectorAll('.context-menu__item').length
    };
  })()`);
  console.log('右键后主进程状态:', JSON.stringify(afterRight));
  console.log('右键后菜单状态:', JSON.stringify(menuAfterRight));
  check('右键后 Popup 已关闭（popupId=null）', afterRight.popupId === null, String(afterRight.popupId));
  // 视图保持附加但隐藏为 1x1（不再 removeBrowserView，避免网页频闪）
  check('右键后 Popup 视图已隐藏（1x1 保持附加）',
    afterRight.hasPopupView === true &&
    afterRight.popupBounds && afterRight.popupBounds.width <= 2 && afterRight.popupBounds.height <= 2,
    JSON.stringify(afterRight));
  check('右键菜单打开', menuAfterRight.open === true && menuAfterRight.hasItems > 5, JSON.stringify(menuAfterRight));
  check('两个窗口不共存', afterRight.popupId === null && menuAfterRight.open === true);

  // ===== 3. 反向：菜单开着时左键点击扩展 → 菜单关闭 + Popup 打开 =====
  await evalInPage(`(function(){
    var btn = document.querySelector('.ext-tool-btn[data-ext-id="${extId}"]');
    if (btn) btn.click();
    return !!btn;
  })()`);
  await new Promise(r => setTimeout(r, 1200));
  const afterLeftAgain = await mainState();
  const menuAfterLeftAgain = await evalInPage(`(function(){
    var m = document.getElementById('contextMenu');
    return m.style.display === 'none';
  })()`);
  check('反向：左键点击后 Popup 打开', afterLeftAgain.popupId === extId, String(afterLeftAgain.popupId));
  check('反向：左键点击后菜单关闭', menuAfterLeftAgain === true);

  // ===== 4. 右键另一个操作路径：Popup 打开状态下直接右键（menu 事件顺序） =====
  await evalInPage(`(function(){
    var btn = document.querySelector('.ext-tool-btn[data-ext-id="${extId}"]');
    var r = btn.getBoundingClientRect();
    btn.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 10, clientY: r.top + 10 }));
    return true;
  })()`);
  await new Promise(r => setTimeout(r, 900));
  const finalState = await mainState();
  const finalMenu = await evalInPage(`(function(){
    var m = document.getElementById('contextMenu');
    return m.style.display === 'block';
  })()`);
  check('再次右键：Popup 关闭 + 菜单打开（可重复）', finalState.popupId === null && finalMenu === true, JSON.stringify({ popupId: finalState.popupId, menuOpen: finalMenu }));

  await electronApp.close();
  const failed = results.filter(x => !x.ok).length;
  console.log('\n总计: ' + results.length + ' 项, 失败 ' + failed + ' 项');
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error('测试失败:', e); process.exit(1); });
