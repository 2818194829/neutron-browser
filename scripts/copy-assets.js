/**
 * 构建辅助：把 src 下除 .ts 之外的所有资源文件（.js/.html/.css/.json/图片等）
 * 原样复制到 dist，配合 tsc（只编译 .ts）生成完整可运行的 dist 目录。
 * 运行：node scripts/copy-assets.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');

const SKIP_EXT = new Set(['.ts', '.tsx']);

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
      continue;
    }
    if (SKIP_EXT.has(path.extname(entry.name))) continue;
    const rel = path.relative(SRC, full);
    const dest = path.join(DIST, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(full, dest);
  }
}

fs.rmSync(DIST, { recursive: true, force: true });
walk(SRC);
console.log('[copy-assets] 资源文件已复制到 dist');
