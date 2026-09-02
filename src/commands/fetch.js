import { request, createDispatcher } from "../lib/http.js";
import { checkMayAutonomouslyFetchUrl } from "../lib/robots.js";
import { htmlToMarkdown, isHtml } from "../lib/content.js";
import { WebFetchError } from "../errors.js";

const DEFAULT_USER_AGENT =
  "WebSearchCLI/0.1 (+https://github.com/dej4vu/websearch)";
const DEFAULT_MAX_LENGTH = 10000;
const DEFAULT_TIMEOUT_MS = 30000;

function parsePositiveInteger(value, optionName, { maximum = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > maximum) {
    throw new WebFetchError(`${optionName} must be an integer between 1 and ${maximum}`);
  }
  return parsed;
}

function parseStartIndex(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new WebFetchError("--start-index must be an integer of at least 0");
  }
  return parsed;
}

export async function fetchFromWeb(url, options) {
  const userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
  const proxyUrl = options.proxyUrl;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const max_length = options.maxLength ?? DEFAULT_MAX_LENGTH;
  const start_index = options.startIndex ?? 0;
  const raw = options.raw ?? false;

  if (!/^(https?:\/\/)/i.test(url)) {
    throw new WebFetchError("URL must start with http:// or https://");
  }

  // Reuse one connection pool and one proxy dispatcher for robots and content.
  let dispatcher;
  try {
    dispatcher = createDispatcher(proxyUrl);
  } catch (error) {
    if (dispatcher) dispatcher.close?.();
    throw error;
  }

  const requestContext = {
    userAgent,
    proxyUrl,
    timeoutMs,
    dispatcher,
  };

  try {
    if (!options.ignoreRobotsTxt) {
      await checkMayAutonomouslyFetchUrl(url, requestContext);
    }

    const response = await request(url, requestContext);
    if (response.status >= 400) {
      throw new WebFetchError(`Failed to fetch ${url} - status code ${response.status}`);
    }

    const pageRaw = await response.text();
    const contentType = response.headers.get("content-type") ?? "";
    const convert = isHtml(pageRaw, contentType) && !raw;
    const content = convert ? htmlToMarkdown(pageRaw, url) : pageRaw;
    const prefix = convert
      ? ""
      : `Content type ${contentType || "unknown"} cannot be simplified to markdown, but here is the raw content:\n`;

    const originalLength = content.length;
    let output;
    let nextStartIndex;

    if (start_index >= originalLength) {
      output = "<error>No more content available.</error>";
      nextStartIndex = null;
    } else {
      const truncated = content.slice(start_index, start_index + max_length);
      if (!truncated) {
        output = "<error>No more content available.</error>";
        nextStartIndex = null;
      } else {
        const remaining = originalLength - (start_index + truncated.length);
        if (remaining > 0) {
          nextStartIndex = start_index + truncated.length;
          output = `${truncated}\n\n<error>Content truncated. Call the fetch tool with a start_index of ${nextStartIndex} to get more content.</error>`;
        } else {
          nextStartIndex = null;
          output = truncated;
        }
      }
    }

    return {
      url: response.url || url,
      requestedUrl: url,
      status: response.status,
      contentType,
      markdown: convert,
      contentLength: originalLength,
      startIndex: start_index,
      maxLength: max_length,
      nextStartIndex,
      truncated: nextStartIndex !== null,
      prefix,
      content: output,
    };
  } finally {
    await dispatcher?.close?.();
  }
}

function renderPlain(result) {
  return `${result.prefix}Contents of ${result.url}:\n${result.content}`;
}

function renderJson(result) {
  return JSON.stringify({
    ok: true,
    url: result.url,
    requestedUrl: result.requestedUrl,
    status: result.status,
    contentType: result.contentType,
    markdown: result.markdown,
    contentLength: result.contentLength,
    startIndex: result.startIndex,
    maxLength: result.maxLength,
    nextStartIndex: result.nextStartIndex,
    truncated: result.truncated,
    content: result.content,
  }, null, 2);
}

export function registerFetchCommand(program) {
  return program
    .command("fetch")
    .description("Fetch a URL and extract readable HTML as markdown.")
    .argument("<url>", "HTTP or HTTPS URL to fetch.")
    .option("--max-length <characters>", "Maximum characters to return.", "10000")
    .option("--start-index <characters>", "Return output beginning at this index.", "0")
    .option("--raw", "Return raw response text without markdown extraction.", false)
    .option("--user-agent <user-agent>", "Custom User-Agent for requests.")
    .option("--proxy-url <url>", "Route requests through an HTTP or HTTPS proxy.")
    .option("--ignore-robots-txt", "Skip robots.txt checks.", false)
    .option("--timeout-ms <milliseconds>", "Request timeout in milliseconds.", "30000")
    .option("--json", "Emit structured metadata plus content.", false)
    .action(async (url, options) => {
      const parsedOptions = {
        maxLength: parsePositiveInteger(options.maxLength, "--max-length", { maximum: 1_000_000 }),
        startIndex: parseStartIndex(options.startIndex),
        raw: options.raw,
        userAgent: options.userAgent,
        proxyUrl: options.proxyUrl,
        ignoreRobotsTxt: options.ignoreRobotsTxt,
        timeoutMs: parsePositiveInteger(options.timeoutMs, "--timeout-ms"),
        json: options.json,
      };

      try {
        const result = await fetchFromWeb(url, parsedOptions);
        if (parsedOptions.json) {
          console.log(renderJson(result));
        } else {
          console.log(renderPlain(result));
        }
      } catch (error) {
        const message = error instanceof WebFetchError || error instanceof Error
          ? error.message
          : String(error);

        if (parsedOptions.json) {
          console.error(JSON.stringify({ ok: false, error: message }, null, 2));
        } else {
          console.error(`websearch: ${message}`);
        }
        process.exitCode = 1;
      }
    });
}
