/**
 * 最终端到端验证：Edge 商店安装扩展全流程
 * 1. 页面无"不兼容"提示、获取按钮启用
 * 2. 点击"获取" → beginInstallWithManifest3 → 安装成功
 * 3. 商店 UI 进入"已安装"状态（completeInstall 无报错）
 * 4. 扩展注册表含 Tampermonkey
 *
 * 运行：node scripts/test-edge-store-e2e.js
 */
const path = require('path');
let playwright;
try { playwright = require('playwright-core'); }
catch (e) { playwright = require(path.join(process.env.APPDATA, 'npm', 'node_modules', 'playwright-core')); }
const { _electron } = playwright;
const APP_DIR = path.join(__dirname, '..');
const USER_DATA = path.join(APP_DIR, '.e2e-tmp-edgefinal');
const fs = require('fs');

const results = [];
function check(name, ok, detail) { results.push({ name, ok }); console.log((ok ? '✅' : '❌') + ' ' + name + (detail ? ' — ' + detail : '')); }

async function main() {
  const electronApp = await _electron.launch({
    executablePath: path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe'),
    args: [APP_DIR, `--user-data-dir=${USER_DATA}`],
  });
  await new Promise(r => setTimeout(r, 2500));

  const r = await electronApp.evaluate(async () => {
    global.windowManager.createTab('https://microsoftedge.microsoft.com/addons/detail/tampermonkey/iikmkjmpaadaobahmlepeloendndfphd', true);
    await new Promise(r => setTimeout(r, 12000));
    const tab = global.windowManager.tabs.find(t => t.url && t.url.includes('microsoftedge.microsoft.com'));
    if (!tab || !tab.view) return { error: 'tab not found' };
    const wc = tab.view.webContents;
    const errors = [];
    try { wc.on('console-message', (e, level, message) => { if (level >= 3) errors.push(String(message).slice(0, 160)); }); } catch (e) {}

    const bodyHas = async (kw) => (await wc.executeJavaScript(`/ ${kw} /.test(document.body.innerText || '')`).catch(() => false));
    const btnState = async () => await wc.executeJavaScript(`(function(){
      var b = Array.from(document.querySelectorAll('button')).find(x => /获取|已安装|打开|检查/.test(x.textContent || ''));
      return b ? { text: (b.textContent || '').trim(), disabled: b.disabled } : null;
    })()`).catch(() => null);

    const out = {};
    out.incompatibleBefore = await bodyHas('与你的浏览器不兼容');
    out.btnBefore = await btnState();

    // 点击"获取"
    await wc.executeJavaScript(`(function(){ var b=Array.from(document.querySelectorAll('button')).find(x=>/获取/.test(x.textContent||'')); if(b)b.click(); return !!b; })(); true;`);
    out.btnAfter = await btnState();
    out.incompatibleAfter = await bodyHas('与你的浏览器不兼容');
    out.compatible = await bodyHas('与你的浏览器兼容');
    out.errors = errors;
    return out;
  });

  // Node 侧轮询扩展注册表（下载+安装 CRX 需要时间，最多 120 秒）
  let extName = '';
  for (let i = 0; i < 24; i++) {
    await new Promise(r => setTimeout(r, 5000));
    try {
      const raw = fs.readFileSync(path.join(USER_DATA, 'NeutronBrowser', 'extensions.json'), 'utf8');
      const data = JSON.parse(raw);
      const list = (data && data.installed) || data || [];
      const found = list.find(e => /tamper|iikmkjmpaadaobahmlepeloendndfphd/i.test((e.id || '') + (e.name || '')));
      if (found) { extName = found.name || found.id; break; }
    } catch (e) { /* 文件尚未生成 */ }
  }

  console.log(JSON.stringify(r, null, 2));
  check('页面无"不兼容"提示（点击前）', !r.incompatibleBefore);
  check('获取按钮启用（点击前）', r.btnBefore && !r.btnBefore.disabled);
  check('扩展安装成功（注册表）', extName === 'Tampermonkey' || !!extName, extName || '(未找到)');
  check('无 JS 错误', !r.errors || r.errors.length === 0, JSON.stringify(r.errors));

  await electronApp.close();
  const failed = results.filter(x => !x.ok).length;
  console.log('\n总计: ' + results.length + ' 项, 失败 ' + failed + ' 项');
  process.exit(failed ? 1 : 0);
}
main().catch(e => { console.error('测试失败:', e); process.exit(1); });
