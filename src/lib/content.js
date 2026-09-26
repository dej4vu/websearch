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

// jsdom 29's in-house CSS parser crashes while parsing style attributes that
// set longhands (e.g. background-position-x) after a `background` shorthand —
// a pattern browsers' computed-style dumps use, which WeChat articles are
// full of. Nothing in the extraction pipeline reads CSS, so drop the
// attributes before parsing.
function stripStyleAttributes(html) {
  return html.replace(/(<[^>]*?)\s+style=(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "$1");
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

// WeChat code snippets render one line per <code> element inside a single
// <pre> (next to a decorative line-number <ul>). textContent would glue those
// lines together, so join the direct <code> children with newlines instead.
// <br> is honored for sites that break code lines with it rather than with
// real newlines.
function textWithBreaks(node) {
  let text = "";
  for (const child of Array.from(node.childNodes ?? [])) {
    if (child.nodeType === 3) {
      text += child.nodeValue ?? "";
    } else if (child.nodeType === 1) {
      text += child.tagName === "BR" ? "\n" : textWithBreaks(child);
    }
  }
  return text;
}

function preToFencedText(preElement) {
  const lineCodes = Array.from(preElement.children ?? [])
    .filter((child) => child.tagName === "CODE");
  const text = lineCodes.length > 1
    ? lineCodes.map(textWithBreaks).join("\n")
    : textWithBreaks(preElement);
  // &nbsp; is how WeChat indents code lines; keep plain spaces so the fenced
  // block stays copy-paste friendly.
  return text.replace(/\u00a0/g, " ").replace(/\n+$/, "");
}

function preLanguage(preElement) {
  const code = Array.from(preElement.children ?? [])
    .find((child) => child.tagName === "CODE");
  return code?.className?.match(/language-([^\s]+)/)?.[1] ?? "";
}

function createMarkdownConverter() {
  const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
  });
  // Enables GFM table conversion, matching the official fetch MCP server.
  // Without it, Turndown flattens <table> content into plain paragraphs.
  turndown.use(gfm);

  // Rules are prepended, so this must come after gfm to take precedence.
  // Syntax-highlighted Markdown snippets can contain an empty <table> that
  // turndown-plugin-gfm mishandles while probing for a heading row. Such
  // markup is display-only in Juejin posts, so remove it before GFM sees it.
  turndown.addRule("dropEmptyTables", {
    filter: (node) => node.nodeName === "TABLE" && !(node.rows?.length > 0),
    replacement: () => "",
  });

  // Turndown's built-in fenced block rule requires `pre > code`, but GitHub
  // and several documentation sites render syntax-highlighted code as
  // `pre > span`. Preserve those blocks as fenced code instead of dropping the
  // code formatting.
  turndown.addRule("allPreElementsToFencedCode", {
    filter: ["pre"],
    replacement: (_content, node) => {
      const code = preToFencedText(node);
      const fence = codeFence(code);
      const language = preLanguage(node);
      return `\n\n${fence}${language}\n${code}\n${fence}\n\n`;
    },
  });

  // Turndown keeps one trailing newline inside <li> content, which its list
  // indenting then turns into a blank `    ` line after every <li><p>…</p></li>
  // (WeChat and many CMSes wrap list items in paragraphs). Dropping the
  // newline keeps single-paragraph items a tight list.
  turndown.addRule("tightListItems", {
    filter: "li",
    replacement: (content, node, options) => {
      content = content
        .replace(/^\n+/, "")
        .replace(/\n+$/, "")
        .replace(/\n/g, "\n    ");
      let prefix = `${options.bulletListMarker}   `;
      const parent = node.parentNode;
      if (parent.tagName === "OL") {
        const start = parent.getAttribute("start");
        const index = Array.prototype.indexOf.call(parent.children, node);
        prefix = `${start ? Number(start) + index : index + 1}.  `;
      }
      return prefix + content + (node.nextSibling && !/\n$/.test(content) ? "\n" : "");
    },
  });
  return turndown;
}

function cleanMarkdownOutput(markdown) {
  return markdown
    .replace(/[\u200b\u200e\u200f]/g, "")
    // Safety net for indented blank lines from any other loose-list quirk.
    .replace(/^[ \t\u00a0]+$/gm, "")
    .trim();
}

export function htmlToMarkdown(html, baseUrl) {
  const simplified = extractArticleHtml(stripStyleAttributes(html), baseUrl);

  if (!simplified) {
    return "<error>Page failed to be simplified from HTML</error>";
  }

  return cleanMarkdownOutput(createMarkdownConverter().turndown(simplified));
}

export function isWeixinArticleUrl(url) {
  try {
    return new URL(url).hostname.toLowerCase() === "mp.weixin.qq.com";
  } catch {
    return false;
  }
}

export function isJuejinArticleUrl(url) {
  try {
    const { hostname, pathname } = new URL(url);
    return (
      (hostname.toLowerCase() === "juejin.cn" || hostname.endsWith(".juejin.cn"))
      && /^\/post\/[^/]+/.test(pathname)
    );
  } catch {
    return false;
  }
}

function extractJuejinArticleMeta(html) {
  const document = new JSDOM(html).window.document;
  let posting;
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const parsed = JSON.parse(script.textContent);
      for (const item of Array.isArray(parsed) ? parsed : [parsed]) {
        const types = Array.isArray(item?.["@type"]) ? item["@type"] : [item?.["@type"]];
        if (types.some((type) => ["BlogPosting", "Article"].includes(type))) {
          posting = item;
          break;
        }
      }
    } catch {
      // Structured data is only one of several metadata sources.
    }
    if (posting) break;
  }

  const title = (
    posting?.headline
      ?? document.querySelector(".article-title")?.textContent
      ?? document.querySelector('meta[property="og:title"]')?.getAttribute("content")
      ?? ""
  ).replace(/\s+/g, " ").trim();
  const author = (
    posting?.author?.name
      ?? document.querySelector(".author-name")?.textContent
      ?? document.querySelector('meta[name="author"]')?.getAttribute("content")
      ?? ""
  ).replace(/\s+/g, " ").trim();
  const publishedAt = posting?.datePublished
    ?? document.querySelector('meta[itemprop="datePublished"]')?.getAttribute("content");
  const publishedDate = publishedAt ? new Date(publishedAt) : undefined;

  return {
    platform: "juejin",
    title: title || undefined,
    author: author || undefined,
    publishedAt: publishedDate && !Number.isNaN(publishedDate.getTime())
      ? publishedDate.toISOString()
      : undefined,
    publishedAtText: publishedDate && !Number.isNaN(publishedDate.getTime())
      ? publishedDate.toISOString().slice(0, 10)
      : undefined,
  };
}

function resolveJuejinRedirects(root) {
  // Article links pass through Juejin's click tracker. Keep the user-facing
  // destination so copied Markdown links remain useful.
  for (const anchor of root.querySelectorAll("a[href]")) {
    try {
      const href = new URL(anchor.getAttribute("href"), root.ownerDocument.baseURI);
      if (href.hostname !== "link.juejin.cn" || !href.searchParams.has("target")) continue;
      const target = new URL(href.searchParams.get("target"));
      if (target.protocol === "http:" || target.protocol === "https:") {
        anchor.setAttribute("href", target.toString());
      }
    } catch {
      // Leave the original redirect in place if Juejin changes its format.
    }
  }
}

export function juejinArticleToMarkdown(html, baseUrl) {
  if (!isJuejinArticleUrl(baseUrl)) return null;

  const document = new JSDOM(stripStyleAttributes(html), { url: baseUrl }).window.document;
  const content = document.querySelector(
    'article[itemprop="articleBody"] .markdown-body, article .markdown-body',
  );
  if (!content) return null;

  const cloned = content.cloneNode(true);
  for (const noise of cloned.querySelectorAll(
    "script, style, noscript, template, button, input, [aria-hidden='true']",
  )) {
    noise.remove();
  }
  resolveJuejinRedirects(cloned);

  const bodyText = cloned.textContent.replace(/\s+/g, "");
  if (bodyText.length < 200) return null;

  const meta = extractJuejinArticleMeta(html);
  const body = cleanMarkdownOutput(createMarkdownConverter().turndown(cloned.innerHTML));
  const header = [
    meta.title ? `# ${meta.title}` : "",
    meta.author || meta.publishedAtText
      ? `> ${[meta.author, meta.publishedAtText].filter(Boolean).join(" · ")}`
      : "",
  ].filter(Boolean).join("\n\n");
  if (!header && !body) return null;

  return {
    markdown: [header, body].filter(Boolean).join("\n\n"),
    meta,
  };
}

export function isYuqueArticleUrl(url) {
  try {
    const { hostname, pathname } = new URL(url);
    const normalizedHostname = hostname.toLowerCase();
    if (
      normalizedHostname !== "yuque.com"
      && normalizedHostname !== "www.yuque.com"
      && !normalizedHostname.endsWith(".yuque.com")
    ) {
      return false;
    }
    const parts = pathname.split("/").filter(Boolean);
    return parts.length >= 3;
  } catch {
    return false;
  }
}

export function buildYuqueMarkdownUrl(url) {
  const markdownUrl = new URL(url);
  const parts = markdownUrl.pathname.split("/").filter(Boolean).slice(0, 3);
  markdownUrl.hash = "";
  markdownUrl.pathname = `/${parts.join("/")}/markdown`;
  markdownUrl.search = "";
  for (const [key, value] of Object.entries({
    attachment: "true",
    latexcode: "false",
    anchor: "false",
    linebreak: "false",
  })) {
    markdownUrl.searchParams.set(key, value);
  }
  return markdownUrl.toString();
}

export function extractYuqueArticleMeta(html) {
  const document = new JSDOM(html).window.document;
  const title = (
    document.querySelector('meta[property="og:title"]')?.getAttribute("content") ?? ""
  ).replace(/\s*·\s*语雀\s*$/, "").trim();
  const description = document.querySelector('meta[name="description"]')
    ?.getAttribute("content")?.trim();

  return {
    platform: "yuque",
    title: title || undefined,
    description: description || undefined,
    publishedAt: document.querySelector('meta[name="weibo:article:create_at"]')
      ?.getAttribute("content") || undefined,
    updatedAt: document.querySelector('meta[name="weibo:article:update_at"]')
      ?.getAttribute("content") || undefined,
  };
}

export function cleanYuqueMarkdown(markdown) {
  let inFence = false;
  return markdown
    .split("\n")
    .map((line) => {
      if (/^\s*(?:```|~~~)/.test(line)) inFence = !inFence;
      if (inFence) return line;
      // Yuque's Markdown export preserves editor color runs as <font> tags.
      // They are presentation-only and become HTML noise for agent consumers.
      return line.replace(/<\/?font\b[^>]*>/gi, "");
    })
    .join("\n")
    .replace(/^[ \t\u00a0]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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

function isBlankText(element) {
  return element.textContent.replace(/[\u00a0\u200b\s]/g, "") === "";
}

function containsMedia(element) {
  return element.querySelector("img, video, iframe, table, svg") !== null;
}

// Authors wrap cover images in heading tags and pad paragraphs with nbsp-only
// sections for vertical spacing. Unwrap the former and drop the latter so they
// don't turn into empty `#` headings and stray whitespace lines in Markdown.
function unwrapImageOnlyHeadings(root) {
  for (const heading of root.querySelectorAll("h1, h2, h3, h4, h5, h6")) {
    if (!heading.querySelector("img")) continue;
    if (!isBlankText(heading)) continue;
    const parent = heading.parentElement;
    if (!parent) continue;
    for (const child of [...heading.childNodes]) {
      parent.insertBefore(child, heading);
    }
    heading.remove();
  }
}

function pruneBlankSpacingBlocks(root) {
  // Repeat: removing inner blocks exposes parents that have become empty.
  for (let pass = 0; pass < 5; pass += 1) {
    let removed = false;
    for (const element of root.querySelectorAll("section, p, span, blockquote")) {
      if (element.closest("pre")) continue;
      if (containsMedia(element) || !isBlankText(element)) continue;
      element.remove();
      removed = true;
    }
    if (!removed) break;
  }
}

function prepareWeixinContentHtml(html) {
  const document = new JSDOM(html).window.document;
  const content = document.querySelector("#js_content");
  if (!content) return null;

  const cloned = content.cloneNode(true);
  for (const noise of cloned.querySelectorAll(
    "script, style, noscript, template, button, input, [aria-hidden='true'], "
    + "mpvoice, mp-common-profile, ul.code-snippet__line-index",
  )) {
    noise.remove();
  }
  pruneBlankSpacingBlocks(cloned);
  unwrapImageOnlyHeadings(cloned);

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

// Only consulted when the page has no #js_content, so articles that merely
// quote these phrases are unaffected.
const WEIXIN_BLOCKED_PAGE_MARKERS = [
  {
    pattern: /环境异常|完成验证后即可继续访问/,
    message: "WeChat served an environment-verification page instead of the article; "
      + "retry later, slow down, or use --proxy-url",
  },
  {
    pattern: /该内容已被发布者删除/,
    message: "WeChat article has been deleted by its author",
  },
  {
    pattern: /此内容因违规无法查看|该内容已被多人投诉/,
    message: "WeChat article is unavailable because it was reported or policy-blocked",
  },
  {
    pattern: /仅关注[^<>]{0,20}粉丝|作者设置了[^<>]{0,12}可见|粉丝(?:才)?(?:可见|可以查看)/,
    message: "WeChat article is visible to followers only",
  },
  {
    pattern: /系统出错|链接已过期|参数错误/,
    message: "WeChat article link is invalid or expired",
  },
];

function assertWeixinArticleNotBlocked(html) {
  for (const marker of WEIXIN_BLOCKED_PAGE_MARKERS) {
    if (marker.pattern.test(html)) {
      throw new WebFetchError(marker.message);
    }
  }
}

export function weixinArticleToMarkdown(html, baseUrl) {
  const safeHtml = stripStyleAttributes(html);
  const contentHtml = prepareWeixinContentHtml(safeHtml);
  if (!contentHtml) {
    assertWeixinArticleNotBlocked(safeHtml);
    return null;
  }

  const meta = extractWeixinArticleMeta(safeHtml);
  const body = cleanMarkdownOutput(createMarkdownConverter().turndown(contentHtml));

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
