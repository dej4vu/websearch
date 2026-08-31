import test from "node:test";
import assert from "node:assert/strict";
import {
  buildBingSearchUrl,
  canonicalizeUrl,
  mergeBingPages,
  normalizeFreshness,
  parseBingResults,
  requestBingHtml,
  unwrapBingRedirect,
} from "../src/lib/bing.js";
import { isUrlBlacklisted } from "../src/lib/blacklist.js";

const now = new Date("2026-08-31T00:00:00Z");

function resultItem(title, url, snippet, dateText = "") {
  const dateHtml = dateText ? `<span class="news_dt">${dateText}</span>` : "";
  return `<li class="b_algo">
    ${dateHtml}
    <h2><a href="${url}">${title}</a></h2>
    <div class="b_caption"><p>${snippet}</p></div>
  </li>`;
}

test("search builds Bing CN query with count, offset, market, and UI freshness filters", () => {
  assert.equal(
    buildBingSearchUrl("ai agents", { count: 10, offset: 10 }),
    "https://cn.bing.com/search?q=ai+agents&count=10&first=11&mkt=zh-CN",
  );
  assert.equal(
    buildBingSearchUrl("ai agents", { count: 10, offset: 0, freshness: "month" }),
    'https://cn.bing.com/search?q=ai+agents&count=10&first=1&mkt=zh-CN&filters=ex1%3A%22ez3%22&FORM=000017',
  );
  assert.equal(
    buildBingSearchUrl("ai agents", { count: 10, offset: 0, freshness: "day" }),
    'https://cn.bing.com/search?q=ai+agents&count=10&first=1&mkt=zh-CN&filters=ex1%3A%22ez1%22&FORM=000017',
  );
  assert.equal(
    buildBingSearchUrl("ai agents", { count: 10, offset: 10, ensearch: true }),
    'https://cn.bing.com/search?q=ai+agents&count=10&first=11&mkt=zh-CN&ensearch=1',
  );
});

test("search validates freshness windows", async () => {
  await assert.rejects(
    () => requestBingHtml("test", { freshness: "half-year" }),
    /day, week, month/,
  );
  assert.equal(normalizeFreshness(undefined, "GLM 最新模型", "auto"), "month");
  assert.equal(normalizeFreshness(undefined, "docker network", "auto"), "any");
  assert.equal(normalizeFreshness("week", "docker network", "auto"), "week");
});

test("search parses result fields, dates, missing-date state, and totals", () => {
  const html = `<!doctype html><html><body><ol id="b_results">
    ${resultItem("First Result", "https://example.com/one?utm_source=x", "First snippet", "2026-08-30")}
    ${resultItem("Second Result", "https://example.com/two", "4 天之前 updated")}
    ${resultItem("Third Result", "https://example.com/three", "No date here")}
    <li class="b_algo"><h2>No link here</h2></li>
  </ol><span class="sb_count">1,234 results</span></body></html>`;

  const response = parseBingResults(html, { query: "test", count: 50, now });
  assert.equal(response.engine, "bing-cn");
  assert.equal(response.totalResults, 1234);
  assert.equal(response.resultCount, 3);
  assert.equal(response.pagesFetched, 1);
  assert.equal(response.duplicatesRemoved, 0);

  const [first, second, third] = response.results;
  assert.equal(first.rank, 1);
  assert.equal(first.title, "First Result");
  assert.equal(first.url, "https://example.com/one?utm_source=x");
  assert.equal(first.publishedAt, "2026-08-30T00:00:00.000Z");
  assert.equal(first.publishedAtText, "2026-08-30");
  assert.equal(first.publishedAtSource, "news_dt");
  assert.equal(first.dateMissing, false);
  assert.equal(first.fetchBlocked, false);

  assert.equal(second.publishedAt, "2026-08-27T00:00:00.000Z");
  assert.equal(second.publishedAtText, "4 天之前");
  assert.equal(second.publishedAtSource, "snippet");
  assert.equal(third.dateMissing, true);
  assert.equal(third.publishedAt, undefined);
});

test("search date sorting keeps generic undated results low but boosts official pages", () => {
  const html = `<ol id="b_results">
    ${resultItem("Old", "https://example.com/old", "2020-01-01 news")}
    ${resultItem("Undated official", "https://docs.bigmodel.cn/cn/guide/models/text/glm-5", "Official page")}
    ${resultItem("New", "https://example.com/new", "2026-08-29 release")}
  </ol>`;

  const response = parseBingResults(html, {
    query: "GLM 最新模型",
    count: 10,
    sort: "auto",
    now,
  });

  assert.equal(response.sort, "date");
  assert.deepEqual(response.results.map((result) => result.title), ["New", "Undated official", "Old"]);
});

test("search parses Chinese relative, English relative, ISO, and URL dates", () => {
  const html = `<ol id="b_results">
    ${resultItem("Chinese relative", "https://example.com/a", "5 天之前 updated")}
    ${resultItem("English relative", "https://example.com/b", "5 days ago updated")}
    ${resultItem("ISO date", "https://example.com/c", "2026-08-20T10:30:00Z published")}
    ${resultItem("URL date", "https://example.com/news/2026/08/18/story", "No visible date")}
  </ol>`;

  const response = parseBingResults(html, {
    query: "release notes",
    count: 10,
    sort: "date",
    now,
  });
  const dates = response.results.map((result) => result.publishedAt);
  assert.deepEqual(dates, [
    "2026-08-26T00:00:00.000Z",
    "2026-08-26T00:00:00.000Z",
    "2026-08-20T10:30:00.000Z",
    "2026-08-18T00:00:00.000Z",
  ]);
  assert.deepEqual(response.results.map((result) => result.dateMissing), [false, false, false, false]);
});

test("multi-page aggregation deduplicates, applies offset, and reports page metrics", () => {
  const page1 = `<ol id="b_results">
    ${resultItem("New", "https://example.com/new", "2026-08-29 release")}
    ${resultItem("Old", "https://example.com/old", "2020-01-01 news")}
  </ol>`;
  const page2 = `<ol id="b_results">
    ${resultItem("Duplicate New", "https://example.com/new?utm_source=feed", "2026-08-29 release")}
    ${resultItem("Third", "https://example.com/third", "No date")}
  </ol><span class="sb_count">1,234 results</span>`;

  const response = mergeBingPages([page1, page2], {
    query: "GLM 最新模型",
    count: 2,
    offset: 1,
    requestedSort: "auto",
    sort: "date",
    freshness: "month",
    pagesRequested: 2,
    now,
  });

  assert.equal(response.resultCount, 2);
  assert.equal(response.pagesFetched, 2);
  assert.equal(response.pagesRequested, 2);
  assert.equal(response.duplicatesRemoved, 1);
  assert.equal(response.freshness, "month");
  assert.equal(response.sort, "date");
  assert.equal(response.totalResults, 1234);
  assert.deepEqual(response.results.map((result) => result.rank), [1, 2]);
  assert.deepEqual(response.results.map((result) => result.title), ["Old", "Third"]);
});

test("canonicalization removes tracking parameters and normalizes URLs", () => {
  assert.equal(
    canonicalizeUrl("HTTPS://Example.COM:443/a/b/?spm=x&utm_campaign=y&z=1#section"),
    "https://example.com/a/b?z=1",
  );
  assert.equal(canonicalizeUrl("not-a-url"), "not-a-url");
});

test("Bing redirect URLs unwrap to the real destination", () => {
  const target = "https://docs.bigmodel.cn/cn/guide/models/text/glm-5.3";
  const encoded = Buffer.from(target, "utf8").toString("base64url");
  const redirect = `https://www.bing.com/ck/a?!&u=a1${encoded}&ntb=1`;
  assert.equal(unwrapBingRedirect(redirect), target);
});

test("bing-fetch blacklist matches root domains and subdomains", () => {
  for (const url of [
    "https://zhihu.com/question/1",
    "https://zhuanlan.zhihu.com/p/1",
    "https://blog.csdn.net/user/article/details/1",
    "https://www.bilibili.com/video/1",
  ]) {
    assert.equal(isUrlBlacklisted(url), true, url);
  }
  assert.equal(isUrlBlacklisted("https://example.com/zhihu.com"), false);
  assert.equal(isUrlBlacklisted("not a url"), false);
});
