/**
 * E2E：扩展右键菜单（对齐 Edge）
 * 验证：菜单项齐全、网站访问权限切换、取消固定、管理扩展、扩展选项窗口
 *
 * 注意：
 * - playwright electronApp.evaluate 环境无 require 且【参数传递不可靠】，
 *   页面脚本统一在 Node 侧构建后 JSON.stringify 内插，避免多层转义。
 * - 主进程逻辑全部经渲染层 window.NeutronBrowser API / global.windowManager 驱动。
 *
 * 运行：node scripts/test-ext-context-menu-e2e.js
 */
const path = require('path');
const fs = require('fs');
const AdmZip = require(path.join(__dirname, '..', 'node_modules', 'adm-zip'));
let playwright;
try { playwright = require('playwright-core'); }
catch (e) { playwright = require(path.join(process.env.APPDATA, 'npm', 'node_modules', 'playwright-core')); }
const { _electron } = playwright;
const APP_DIR = path.join(__dirname, '..');
const USER_DATA = path.join(APP_DIR, '.e2e-tmp-extmenu');
const SRC_DIR = path.join(APP_DIR, '.e2e-tmp-extmenu-src');

const results = [];
function check(name, ok, detail) { results.push({ name, ok }); console.log((ok ? '✅' : '❌') + ' ' + name + (detail ? ' — ' + detail : '')); }

/** 创建最小 MV3 测试扩展 zip（含 popup + options + host_permissions） */
function buildTestExtensionZip() {
  fs.rmSync(SRC_DIR, { recursive: true, force: true });
  fs.mkdirSync(SRC_DIR, { recursive: true });
  fs.writeFileSync(path.join(SRC_DIR, 'manifest.json'), JSON.stringify({
    manifest_version: 3,
    name: 'Neutron E2E Test Extension',
    version: '1.0.0',
    description: 'E2E test extension for context menu',
    permissions: ['storage', 'activeTab'],
    host_permissions: ['https://example.com/*'],
    background: { service_worker: 'background.js' },
    action: { default_popup: 'popup.html', default_title: 'E2E Test' },
    options_ui: { page: 'options.html', open_in_tab: true },
  }, null, 2));
  fs.writeFileSync(path.join(SRC_DIR, 'background.js'), 'chrome.runtime.onInstalled.addListener(() => {});');
  fs.writeFileSync(path.join(SRC_DIR, 'popup.html'), '<!DOCTYPE html><html><head><meta charset="utf-8"><title>popup</title></head><body><h1>E2E Popup</h1></body></html>');
  fs.writeFileSync(path.join(SRC_DIR, 'options.html'), '<!DOCTYPE html><html><head><meta charset="utf-8"><title>options</title></head><body><h1>E2E Options</h1></body></html>');
  const zip = new AdmZip();
  zip.addLocalFolder(SRC_DIR);
  const zipPath = path.join(APP_DIR, '.e2e-tmp-extmenu-test.zip');
  zip.writeZip(zipPath);
  return zipPath;
}

/** 在 evaluate 里执行页面脚本（返回 Promise 结果） */
function evalInPage(pageScript) {
  return electronApp.evaluate(`(async function(){
    const wc = global.windowManager.mainWindow.webContents;
    return await wc.executeJavaScript(${JSON.stringify(pageScript)}).catch(function(e){ return { __err: String(e && e.message || e) }; });
  })()`);
}

let electronApp;

async function main() {
  const zipPath = buildTestExtensionZip();

  electronApp = await _electron.launch({
    executablePath: path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe'),
    args: [APP_DIR, `--user-data-dir=${USER_DATA}`],
    env: { ...process.env, NEUTRON_SKIP_EXT_CONFIRM: '1' },
  });
  await new Promise(r => setTimeout(r, 2500));

  // ===== 1. 通过渲染层 API 安装测试扩展 =====
  const installScript = `window.NeutronBrowser.installExtensionFromFile(${JSON.stringify(zipPath)})`;
  const installed = await electronApp.evaluate(`(async function(){
    const wc = global.windowManager.mainWindow.webContents;
    return await wc.executeJavaScript(${JSON.stringify(installScript)});
  })()`);
  console.log('安装结果:', JSON.stringify(installed).slice(0, 240));
  check('测试扩展安装成功', !!(installed && installed.success), (installed && installed.message) || '');
  const extId = installed && installed.extension && installed.extension.id;
  check('获取到扩展 ID', !!extId, extId || '');
  if (!extId) { console.log('无法继续：扩展未安装'); process.exit(1); }
  await new Promise(r => setTimeout(r, 1500));

  // ===== 2. 工具栏图标出现 =====
  const iconState = await evalInPage(
    `!!document.querySelector('.ext-tool-btn[data-ext-id="${extId}"]')`
  );
  check('工具栏出现扩展图标', iconState === true);

  // ===== 3. 右键打开菜单（先导航到 http 页面） =====
  await electronApp.evaluate(`(async function(){
    global.windowManager.createTab('https://example.com/', true);
    await new Promise(function(r){ setTimeout(r, 2000); });
  })()`);
  const menuState = await evalInPage(`(async function(){
    var btn = document.querySelector('.ext-tool-btn[data-ext-id="${extId}"]');
    if (!btn) return { error: '图标不存在' };
    var r = btn.getBoundingClientRect();
    btn.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 10, clientY: r.top + 10 }));
    await new Promise(function(res){ setTimeout(res, 700); });
    var menu = document.getElementById('contextMenu');
    if (!menu || menu.style.display === 'none') return { error: '菜单未打开' };
    return {
      texts: Array.from(menu.querySelectorAll('.context-menu__item-label')).map(function(e){ return e.textContent.trim(); }),
      headers: Array.from(menu.querySelectorAll('.context-menu__group-header')).map(function(e){ return e.textContent.trim(); }),
      checked: Array.from(menu.querySelectorAll('.context-menu__item'))
        .filter(function(e){ return e.querySelector('.context-menu__item-icon svg'); })
        .map(function(e){ return e.querySelector('.context-menu__item-label').textContent.trim(); })
    };
  })()`);
  console.log('菜单状态:', JSON.stringify(menuState));
  check('右键打开扩展菜单', !menuState.error && !menuState.__err, JSON.stringify(menuState.error || menuState.__err || ''));
  check('含组标题"网站访问权限"', (menuState.headers || []).indexOf('网站访问权限') !== -1);
  const expectItems = ['仅在单击时允许', '允许在所有网站上使用', '扩展选项', '从 Neutron 浏览器中删除', '从工具栏取消固定', '管理扩展', '查看 Web 权限'];
  const texts = menuState.texts || [];
  const missing = expectItems.filter(function(t) { return !texts.some(function(x) { return x.indexOf(t) !== -1; }); });
  check('菜单项齐全（7 项）', missing.length === 0, missing.join(', ') || '全部存在');
  check('含"允许在 example.com 上使用"', texts.some(function(t) { return t.indexOf('允许在 example.com 上使用') !== -1; }));
  check('含"检查弹出窗口"', texts.indexOf('检查弹出窗口') !== -1);
  check('默认选中"允许在所有网站上使用"', (menuState.checked || []).indexOf('允许在所有网站上使用') !== -1);

  // ===== 4. 点击"仅在单击时允许" → 存储 siteAccess=on_click =====
  const clicked1 = await evalInPage(`(function(){
    var menu = document.getElementById('contextMenu');
    var items = Array.from(menu.querySelectorAll('.context-menu__item'));
    var item = items.find(function(e){ return e.querySelector('.context-menu__item-label') && e.querySelector('.context-menu__item-label').textContent.trim() === '仅在单击时允许'; });
    if (item) { item.click(); return true; } return false;
  })()`);
  await new Promise(r => setTimeout(r, 900));
  check('菜单点击成功', clicked1 === true);

  // 重新右键读取选中态
  await evalInPage(`(function(){
    var btn = document.querySelector('.ext-tool-btn[data-ext-id="${extId}"]');
    if (!btn) return false;
    var r = btn.getBoundingClientRect();
    btn.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 10, clientY: r.top + 10 }));
    return true;
  })()`);
  await new Promise(r => setTimeout(r, 700));
  const checkedAfter = await evalInPage(`(function(){
    var menu = document.getElementById('contextMenu');
    return Array.from(menu.querySelectorAll('.context-menu__item'))
      .filter(function(e){ return e.querySelector('.context-menu__item-icon svg'); })
      .map(function(e){ return e.querySelector('.context-menu__item-label').textContent.trim(); });
  })()`);
  check('重开菜单选中"仅在单击时允许"', (checkedAfter || []).indexOf('仅在单击时允许') !== -1, JSON.stringify(checkedAfter));

  // Node 侧读存储验证 siteAccess 持久化
  let storedSiteAccess = '';
  try {
    const data = JSON.parse(fs.readFileSync(path.join(USER_DATA, 'NeutronBrowser', 'extensions.json'), 'utf8'));
    const rec = (data.installed || []).find(e => e.id === extId);
    storedSiteAccess = rec && rec.siteAccess;
  } catch (e) { /* 忽略 */ }
  check('存储持久化 siteAccess=on_click', storedSiteAccess === 'on_click', storedSiteAccess);

  // ===== 5. 菜单"管理扩展"打开管理页标签 =====
  const clickManage = await evalInPage(`(function(){
    var menu = document.getElementById('contextMenu');
    if (!menu || menu.style.display === 'none') return { found: false, reason: '菜单未打开' };
    var items = Array.from(menu.querySelectorAll('.context-menu__item'));
    var item = items.find(function(e){ return e.querySelector('.context-menu__item-label') && e.querySelector('.context-menu__item-label').textContent.trim() === '管理扩展'; });
    if (item) { item.click(); return { found: true }; }
    return { found: false, reason: '未找到菜单项', labels: items.map(function(e){ return e.querySelector('.context-menu__item-label') ? e.querySelector('.context-menu__item-label').textContent.trim() : ''; }).slice(0, 12) };
  })()`);
  await new Promise(r => setTimeout(r, 1500));
  const manageTab = await electronApp.evaluate(`(function(){
    const wm = global.windowManager;
    var urls = wm.tabs.map(function(t){ return t.url; });
    for (var i = 0; i < wm.tabs.length; i++) {
      if (wm.tabs[i].url && wm.tabs[i].url.indexOf('neutron://extensions') !== -1) return { url: wm.tabs[i].url, urls: urls };
    }
    return { url: '', urls: urls };
  })()`);
  console.log('管理扩展点击:', JSON.stringify(clickManage));
  console.log('标签列表:', JSON.stringify(manageTab));
  // neutron://extensions 内部页解析为 file://.../extensions.html
  const allUrls = manageTab.urls || [];
  const manageOk = allUrls.some(function(u) {
    return u.indexOf('neutron://extensions') !== -1 || u.indexOf('extensions.html') !== -1;
  });
  check('菜单"管理扩展"打开管理页标签', manageOk, JSON.stringify(allUrls));

  // ===== 6. 取消固定 → 图标消失 =====
  await evalInPage(`(function(){
    var btn = document.querySelector('.ext-tool-btn[data-ext-id="${extId}"]');
    if (!btn) return false;
    var r = btn.getBoundingClientRect();
    btn.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 10, clientY: r.top + 10 }));
    return true;
  })()`);
  await new Promise(r => setTimeout(r, 700));
  const clicked2 = await evalInPage(`(function(){
    var menu = document.getElementById('contextMenu');
    var items = Array.from(menu.querySelectorAll('.context-menu__item'));
    var item = items.find(function(e){ return e.querySelector('.context-menu__item-label') && e.querySelector('.context-menu__item-label').textContent.trim() === '从工具栏取消固定'; });
    if (item) { item.click(); return true; } return false;
  })()`);
  await new Promise(r => setTimeout(r, 1200));
  const iconGone = await evalInPage(
    `!document.querySelector('.ext-tool-btn[data-ext-id="${extId}"]')`
  );
  check('取消固定菜单点击成功', clicked2 === true);
  check('工具栏图标消失', iconGone === true);

  let storedPinned = null;
  try {
    const data = JSON.parse(fs.readFileSync(path.join(USER_DATA, 'NeutronBrowser', 'extensions.json'), 'utf8'));
    const rec = (data.installed || []).find(e => e.id === extId);
    storedPinned = rec && rec.pinned;
  } catch (e) { /* 忽略 */ }
  check('存储持久化 pinned=false', storedPinned === false, String(storedPinned));

  // ===== 7. 扩展选项窗口（主进程 windowManager） =====
  const optionsResult = await electronApp.evaluate(`(async function(){
    const wm = global.windowManager;
    const res1 = wm.openExtensionOptionsPage(${JSON.stringify(extId)});
    await new Promise(function(r){ setTimeout(r, 2500); });
    var wins = [];
    if (wm.extensionOptionsWindows) {
      wm.extensionOptionsWindows.forEach(function(w, id){ wins.push({ id: id, destroyed: w.isDestroyed(), url: w.getURL() }); });
    }
    const res2 = wm.openExtensionOptionsPage(${JSON.stringify(extId)});
    return { res1: res1, res2: res2, wins: wins };
  })()`);
  const optWin = (optionsResult.wins || []).find(w => w.url.indexOf('options.html') !== -1);
  check('扩展选项窗口打开', !!optWin, JSON.stringify((optionsResult.wins || []).map(w => w.url)));
  check('选项页 URL 正确', !!(optWin && optWin.url.indexOf('chrome-extension://') !== -1 && optWin.url.indexOf('options.html') !== -1), optWin && optWin.url);
  check('重复打开聚焦已有窗口', !!(optionsResult.res2 && optionsResult.res2.focused === true), JSON.stringify(optionsResult.res2));

  await electronApp.close();
  const failed = results.filter(x => !x.ok).length;
  console.log('\n总计: ' + results.length + ' 项, 失败 ' + failed + ' 项');
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error('测试失败:', e); process.exit(1); });
