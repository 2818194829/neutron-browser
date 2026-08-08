/**
 * 验证码服务客户端（浏览器主进程）
 * 验证码的生成、存储、发送、校验全部由官网后端（verify-server）统一处理，
 * 浏览器只负责把请求转发到后端。站长在官网 /admin 管理页配置发送渠道，
 * 普通用户无需（也不可）在浏览器内配置。
 *
 * 后端地址来源：settings.json 的 verifyServerUrl（站长预置），默认 http://localhost:3000
 */
const http = require('http');
const https = require('https');
const { getStore } = require('./storage');

const DEFAULT_SERVER = 'http://localhost:3000';

/** 获取后端地址 */
function getServerUrl() {
  try {
    return (getStore('settings').get('verifyServerUrl') || '').trim() || DEFAULT_SERVER;
  } catch (e) {
    return DEFAULT_SERVER;
  }
}

/** 向后端发起 JSON POST 请求 */
function postJson(base, apiPath, body) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(base.replace(/\/+$/, '') + apiPath);
    } catch (e) {
      return reject(new Error('后端地址无效：' + base));
    }
    const lib = url.protocol === 'https:' ? https : http;
    const payload = JSON.stringify(body || {});
    const req = lib.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error('后端响应解析失败'));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(new Error('后端连接超时')); });
    req.write(payload);
    req.end();
  });
}

/**
 * 发送验证码（转发到后端，由后端真实发送到邮箱/手机）
 * @param {string} account 手机号或邮箱
 * @returns {Promise<{ok:boolean, account?:string, error?:string}>}
 */
async function sendVerifyCode(account) {
  try {
    return await postJson(getServerUrl(), '/api/verify/send', { account: String(account || '').trim() });
  } catch (e) {
    console.error('[Verify] 验证码服务不可用:', e && e.message);
    return { ok: false, error: '验证码服务不可用（' + (e && e.message || '未连接后端') + '），可使用本地模拟验证码' };
  }
}

/**
 * 校验验证码（转发到后端，校验通过后即作废）
 * @param {string} account 手机号或邮箱
 * @param {string} code 验证码
 * @returns {Promise<boolean>}
 */
async function checkVerifyCode(account, code) {
  try {
    const r = await postJson(getServerUrl(), '/api/verify/check', {
      account: String(account || '').trim(),
      code: String(code || '').trim(),
    });
    return !!(r && r.ok);
  } catch (e) {
    return false;
  }
}

module.exports = { sendVerifyCode, checkVerifyCode };
