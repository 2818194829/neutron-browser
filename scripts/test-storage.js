/**
 * storage（SQLite）冒烟测试
 * 运行：先 npm run build:ts，再 node scripts/test-storage.js
 */
const os = require('os');
const path = require('path');
const fs = require('fs');
const assert = require('assert');

const st = require('../dist/main/storage/index.js');

function cleanup(dir) {
  try {
    // maxRetries/retryDelay 处理 Windows 上 SQLite 句柄释放的短暂延迟
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  } catch (e) { /* 清理失败不影响测试结论 */ }
}

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

(async () => {
  const tmp = path.join(os.tmpdir(), 'neutron-storage-test-' + Date.now());

  console.log('== 场景 1：全新初始化 + 默认值 ==');
  await st.initStorage(tmp);
  ok('settings 默认 theme', () => assert.strictEqual(st.getStore('settings').get('theme'), 'system'));
  ok('bookmarks 三个根（顺序稳定）', () => {
    const keys = Object.keys(st.getStore('bookmarks').getAll());
    assert.deepStrictEqual(keys, ['bookmark_bar', 'other', 'mobile']);
  });
  ok('dnrDynamic 默认 dynamic={}', () => {
    assert.deepStrictEqual(st.getStore('dnrDynamic').get('dynamic'), {});
  });

  console.log('== 场景 2：set/get/getAll/delete ==');
  ok('set + get 往返', () => {
    st.getStore('settings').set('theme', 'dark');
    assert.strictEqual(st.getStore('settings').get('theme'), 'dark');
  });
  ok('复杂对象往返', () => {
    st.getStore('history').set('visits', [{ id: 'h1', url: 'https://a.com', visitCount: 3 }]);
    const v = st.getStore('history').get('visits');
    assert.strictEqual(v[0].url, 'https://a.com');
    assert.strictEqual(v[0].visitCount, 3);
  });
  ok('getAll 返回全部键值', () => {
    const all = st.getStore('settings').getAll();
    assert.strictEqual(all.theme, 'dark');
    assert.strictEqual(all.accentColor, 'blue');
  });
  ok('delete', () => {
    st.getStore('settings').delete('theme');
    assert.strictEqual(st.getStore('settings').get('theme', 'MISSING'), 'MISSING');
  });
  // 恢复 theme，供场景 4 持久化校验
  st.getStore('settings').set('theme', 'dark');

  console.log('== 场景 3：旧 JSON 数据迁移（独立临时目录） ==');
  const tmp2 = path.join(os.tmpdir(), 'neutron-storage-migrate-' + Date.now());
  const dataDir2 = path.join(tmp2, 'NeutronBrowser');
  fs.mkdirSync(dataDir2, { recursive: true });
  fs.writeFileSync(path.join(dataDir2, 'bookmarks.json'), JSON.stringify({
    bookmark_bar: { id: 'bookmark_bar', title: '书签栏', type: 'folder', children: [
      { id: 'bm_1', title: 'GitHub', type: 'bookmark', url: 'https://github.com' },
    ] },
    other: { id: 'other', title: '其他书签', type: 'folder', children: [] },
    mobile: { id: 'mobile', title: '移动设备书签', type: 'folder', children: [] },
  }), 'utf-8');
  await st.initStorage(tmp2);
  ok('迁移后书签栏包含旧书签', () => {
    const bm = st.getStore('bookmarks').getAll();
    assert.strictEqual(bm.bookmark_bar.children[0].title, 'GitHub');
  });
  ok('迁移不覆盖默认键（other/mobile 仍在）', () => {
    const bm = st.getStore('bookmarks').getAll();
    assert.ok(bm.other && bm.mobile);
  });
  st.closeStorage();
  cleanup(tmp2);

  console.log('== 场景 4：重启后数据持久（回到 tmp） ==');
  st.closeStorage();
  await st.initStorage(tmp);
  ok('重启后 theme 保持 dark', () => {
    assert.strictEqual(st.getStore('settings').get('theme'), 'dark');
  });
  ok('重启后 history 仍存在', () => {
    assert.strictEqual(st.getStore('history').get('visits')[0].url, 'https://a.com');
  });

  st.closeStorage();
  cleanup(tmp);

  if (process.exitCode) {
    console.error('\n存在失败用例');
  } else {
    console.log(`\n全部通过（${passed} 项）`);
  }
})();
