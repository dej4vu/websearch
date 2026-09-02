import * as cheerio from "cheerio";
import { randomUUID } from "node:crypto";
import { request, createDispatcher } from "./http.js";
import { mergeCookies } from "./cookies.js";
import { BROWSER_USER_AGENT } from "./bing.js";
import { WebSearchError } from "../errors.js";

export const WEIXIN_SOGOU_URL = "https://weixin.sogou.com/";
export const WEIXIN_SEARCH_URL = "https://weixin.sogou.com/weixin";
export const WEIXIN_RESULTS_PER_PAGE = 10;
export const WEIXIN_MAX_PAGES = 10;

export const WEIXIN_URL_NOTICE =
  "WeChat article URLs are time-limited signed links; fetch them promptly after searching.";

export function buildWeixinSearchUrl(query, { type = 2, page = 1 } = {}) {
  if (typeof query !== "string" || query.trim() === "") {
    throw new WebSearchError("Weixin search query must not be empty");
  }
  if (!Number.isInteger(page) || page < 1 || page > WEIXIN_MAX_PAGES) {
    throw new WebSearchError(`Weixin search page must be between 1 and ${WEIXIN_MAX_PAGES}`);
  }
  const params = new URLSearchParams({
    type: String(type),
    query,
    page: String(page),
    ie: "utf8",
  });
  return `${WEIXIN_SEARCH_URL}?${params}`;
}

function assertSogouAllowed(html, finalUrl) {
  const antiSpider = finalUrl.includes("antispider")
    || /antispider|异常流量|访问出错了|请输入验证码/i.test(html);
  if (antiSpider) {
    throw new WebSearchError(
      "Sogou Weixin search triggered an anti-crawler verification; "
      + "retry later or use --proxy-url",
    );
  }
}

async function requestSogouPage(url, { cookies, referer, dispatcher, timeoutMs }) {
  const headers = {
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
    "upgrade-insecure-requests": "1",
  };
  if (cookies) headers.cookie = cookies;
  if (referer) headers.referer = referer;

  const response = await request(url, {
    userAgent: BROWSER_USER_AGENT,
    headers,
    timeoutMs,
    dispatcher,
  });
  if (response.status >= 400) {
    throw new WebSearchError(`Sogou Weixin search failed - status code ${response.status}`);
  }
  const html = await response.text();
  assertSogouAllowed(html, response.url || url);
  return {
    html,
    url: response.url || url,
    cookies: mergeCookies(cookies, response.headers.getSetCookie?.() ?? []),
  };
}

export function parseWeixinPage(html, { page = 1 } = {}) {
  const $ = cheerio.load(html);
  const results = [];

  $(".news-list li").each((_, element) => {
    const item = $(element);
    const titleLink = item.find(".txt-box h3 a").first();
    const title = titleLink.text().trim();
    const href = titleLink.attr("href")?.trim() ?? "";
    if (!title || !href) return;

    let link;
    try {
      link = new URL(href, WEIXIN_SEARCH_URL).toString();
    } catch {
      return;
    }

    const snippet = item.find(".txt-info").first().text().trim();
    const account = (item.find(".s-p .all-time-y2").first().text()
      || item.find(".s-p a.account").first().text()).trim();

    const timeScript = item.find(".s-p .s2 script").first().text();
    const timestampMatch = timeScript.match(/timeConvert\('(\d+)'\)/);
    let publishedAt;
    if (timestampMatch) {
      const date = new Date(Number(timestampMatch[1]) * 1000);
      if (!Number.isNaN(date.getTime())) publishedAt = date.toISOString();
    }

    const coverImageHref = item.find(".img-box img").first().attr("src")?.trim();
    let coverImage;
    if (coverImageHref?.startsWith("//")) {
      coverImage = `https:${coverImageHref}`;
    } else if (coverImageHref?.startsWith("https://")) {
      coverImage = coverImageHref;
    }

    results.push({
      id: randomUUID(),
      title,
      sogouLink: link,
      displayUrl: "mp.weixin.qq.com",
      snippet,
      account,
      coverImage,
      publishedAt,
      publishedAtText: publishedAt?.slice(0, 10),
      publishedAtSource: publishedAt ? "sogou-timeConvert" : undefined,
      dateMissing: !publishedAt,
    });
  });

  const maxPage = $("#pagebar_container a")
    .map((_, element) => {
      const href = $(element).attr("href") ?? "";
      return Number(new URL(href, WEIXIN_SEARCH_URL).searchParams.get("page"));
    })
    .get()
    .filter((value) => Number.isInteger(value))
    .reduce((max, value) => Math.max(max, value), page);

  return {
    results,
    hasNextPage: maxPage > page,
  };
}

export function parseWeixinResults(html, options = {}) {
  const count = options.count ?? 10;
  const offset = options.offset ?? 0;
  const requestedSort = options.sort ?? "relevance";
  const sort = requestedSort === "auto" ? "relevance" : requestedSort;
  const page = parseWeixinPage(html, { page: options.page ?? 1 });
  const ordered = sort === "date" ? sortWeixinByDate(page.results) : page.results;
  const selected = ordered.slice(offset, offset + count).map((result, index) => ({
    ...result,
    rank: offset + index + 1,
    url: result.sogouLink,
    temporaryUrl: false,
  }));

  return {
    query: options.query,
    engine: "weixin-sogou",
    offset,
    requestedCount: count,
    resultCount: selected.length,
    sort,
    freshness: "any",
    pagesFetched: 1,
    pagesRequested: 1,
    duplicatesRemoved: 0,
    totalResults: null,
    hasMore: page.hasNextPage,
    notice: WEIXIN_URL_NOTICE,
    results: selected,
  };
}

function sortWeixinByDate(results) {
  return [...results].sort((a, b) => {
    if (a.publishedAt && b.publishedAt) {
      return Date.parse(b.publishedAt) - Date.parse(a.publishedAt);
    }
    if (a.publishedAt) return -1;
    if (b.publishedAt) return 1;
    return 0;
  });
}

/**
 * Sogou result pages link to `/link?url=...` intermediates that respond with
 * JavaScript building the real WeChat article URL from string fragments:
 * `url += 'https://mp.'; url += 'weixin.qq.c'; ...`.
 */
export async function resolveSogouLink(linkUrl, { cookies, referer, dispatcher, timeoutMs = 30000 } = {}) {
  const headers = {
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
  };
  if (cookies) headers.cookie = cookies;
  if (referer) headers.referer = referer;

  const response = await request(linkUrl, {
    userAgent: BROWSER_USER_AGENT,
    headers,
    timeoutMs,
    dispatcher,
  });
  if (response.status >= 400) {
    throw new WebSearchError(
      `Failed to resolve Sogou link ${linkUrl} - status code ${response.status}`,
    );
  }
  const html = await response.text();
  assertSogouAllowed(html, response.url || linkUrl);

  const pieces = [...html.matchAll(/url\s*\+=\s*'([^']*)'/g)].map((match) => match[1]);
  let resolved = pieces.join("");
  if (!/^https?:\/\//i.test(resolved)) {
    const replaceMatch = html.match(/window\.location\.replace\(["']([^"']+)["']\)/);
    resolved = replaceMatch?.[1] ?? "";
  }
  if (!/^https?:\/\/mp\.weixin\.qq\.com\//i.test(resolved) && !/^https?:\/\//i.test(resolved)) {
    return null;
  }
  return resolved;
}

async function warmUpCookies({ dispatcher, timeoutMs }) {
  const response = await requestSogouPage(WEIXIN_SOGOU_URL, { dispatcher, timeoutMs });
  return response.cookies;
}

export async function searchWeixin(query, options = {}) {
  const count = options.count ?? 10;
  const offset = options.offset ?? 0;
  const requestedSort = options.sort ?? "auto";
  if (!["auto", "relevance", "date"].includes(requestedSort)) {
    throw new WebSearchError("--sort must be one of: auto, relevance, date");
  }
  if (options.freshness && options.freshness !== "any") {
    throw new WebSearchError(
      "--freshness is not supported by the weixin engine (Sogou time filters are unavailable)",
    );
  }
  const sort = requestedSort === "auto" ? "relevance" : requestedSort;
  const pagesRequested = Math.min(
    WEIXIN_MAX_PAGES,
    Math.max(1, Math.ceil((offset + count) / WEIXIN_RESULTS_PER_PAGE)),
  );

  const dispatcher = createDispatcher(options.proxyUrl);
  try {
    const timeoutMs = options.timeoutMs ?? 15000;
    let cookies = await warmUpCookies({ dispatcher, timeoutMs });
    const seen = new Set();
    const unique = [];
    let rawCount = 0;
    let pagesFetched = 0;
    let hasNextPage = false;

    for (let page = 1; page <= pagesRequested; page += 1) {
      const pageUrl = buildWeixinSearchUrl(query, { page });
      const response = await requestSogouPage(pageUrl, {
        cookies,
        referer: page === 1 ? WEIXIN_SOGOU_URL : buildWeixinSearchUrl(query, { page: page - 1 }),
        dispatcher,
        timeoutMs,
      });
      cookies = response.cookies;
      const parsed = parseWeixinPage(response.html, { page });
      pagesFetched += 1;
      hasNextPage = parsed.hasNextPage;
      rawCount += parsed.results.length;

      for (const result of parsed.results) {
        result.sourcePageUrl = pageUrl;
        if (seen.has(result.sogouLink)) continue;
        seen.add(result.sogouLink);
        unique.push(result);
      }

      if (parsed.results.length === 0 || !parsed.hasNextPage) break;
      if (unique.length >= offset + count) break;
    }

    const ordered = sort === "date" ? sortWeixinByDate(unique) : unique;
    // Resolve only the links that will be returned: every resolution is one
    // extra request to Sogou's /link endpoint, which raises anti-crawler risk.
    const window = ordered.slice(offset, offset + count);
    const resolved = await Promise.all(
      window.map(async (result) => {
        try {
          const url = await resolveSogouLink(result.sogouLink, {
            cookies,
            referer: result.sourcePageUrl,
            dispatcher,
            timeoutMs,
          });
          return { ...result, url: url ?? result.sogouLink, temporaryUrl: Boolean(url) };
        } catch {
          return { ...result, url: result.sogouLink, temporaryUrl: false };
        }
      }),
    );

    const selected = resolved.map((result, index) => ({
      id: result.id,
      rank: index + 1,
      title: result.title,
      url: result.url,
      sogouLink: result.sogouLink,
      displayUrl: result.displayUrl,
      snippet: result.snippet,
      account: result.account,
      coverImage: result.coverImage,
      publishedAt: result.publishedAt,
      publishedAtText: result.publishedAtText,
      publishedAtSource: result.publishedAtSource,
      dateMissing: !result.publishedAt,
      temporaryUrl: result.temporaryUrl,
    }));

    return {
      query,
      engine: "weixin-sogou",
      offset,
      requestedCount: count,
      resultCount: selected.length,
      sort,
      freshness: "any",
      pagesFetched,
      pagesRequested,
      duplicatesRemoved: Math.max(0, rawCount - unique.length),
      totalResults: null,
      hasMore: offset + count < unique.length || hasNextPage,
      notice: WEIXIN_URL_NOTICE,
      results: selected,
    };
  } finally {
    await dispatcher?.close?.();
  }
}
