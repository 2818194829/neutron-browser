/**
 * 内置跟踪器拦截 冒烟测试
 * 运行：先 npm run build:ts，再 node scripts/test-tracking-protection.js
 */
const assert = require('assert');
const tp = require('../dist/main/trackingProtection.js');

let passed = 0;
function ok(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ✔', name);
  } catch (e) {
    console.error('  ✘', name, '\n   ', e.message);
    process.exitCode = 1;
  }
}

ok('精确域名命中', () => assert.strictEqual(tp.isTrackerUrl('https://doubleclick.net/ads'), true));
ok('子域名命中', () => assert.strictEqual(tp.isTrackerUrl('https://adservice.google.com/foo'), true));
ok('多级子域名命中', () => assert.strictEqual(tp.isTrackerUrl('https://a.b.google-analytics.com/g.js'), true));
ok('普通站点不命中', () => assert.strictEqual(tp.isTrackerUrl('https://example.com/x'), false));
ok('非 http 不命中', () => assert.strictEqual(tp.isTrackerUrl('file:///etc/passwd'), false));
ok('非法 URL 不命中', () => assert.strictEqual(tp.isTrackerUrl('not a url'), false));

ok('子资源命中 → cancel', () => {
  const r = tp.evaluateTrackingProtection({ url: 'https://google-analytics.com/ga.js', resourceType: 'script' });
  assert.deepStrictEqual(r, { cancel: true });
});
ok('普通子资源 → 放行', () => {
  const r = tp.evaluateTrackingProtection({ url: 'https://example.com/app.js', resourceType: 'script' });
  assert.deepStrictEqual(r, {});
});
ok('主框架导航 → 放行（不误伤用户主动访问）', () => {
  const r = tp.evaluateTrackingProtection({ url: 'https://doubleclick.net/', resourceType: 'mainFrame' });
  assert.deepStrictEqual(r, {});
});
ok('无 URL → 放行', () => {
  assert.deepStrictEqual(tp.evaluateTrackingProtection({}), {});
});

if (process.exitCode) {
  console.error('\n存在失败用例');
} else {
  console.log(`\n全部通过（${passed} 项）`);
}
