/**
 * 拖放诊断日志
 * 真实系统拖放（资源管理器 → 浏览器窗口）疑难排查用：
 * 记录每个 dragenter/dragleave/dragover/drop 事件（含来源区域、文件名、时间），
 * 文件位置：%APPDATA%\neutron-browser\NeutronBrowser\drag-debug.log
 * 超过 1MB 自动截断（保留尾部）。
 */
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const MAX_SIZE = 1024 * 1024;

function logFile() {
  return path.join(app.getPath('userData'), 'NeutronBrowser', 'drag-debug.log');
}

/**
 * @param {string} source 'chrome' | 'page' | 'main' | 'overlay'
 * @param {string} event 'dragenter' | 'dragleave' | 'dragover' | 'drop' | 'install'
 * @param {Object} [extra]
 */
function logDrag(source, event, extra = {}) {
  try {
    const file = logFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    let line = `${new Date().toISOString()} [${source}] ${event}`;
    if (extra.url) line += ` url=${extra.url}`;
    if (extra.names) line += ` files=[${extra.names.join(', ')}]`;
    if (extra.types) line += ` types=[${extra.types.join(',')}]`;
    if (extra.path) line += ` path=${extra.path}`;
    if (extra.message) line += ` ${extra.message}`;
    line += '\n';

    if (fs.existsSync(file) && fs.statSync(file).size > MAX_SIZE) {
      // 截断：保留最后 64KB
      const fd = fs.openSync(file, 'r');
      const buf = Buffer.alloc(64 * 1024);
      const read = fs.readSync(fd, buf, 0, buf.length, Math.max(0, fs.fstatSync(fd).size - buf.length));
      fs.closeSync(fd);
      fs.writeFileSync(file, '[truncated]\n' + buf.subarray(0, read).toString('utf8').replace(/^[^\n]*\n/, ''));
    }
    fs.appendFileSync(file, line, 'utf8');
  } catch (e) { /* 诊断日志失败不影响主流程 */ }
}

module.exports = { logDrag, logFile };
