import test from "node:test";
import assert from "node:assert/strict";
import { aggregateResults } from "../src/lib/search.js";

function bingResponse(results, overrides = {}) {
  return {
    query: "glm",
    engine: "bing-cn",
    offset: 0,
    requestedCount: 10,
    resultCount: results.length,
    sort: "relevance",
    freshness: "any",
    pagesFetched: 1,
    pagesRequested: 1,
    duplicatesRemoved: 0,
    totalResults: 1000,
    hasMore: true,
    results,
  };
}

function weixinResponse(results, overrides = {}) {
  return {
    query: "glm",
    engine: "weixin-sogou",
    offset: 0,
    requestedCount: 10,
    resultCount: results.length,
    sort: "relevance",
    freshness: "any",
    pagesFetched: 1,
    pagesRequested: 1,
    duplicatesRemoved: 0,
    totalResults: null,
    hasMore: false,
    notice: "signed links",
    results,
  };
}

const bingResults = [
  { id: "b1", title: "Bing One", url: "https://example.com/one?utm_source=x", snippet: "s", publishedAt: "2026-08-30T00:00:00.000Z" },
  { id: "b2", title: "Bing Two", url: "https://example.com/two", snippet: "s", publishedAt: "2026-08-28T00:00:00.000Z" },
];
const weixinResults = [
  { id: "w1", title: "Weixin One", url: "https://mp.weixin.qq.com/s?src=11&timestamp=1&signature=a", account: "公众号A", publishedAt: "2026-08-29T00:00:00.000Z", temporaryUrl: true },
  { id: "w2", title: "Weixin Duplicate", url: "https://example.com/one", snippet: "same canonical as b1", publishedAt: "2026-08-20T00:00:00.000Z" },
];

test("aggregate interleaves engines, tags source, and removes cross-engine duplicates", () => {
  const response = aggregateResults(
    [bingResponse(bingResults), weixinResponse(weixinResults)],
    { query: "glm", count: 10, sort: "relevance" },
  );

  assert.equal(response.engine, "aggregated");
  assert.deepEqual(response.engines, ["bing-cn", "weixin-sogou"]);
  assert.deepEqual(response.engineResultCounts, { "bing-cn": 2, "weixin-sogou": 2 });
  assert.equal(response.resultCount, 3);
  assert.equal(response.duplicatesRemoved, 1);
  assert.equal(response.totalResults, 1000);
  assert.equal(response.notice, "signed links");

  assert.deepEqual(
    response.results.map((result) => [result.title, result.engine]),
    [
      ["Bing One", "bing-cn"],
      ["Weixin One", "weixin-sogou"],
      ["Bing Two", "bing-cn"],
    ],
  );
  response.results.forEach((result, index) => assert.equal(result.rank, index + 1));
});

test("aggregate sorts by publish date across engines and applies global offset", () => {
  const response = aggregateResults(
    [bingResponse(bingResults), weixinResponse(weixinResults)],
    { query: "glm 最新", count: 2, offset: 1, sort: "auto" },
  );

  assert.equal(response.sort, "date");
  assert.deepEqual(
    response.results.map((result) => result.title),
    ["Weixin One", "Bing Two"],
  );
  assert.equal(response.resultCount, 2);
});

test("aggregate keeps working with a single engine response", () => {
  const response = aggregateResults(
    [bingResponse(bingResults)],
    { query: "glm", count: 10 },
  );
  assert.equal(response.engine, "aggregated");
  assert.equal(response.resultCount, 2);
  assert.equal(response.notice, undefined);
  assert.ok(response.results.every((result) => result.engine === "bing-cn"));
});
