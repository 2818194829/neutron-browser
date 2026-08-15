(function (global) {
  'use strict';

  const GENERIC_TITLES = new Set([
    '',
    '新标签页',
    'New Tab',
    '设置',
    '历史记录',
    '下载内容',
    '书签管理器',
    '扩展程序',
  ]);
  const PUBLIC_SUFFIXES = [
    'com.cn',
    'net.cn',
    'org.cn',
    'edu.cn',
    'com',
    'net',
    'org',
    'cn',
    'io',
    'co',
    'dev',
    'app',
    'tv',
  ];

  function getHostname(value) {
    try {
      return new URL(value).hostname.toLowerCase();
    } catch (e) {
      return '';
    }
  }

  function getSiteKey(hostname) {
    const host = String(hostname || '').toLowerCase().replace(/^www\./, '');
    for (const suffix of PUBLIC_SUFFIXES) {
      if (host.endsWith('.' + suffix)) {
        return host.slice(0, host.length - suffix.length - 1).split('.').pop() + '.' + suffix;
      }
    }
    return host;
  }

  const FAVICON_CDN_HOSTS = {
    'bilibili.com': ['hdslb.com'],
    'douyin.com': ['douyinstatic.com', 'byteimg.com'],
    'youku.com': ['alicdn.com', 'ykimg.com'],
    'sciencedirect.com': ['elseviercdn.cn', 'elsevier.com'],
    'baidu.com': ['bdstatic.com'],
    'zhihu.com': ['zhimg.com'],
    'bilibili.tv': ['hdslb.com'],
    'doubao.com': ['doubaoimg.com', 'byteimg.com', 'bytedance.com'],
  };

  function isFaviconTrusted(faviconUrl, pageUrl) {
    try {
      const icon = new URL(faviconUrl);
      const page = new URL(pageUrl);
      if (icon.protocol !== 'http:' && icon.protocol !== 'https:') return false;

      const iconHost = icon.hostname.toLowerCase();
      const pageHost = page.hostname.toLowerCase();
      if (iconHost === pageHost) return true;
      if (iconHost.endsWith('.' + pageHost) || pageHost.endsWith('.' + iconHost)) return true;

      const siteKey = getSiteKey(pageHost);
      // 同注册域下的子域（如 lf-flow-web-cdn.doubao.com 之于 www.doubao.com）
      if (iconHost === siteKey || iconHost.endsWith('.' + siteKey)) return true;

      const cdnHosts = FAVICON_CDN_HOSTS[siteKey] || [];
      return cdnHosts.some((host) => iconHost === host || iconHost.endsWith('.' + host));
    } catch (e) {
      return false;
    }
  }

  function sanitizeFavicon(faviconUrl, pageUrl) {
    if (!faviconUrl || !pageUrl) return '';
    return isFaviconTrusted(faviconUrl, pageUrl) ? faviconUrl : '';
  }

  function normalizeHistoryTitle(title, url) {
    const value = String(title || '').trim();
    if (value && !GENERIC_TITLES.has(value)) return value;

    const host = getHostname(url);
    if (host) return host.replace(/^www\./, '');
    return value || String(url || '未知页面');
  }

  function sanitizeBookmarks(bookmarks) {
    const cleanFolder = (folder) => {
      if (!folder || !Array.isArray(folder.children)) return folder;
      folder.children.forEach((child) => {
        if (child.type === 'folder') {
          cleanFolder(child);
          return;
        }
        if (child.favicon && !isFaviconTrusted(child.favicon, child.url)) {
          child.favicon = '';
        }
      });
      return folder;
    };

    Object.keys(bookmarks || {}).forEach((key) => {
      cleanFolder(bookmarks[key]);
    });
    return bookmarks;
  }

  function sanitizeHistory(visits) {
    return (visits || [])
      .filter((item) => /^https?:/i.test(item.url || ''))
      .map((item) => {
        item.title = normalizeHistoryTitle(item.title, item.url);
        if (item.favicon && !isFaviconTrusted(item.favicon, item.url)) {
          item.favicon = '';
        }
        return item;
      });
  }

  const api = {
    getHostname,
    getSiteKey,
    isFaviconTrusted,
    sanitizeFavicon,
    normalizeHistoryTitle,
    sanitizeBookmarks,
    sanitizeHistory,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.SiteMeta = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
