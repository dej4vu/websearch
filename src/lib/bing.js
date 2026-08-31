import * as cheerio from "cheerio";
import { randomUUID } from "node:crypto";
import { request, createDispatcher } from "./http.js";
import { WebSearchError } from "../errors.js";

export const BING_SEARCH_URL = "https://cn.bing.com/search";
export const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
export const RESULTS_PER_PAGE = 10;
export const MAX_PAGES = 5;

const FRESHNESS_FILTERS = {
  day: 'ex1:"ez1"',
  week: 'ex1:"ez2"',
  month: 'ex1:"ez3"',
};

const OFFICIAL_DOMAIN_SCORES = [
  ["docs.bigmodel.cn", 500],
  ["bigmodel.cn", 450],
  ["zhipuai.cn", 450],
  ["z.ai", 450],
  ["deepseek.com", 500],
  ["aliyun.com", 400],
  ["tongyi.aliyun.com", 480],
  ["qwen.ai", 480],
  ["docker.com", 480],
  ["kubernetes.io", 480],
  ["python.org", 480],
  ["nodejs.org", 480],
  ["typescriptlang.org", 480],
  ["rust-lang.org", 480],
  ["go.dev", 480],
  ["postgresql.org", 480],
  ["mysql.com", 450],
  ["gnu.org", 460],
  ["debian.org", 460],
  ["ubuntu.com", 440],
  ["anthropic.com", 440],
  ["developer.mozilla.org", 460],
];

const RECENCY_INTENT = /最新|最近|新模型|发布|上线|更新|latest|release|new\b|news\b/i;

export function normalizeFreshness(freshness, query, sort = "auto") {
  if (freshness && !(freshness in FRESHNESS_FILTERS)) {
    throw new WebSearchError("--freshness must be one of: any, day, week, month");
  }
  if (freshness) return freshness;
  if (sort === "auto" && RECENCY_INTENT.test(query ?? "")) return "month";
  return "any";
}

export function buildBingSearchUrl(query, {
  count = RESULTS_PER_PAGE,
  offset = 0,
  freshness = "any",
  ensearch = false,
} = {}) {
  if (!Number.isInteger(count) || count < 1 || count > 100) {
    throw new WebSearchError("Bing page count must be between 1 and 100");
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new WebSearchError("Bing offset must be at least 0");
  }
  if (freshness !== "any" && !(freshness in FRESHNESS_FILTERS)) {
    throw new WebSearchError("--freshness must be one of: any, day, week, month");
  }

  const params = new URLSearchParams({
    q: query,
    count: String(count),
    first: String(offset + 1),
    mkt: "zh-CN",
  });
  if (ensearch) params.set("ensearch", "1");
  if (freshness !== "any") {
    params.set("filters", FRESHNESS_FILTERS[freshness]);
    params.set("FORM", "000017");
  }
  return `${BING_SEARCH_URL}?${params}`;
}

async function requestPage(url, { proxyUrl, timeoutMs, cookies } = {}) {
  const dispatcher = createDispatcher(proxyUrl);
  try {
    const headers = {
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
      "upgrade-insecure-requests": "1",
    };
    if (cookies) headers.cookie = cookies;

    const response = await request(url, {
      userAgent: BROWSER_USER_AGENT,
      headers,
      timeoutMs,
      dispatcher,
    });
    if (response.status >= 400) {
      throw new WebSearchError(`Bing search failed - status code ${response.status}`);
    }
    const html = await response.text();
    if (/b_captcha|Enter the characters you see/i.test(html)) {
      throw new WebSearchError("Bing returned a captcha; retry later or use --proxy-url");
    }
    return {
      html,
      cookies: mergeCookies(cookies, response.headers.getSetCookie?.() ?? []),
    };
  } finally {
    await dispatcher?.close?.();
  }
}

function mergeCookies(current = "", setCookieHeaders = []) {
  const jar = new Map();
  for (const text of [current, ...setCookieHeaders].filter(Boolean)) {
    for (const pair of text.split(/;\s*/)) {
      const index = pair.indexOf("=");
      if (index <= 0) continue;
      jar.set(pair.slice(0, index), pair.slice(index + 1));
    }
  }
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ") || undefined;
}

function extractNextPageUrl(html) {
  try {
    const $ = cheerio.load(html);
    const href = $("a.sb_pagN[href]").first().attr("href");
    if (!href) return null;
    return new URL(href, BING_SEARCH_URL).toString();
  } catch {
    return null;
  }
}

function countNewResults(page, canonicalSeen) {
  return page.results.filter((result) => !canonicalSeen.has(canonicalizeUrl(result.url))).length;
}

export async function requestBingHtml(query, options = {}) {
  const { proxyUrl, timeoutMs = 15000, ...urlOptions } = options;
  const result = await requestPage(
    buildBingSearchUrl(query, urlOptions),
    { proxyUrl, timeoutMs },
  );
  return result.html;
}

export async function searchBing(query, options = {}) {
  const count = options.count ?? 10;
  const offset = options.offset ?? 0;
  const requestedSort = options.sort ?? "auto";
  const freshness = normalizeFreshness(options.freshness, query, requestedSort);
  const sort = requestedSort === "auto"
    ? (RECENCY_INTENT.test(query) ? "date" : "relevance")
    : requestedSort;

  const pageCount = Math.min(
    MAX_PAGES,
    Math.ceil((offset + count) / RESULTS_PER_PAGE),
  );
  const pages = [];
  const canonicalSeen = new Set();
  let uniqueCount = 0;
  let cookies;
  let nextPageUrl = buildBingSearchUrl(query, {
    count: RESULTS_PER_PAGE,
    offset: 0,
    freshness,
  });

  for (let page = 0; page < pageCount; page += 1) {
    const response = await requestPage(nextPageUrl, {
      proxyUrl: options.proxyUrl,
      timeoutMs: options.timeoutMs ?? 15000,
      cookies,
    });
    cookies = response.cookies;
    let parsedPage = parseBingPage(response.html, { query });
    let newCount = countNewResults(parsedPage, canonicalSeen);

    if (page > 0 && newCount === 0 && parsedPage.results.length > 0) {
      const retryUrl = buildBingSearchUrl(query, {
        count: RESULTS_PER_PAGE,
        offset: page * RESULTS_PER_PAGE,
        freshness,
        ensearch: true,
      });
      const retry = await requestPage(retryUrl, {
        proxyUrl: options.proxyUrl,
        timeoutMs: options.timeoutMs ?? 15000,
        cookies,
      });
      const retryPage = parseBingPage(retry.html, { query });
      const retryNewCount = countNewResults(retryPage, canonicalSeen);
      if (retryNewCount > newCount) {
        response.html = retry.html;
        cookies = retry.cookies;
        parsedPage = retryPage;
        newCount = retryNewCount;
      }
    }

    pages.push(response.html);
    for (const result of parsedPage.results) {
      const canonicalUrl = canonicalizeUrl(result.url);
      if (!canonicalSeen.has(canonicalUrl)) {
        canonicalSeen.add(canonicalUrl);
        uniqueCount += 1;
      }
    }

    if (uniqueCount >= offset + count) break;
    if (pages.length >= MAX_PAGES) break;
    nextPageUrl = extractNextPageUrl(response.html);
    if (!nextPageUrl) break;
  }

  return mergeBingPages(pages, {
    query,
    count,
    offset,
    requestedSort,
    sort,
    freshness,
    pagesRequested: pageCount,
    now: options.now,
  });
}

export function mergeBingPages(pages, options) {
  const {
    query,
    count = 10,
    offset = 0,
    requestedSort = "auto",
    sort = "relevance",
    freshness = "any",
    pagesRequested = pages.length,
    now = new Date(),
  } = options;

  const canonicalSeen = new Set();
  const merged = [];
  let totalResults;
  let lastPageRawCount = 0;

  for (const html of pages) {
    const page = parseBingPage(html, {
      query,
      sort: "relevance",
      now,
    });
    if (totalResults === undefined && page.totalResults !== null) {
      totalResults = page.totalResults;
    }
    lastPageRawCount = page.results.length;

    for (const result of page.results) {
      const canonicalUrl = canonicalizeUrl(result.url);
      if (canonicalSeen.has(canonicalUrl)) continue;
      canonicalSeen.add(canonicalUrl);
      merged.push(result);
    }
  }

  const ordered = sort === "date" ? sortByDate(merged, now) : merged;
  const start = offset;
  const end = offset + count;
  const selected = ordered.slice(start, end).map((result, index) => ({
    id: result.id,
    rank: index + 1,
    title: result.title,
    url: result.url,
    displayUrl: result.displayUrl,
    snippet: result.snippet,
    publishedAt: result.publishedAt,
    publishedAtText: result.publishedAtText,
    publishedAtSource: result.publishedAtSource,
    dateMissing: !result.publishedAt,
    authorityBoost: result.authorityBoost ?? 0,
    bingRank: result.bingRank,
  }));

  const duplicatesRemoved = pages.reduce((sum, html, index) => {
    const page = parseBingPage(html, {
      query,
      sort: "relevance",
      now,
    });
    return sum + page.results.length;
  }, 0) - merged.length;

  return {
    query,
    engine: "bing-cn",
    offset,
    requestedCount: count,
    resultCount: selected.length,
    sort,
    freshness,
    pagesFetched: pages.length,
    pagesRequested,
    duplicatesRemoved: Math.max(0, duplicatesRemoved),
    totalResults: totalResults ?? null,
    hasMore: end < merged.length
      || (totalResults !== null && end < totalResults && lastPageRawCount === RESULTS_PER_PAGE),
    results: selected,
  };
}

export function parseBingResults(html, options = {}) {
  const page = parseBingPage(html, options);
  const count = options.count ?? 50;
  const offset = options.offset ?? 0;
  const requestedSort = options.sort ?? "relevance";
  const normalizedSort = requestedSort === "auto"
    ? (RECENCY_INTENT.test(options.query ?? "") ? "date" : "relevance")
    : requestedSort;
  const now = options.now ?? new Date();
  const ordered = normalizedSort === "date"
    ? sortByDate(page.results, now)
    : page.results;
  const selected = ordered.slice(offset, offset + count).map((result, index) => ({
    ...result,
    rank: index + 1,
    dateMissing: !result.publishedAt,
    fetchBlocked: false,
  }));

  return {
    query: options.query,
    engine: "bing-cn",
    offset,
    requestedCount: count,
    resultCount: selected.length,
    sort: normalizedSort,
    freshness: options.freshness ?? "any",
    pagesFetched: 1,
    pagesRequested: 1,
    duplicatesRemoved: 0,
    totalResults: page.totalResults,
    hasMore: offset + count < ordered.length
      || (page.totalResults !== null && offset + count < page.totalResults),
    results: selected,
  };
}

function parseBingPage(html, { query, offset = 0, sort = "relevance", now = new Date() }) {
  const $ = cheerio.load(html);
  const results = [];

  $(".b_algo").each((_, element) => {
    const item = $(element);
    const titleLink = item.find("h2 a").first();
    const title = titleLink.text().trim();
    const url = unwrapBingRedirect(titleLink.attr("href")?.trim() ?? "");
    const snippet = item.find(".b_caption p").first().text().trim();
    const displayUrl = item.find(".b_attribution cite").first().text().trim();
    const explicitDateText = item.find(".news_dt").first().text().trim();

    if (!title || !url) return;

    const date = explicitDateText
      ? parseDateText(explicitDateText, now)
      : extractPublishedDate({ title, url, snippet }, now);
    const dateSource = explicitDateText ? "news_dt" : date?.source;
    const bingRank = offset + results.length + 1;

    results.push({
      id: randomUUID(),
      bingRank,
      title,
      url,
      displayUrl: displayUrl || url,
      snippet,
      publishedAt: date?.date.toISOString(),
      publishedAtText: date?.text,
      publishedAtSource: dateSource,
      dateMissing: !date,
      authorityBoost: authorityBoost(url),
    });
  });

  const countText = $(".sb_count").first().text().trim();
  const countMatch = countText.match(/[\d,]+/);
  const normalizedSort = sort === "date" || sort === "relevance" ? sort : "relevance";
  const ordered = normalizedSort === "date"
    ? sortByDate(results, now)
    : results;

  return {
    totalResults: countMatch
      ? Number.parseInt(countMatch[0].replaceAll(",", ""), 10)
      : null,
    results: ordered,
    normalizedSort,
  };
}

export function canonicalizeUrl(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    url.protocol = url.protocol.toLowerCase();
    if ((url.protocol === "https:" && url.port === "443")
      || (url.protocol === "http:" && url.port === "80")) {
      url.port = "";
    }
    const tracking = /^(utm_|spm|scm|request_id|biz_id|ops_request_misc|share_|from_|fr=)/i;
    for (const key of [...url.searchParams.keys()]) {
      if (tracking.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    let pathname = url.pathname.replace(/\/$/, "");
    if (pathname === "") pathname = "/";
    return `${url.protocol}//${url.hostname}${url.port ? `:${url.port}` : ""}${pathname}${url.search}`;
  } catch {
    return value;
  }
}

export function unwrapBingRedirect(value) {
  try {
    const url = new URL(value);
    if (!/^www\.bing\.com$|^cn\.bing\.com$/i.test(url.hostname) || url.pathname !== "/ck/a") {
      return value;
    }
    const encoded = url.searchParams.get("u");
    if (!encoded || !encoded.startsWith("a1")) return value;
    const decoded = Buffer.from(encoded.slice(2), "base64url").toString("utf8");
    // Validate before replacing the tracking URL.
    return new URL(decoded).toString();
  } catch {
    return value;
  }
}

function authorityBoost(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    let score = 0;
    for (const [domain, boost] of OFFICIAL_DOMAIN_SCORES) {
      if (hostname === domain || hostname.endsWith(`.${domain}`)) {
        score = Math.max(score, boost);
      }
    }
    if (/\.(gov|edu)(\.[a-z]+)?$/.test(hostname)) score = Math.max(score, 500);
    return score;
  } catch {
    return 0;
  }
}

function sortByDate(results, now) {
  return [...results].sort((a, b) => {
    const aScore = dateSortScore(a, now);
    const bScore = dateSortScore(b, now);
    if (aScore !== bScore) return bScore - aScore;

    const aTime = a.publishedAt ? Date.parse(a.publishedAt) : Number.NEGATIVE_INFINITY;
    const bTime = b.publishedAt ? Date.parse(b.publishedAt) : Number.NEGATIVE_INFINITY;
    if (aTime !== bTime) return bTime - aTime;

    return a.bingRank - b.bingRank;
  });
}

function recencyScore(result, now) {
  const ageDays = (now.getTime() - Date.parse(result.publishedAt)) / 24 / 60 / 60 / 1000;
  if (ageDays <= 1) return 100000;
  if (ageDays <= 7) return 90000;
  if (ageDays <= 30) return 80000;
  if (ageDays <= 90) return 70000;
  if (ageDays <= 180) return 60000;
  if (ageDays <= 365) return 50000;
  return 0;
}

function dateSortScore(result, now) {
  if (!result.publishedAt) {
    // A high-authority undated official page may be newer than its crawl or
    // snippet suggests. Generic undated pages stay after all dated results.
    if (result.authorityBoost >= 400) return 45000 + result.authorityBoost;
    return -1000;
  }
  return recencyScore(result, now) + result.authorityBoost * 5;
}

function extractPublishedDate({ title, url, snippet }, now) {
  const sources = [
    [snippet, "snippet"],
    [title, "title"],
    [url, "url"],
  ];

  for (const [text, source] of sources) {
    if (!text) continue;
    const date = parseDateText(text, now, url);
    if (date) return { ...date, source };
  }
  return null;
}

function parseDateText(text, now, sourceUrl) {
  let match = text.match(/(\d+)\s*天(?:之)?前/);
  if (match) {
    return createDate(daysAgo(Number(match[1]), now), match[0]);
  }

  match = text.match(/(\d+)\s*(?:days?|d)\s+ago/i);
  if (match) return createDate(daysAgo(Number(match[1]), now), match[0]);

  match = text.match(/(\d+)\s*(?:hours?|hrs?)\s+ago/i);
  if (match) {
    return createDate(new Date(now.getTime() - Number(match[1]) * 3600_000), match[0]);
  }

  match = text.match(/(\d+)\s*(?:周|星期)(?:之)?前/);
  if (match) return createDate(daysAgo(Number(match[1]) * 7, now), match[0]);

  match = text.match(/(\d+)\s*(?:weeks?)\s+ago/i);
  if (match) return createDate(daysAgo(Number(match[1]) * 7, now), match[0]);

  match = text.match(/(\d+)\s*个月(?:之)?前/);
  if (match) {
    const date = new Date(now);
    date.setMonth(date.getMonth() - Number(match[1]));
    return createDate(date, match[0]);
  }

  match = text.match(/(\d+)\s*months?\s+ago/i);
  if (match) {
    const date = new Date(now);
    date.setMonth(date.getMonth() - Number(match[1]));
    return createDate(date, match[0]);
  }

  if (/今天|今日/.test(text)) return createDate(new Date(now), "今天");
  if (/today/i.test(text)) return createDate(new Date(now), "today");
  if (/昨天/.test(text)) return createDate(daysAgo(1, now), "昨天");
  if (/yesterday/i.test(text)) return createDate(daysAgo(1, now), "yesterday");

  match = text.match(/(20\d{2})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (match) {
    const date = new Date(`${match[1]}-${match[2]}-${match[3]}T${match[4] ?? "00"}:${match[5] ?? "00"}:${match[6] ?? "00"}Z`);
    if (!Number.isNaN(date.getTime())) return createDate(date, match[0]);
  }

  match = text.match(/(20\d{2})[年/-](\d{1,2})(?:[月/-](\d{1,2}))?[日]?/);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = match[3] ? Number(match[3]) : 1;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return createDate(new Date(Date.UTC(year, month - 1, day)), match[0]);
    }
  }

  const months = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };
  match = text.match(/(20\d{2})[-/, ]\s*([a-z]{3,})\.?\s+(\d{1,2})/i)
    ?? text.match(/([a-z]{3,})\.?\s+(\d{1,2}),?\s+(20\d{2})/i);
  if (match) {
    const monthName = match[2].slice(0, 3).toLowerCase();
    const month = months[monthName];
    const day = match[3].length <= 2 ? Number(match[3]) : Number(match[1]);
    const year = match[3].length <= 2 ? Number(match[1]) : Number(match[3]);
    if (month !== undefined && day >= 1 && day <= 31) {
      return createDate(new Date(Date.UTC(year, month, day)), match[0]);
    }
  }

  match = sourceUrl?.match(/\/(20\d{2})\/(\d{2})\/(\d{2})\//);
  if (match) {
    return createDate(
      new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))),
      `${match[1]}-${match[2]}-${match[3]}`,
    );
  }

  match = sourceUrl?.match(/\/(?:20\d{2}\/).*?(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?:[a-z]|$)/i);
  if (match) {
    return createDate(
      new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))),
      `${match[1]}-${match[2]}-${match[3]}`,
    );
  }

  return null;
}

function createDate(date, text) {
  if (Number.isNaN(date.getTime())) return null;
  return { date, text: text.trim() };
}

function daysAgo(days, now) {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}
