import test from "node:test";
import assert from "node:assert/strict";
import { htmlToMarkdown } from "../src/lib/content.js";

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
