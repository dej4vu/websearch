import { fetchFromWeb } from "./fetch.js";
import { BROWSER_USER_AGENT } from "../lib/bing.js";
import { isUrlBlacklisted } from "../lib/blacklist.js";
import { WebFetchError } from "../errors.js";

function renderJson(result) {
  return JSON.stringify({ ...result, ok: result.ok !== false }, null, 2);
}

export function registerBingFetchCommand(program) {
  return program
    .command("bing-fetch")
    .description("Fetch a search result using the bing-search-cn blacklist.")
    .argument("<url>", "HTTP or HTTPS URL to fetch.")
    .option("--max-length <characters>", "Maximum characters to return.", "5000")
    .option("--start-index <characters>", "Return output beginning at this index.", "0")
    .option("--raw", "Return raw response text without markdown extraction.", false)
    .option("--user-agent <user-agent>", "Custom User-Agent for requests.")
    .option("--proxy-url <url>", "Route requests through an HTTP/HTTPS proxy.")
    .option("--ignore-robots-txt", "Skip robots.txt checks.", false)
    .option("--timeout-ms <milliseconds>", "Request timeout in milliseconds.", "30000")
    .option("--json", "Emit structured metadata plus content.", false)
    .action(async (url, options) => {
      const parsedOptions = {
        maxLength: Number(options.maxLength),
        startIndex: Number(options.startIndex),
        raw: options.raw,
        userAgent: options.userAgent ?? BROWSER_USER_AGENT,
        proxyUrl: options.proxyUrl,
        ignoreRobotsTxt: options.ignoreRobotsTxt,
        timeoutMs: Number(options.timeoutMs),
        json: options.json,
      };

      try {
        if (isUrlBlacklisted(url)) {
          throw new WebFetchError(`URL is blocked by the bing-fetch blacklist: ${url}`);
        }
        const result = await fetchFromWeb(url, parsedOptions);
        console.log(parsedOptions.json ? renderJson(result) : `${result.prefix}Contents of ${result.url}:\n${result.content}`);
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
