/**
 * E2E：扩展弹窗（Popup）打开/关闭修复
 *
 * 验证：
 *   A. 点击有 popup 的扩展 → 弹窗打开（视图 380x500、内容加载、extensionPopupId 正确）
 *   B. 同图标再次点击 → 弹窗关闭，且视图保持附加并移出屏幕（保持尺寸）——不再 add/remove BrowserView（防网页频闪）
 *   C. 无 popup 的扩展 → 不打开弹窗（走 onClicked，无空壳覆盖层）
 *   D. popup 文件缺失的扩展 → 打开失败并提示（toast），不留空壳
 *   E. 切换标签页 → 弹窗自动关闭
 *
 * 运行：node scripts/test-ext-popup-e2e.js
 */
const path = require('path');
const fs = require('fs');
const AdmZip = require(path.join(__dirname, '..', 'node_modules', 'adm-zip'));

let playwright;
try { playwright = require('playwright-core'); }
catch (e) { playwright = require(path.join(process.env.APPDATA, 'npm', 'node_modules', 'playwright-core')); }
const { _electron } = playwright;

const APP_DIR = path.join(__dirname, '..');
const USER_DATA = path.join(APP_DIR, '.e2e-tmp-extpopup');
const SRC_DIR = path.join(APP_DIR, '.e2e-tmp-extpopup-src');

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok });
  console.log((ok ? '✅' : '❌') + ' ' + name + (detail ? ' — ' + detail : ''));
}

function buildZip(name, manifest) {
  const dir = path.join(SRC_DIR, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  if (name === 'popup') {
    fs.writeFileSync(path.join(dir, 'popup.html'), '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="background:#ffffff"><h1>EXT_POPUP_READY</h1></body></html>');
  }
  const zip = new AdmZip();
  zip.addLocalFolder(dir);
  const zipPath = path.join(APP_DIR, `.e2e-tmp-extpopup-${name}.zip`);
  zip.writeZip(zipPath);
  return zipPath;
}

async function main() {
  fs.rmSync(USER_DATA, { recursive: true, force: true });

  const popupZip = buildZip('popup', {
    manifest_version: 2, name: 'E2E Popup Ext', version: '1.0.0',
    browser_action: { default_popup: 'popup.html', default_title: 'Popup Ext' },
    permissions: [],
  });
  const noPopupZip = buildZip('nopopup', {
    manifest_version: 2, name: 'E2E NoPopup Ext', version: '1.0.0',
    browser_action: { default_title: 'NoPopup Ext' },
    permissions: [],
  });
  const brokenZip = buildZip('broken', {
    manifest_version: 2, name: 'E2E Broken Ext', version: '1.0.0',
    browser_action: { default_popup: 'missing.html', default_title: 'Broken Ext' },
    permissions: [],
  });

  const electronApp = await _electron.launch({
    executablePath: path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe'),
    args: [APP_DIR, `--user-data-dir=${USER_DATA}`],
    env: { ...process.env, NEUTRON_SKIP_EXT_CONFIRM: '1' },
  });
  await new Promise(r => setTimeout(r, 2500));

  let page = null;
  for (const w of await electronApp.windows()) {
    if (String(w.url()).includes('app.html')) { page = w; break; }
  }
  if (!page) throw new Error('main window (app.html) not found');

  // 安装三个测试扩展
  const installed = await page.evaluate((files) =>
    Promise.all(files.map((f) => window.NeutronBrowser.installExtensionFromFile(f)))
  , [popupZip, noPopupZip, brokenZip]);
  console.log('installed:', JSON.stringify(installed));
  await new Promise(r => setTimeout(r, 2500));

  // 通过 getExtensionActions 找到各扩展 id（含 popup 配置）
  const actions = await page.evaluate(() => window.NeutronBrowser.getExtensionActions());
  const popupAct = (actions || []).find(a => a.popup === 'popup.html');
  const noPopupAct = (actions || []).find(a => !a.popup);
  const brokenAct = (actions || []).find(a => a.popup === 'missing.html');
  check('测试扩展已安装并出现在工具栏', !!popupAct && !!noPopupAct && !!brokenAct, JSON.stringify((actions || []).map(a => `${a.id}:${a.popup}`)));
  if (!popupAct || !noPopupAct || !brokenAct) {
    await electronApp.close().catch(() => {});
    process.exit(1);
  }

  const mainState = (script) => electronApp.evaluate(`(async function(){
    const wm = global.windowManager;
    ${script}
  })()`);

  // ---- A. 打开 popup ----
  await page.evaluate((id) => {
    const btn = document.querySelector(`[data-ext-id="${CSS.escape(id)}"]`);
    if (btn) btn.click();
    return !!btn;
  }, popupAct.id);
  await new Promise(r => setTimeout(r, 1500));
  let state = await mainState(`
    const wc = wm.extensionPopupView && wm.extensionPopupView.webContents;
    let popupText = '';
    if (wc && !wc.isDestroyed()) {
      popupText = await wc.executeJavaScript("(document.querySelector('h1')||{}).textContent || ''").catch(function(){ return ''; });
    }
    const b = wm.extensionPopupView ? wm.extensionPopupView.getBounds() : null;
    return { id: wm.extensionPopupId, bounds: b, popupText, attached: wm.mainWindow.getBrowserViews().includes(wm.extensionPopupView) };
  `);
  check('A1 点击后弹窗打开（id 正确）', state.id === popupAct.id, JSON.stringify(state));
  check('A2 弹窗尺寸 380x500', state.bounds && Math.abs(state.bounds.width - 380) < 2 && Math.abs(state.bounds.height - 500) < 2, JSON.stringify(state.bounds));
  check('A3 弹窗内容已加载', state.popupText === 'EXT_POPUP_READY', JSON.stringify(state.popupText));

  // ---- B. 同图标再次点击 → 关闭（视图保持附加、移出屏幕保持尺寸，防频闪） ----
  await page.evaluate((id) => {
    const btn = document.querySelector(`[data-ext-id="${CSS.escape(id)}"]`);
    if (btn) btn.click();
    return !!btn;
  }, popupAct.id);
  await new Promise(r => setTimeout(r, 800));
  state = await mainState(`
    const b = wm.extensionPopupView ? wm.extensionPopupView.getBounds() : null;
    return { id: wm.extensionPopupId, bounds: b, attached: wm.mainWindow.getBrowserViews().includes(wm.extensionPopupView) };
  `);
  check('B1 再次点击后弹窗关闭', state.id === null, JSON.stringify(state.id));
  check('B2 关闭=移出屏幕保持附加（不再 removeBrowserView）', state.attached === true && state.bounds && state.bounds.x < -1000 && state.bounds.y < -1000 && state.bounds.width >= 380 && state.bounds.height >= 500, JSON.stringify(state));

  // ---- C. 无 popup 扩展：不打开空壳 ----
  await page.evaluate((id) => {
    const btn = document.querySelector(`[data-ext-id="${CSS.escape(id)}"]`);
    if (btn) btn.click();
    return !!btn;
  }, noPopupAct.id);
  await new Promise(r => setTimeout(r, 600));
  state = await mainState(`return { id: wm.extensionPopupId };`);
  check('C 无 popup 扩展不打开弹窗', state.id === null, JSON.stringify(state));

  // ---- D. popup 文件缺失：失败提示，不留空壳 ----
  await page.evaluate((id) => {
    const btn = document.querySelector(`[data-ext-id="${CSS.escape(id)}"]`);
    if (btn) btn.click();
    return !!btn;
  }, brokenAct.id);
  await new Promise(r => setTimeout(r, 1000));
  state = await mainState(`return { id: wm.extensionPopupId };`);
  const toastText = await page.evaluate(() => (document.getElementById('toast') || {}).textContent || '');
  check('D1 缺失 popup 不打开弹窗', state.id === null, JSON.stringify(state));
  check('D2 弹出明确提示', toastText.indexOf('不存在') !== -1, JSON.stringify(toastText));

  // ---- E. 切换标签页自动关闭 ----
  await page.evaluate((id) => {
    const btn = document.querySelector(`[data-ext-id="${CSS.escape(id)}"]`);
    if (btn) btn.click();
    return !!btn;
  }, popupAct.id);
  await new Promise(r => setTimeout(r, 1000));
  await mainState(`wm.createTab('https://example.com/'); return true;`);
  await new Promise(r => setTimeout(r, 1500));
  state = await mainState(`return { id: wm.extensionPopupId };`);
  check('E 切换标签页自动关闭弹窗', state.id === null, JSON.stringify(state));

  const failed = results.filter(r => !r.ok);
  console.log(failed.length ? `\n❌ FAIL ${failed.length} 项` : '\n✅ ALL PASS');

  await electronApp.close().catch(() => {});
  fs.rmSync(USER_DATA, { recursive: true, force: true });
  fs.rmSync(SRC_DIR, { recursive: true, force: true });
  [popupZip, noPopupZip, brokenZip].forEach(f => { try { fs.rmSync(f); } catch (e) {} });
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
