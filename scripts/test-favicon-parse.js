/**
 * 单元测试：parseFaviconFromHtml（从网站 HTML 解析真实 <link rel="icon">）
 * 运行：node scripts/test-favicon-parse.js
 */
const { parseFaviconFromHtml } = require('../src/shared/faviconHtml');

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok });
  console.log((ok ? '✅' : '❌') + ' ' + name + (detail ? ' — ' + detail : ''));
}

const BASE = 'https://www.doubao.com/chat/?channel=xiazais';

// 1. 标准 rel="icon" + 绝对路径
check('标准 icon 链接', parseFaviconFromHtml(
  '<link rel="icon" href="https://lf-flow-web-cdn.doubao.com/logo.png">',
  BASE
) === 'https://lf-flow-web-cdn.doubao.com/logo.png');

// 2. rel="shortcut icon" + 相对路径（相对页面 URL）
check('shortcut icon + 相对路径', parseFaviconFromHtml(
  '<link rel="shortcut icon" href="/favicon.ico">',
  BASE
) === 'https://www.doubao.com/favicon.ico');

// 3. 多个 icon：优先大尺寸
check('多图标优先大尺寸', parseFaviconFromHtml(
  '<link rel="icon" sizes="16x16" href="/a16.png"><link rel="icon" sizes="64x64" href="/a64.png">',
  BASE
) === 'https://www.doubao.com/a64.png');

// 4. 同尺寸优先 png 而非 ico
check('同尺寸优先 png', parseFaviconFromHtml(
  '<link rel="icon" href="/favicon.ico"><link rel="icon" href="/icon.png">',
  BASE
) === 'https://www.doubao.com/icon.png');

// 5. <base href> 支持
check('<base> 标签支持', parseFaviconFromHtml(
  '<base href="https://cdn.doubao.com/"><link rel="icon" href="icon.png">',
  BASE
) === 'https://cdn.doubao.com/icon.png');

// 6. 无图标链接 → 空
check('无图标链接返回空', parseFaviconFromHtml('<html><body>hello</body></html>', BASE) === '');

// 7. rel="apple-touch-icon" 也算
check('apple-touch-icon', parseFaviconFromHtml(
  '<link rel="apple-touch-icon" href="/touch.png">',
  BASE
) === 'https://www.doubao.com/touch.png');

// 8. 非 http(s) 协议被过滤（data:/javascript:）
check('data: URL 被过滤', parseFaviconFromHtml(
  '<link rel="icon" href="data:image/png;base64,AAAA">',
  BASE
) === '');

// 9. 单引号属性
check('单引号属性', parseFaviconFromHtml(
  "<link rel='icon' href='/f.png'>",
  BASE
) === 'https://www.doubao.com/f.png');

// 10. 非法输入不抛错
let noThrow = true;
try { parseFaviconFromHtml('', ''); parseFaviconFromHtml(null, null); } catch (e) { noThrow = false; }
check('非法输入不抛错', noThrow);

const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `\n❌ FAIL ${failed.length} 项` : '\n✅ ALL PASS');
process.exit(failed.length ? 1 : 0);
