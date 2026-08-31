// Root domains from the bing-search-cn skill. Matching includes subdomains.
const BLOCKED_ROOT_DOMAINS = new Set([
  "zhihu.com",
  "xiaohongshu.com",
  "xhs.com",
  "weibo.com",
  "weixin.qq.com",
  "douyin.com",
  "tiktok.com",
  "bilibili.com",
  "csdn.net",
]);

export function isUrlBlacklisted(url) {
  try {
    const { hostname } = new URL(url);
    const labels = hostname.toLowerCase();
    for (const domain of BLOCKED_ROOT_DOMAINS) {
      if (labels === domain || labels.endsWith(`.${domain}`)) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

export function blockedRootDomains() {
  return [...BLOCKED_ROOT_DOMAINS].sort();
}
