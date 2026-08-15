/**
 * 内置跟踪器拦截（隐私保护）
 * 复用 webRequest 拦截：屏蔽常见广告/分析/追踪器域名。
 * 仅拦截子资源请求（脚本/图片/XHR 等），不拦截主框架导航，避免误伤用户主动访问。
 *
 * 规则为「实用子集」：内置一份常见追踪器域名列表，后续可扩展为读取
 * EasyList 格式的规则文件或接入 DNR 规则集。
 */
const TRACKER_DOMAINS = new Set([
  // 广告网络 / 广告交换
  'doubleclick.net',
  'googlesyndication.com',
  'adservice.google.com',
  'adnxs.com',
  'criteo.com',
  'criteo.net',
  'rubiconproject.com',
  'pubmatic.com',
  'openx.net',
  'sovrn.com',
  'sharethrough.com',
  'taboola.com',
  'outbrain.com',
  'revcontent.com',
  'moatads.com',
  'adform.net',
  'adroll.com',
  'casalemedia.com',
  'bidswitch.net',
  'yieldmo.com',
  'simpli.fi',
  'media.net',
  'amazon-adsystem.com',
  // 分析 / 行为追踪
  'google-analytics.com',
  'googletagmanager.com',
  'googletagservices.com',
  'facebook.net',
  'hotjar.com',
  'mixpanel.com',
  'segment.io',
  'segment.com',
  'clarity.ms',
  'fullstory.com',
  'crazyegg.com',
  'mouseflow.com',
  'quantcount.com',
  'scorecardresearch.com',
  'chartbeat.com',
  'matomo.cloud',
  'plausible.io',
  'fathomdns.com',
  'newrelic.com',
  'amplitude.com',
  'heap.io',
]);

/** 判断 URL 是否命中跟踪器域名（精确匹配或子域匹配） */
function isTrackerUrl(url) {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    for (const domain of TRACKER_DOMAINS) {
      if (host === domain || host.endsWith('.' + domain)) return true;
    }
    return false;
  } catch (e) {
    return false;
  }
}

/**
 * 评估跟踪器拦截：命中且非主框架请求时返回 { cancel: true }。
 * @param {{url:string, resourceType?:string}} details Electron webRequest details
 */
function evaluateTrackingProtection(details) {
  if (!details || !details.url) return {};
  // 仅拦截子资源，放行主框架导航（用户主动访问跟踪器主页时不做拦截）
  if (details.resourceType === 'mainFrame') return {};
  return isTrackerUrl(details.url) ? { cancel: true } : {};
}

module.exports = { evaluateTrackingProtection, isTrackerUrl, TRACKER_DOMAINS };
