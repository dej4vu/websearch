import { searchBing, BROWSER_USER_AGENT } from "../lib/bing.js";
import { searchWeixin } from "../lib/weixin.js";
import { isUrlBlacklisted } from "../lib/blacklist.js";
import { WebSearchError } from "../errors.js";

function parseCount(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 50) {
    throw new WebSearchError("--count must be an integer between 1 and 50");
  }
  return parsed;
}

function parseOffset(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new WebSearchError("--offset must be an integer of at least 0");
  }
  return parsed;
}

function parseTimeout(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new WebSearchError("--timeout-ms must be a positive integer");
  }
  return parsed;
}

function renderPlain(response) {
  const lines = [
    `${response.engine} results for ${response.query} (offset ${response.offset}):`,
    `Sort: ${response.sort}; freshness: ${response.freshness}; pages: ${response.pagesFetched}; duplicates removed: ${response.duplicatesRemoved}`,
    "",
  ];

  if (response.results.length === 0) {
    lines.push("No results found.");
  }

  for (const result of response.results) {
    const number = result.rank;
    const blacklisted = response.engine === "weixin-sogou"
      ? ""
      : (isUrlBlacklisted(result.url) ? " [bing-fetch blacklist]" : "");
    lines.push(
      `${number}. ${result.title}${blacklisted}`,
      `   URL: ${result.url}`,
      `   Site: ${result.displayUrl}`,
    );
    if (result.account) {
      lines.push(`   Account: ${result.account}`);
    }
    if (result.snippet) {
      lines.push(`   ${result.snippet.replaceAll(/\s+/g, " ")}`);
    }
    if (result.publishedAtText || result.publishedAt) {
      lines.push(`   Date: ${result.publishedAtText ?? result.publishedAt} (${result.publishedAtSource})`);
    }
    lines.push("");
  }

  if (response.totalResults !== null) {
    lines.push(`Total reported by Bing: ${response.totalResults}`);
  }
  if (response.notice) {
    lines.push(`Note: ${response.notice}`);
  }
  return lines.join("\n");
}

function renderJson(response) {
  return JSON.stringify({
    ok: true,
    query: response.query,
    engine: response.engine,
    offset: response.offset,
    requestedCount: response.requestedCount,
    resultCount: response.resultCount,
    sort: response.sort,
    freshness: response.freshness,
    pagesFetched: response.pagesFetched,
    pagesRequested: response.pagesRequested,
    duplicatesRemoved: response.duplicatesRemoved,
    totalResults: response.totalResults,
    hasMore: response.hasMore,
    results: response.results.map((result) => ({
      id: result.id,
      rank: result.rank,
      title: result.title,
      url: result.url,
      displayUrl: result.displayUrl,
      snippet: result.snippet,
      publishedAt: result.publishedAt,
      publishedAtText: result.publishedAtText,
      publishedAtSource: result.publishedAtSource,
      dateMissing: result.dateMissing,
      fetchBlocked: response.engine === "weixin-sogou" ? false : isUrlBlacklisted(result.url),
      account: result.account,
      coverImage: result.coverImage,
      temporaryUrl: result.temporaryUrl,
      sogouLink: result.sogouLink,
    })),
    notice: response.notice,
  }, null, 2);
}

export function registerSearchCommand(program) {
  return program
    .command("search")
    .description("Search the web with Bing CN, or WeChat articles via Sogou.")
    .argument("<query...>", "Search keywords.")
    .option("--engine <name>", "Search engine: bing or weixin (WeChat official-account articles).", "bing")
    .option("--count <results>", "Maximum results to return (1-50).", "10")
    .option("--offset <results>", "Zero-based result offset.", "0")
    .option("--sort <mode>", "auto, relevance, or date.", "auto")
    .option("--freshness <window>", "any, day, week, or month. Auto uses month for recency intent.")
    .option("--proxy-url <url>", "Route the search request through an HTTP/HTTPS proxy.")
    .option("--timeout-ms <milliseconds>", "Search request timeout.", "15000")
    .option("--json", "Emit structured results.", false)
    .action(async (queryParts, options) => {
      const parsedOptions = {
        count: parseCount(options.count),
        offset: parseOffset(options.offset),
        sort: options.sort,
        freshness: options.freshness,
        proxyUrl: options.proxyUrl,
        timeoutMs: parseTimeout(options.timeoutMs),
        json: options.json,
      };
      const query = queryParts.join(" ").trim();

      try {
        if (options.engine !== "bing" && options.engine !== "weixin") {
          throw new WebSearchError("--engine must be one of: bing, weixin");
        }
        const response = options.engine === "weixin"
          ? await searchWeixin(query, parsedOptions)
          : await searchBing(query, parsedOptions);
        const output = parsedOptions.json ? renderJson(response) : renderPlain(response);
        console.log(output);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (parsedOptions.json) {
          console.error(JSON.stringify({ ok: false, error: message }, null, 2));
        } else {
          console.error(`websearch: ${message}`);
        }
        process.exitCode = 1;
      }
    });
}

export { BROWSER_USER_AGENT };
