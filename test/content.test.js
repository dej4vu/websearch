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
