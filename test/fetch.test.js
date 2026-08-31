import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { fetchFromWeb } from "../src/commands/fetch.js";

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

test("fetch converts readable HTML to markdown and reports truncation", async () => {
  const server = http.createServer((request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`<!doctype html><html><head><title>Example</title></head><body><article><h1>Hello</h1><p>${"x".repeat(5000)}</p></article></body></html>`);
  });
  const port = await listen(server);
  try {
    const result = await fetchFromWeb(`http://127.0.0.1:${port}/`, {
      maxLength: 20,
      startIndex: 0,
      ignoreRobotsTxt: false,
    });
    assert.equal(result.status, 200);
    assert.equal(result.markdown, true);
    assert.match(result.content, /Content truncated/);
    assert.equal(result.nextStartIndex, 20);
  } finally {
    server.close();
  }
});

test("fetch honors a disallow-all robots file", async () => {
  const server = http.createServer((request, response) => {
    if (request.url === "/robots.txt") {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("User-agent: *\nDisallow: /private\n");
    } else {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("secret");
    }
  });
  const port = await listen(server);
  try {
    await assert.rejects(
      () => fetchFromWeb(`http://127.0.0.1:${port}/private`, {}),
      /does not allow autonomous fetching/,
    );
  } finally {
    server.close();
  }
});

test("raw mode skips markdown extraction", async () => {
  const server = http.createServer((request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end("<html><body><p>Raw body</p></body></html>");
  });
  const port = await listen(server);
  try {
    const result = await fetchFromWeb(`http://127.0.0.1:${port}/`, { raw: true });
    assert.equal(result.markdown, false);
    assert.match(result.content, /Raw body/);
  } finally {
    server.close();
  }
});
