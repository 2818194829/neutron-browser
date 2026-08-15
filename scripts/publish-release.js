/**
 * 发布 Neutron Browser 到 GitHub Releases（中文 body + 上传 exe/latest.yml）
 * 用法：node scripts/publish-release.js [版本号，默认取 package.json]
 *
 * 关键经验（本仓库已验证）：
 * - gh CLI 未安装，token 从 `git credential fill` 获取（gho_ 前缀）
 * - 所有带 body 的请求必须显式带 Content-Length（uploads.github.com 拒绝 chunked）
 * - body 直接发 UTF-8 字节（中文正常）；禁止在脚本里内插特殊符号（→/emoji 会损坏）
 * - asset 名必须与 latest.yml 的 url 一致（连字符 Neutron-Browser-Setup-X.Y.Z.exe）
 * - 重复上传同 asset 会 422 already_exists（无害），release 已存在时自动复用其 id
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const https = require('https');
const path = require('path');

const REPO_DIR = path.join(__dirname, '..');
const OWNER = '2818194829';
const REPO = 'neutron-browser';
const VERSION = process.argv[2] || require(path.join(REPO_DIR, 'package.json')).version;
const TAG = 'v' + VERSION;

function getToken() {
  const out = execFileSync('git', ['credential', 'fill'], {
    cwd: REPO_DIR,
    input: 'protocol=https\nhost=github.com\n\n',
    encoding: 'utf8',
  });
  for (const line of out.split(/\r?\n/)) {
    if (line.startsWith('password=')) return line.slice('password='.length).trim();
  }
  throw new Error('无法从 git credential fill 获取 token');
}

function request(method, url, { headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      {
        host: u.host,
        path: u.pathname + u.search,
        method,
        headers: {
          'User-Agent': 'neutron-browser-release-script',
          Accept: 'application/vnd.github+json',
          ...headers,
        },
      },
      (res) => {
        res.setEncoding('utf8');
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode, data }));
      }
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function api(method, url, headers, body) {
  const buf = body == null ? null : Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
  return request(method, url, {
    headers: buf == null ? headers : { ...headers, 'Content-Length': buf.length },
    body: buf,
  }).then((r) => {
    if (r.status < 200 || r.status >= 300) {
      throw new Error(`${method} ${url} -> ${r.status}: ${r.data.slice(0, 500)}`);
    }
    return r;
  });
}

async function main() {
  const token = getToken();
  const auth = { Authorization: 'token ' + token };

  const notesFile = path.join(REPO_DIR, `RELEASE_NOTES_${VERSION}.md`);
  const bodyText = fs.readFileSync(notesFile, 'utf8');
  const payload = JSON.stringify({
    tag_name: TAG,
    name: TAG,
    body: bodyText,
    draft: false,
    prerelease: false,
  });

  // 创建 release；若 tag 已有 release（重复运行）则复用其 id
  let release;
  const created = await api(
    'POST',
    `https://api.github.com/repos/${OWNER}/${REPO}/releases`,
    { ...auth, 'Content-Type': 'application/json; charset=utf-8' },
    payload
  ).catch(async (e) => {
    if (String(e.message).includes('422')) {
      const got = await api('GET', `https://api.github.com/repos/${OWNER}/${REPO}/releases/tags/${TAG}`, auth);
      console.log('release already exists, reuse it');
      return got;
    }
    throw e;
  });
  release = JSON.parse(created.data);
  console.log('release id:', release.id, 'url:', release.html_url);

  const assets = [
    { uploadName: `Neutron-Browser-Setup-${VERSION}.exe`, file: path.join(REPO_DIR, 'build', `Neutron Browser Setup ${VERSION}.exe`) },
    { uploadName: 'latest.yml', file: path.join(REPO_DIR, 'build', 'latest.yml') },
  ];
  for (const { uploadName, file } of assets) {
    const buf = fs.readFileSync(file);
    console.log('uploading', uploadName, buf.length, 'bytes ...');
    await api(
      'POST',
      `https://uploads.github.com/repos/${OWNER}/${REPO}/releases/${release.id}/assets?name=${encodeURIComponent(uploadName)}`,
      { ...auth, 'Content-Type': 'application/octet-stream' },
      buf
    ).catch(async (e) => {
      if (String(e.message).includes('422')) {
        console.log('asset already exists, skip:', uploadName);
        return { status: 200, data: '{}' };
      }
      throw e;
    });
    console.log('uploaded:', uploadName);
  }

  // 验证：中文 body 无转义字面量、无替换字符，assets 齐全
  const verify = await api('GET', `https://api.github.com/repos/${OWNER}/${REPO}/releases/tags/${TAG}`, auth);
  const rel = JSON.parse(verify.data);
  console.log('VERIFY assets:', rel.assets.map((a) => `${a.name}(${a.size})`).join(' | '));
  const okBody =
    rel.body.includes('\u5b89\u88c5\u5411\u5bfc') &&
    !/\\u[0-9a-f]{4}/.test(rel.body) &&
    !rel.body.includes('\uFFFD');
  console.log('VERIFY body chinese ok:', okBody);
  console.log('VERIFY draft:', rel.draft, 'prerelease:', rel.prerelease);
  console.log('DONE', rel.html_url);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
