/**
 * parseArchiveBuffer CRX/zip 解析单元测试（纯 Node，不依赖 Electron 运行时）
 * 验证 CRX2 老格式解析修复（v1.10.x 曾把偏移 8 当 header 长度，CRX2 实际是公钥长度）
 */
const assert = require('assert');
const AdmZip = require('adm-zip');
const { parseArchiveBuffer } = require('../src/main/extensions');

function writeU32LE(buf, offset, value) {
  buf.writeUInt32LE(value >>> 0, offset);
}

function buildCrx2(zipBytes) {
  const pubkey = Buffer.from('PUBKEY0123456789');
  const sig = Buffer.from('SIG0123456789012345');
  const header = Buffer.alloc(16);
  header.write('Cr24', 0, 'latin1');
  writeU32LE(header, 4, 2);            // 版本 2
  writeU32LE(header, 8, pubkey.length); // 公钥长度
  writeU32LE(header, 12, sig.length);   // 签名长度
  return Buffer.concat([header, pubkey, sig, zipBytes]);
}

function buildCrx3(zipBytes) {
  const crxHeader = Buffer.from('CRX3-HEADER-PLACEHOLDER');
  const header = Buffer.alloc(12);
  header.write('Cr24', 0, 'latin1');
  writeU32LE(header, 4, 3);              // 版本 3
  writeU32LE(header, 8, crxHeader.length); // 头长度
  return Buffer.concat([header, crxHeader, zipBytes]);
}

/** 构造一个真正的 zip 包（含 manifest.json），验证解析结果可被 AdmZip 解压 */
function buildRealZip() {
  const zip = new AdmZip();
  zip.addFile('manifest.json', Buffer.from(
    JSON.stringify({ manifest_version: 3, name: 'Test Ext', version: '1.0.0' }),
    'utf8'
  ));
  return zip.toBuffer();
}

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('PASS', name);
}

test('CRX3：zip 起点 = 12 + headerSize', () => {
  const zipBytes = Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.from('fake-zip-content')]);
  const out = parseArchiveBuffer(buildCrx3(zipBytes));
  assert.strictEqual(Buffer.compare(out, zipBytes), 0);
});

test('CRX2：zip 起点 = 16 + pubkeyLen + sigLen（老格式修复）', () => {
  const zipBytes = Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.from('fake-zip-content')]);
  const out = parseArchiveBuffer(buildCrx2(zipBytes));
  assert.strictEqual(Buffer.compare(out, zipBytes), 0);
});

test('普通 zip（PK 魔数）原样返回', () => {
  const zipBytes = Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.from('hello')]);
  const out = parseArchiveBuffer(zipBytes);
  assert.strictEqual(Buffer.compare(out, zipBytes), 0);
});

test('非法文件抛错', () => {
  assert.throws(() => parseArchiveBuffer(Buffer.from('NOT-A-VALID-PACKAGE')));
});

test('CRX 头损坏（zip 起点越界）抛错', () => {
  const buf = Buffer.alloc(12);
  buf.write('Cr24', 0, 'latin1');
  writeU32LE(buf, 4, 2);
  writeU32LE(buf, 8, 999999);
  assert.throws(() => parseArchiveBuffer(buf));
});

test('真实 zip 可被 AdmZip 解压出 manifest.json（CRX2/CRX3 头剥离后内容完整）', () => {
  const zipBytes = buildRealZip();
  for (const wrapped of [buildCrx2(zipBytes), buildCrx3(zipBytes)]) {
    const out = parseArchiveBuffer(wrapped);
    const zip = new AdmZip(out);
    const entry = zip.getEntry('manifest.json');
    assert.ok(entry, 'manifest.json 应存在');
    const manifest = JSON.parse(entry.getData().toString('utf8'));
    assert.strictEqual(manifest.name, 'Test Ext');
  }
});

console.log(`\n全部通过：${passed}/6`);
