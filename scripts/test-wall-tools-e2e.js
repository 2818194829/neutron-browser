/**
 * 端到端验证：新标签页壁纸操作三按钮
 * 1. 切换壁纸（每日一图 seed 变化 → 背景图变化）
 * 2. 固定壁纸（按钮激活态 + localStorage pinned + 固定后 seed 不变）
 * 3. 保存壁纸（customWallpaper 被保存）
 * 4. 无 JS 错误
 *
 * 运行：node scripts/test-wall-tools-e2e.js
 */
const path = require('path');
let playwright;
try { playwright = require('playwright-core'); }
catch (e) { playwright = require(path.join(process.env.APPDATA, 'npm', 'node_modules', 'playwright-core')); }
const { _electron } = playwright;
const APP_DIR = path.join(__dirname, '..');
const USER_DATA = path.join(APP_DIR, '.e2e-tmp-walltools');

const results = [];
function check(name, ok, detail) { results.push({ name, ok, detail }); console.log((ok ? '✅' : '❌') + ' ' + name + (detail ? ' — ' + detail : '')); }

async function main() {
  const electronApp = await _electron.launch({
    executablePath: path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe'),
    args: [APP_DIR, `--user-data-dir=${USER_DATA}`],
  });
  await new Promise(r => setTimeout(r, 2500));
  await electronApp.evaluate(async () => { global.windowManager.createTab('neutron://newtab', true); });
  await new Promise(r => setTimeout(r, 3000));

  const r = await electronApp.evaluate(async () => {
    const tab = global.windowManager.tabs.find(t => t.url && t.url.includes('newtab.html'));
    if (!tab || !tab.view) return { error: 'tab not found' };
    const wc = tab.view.webContents;
    const errors = [];
    try { wc.on('console-message', (e, level, message) => { if (level >= 3) errors.push(String(message)); }); } catch (e) {}

    // 等待初始化完成
    let ready = false;
    for (let k = 0; k < 40; k++) {
      try {
        const s = String(await wc.executeJavaScript(
          `document.readyState + '|' + document.body.getAttribute('data-wallpaper') + '|' + document.querySelectorAll('.sc-item').length`
        ));
        const p = s.split('|');
        if (p[0] === 'complete' && p[1] === 'image' && +p[2] > 0) { ready = true; break; }
      } catch (e) {}
      await new Promise(r => setTimeout(r, 300));
    }
    if (!ready) return { error: '页面未初始化完成' };

    const g = async (code) => { try { return await wc.executeJavaScript(code); } catch (e) { return 'ERR:' + e.message; } };
    const click = (id) => wc.executeJavaScript(`document.getElementById('${id}').click(); true;`);
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    const out = {};
    out.buttons = {
      next: await g('!!document.getElementById("btnWallNext")'),
      pin: await g('!!document.getElementById("btnWallPin")'),
      save: await g('!!document.getElementById("btnWallSave")'),
    };
    out.initialBg = await g(`(document.getElementById('bgImage').style.backgroundImage || '').slice(0, 120)`);

    // 1. 切换壁纸
    await click('btnWallNext'); await sleep(300);
    out.afterNextBg = await g(`(document.getElementById('bgImage').style.backgroundImage || '').slice(0, 120)`);

    // 2. 固定壁纸
    await click('btnWallPin'); await sleep(300);
    out.pinActive = await g('document.getElementById("btnWallPin").classList.contains("is-active")');
    out.pinTitle = await g('document.getElementById("btnWallPin").title');
    out.pinnedStore = await g('(function(){ var d=JSON.parse(localStorage.getItem("tabspace_v1")||"{}"); return JSON.stringify(d.pinned||null); })()');
    out.bgAfterPin = await g(`(document.getElementById('bgImage').style.backgroundImage || '').slice(0, 120)`);

    // 3. 保存壁纸
    await click('btnWallSave'); await sleep(300);
    out.savedStore = await g('(function(){ var d=JSON.parse(localStorage.getItem("tabspace_v1")||"{}"); return JSON.stringify(d.customWallpaper||""); })()');

    // 4. 取消固定
    await click('btnWallPin'); await sleep(300);
    out.pinAfterUnpin = await g('document.getElementById("btnWallPin").classList.contains("is-active")');
    out.unpinnedStore = await g('(function(){ var d=JSON.parse(localStorage.getItem("tabspace_v1")||"{}"); return JSON.stringify(d.pinned||null); })()');

    out.errors = errors;
    return out;
  });

  console.log(JSON.stringify(r, null, 2));

  if (r.error) { check('页面初始化', false, r.error); }
  else {
    check('三个按钮存在', r.buttons.next && r.buttons.pin && r.buttons.save, JSON.stringify(r.buttons));
    check('切换壁纸生效', r.initialBg && r.afterNextBg && r.initialBg !== r.afterNextBg, 'seed 已变化');
    check('固定壁纸激活态', r.pinActive, 'title=' + r.pinTitle);
    check('固定写入存储', r.pinnedStore && r.pinnedStore !== 'null', r.pinnedStore);
    check('固定后背景保留', r.bgAfterPin === r.afterNextBg, '固定图未变');
    check('保存壁纸写入', !!r.savedStore && r.savedStore.length > 10, 'customWallpaper 已保存');
    check('取消固定恢复', !r.pinAfterUnpin && r.unpinnedStore === 'null', '已清除');
    check('无 JS 错误', !r.errors || r.errors.length === 0, JSON.stringify(r.errors));
  }

  await electronApp.close();
  const failed = results.filter(x => !x.ok).length;
  console.log('\n总计: ' + results.length + ' 项, 失败 ' + failed + ' 项');
  process.exit(failed ? 1 : 0);
}
main().catch(e => { console.error('测试失败:', e); process.exit(1); });
