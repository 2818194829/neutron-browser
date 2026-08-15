/**
 * 验证：标签页右键菜单图标统一为 SVG
 * 1. 启动真实应用，创建多个标签页
 * 2. 在标签栏 dispatch contextmenu
 * 3. 检查菜单项图标是否全部为 <svg>（无字符/emoji 混用）
 * 4. 截图保存
 *
 * 运行：node scripts/test-tab-menu-e2e.js
 */
const path = require('path');
let playwright;
try { playwright = require('playwright-core'); }
catch (e) { playwright = require(path.join(process.env.APPDATA, 'npm', 'node_modules', 'playwright-core')); }
const { _electron } = playwright;
const APP_DIR = path.join(__dirname, '..');
const USER_DATA = path.join(APP_DIR, '.e2e-tmp-tabmenu');

async function main() {
  const electronApp = await _electron.launch({
    executablePath: path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe'),
    args: [APP_DIR, `--user-data-dir=${USER_DATA}`],
  });
  await new Promise(r => setTimeout(r, 2500));

  // 主进程创建 2 个标签页，让标签栏有可右键的 tab 元素
  await electronApp.evaluate(async () => {
    global.windowManager.createTab('https://example.com', true);
    global.windowManager.createTab('https://github.com', false);
  });
  await new Promise(r => setTimeout(r, 2500));

  // 找到主窗口 app.html
  let win = null;
  for (const w of electronApp.windows()) {
    if (w.url().includes('app.html')) { win = w; break; }
  }
  if (!win) throw new Error('找不到主窗口 app.html');

  // 在标签栏元素上触发 contextmenu
  const menuInfo = await win.evaluate(async () => {
    const tab = document.querySelector('.tab');
    if (!tab) return { error: '无标签元素' };
    const rect = tab.getBoundingClientRect();
    tab.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true,
      clientX: rect.left + 30, clientY: rect.top + 20,
    }));
    return { tabCount: document.querySelectorAll('.tab').length, ok: true };
  });
  await new Promise(r => setTimeout(r, 600));

  // 读取右键菜单内容
  const result = await win.evaluate(async () => {
    const menu = document.getElementById('contextMenu');
    const visible = menu && menu.style.display !== 'none';
    if (!menu) return { error: '无 contextMenu 元素' };
    const items = Array.from(menu.querySelectorAll('.context-menu__item'));
    const icons = items.map((el) => {
      const iconEl = el.querySelector('.context-menu__item-icon');
      const svg = iconEl ? iconEl.querySelector('svg') : null;
      return {
        label: (el.querySelector('.context-menu__item-label') || {}).textContent || '',
        hasIconSpan: !!iconEl,
        isSvg: !!svg,
        svgSize: svg ? (svg.getAttribute('width') + 'x' + svg.getAttribute('height')) : null,
        rawIcon: iconEl ? iconEl.innerHTML.slice(0, 60) : null,
      };
    });
    const separators = menu.querySelectorAll('.context-menu__separator').length;
    return { visible, itemCount: items.length, separators, icons };
  });

  console.log(JSON.stringify({ menuInfo, result }, null, 2));

  // 截图
  await win.screenshot({ path: path.join(APP_DIR, 'scripts', '_tab-menu.png') });
  console.log('截图已保存: scripts/_tab-menu.png');

  const ok = result && result.visible && result.icons.length > 0 &&
    result.icons.every((i) => i.isSvg && i.hasIconSpan);
  console.log(ok ? '\n✅ PASS：所有菜单项图标均为统一 SVG' : '\n❌ FAIL：图标未统一');

  await electronApp.close();
  process.exit(ok ? 0 : 1);
}
main().catch(e => { console.error('测试失败:', e); process.exit(1); });
