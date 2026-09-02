import { searchBing, canonicalizeUrl, RECENCY_INTENT } from "./bing.js";
import { searchWeixin } from "./weixin.js";
import { WebSearchError } from "../errors.js";

export const AGGREGATED_ENGINE = "aggregated";

function normalizeSort(sort, query) {
  if (sort && sort !== "auto") return sort;
  return RECENCY_INTENT.test(query ?? "") ? "date" : "relevance";
}

function interleaveByEngine(results) {
  const queues = new Map();
  for (const result of results) {
    if (!queues.has(result.engine)) queues.set(result.engine, []);
    queues.get(result.engine).push(result);
  }

  const ordered = [];
  let added = true;
  while (added) {
    added = false;
    for (const queue of queues.values()) {
      const item = queue.shift();
      if (item) {
        ordered.push(item);
        added = true;
      }
    }
  }
  return ordered;
}

function sortByDate(results) {
  return [...results].sort((a, b) => {
    if (a.publishedAt && b.publishedAt) {
      return Date.parse(b.publishedAt) - Date.parse(a.publishedAt);
    }
    if (a.publishedAt) return -1;
    if (b.publishedAt) return 1;
    return 0;
  });
}

export function aggregateResults(engineResponses, options = {}) {
  const count = options.count ?? 10;
  const offset = options.offset ?? 0;
  const sort = normalizeSort(options.sort, options.query);

  const canonicalSeen = new Set();
  const merged = [];
  let crossEngineDuplicates = 0;
  for (const response of engineResponses) {
    for (const result of response.results) {
      const canonical = canonicalizeUrl(result.url);
      if (canonicalSeen.has(canonical)) {
        crossEngineDuplicates += 1;
        continue;
      }
      canonicalSeen.add(canonical);
      merged.push({ ...result, engine: response.engine });
    }
  }

  const ordered = sort === "date" ? sortByDate(merged) : interleaveByEngine(merged);
  const selected = ordered.slice(offset, offset + count).map((result, index) => ({
    ...result,
    rank: index + 1,
  }));

  const engineResultCounts = Object.fromEntries(
    engineResponses.map((response) => [response.engine, response.resultCount]),
  );
  const weixinResponse = engineResponses.find((response) => response.engine === "weixin-sogou");

  return {
    query: options.query,
    engine: AGGREGATED_ENGINE,
    engines: engineResponses.map((response) => response.engine),
    engineResultCounts,
    offset,
    requestedCount: count,
    resultCount: selected.length,
    sort,
    freshness: engineResponses.find((response) => response.engine === "bing-cn")?.freshness ?? "any",
    pagesFetched: engineResponses.reduce((sum, response) => sum + response.pagesFetched, 0),
    pagesRequested: engineResponses.reduce((sum, response) => sum + response.pagesRequested, 0),
    duplicatesRemoved: engineResponses.reduce((sum, response) => sum + response.duplicatesRemoved, 0)
      + crossEngineDuplicates,
    totalResults: engineResponses.find((response) => response.engine === "bing-cn")?.totalResults ?? null,
    hasMore: offset + count < ordered.length
      || engineResponses.some((response) => response.hasMore),
    notice: weixinResponse?.notice,
    results: selected,
  };
}

export async function searchAll(query, options = {}) {
  const count = options.count ?? 10;
  const offset = options.offset ?? 0;
  if (options.freshness && !["any", "day", "week", "month"].includes(options.freshness)) {
    throw new WebSearchError("--freshness must be one of: any, day, week, month");
  }
  const windowCount = Math.min(50, Math.max(1, offset + count));

  const settled = await Promise.allSettled([
    searchBing(query, { ...options, count: windowCount, offset: 0 }),
    searchWeixin(query, { ...options, count: windowCount, offset: 0, freshness: undefined }),
  ]);

  const responses = [];
  const warnings = [];
  const engineNames = ["bing", "weixin"];
  settled.forEach((outcome, index) => {
    if (outcome.status === "fulfilled") {
      responses.push(outcome.value);
    } else {
      const message = outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
      warnings.push(`${engineNames[index]} engine failed: ${message}`);
    }
  });

  if (responses.length === 0) {
    throw settled[0].reason instanceof Error
      ? settled[0].reason
      : new WebSearchError("All search engines failed");
  }

  if (options.freshness && options.freshness !== "any"
    && responses.some((response) => response.engine === "weixin-sogou")) {
    warnings.push("--freshness was applied to the bing engine only; Sogou Weixin has no time filter");
  }

  const aggregated = aggregateResults(responses, {
    query,
    count,
    offset,
    sort: options.sort,
  });
  aggregated.warnings = warnings;
  return aggregated;
}
