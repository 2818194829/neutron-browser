/**
 * 从网站 HTML 中解析真实 favicon 链接（<link rel="icon">）
 * 用于书签对话框的「识别网址图标」（主进程抓取页面 HTML 后调用）。
 */

interface FoundIcon {
  url: string;
  size: number;
}

/**
 * 解析 HTML 中的图标链接
 * @param html 页面 HTML（可只传前 N KB）
 * @param baseUrl 页面完整 URL（用于相对路径与 <base> 解析）
 * @returns 最合适的图标绝对 URL；无则返回 ''
 */
export function parseFaviconFromHtml(html: string, baseUrl: string): string {
  if (!html || !baseUrl) return '';

  const found: FoundIcon[] = [];

  // <base href="..."> 支持
  const baseMatch = html.match(/<base\b[^>]*href\s*=\s*["']([^"']+)["']/i);
  const base = baseMatch ? baseMatch[1] : baseUrl;

  const linkRe = /<link\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html)) !== null) {
    const tag = m[0];
    const rel = (tag.match(/rel\s*=\s*["']([^"']*)["']/i) || [])[1] || '';
    if (!/\bicon\b/i.test(rel)) continue; // rel="icon" / rel="shortcut icon" / rel="apple-touch-icon"
    const href = (tag.match(/href\s*=\s*["']([^"']+)["']/i) || [])[1] || '';
    if (!href) continue;
    try {
      const abs = new URL(href, base).href;
      if (!/^https?:/i.test(abs)) continue;
      // 优先大尺寸（sizes="64x64"），其次优先 png/svg/webp，其次 ico
      const size = parseInt(((tag.match(/sizes\s*=\s*["']([0-9]+)x[0-9]+/i) || [])[1] || ''), 10) || 0;
      found.push({ url: abs, size });
    } catch (e) { /* 忽略非法 URL */ }
  }

  if (found.length === 0) return '';

  found.sort((a, b) => {
    if (a.size !== b.size) return b.size - a.size;
    const score = (u: string): number => (/\.(svg|png|webp)$/i.test(u) ? 2 : /\.ico$/i.test(u) ? 1 : 0);
    return score(b.url) - score(a.url);
  });
  return found[0].url;
}
