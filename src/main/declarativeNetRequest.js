/**
 * declarativeNetRequest（DNR）规则引擎（对齐 Edge/Chrome MV3 广告拦截核心）
 *
 * 支持：静态规则集（manifest.declarative_net_request.rule_resources）+ 动态规则 + 会话规则。
 * 规则 action：block / allow / redirect / upgradeScheme / modifyHeaders。
 * 条件：urlFilter / regexFilter / resourceTypes / domains / requestDomains / domainType / excludedResourceTypes。
 *
 * 评估结果通过 extensionBridge 的 webRequest 处理器应用（cancel / redirectURL / 改头）。
 * 本实现为「实用子集」：覆盖常见广告拦截器（uBlock Lite / AdGuard MV3）的主要规则形态，
 * 不含 requestBody/responseHeaders 全部语义、优先级跨扩展 allow 全覆盖等高级特性。
 */
const { ipcMain, session } = require('electron');
const fs = require('fs');
const path = require('path');
const { IPC_CHANNELS } = require('../shared/constants');
const { getStore } = require('./storage');

// extId -> { dynamic: Map(id->rule), session: Map(id->rule), enabledRulesetIds: Set, staticLoaded: bool, static: Rule[] }
const stateMap = new Map();

function getState(extId) {
  let s = stateMap.get(extId);
  if (!s) {
    s = { dynamic: new Map(), session: new Map(), enabledRulesetIds: new Set(), static: [], staticLoaded: false };
    stateMap.set(extId, s);
  }
  return s;
}

function readManifest(ext) {
  try {
    if (!ext || !ext.path) return {};
    return JSON.parse(fs.readFileSync(path.join(ext.path, 'manifest.json'), 'utf8'));
  } catch (e) {
    return {};
  }
}

/** 加载 manifest 声明的静态规则集（含默认启用与 updateEnabledRulesets 覆盖） */
function ensureStaticRules(extId) {
  const s = getState(extId);
  if (s.staticLoaded) return s.static;
  s.staticLoaded = true;
  try {
    const { getInstalledExtensions } = require('./extensions');
    const ext = getInstalledExtensions().find((e) => e.id === extId);
    if (!ext) return s.static;
    const manifest = readManifest(ext);
    const dnr = manifest.declarative_net_request;
    if (!dnr) return s.static;
    const resources = Array.isArray(dnr.rule_resources) ? dnr.rule_resources : [];
    const persisted = getStore('dnrDynamic').get('enabledRulesets', {}) || {};
    const enabledByPersist = persisted[extId];
    const enabledIds = enabledByPersist
      ? new Set(enabledByPersist)
      : new Set(resources.filter((r) => r.enabled !== false).map((r) => r.id));
    s.enabledRulesetIds = enabledIds;
    for (const res of resources) {
      if (!enabledIds.has(res.id)) continue;
      const file = path.join(ext.path, String(res.path || '').replace(/^[/\\]+/, ''));
      if (!fs.existsSync(file)) continue;
      try {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        const rules = Array.isArray(parsed) ? parsed : (parsed.rules || []);
        s.static.push(...rules.filter((r) => r && r.condition));
      } catch (e) { /* 忽略损坏规则文件 */ }
    }
  } catch (e) { /* 忽略 */ }
  return s.static;
}

function clearStaticCache(extId) {
  const s = stateMap.get(extId);
  if (s) s.staticLoaded = false;
}

function collectAllRules() {
  const out = [];
  try {
    const { getInstalledExtensions } = require('./extensions');
    for (const ext of getInstalledExtensions().filter((e) => e.enabled)) {
      const s = getState(ext.id);
      for (const rule of ensureStaticRules(ext.id)) out.push({ extId: ext.id, rule });
      for (const rule of s.dynamic.values()) out.push({ extId: ext.id, rule });
      for (const rule of s.session.values()) out.push({ extId: ext.id, rule });
    }
  } catch (e) { /* 忽略 */ }
  return out;
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** urlFilter → RegExp（支持 * 通配、|| 域名锚、| 起止锚、^ 分隔符） */
function urlFilterToRegExp(filter, caseSensitive) {
  const f = String(filter || '');
  let pattern = '';
  let i = 0;
  const len = f.length;
  if (f.startsWith('||')) {
    pattern += '^(?:[a-z][a-z0-9+.-]*:)?\\/\\/(?:[^\\/]*\\.)?';
    i = 2;
  } else if (f.startsWith('|')) {
    pattern += '^';
    i = 1;
  }
  const endAnchor = f.endsWith('|') && len > i;
  const body = f.slice(i, endAnchor ? len - 1 : len);
  for (let j = 0; j < body.length; j++) {
    const ch = body[j];
    if (ch === '*') pattern += '.*';
    else if (ch === '^') pattern += '[^a-zA-Z0-9_.%-]';
    else pattern += escapeRegExp(ch);
  }
  if (endAnchor) pattern += '$';
  return new RegExp(pattern, caseSensitive ? '' : 'i');
}

function toDnrResourceType(rt) {
  const map = {
    mainFrame: 'main_frame', subFrame: 'sub_frame', stylesheet: 'stylesheet',
    script: 'script', image: 'image', font: 'font', object: 'object',
    xhr: 'xmlhttprequest', ping: 'ping', cspReport: 'csp_report',
    media: 'media', webSocket: 'websocket', other: 'other',
  };
  return map[rt] || 'other';
}

function isSubdomainOrSame(host, domain) {
  return host === domain || host.endsWith('.' + domain);
}

function matchesDomainList(host, list) {
  return list.some((d) => {
    const dom = String(d).replace(/^\*\./, '');
    return isSubdomainOrSame(host, dom);
  });
}

function matchRule(rule, ctx) {
  const cond = rule.condition || {};
  // 资源类型
  if (Array.isArray(cond.resourceTypes) && cond.resourceTypes.length > 0 &&
      !cond.resourceTypes.includes(ctx.resourceType)) return false;
  if (Array.isArray(cond.excludedResourceTypes) && cond.excludedResourceTypes.includes(ctx.resourceType)) return false;
  // 目标域名
  if (Array.isArray(cond.domains) && cond.domains.length > 0 &&
      !matchesDomainList(ctx.host, cond.domains)) return false;
  if (Array.isArray(cond.excludedDomains) && matchesDomainList(ctx.host, cond.excludedDomains)) return false;
  // 请求来源域名
  if (Array.isArray(cond.requestDomains) && cond.requestDomains.length > 0) {
    if (!ctx.initiator || !matchesDomainList(ctx.initiator, cond.requestDomains)) return false;
  }
  if (Array.isArray(cond.excludedRequestDomains) && ctx.initiator &&
      matchesDomainList(ctx.initiator, cond.excludedRequestDomains)) return false;
  // 第一方/第三方
  if (cond.domainType && ctx.initiator && ctx.host) {
    const firstParty = isSubdomainOrSame(ctx.host, ctx.initiator) || isSubdomainOrSame(ctx.initiator, ctx.host);
    if (cond.domainType === 'firstParty' && !firstParty) return false;
    if (cond.domainType === 'thirdParty' && firstParty) return false;
  }
  // URL 匹配
  if (cond.regexFilter) {
    try {
      if (!new RegExp(cond.regexFilter).test(ctx.url)) return false;
    } catch (e) { return false; }
  } else if (cond.urlFilter !== undefined) {
    try {
      if (!urlFilterToRegExp(cond.urlFilter, !!cond.isUrlFilterCaseSensitive).test(ctx.url)) return false;
    } catch (e) { return false; }
  }
  return true;
}

function applyHeaderOperations(headersObj, operations) {
  // headersObj: Electron 对象 {name: value}；operations: [{header, operation, value}]
  if (!Array.isArray(operations) || operations.length === 0) return headersObj;
  const out = { ...(headersObj || {}) };
  const lower = {};
  Object.keys(out).forEach((k) => { lower[k.toLowerCase()] = k; });
  for (const op of operations) {
    const name = String(op.header || '');
    const lname = name.toLowerCase();
    if (op.operation === 'remove') {
      const orig = lower[lname];
      if (orig) delete out[orig];
    } else if (op.operation === 'set' || op.operation === 'append') {
      const orig = lower[lname];
      const targetKey = orig || name;
      if (op.operation === 'append' && out[targetKey]) {
        out[targetKey] = out[targetKey] + ', ' + String(op.value || '');
      } else {
        out[targetKey] = String(op.value || '');
        lower[lname] = targetKey;
      }
    }
  }
  return out;
}

/** 评估所有已启用扩展的 DNR 规则，返回 Electron webRequest 回调可用的部分响应 */
function evaluateAllDnr(evt, details) {
  const result = {};
  try {
    const url = details.url || '';
    let host = '';
    try { host = new URL(url).hostname; } catch (e) { /* 忽略 */ }
    let initiator = '';
    try { initiator = new URL(details.referrer || '').hostname; } catch (e) { /* 忽略 */ }
    const ctx = { url, host, initiator, resourceType: toDnrResourceType(details.resourceType) };

    const matched = collectAllRules().filter((r) => matchRule(r.rule, ctx));
    if (matched.length === 0) return result;

    const maxPriority = Math.max(...matched.map((r) => r.rule.priority || 1));
    const top = matched.filter((r) => (r.rule.priority || 1) === maxPriority);

    // allow 优先于同优先级其它 action
    if (top.some((r) => (r.rule.action && r.rule.action.type === 'allow'))) return result;

    const rule = top[0].rule;
    const action = rule.action || {};
    switch (action.type) {
      case 'block':
        result.cancel = true;
        break;
      case 'redirect': {
        const rd = action.redirect || {};
        if (rd.url) {
          result.redirectURL = rd.url;
        } else if (rd.regexSubstitution && rule.condition.regexFilter) {
          try {
            const re = new RegExp(rule.condition.regexFilter);
            result.redirectURL = url.replace(re, rd.regexSubstitution);
          } catch (e) { /* 忽略 */ }
        }
        break;
      }
      case 'upgradeScheme':
        if (url.startsWith('http:')) result.redirectURL = url.replace(/^http:/, 'https:');
        break;
      case 'modifyHeaders': {
        if (evt === 'onHeadersReceived') {
          const src = details.responseHeaders;
          if (src) {
            const ops = (action.responseHeaders || []).map((h) => ({ header: h.header, operation: h.operation, value: h.value }));
            result.responseHeaders = applyHeaderOperations(src, ops);
          }
        } else {
          const src = details.requestHeaders;
          if (src) {
            const ops = (action.requestHeaders || []).map((h) => ({ header: h.header, operation: h.operation, value: h.value }));
            result.requestHeaders = applyHeaderOperations(src, ops);
          }
        }
        break;
      }
      default:
        break;
    }
  } catch (e) { /* 忽略 */ }
  return result;
}

// ==================== IPC（chrome.declarativeNetRequest API） ====================

function dnrRuleToChrome(rule) {
  return JSON.parse(JSON.stringify(rule)); // 深拷贝，避免扩展侧篡改内部状态
}

function registerDnrIpc() {
  ipcMain.handle(IPC_CHANNELS.EXT_DNR, async (event, { id, method, args }) => {
    try {
      const s = getState(id);
      switch (method) {
        case 'updateDynamicRules': {
          const opts = args[0] || {};
          const removeIds = Array.isArray(opts.removeRuleIds) ? opts.removeRuleIds : [];
          removeIds.forEach((rid) => s.dynamic.delete(rid));
          const addRules = Array.isArray(opts.addRules) ? opts.addRules : [];
          addRules.forEach((r) => { if (r && r.id !== undefined) s.dynamic.set(r.id, dnrRuleToChrome(r)); });
          persistDynamic(id, s);
          return undefined;
        }
        case 'getDynamicRules':
          return Array.from(s.dynamic.values()).map(dnrRuleToChrome);
        case 'updateSessionRules': {
          const opts = args[0] || {};
          const removeIds = Array.isArray(opts.removeRuleIds) ? opts.removeRuleIds : [];
          removeIds.forEach((rid) => s.session.delete(rid));
          const addRules = Array.isArray(opts.addRules) ? opts.addRules : [];
          addRules.forEach((r) => { if (r && r.id !== undefined) s.session.set(r.id, dnrRuleToChrome(r)); });
          return undefined;
        }
        case 'getSessionRules':
          return Array.from(s.session.values()).map(dnrRuleToChrome);
        case 'getAvailableStaticRuleCount':
          return 30000;
        case 'getEnabledRulesets': {
          ensureStaticRules(id);
          return Array.from(s.enabledRulesetIds);
        }
        case 'updateEnabledRulesets': {
          const opts = args[0] || {};
          const enable = Array.isArray(opts.enableRulesetIds) ? opts.enableRulesetIds : [];
          const disable = Array.isArray(opts.disableRulesetIds) ? opts.disableRulesetIds : [];
          ensureStaticRules(id);
          enable.forEach((rid) => s.enabledRulesetIds.add(rid));
          disable.forEach((rid) => s.enabledRulesetIds.delete(rid));
          clearStaticCache(id);
          persistEnabledRulesets(id, Array.from(s.enabledRulesetIds));
          return undefined;
        }
        default:
          return undefined;
      }
    } catch (e) {
      return undefined;
    }
  });
}

function persistDynamic(extId, s) {
  try {
    const store = getStore('dnrDynamic');
    const data = store.get('dynamic', {}) || {};
    const obj = {};
    s.dynamic.forEach((v, k) => { obj[k] = v; });
    data[extId] = obj;
    store.set('dynamic', data);
  } catch (e) { /* 忽略 */ }
}

function persistEnabledRulesets(extId, ids) {
  try {
    const store = getStore('dnrDynamic');
    const data = store.get('enabledRulesets', {}) || {};
    data[extId] = ids;
    store.set('enabledRulesets', data);
  } catch (e) { /* 忽略 */ }
}

/** 禁用/卸载扩展时清理其 DNR 状态 */
function clearDnrForExt(extId) {
  const s = stateMap.get(extId);
  if (s) {
    s.dynamic.clear();
    s.session.clear();
    s.static = [];
    s.staticLoaded = false;
    s.enabledRulesetIds.clear();
  }
}

module.exports = {
  registerDnrIpc,
  evaluateAllDnr,
  clearDnrForExt,
};
