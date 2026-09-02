import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import { WebFetchError } from "../errors.js";

const FALLBACK_SELECTORS = [
  '[itemprop="articleBody"]',
  "article",
  "main .mdx-content",
  "[role='main'] .mdx-content",
  ".mdx-content",
  "[role='main']",
  "main",
];

function textLength(html) {
  return new JSDOM(html).window.document.body.textContent.replace(/\s+/g, "").length;
}

function findFallbackHtml(document) {
  for (const selector of FALLBACK_SELECTORS) {
    const element = document.querySelector(selector);
    if (!element || textLength(element.innerHTML) < 1000) {
      continue;
    }

    const cloned = element.cloneNode(true);
    for (const noise of cloned.querySelectorAll(
      "script, style, noscript, template, nav, aside, footer, button, [aria-hidden='true']",
    )) {
      noise.remove();
    }

    // Heading anchor buttons often contain only a zero-width space. They become
    // empty Markdown headings and dead links if they reach Turndown.
    for (const anchor of cloned.querySelectorAll("a[href^='#']")) {
      if (anchor.textContent.replace(/\u200b/g, "").trim() === "") {
        const wrapper = anchor.parentElement;
        anchor.remove();
        if (
          wrapper?.tagName === "DIV" &&
          wrapper.childElementCount === 0 &&
          textLength(wrapper.innerHTML) === 0
        ) {
          wrapper.remove();
        }
      }
    }

    if (textLength(cloned.innerHTML) >= 500) {
      return cloned.innerHTML;
    }
  }
  return null;
}

function extractArticleHtml(html, baseUrl) {
  const document = new JSDOM(html, { url: baseUrl }).window.document;
  const fallbackHtml = findFallbackHtml(document);
  const article = new Readability(document).parse();
  const readableHtml = article?.content;

  if (readableHtml && fallbackHtml) {
    const readableLength = textLength(readableHtml);
    const fallbackLength = textLength(fallbackHtml);
    // Documentation frameworks often wrap the real content in a container that
    // Readability undervalues. Use the more complete container when the
    // readable result is tiny compared with the obvious page body.
    if (readableLength < 1000 && fallbackLength > readableLength * 2) {
      return fallbackHtml;
    }
  }

  return readableHtml ?? fallbackHtml;
}

function codeFence(text) {
  let length = 3;
  while (text.includes("`".repeat(length))) {
    length += 1;
  }
  return "`".repeat(length);
}

export function htmlToMarkdown(html, baseUrl) {
  const simplified = extractArticleHtml(html, baseUrl);

  if (!simplified) {
    return "<error>Page failed to be simplified from HTML</error>";
  }

  const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
  });
  // Enables GFM table conversion, matching the official fetch MCP server.
  // Without it, Turndown flattens <table> content into plain paragraphs.
  turndown.use(gfm);

  // Turndown's built-in fenced block rule requires `pre > code`, but GitHub
  // and several documentation sites render syntax-highlighted code as
  // `pre > span`. Preserve those blocks as fenced code instead of dropping the
  // code formatting.
  turndown.addRule("allPreElementsToFencedCode", {
    filter: ["pre"],
    replacement: (_content, node) => {
      const code = (node.textContent ?? "").replace(/\n$/, "");
      const fence = codeFence(code);
      return `\n\n${fence}\n${code}\n${fence}\n\n`;
    },
  });

  return turndown
    .turndown(simplified)
    .replace(/[\u200b\u200e\u200f]/g, "")
    .trim();
}

export function isWeixinArticleUrl(url) {
  try {
    return new URL(url).hostname.toLowerCase() === "mp.weixin.qq.com";
  } catch {
    return false;
  }
}

export function extractWeixinArticleMeta(html) {
  const document = new JSDOM(html).window.document;
  const title = (document.querySelector("#activity-name")?.textContent
    ?? document.querySelector('meta[property="og:title"]')?.getAttribute("content") ?? "")
    .replace(/\s+/g, " ").trim();
  const account = (document.querySelector("#js_name")?.textContent
    ?? document.querySelector('meta[name="author"]')?.getAttribute("content") ?? "")
    .replace(/\s+/g, " ").trim();

  let publishedAt;
  const ct = html.match(/var ct = "?(\d{10})"?/);
  if (ct) {
    const date = new Date(Number(ct[1]) * 1000);
    if (!Number.isNaN(date.getTime())) publishedAt = date.toISOString();
  }
  const createTime = html.match(/var createTime = '([^']+)'/)?.[1]
    ?? document.querySelector("#publish_time")?.textContent?.trim();
  const author = document.querySelector("#js_author_name")?.textContent
    ?.replace(/\s+/g, " ").trim() || undefined;

  return {
    platform: "weixin",
    title: title || undefined,
    account: account || undefined,
    author,
    publishedAt,
    publishedAtText: createTime || undefined,
  };
}

function prepareWeixinContentHtml(html) {
  const document = new JSDOM(html).window.document;
  const content = document.querySelector("#js_content");
  if (!content) return null;

  const cloned = content.cloneNode(true);
  for (const noise of cloned.querySelectorAll(
    "script, style, noscript, template, button, input, [aria-hidden='true'], mpvoice, mp-common-profile",
  )) {
    noise.remove();
  }

  // WeChat lazy-loads article images: the real URL sits in data-src while src
  // is a placeholder (often a data: URI or empty). Promote it so Turndown
  // emits working markdown image links.
  for (const image of cloned.querySelectorAll("img")) {
    const realSrc = image.getAttribute("data-src");
    if (realSrc) {
      image.setAttribute("src", realSrc);
    }
    image.removeAttribute("data-src");
  }

  return cloned.innerHTML;
}

export function weixinArticleToMarkdown(html, baseUrl) {
  const contentHtml = prepareWeixinContentHtml(html);
  if (!contentHtml) return null;

  const meta = extractWeixinArticleMeta(html);
  const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
  });
  turndown.use(gfm);
  turndown.addRule("allPreElementsToFencedCode", {
    filter: ["pre"],
    replacement: (_content, node) => {
      const code = (node.textContent ?? "").replace(/\n$/, "");
      const fence = codeFence(code);
      return `\n\n${fence}\n${code}\n${fence}\n\n`;
    },
  });

  const body = turndown
    .turndown(contentHtml)
    .replace(/[\u200b\u200e\u200f]/g, "")
    .trim();

  const header = [
    meta.title ? `# ${meta.title}` : "",
    meta.account || meta.publishedAtText
      ? `> ${[meta.account, meta.publishedAtText].filter(Boolean).join(" · ")}`
      : "",
  ].filter(Boolean).join("\n\n");

  if (!header && !body) return null;

  return {
    markdown: [header, body].filter(Boolean).join("\n\n"),
    meta,
  };
}

export function isHtml(pageRaw, contentType) {
  return (
    pageRaw.slice(0, 100).toLowerCase().includes("<html") ||
    contentType.toLowerCase().includes("text/html") ||
    contentType.length === 0
  );
}
