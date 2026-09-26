import test from "node:test";
import assert from "node:assert/strict";
import {
  buildYuqueMarkdownUrl,
  cleanYuqueMarkdown,
  extractYuqueArticleMeta,
  htmlToMarkdown,
  isJuejinArticleUrl,
  isYuqueArticleUrl,
  juejinArticleToMarkdown,
} from "../src/lib/content.js";

test("documentation fallback preserves code blocks when readability undershoots", () => {
  const longNav = Array.from({ length: 80 }, (_, i) => `<li><a href="/${i}">Nav ${i}</a></li>`).join("");
  const html = `<!doctype html><html><body><main>
    <nav><p>On this page</p><ul>${longNav}</ul></nav>
    <div class="mdx-content">
      <h1>Install</h1>
      <p>Run the installer.</p>
      <pre><code>npm install -g example-cli</code></pre>
      <h2>Configure</h2>
      <pre><code>{ "BASE_URL": "https://example.com" }</code></pre>
    </div>
  </main></body></html>`;

  const markdown = htmlToMarkdown(html, "https://example.com/docs");
  assert.match(markdown, /npm install -g example-cli/);
  assert.match(markdown, /BASE_URL/);
  assert.doesNotMatch(markdown, /Nav 70/);
});

test("highlighted pre elements without a code child become fenced code", () => {
  const html = `<!doctype html><html><body><article>
    <h1>Install</h1>
    <pre><span># Start here</span>
npx example-cli</pre>
  </article></body></html>`;

  const markdown = htmlToMarkdown(html, "https://example.com/docs");
  assert.match(markdown, /```/);
  assert.match(markdown, /npx example-cli/);
  assert.doesNotMatch(markdown, /^## Start here$/m);
});

test("pre elements with one code child per line keep their line breaks", () => {
  const html = `<!doctype html><html><body><article>
    <h1>Tree</h1>
    <pre><code>root/</code><code><span>&nbsp;&nbsp;├── a.txt</span></code><code><span>&nbsp;&nbsp;└── b.txt</span></code></pre>
  </article></body></html>`;

  const markdown = htmlToMarkdown(html, "https://example.com/tree");
  assert.ok(markdown.includes("```\nroot/\n  ├── a.txt\n  └── b.txt\n```"));
});

test("style attributes that crash the jsdom CSS parser are stripped before parsing", () => {
  // Setting a background longhand after the shorthand throws inside jsdom 29.
  const html = `<!doctype html><html><body><article>
    <h1>Header bar</h1>
    <p style="display: block;background: none;background-position-x: 10px;background-color: red;">Styled body text.</p>
  </article></body></html>`;

  const markdown = htmlToMarkdown(html, "https://example.com/styled");
  assert.match(markdown, /Styled body text\./);
});

test("paragraph-wrapped list items stay a tight list without blank indented lines", () => {
  const html = `<!doctype html><html><body><article>
    <h1>Steps</h1>
    <ul><li><p>Install the CLI.</p></li><li><p>Run the setup wizard.</p></li></ul>
  </article></body></html>`;

  const markdown = htmlToMarkdown(html, "https://example.com/steps");
  assert.ok(markdown.includes("*   Install the CLI.\n*   Run the setup wizard."));
  assert.doesNotMatch(markdown, /^[ \t]+$/m);
});

test("GFM tables are preserved as markdown tables (Readability path)", () => {
  const html = `<!doctype html><html><body><article>
    <h1>Pricing</h1>
    <table>
      <thead><tr><th>Plan</th><th>Price</th></tr></thead>
      <tbody>
        <tr><td>Free</td><td>$0</td></tr>
        <tr><td>Pro</td><td>$20</td></tr>
      </tbody>
    </table>
  </article></body></html>`;

  const markdown = htmlToMarkdown(html, "https://example.com/pricing");
  assert.match(markdown, /\| Plan \| Price \|/);
  assert.match(markdown, /\| --- \| --- \|/);
  assert.match(markdown, /\| Free \| \$0 \|/);
  assert.match(markdown, /\| Pro \| \$20 \|/);
  assert.doesNotMatch(markdown, /Plan\s+Price\s+Free/);
});

test("GFM tables survive the mdx-content fallback path", () => {
  const longNav = Array.from({ length: 80 }, (_, i) => `<li><a href="/${i}">Nav ${i}</a></li>`).join("");
  const html = `<!doctype html><html><body><main>
    <nav><p>On this page</p><ul>${longNav}</ul></nav>
    <div class="mdx-content">
      <h1>Limits</h1>
      <p>Usage limits per plan. Please consult the table below before choosing a plan, since tier limits apply to every workspace and every model family.</p>
      <table>
        <thead><tr><th>Tier</th><th>Tokens</th></tr></thead>
        <tbody>
          <tr><td>Free</td><td>1M</td></tr>
          <tr><td>Pro</td><td>10M</td></tr>
        </tbody>
      </table>
    </div>
  </main></body></html>`;

  const markdown = htmlToMarkdown(html, "https://docs.example.com/limits");
  assert.match(markdown, /\| Tier \| Tokens \|/);
  assert.match(markdown, /\| Free \| 1M \|/);
  assert.match(markdown, /\| Pro \| 10M \|/);
});

test("Juejin SSR body keeps tables and code while resolving tracked links", () => {
  const html = `<!doctype html><html><head>
    <script type="application/ld+json">[{
      "@type": "BlogPosting",
      "headline": "Juejin title",
      "author": { "name": "Djvu677" },
      "datePublished": "2026-08-31T09:22:23+00:00"
    }]</script>
  </head><body>
    <article itemprop="articleBody"><div class="markdown-body">
      <p>${"Juejin body text. ".repeat(20)}</p>
      <table>
        <thead><tr><th>Tool</th><th>Result</th></tr></thead>
        <tbody><tr><td>fetch</td><td>markdown</td></tr></tbody>
      </table>
      <pre><code class="hljs language-markdown"><table></table>
| Hidden | Table |</code></pre>
      <a href="https://link.juejin.cn?target=https%3A%2F%2Fexample.com%2Ftarget">Destination</a>
    </div></article>
  </body></html>`;
  const url = "https://juejin.cn/post/7680021879072981043";

  assert.equal(isJuejinArticleUrl(url), true);
  const article = juejinArticleToMarkdown(html, url);
  assert.match(article.markdown, /^# Juejin title\n\n> Djvu677 · 2026-08-31/);
  assert.match(article.markdown, /\| Tool \| Result \|/);
  assert.match(article.markdown, /\| fetch \| markdown \|/);
  assert.match(article.markdown, /```markdown\n\n\| Hidden \| Table \|/);
  assert.doesNotMatch(article.markdown, /<table><\/table>/);
  assert.match(article.markdown, /https:\/\/example\.com\/target/);
  assert.equal(article.meta.platform, "juejin");
  assert.equal(article.meta.title, "Juejin title");
});

test("Yuque exports use the document markdown URL and remove font wrappers", () => {
  const url = "https://www.yuque.com/some-user/some-book/some-doc?from=notification";
  assert.equal(isYuqueArticleUrl("https://yuque.com/some-user/some-book/some-doc"), true);
  assert.equal(buildYuqueMarkdownUrl(url), "https://www.yuque.com/some-user/some-book/some-doc/markdown?attachment=true&latexcode=false&anchor=false&linebreak=false");

  const pageHtml = `<!doctype html><html><head>
    <meta property="og:title" content="Document title · 语雀">
    <meta name="description" content="Short description.">
    <meta name="weibo:article:create_at" content="2021-08-17 18:22:29">
    <meta name="weibo:article:update_at" content="2021-08-26 06:59:02">
  </head></html>`;
  const meta = extractYuqueArticleMeta(pageHtml);
  assert.equal(meta.title, "Document title");
  assert.equal(meta.description, "Short description.");

  assert.equal(
    cleanYuqueMarkdown("Before\n\n<font style=\"color:red;\">colored</font>\n\n```\n<font>literal</font>\n```"),
    "Before\n\ncolored\n\n```\n<font>literal</font>\n```",
  );
});
