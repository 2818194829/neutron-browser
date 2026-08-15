/**
 * E2E：扩展 Popup 视图销毁后引用残留的修复验证
 *
 * 复现 bug：extensionPopupView 的 webContents 被销毁后 this.extensionPopupView
 * 仍保留引用 → 再次 openExtensionPopup 复用已销毁 view → setTopBrowserView 报
 * "Can't add a destroyed child view to a parent view" → popup 打开失败/无反应。
 *
 * 修复：ensureExtensionPopupView 检测 webContents.isDestroyed() → 清理引用并重建；
 * hideExtensionPopup 对已销毁视图仅清理引用；openExtensionPopup ensure 后防御检查。
 *
 * 运行：node scripts/test-ext-popup-destroy-e2e.js
 */
const path = require('path');
const fs = require('fs');
const AdmZip = require(path.join(__dirname, '..', 'node_modules', 'adm-zip'));

let playwright;
try { playwright = require('playwright-core'); }
catch (e) { playwright = require(path.join(process.env.APPDATA, 'npm', 'node_modules', 'playwright-core')); }
const { _electron } = playwright;

const APP_DIR = path.join(__dirname, '..');
const USER_DATA = path.join(APP_DIR, '.e2e-tmp-extdestroy');
const SRC = path.join(APP_DIR, '.e2e-tmp-extdestroy-src');
const ZIP = path.join(APP_DIR, '.e2e-tmp-extdestroy.zip');

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok });
  console.log((ok ? '✅' : '❌') + ' ' + name + (detail ? ' — ' + detail : ''));
}

async function main() {
  fs.rmSync(USER_DATA, { recursive: true, force: true });
  fs.rmSync(SRC, { recursive: true, force: true });
  fs.mkdirSync(SRC, { recursive: true });
  fs.writeFileSync(path.join(SRC, 'manifest.json'), JSON.stringify({
    manifest_version: 2, name: 'Destroy Popup', version: '1.0.0',
    browser_action: { default_popup: 'popup.html', default_title: 'Destroy' },
    permissions: [],
  }));
  fs.writeFileSync(path.join(SRC, 'popup.html'),
    '<!DOCTYPE html><html><head><meta charset="utf-8"></head>' +
    '<body style="background:#fff;margin:0"><h1>POPUP_OK</h1></body></html>');
  const zip = new AdmZip();
  zip.addLocalFolder(SRC);
  zip.writeZip(ZIP);

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
  if (!page) throw new Error('main window not found');

  await page.evaluate((f) => window.NeutronBrowser.installExtensionFromFile(f), ZIP);
  await new Promise(r => setTimeout(r, 2500));
  const actions = await page.evaluate(() => window.NeutronBrowser.getExtensionActions());
  const act = (actions || []).find(a => a.popup === 'popup.html');
  if (!act) { console.log('未找到 popup 扩展'); process.exit(1); }

  const openPopup = () => electronApp.evaluate(`(async function(){
    const wm = global.windowManager;
    try {
      const r = await wm.openExtensionPopup({ id: '${act.id}', popup: 'popup.html',
        anchor: { left: 100, top: 0, right: 140, bottom: 36, width: 40, height: 36 } });
      return { ok: r.ok, reason: r.reason, err: null, popupExists: !!wm.extensionPopupView && !!wm.extensionPopupView.webContents && !wm.extensionPopupView.webContents.isDestroyed() };
    } catch (e) {
      return { ok: false, reason: 'EXCEPTION', err: String(e) };
    }
  })()`);

  // 1) 第一次正常打开
  const r1 = await openPopup();
  await new Promise(r => setTimeout(r, 1200));
  check('A1 第一次打开 popup 成功', r1.ok === true && r1.popupExists === true, JSON.stringify(r1));

  // 2) 模拟视图销毁 + 引用残留（不置 null）
  const destroyResult = await electronApp.evaluate(`(async function(){
    const wm = global.windowManager;
    let closeErr = null;
    try {
      wm.extensionPopupView.webContents.close();  // 销毁 webContents（view 也被销毁）
    } catch (e) { closeErr = String(e); }
    await new Promise(r => setTimeout(r, 600));
    let destroyedCheck;
    try {
      destroyedCheck = wm.extensionPopupView ? wm.extensionPopupView.webContents.isDestroyed() : 'view-null';
    } catch (e) { destroyedCheck = 'check-err:' + String(e); }
    return { closeErr, refStillSet: wm.extensionPopupView !== null && wm.extensionPopupView !== undefined, destroyedCheck };
  })()`);
  console.log('销毁后状态:', JSON.stringify(destroyResult));
  check('A2 视图已销毁且引用残留（复现 bug 前置）',
    destroyResult.closeErr === null && destroyResult.refStillSet === true &&
      (destroyResult.destroyedCheck === true || String(destroyResult.destroyedCheck).startsWith('check-err')),
    JSON.stringify(destroyResult));

  // 3) 再次打开（修复后应重建，不再报 "Can't add a destroyed child view"）
  const r2 = await openPopup();
  await new Promise(r => setTimeout(r, 1200));
  check('A3 销毁后再次打开 popup 成功（无异常）',
    r2.ok === true && r2.err === null && r2.popupExists === true, JSON.stringify(r2));

  // 4) 第三次（再次关闭再打开，验证稳定）
  await electronApp.evaluate(`global.windowManager.hideExtensionPopup();`);
  await new Promise(r => setTimeout(r, 500));
  const r3 = await openPopup();
  await new Promise(r => setTimeout(r, 1000));
  check('A4 关闭后再打开稳定', r3.ok === true && r3.err === null, JSON.stringify(r3));

  const failed = results.filter(r => !r.ok);
  console.log(failed.length ? `\n❌ FAIL ${failed.length} 项` : '\n✅ ALL PASS');

  await electronApp.close().catch(() => {});
  fs.rmSync(USER_DATA, { recursive: true, force: true });
  fs.rmSync(SRC, { recursive: true, force: true });
  fs.rmSync(ZIP, { force: true });
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
