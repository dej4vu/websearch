import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { ProxyAgent } from "undici";
import { fetchFromWeb } from "../src/commands/fetch.js";
import { createDispatcher } from "../src/lib/http.js";
import { robotsUrlFor } from "../src/lib/robots.js";
import { htmlToMarkdown } from "../src/lib/content.js";

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function serverWithRobots(robotsBody = "", robotsStatus = 200) {
  return http.createServer((request, response) => {
    if (request.url === "/robots.txt") {
      response.writeHead(robotsStatus, { "content-type": "text/plain" });
      response.end(robotsBody);
    } else {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("reachable");
    }
  });
}

test("official parity: robots URLs across path, query, fragment, port, and scheme", () => {
  assert.equal(robotsUrlFor("https://example.com/page"), "https://example.com/robots.txt");
  assert.equal(robotsUrlFor("https://example.com/deep/page"), "https://example.com/robots.txt");
  assert.equal(robotsUrlFor("https://example.com/page?foo=bar&baz=qux"), "https://example.com/robots.txt");
  assert.equal(robotsUrlFor("https://example.com:8080/page"), "https://example.com:8080/robots.txt");
  assert.equal(robotsUrlFor("https://example.com/page#section"), "https://example.com/robots.txt");
  assert.equal(robotsUrlFor("http://example.com/page"), "http://example.com/robots.txt");
});

test("official parity: simple HTML becomes markdown", () => {
  const markdown = htmlToMarkdown(`
    <html><body><article>
      <h1>Hello World</h1>
      <p>This is a test paragraph.</p>
    </article></body></html>
  `, "https://example.com/page");
  assert.match(markdown, /test paragraph/i);
});

test("official parity: links become markdown links", () => {
  const markdown = htmlToMarkdown(`
    <html><body><article>
      <p>Visit <a href="https://example.com">Example</a> for more.</p>
    </article></body></html>
  `, "https://example.com/page");
  assert.match(markdown, /\[Example\]\(https:\/\/example\.com\/\)/);
});

test("official parity: empty content returns an extraction error", () => {
  assert.match(htmlToMarkdown("", "https://example.com/page"), /<error>/);
});

test("official parity: robots 404 allows fetching", async () => {
  const server = serverWithRobots("not found", 404);
  const port = await listen(server);
  try {
    await assert.doesNotReject(() =>
      fetchFromWeb(`http://127.0.0.1:${port}/page`, {}),
    );
  } finally {
    server.close();
  }
});

test("official parity: robots 401 blocks fetching", async () => {
  const server = serverWithRobots("", 401);
  const port = await listen(server);
  try {
    await assert.rejects(() => fetchFromWeb(`http://127.0.0.1:${port}/page`, {}), /401/);
  } finally {
    server.close();
  }
});

test("official parity: robots 403 blocks fetching", async () => {
  const server = serverWithRobots("", 403);
  const port = await listen(server);
  try {
    await assert.rejects(() => fetchFromWeb(`http://127.0.0.1:${port}/page`, {}), /403/);
  } finally {
    server.close();
  }
});

test("official parity: robots allows-all permits fetching", async () => {
  const server = serverWithRobots("User-agent: *\nAllow: /");
  const port = await listen(server);
  try {
    await assert.doesNotReject(() => fetchFromWeb(`http://127.0.0.1:${port}/page`, {}));
  } finally {
    server.close();
  }
});

test("official parity: robots disallows-all blocks fetching", async () => {
  const server = serverWithRobots("User-agent: *\nDisallow: /");
  const port = await listen(server);
  try {
    await assert.rejects(() => fetchFromWeb(`http://127.0.0.1:${port}/page`, {}), /does not allow/);
  } finally {
    server.close();
  }
});

test("official parity: an HTML page is converted", async () => {
  const server = http.createServer((request, response) => {
    if (request.url === "/robots.txt") {
      response.writeHead(404);
      return response.end();
    }
    response.writeHead(200, { "content-type": "text/html" });
    response.end("<html><body><article><h1>Welcome</h1><p>Readable body</p></article></body></html>");
  });
  const port = await listen(server);
  try {
    const result = await fetchFromWeb(`http://127.0.0.1:${port}/page`, {});
    assert.equal(result.markdown, true);
    assert.match(result.content, /Readable body/);
    assert.equal(result.prefix, "");
  } finally {
    server.close();
  }
});

test("official parity: raw HTML returns response text with the raw prefix", async () => {
  const html = "<html><body><h1>Test</h1></body></html>";
  const server = http.createServer((request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end(html);
  });
  const port = await listen(server);
  try {
    const result = await fetchFromWeb(`http://127.0.0.1:${port}/page`, {
      ignoreRobotsTxt: true,
      raw: true,
    });
    assert.equal(result.content, html);
    assert.match(result.prefix, /cannot be simplified to markdown/);
  } finally {
    server.close();
  }
});

test("official parity: JSON returns raw content with the raw prefix", async () => {
  const server = http.createServer((request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"key":"value"}');
  });
  const port = await listen(server);
  try {
    const result = await fetchFromWeb(`http://127.0.0.1:${port}/data`, {
      ignoreRobotsTxt: true,
    });
    assert.equal(result.content, '{"key":"value"}');
    assert.match(result.prefix, /Content type application\/json/);
    assert.equal(result.markdown, false);
  } finally {
    server.close();
  }
});

test("official parity: 404 raises a fetch error", async () => {
  const server = http.createServer((request, response) => response.writeHead(404).end());
  const port = await listen(server);
  try {
    await assert.rejects(() => fetchFromWeb(`http://127.0.0.1:${port}/missing`, { ignoreRobotsTxt: true }), /404/);
  } finally {
    server.close();
  }
});

test("official parity: 500 raises a fetch error", async () => {
  const server = http.createServer((request, response) => response.writeHead(500).end());
  const port = await listen(server);
  try {
    await assert.rejects(() => fetchFromWeb(`http://127.0.0.1:${port}/broken`, { ignoreRobotsTxt: true }), /500/);
  } finally {
    server.close();
  }
});

test("official parity: HTTP proxy creates a dispatcher", () => {
  const dispatcher = createDispatcher("http://127.0.0.1:18080");
  assert.ok(dispatcher instanceof ProxyAgent);
});

test("official parity: invalid proxy schemes are rejected", () => {
  assert.throws(() => createDispatcher("not-a-url"), /Invalid proxy/);
  assert.throws(() => createDispatcher("ftp://proxy.example.com:8080"), /http: or https:/);
});
