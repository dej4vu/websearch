import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";
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

export function isHtml(pageRaw, contentType) {
  return (
    pageRaw.slice(0, 100).toLowerCase().includes("<html") ||
    contentType.toLowerCase().includes("text/html") ||
    contentType.length === 0
  );
}
