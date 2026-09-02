import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {
  buildWeixinSearchUrl,
  parseWeixinResults,
  resolveSogouLink,
} from "../src/lib/weixin.js";
import {
  isWeixinArticleUrl,
  weixinArticleToMarkdown,
} from "../src/lib/content.js";

const link = "/link?url=dn9a_-gY295K0R&type=2&query=Temporal%20workflow&token=CAF3CE5D";

function articleResult({ title = "用 Claude + Temporal.io 构建流水线", timestamp = "1774438761" } = {}) {
  return `<li id="sogou_vr_11002601_box_0">
    <div class="img-box">
      <a href="${link}"><img src="//img01.sogoucdn.com/v2/thumb?url=https%3A%2F%2Fmmbiz.qpic.cn%2Fa.jpg"></a>
    </div>
    <div class="txt-box">
      <h3><a href="${link}">${title}</a></h3>
      <p class="txt-info" id="sogou_vr_11002601_summary_0">Pipeline Agent 的工程实践 snippet</p>
      <div class="s-p">
        <span class="all-time-y2">从黑客到保安</span>
        <span class="s2"><script>document.write(timeConvert('${timestamp}'))</script></span>
      </div>
    </div>
  </li>`;
}

test("weixin search builds Sogou article-search URLs", () => {
  assert.equal(
    buildWeixinSearchUrl("Temporal workflow", { page: 2 }),
    "https://weixin.sogou.com/weixin?type=2&query=Temporal+workflow&page=2&ie=utf8",
  );
  assert.throws(() => buildWeixinSearchUrl("  "), /must not be empty/);
  assert.throws(() => buildWeixinSearchUrl("q", { page: 11 }), /between 1 and 10/);
});

test("weixin search parses Sogou result fields, account, timestamps, and pagination", () => {
  const html = `<html><body><ul class="news-list">
    ${articleResult({ title: "用 Claude + <em><!--red_beg-->Temporal<!--red_end--></em>.io 构建流水线" })}
    <li><div class="txt-box"><h3>缺失链接的条目</h3></div></li>
  </ul>
  <div class="p-fy" id="pagebar_container"><span>1</span><a href="?query=x&type=2&page=2&ie=utf8">2</a></div>
  </body></html>`;

  const response = parseWeixinResults(html, { query: "Temporal", count: 10 });
  assert.equal(response.engine, "weixin-sogou");
  assert.equal(response.resultCount, 1);
  assert.equal(response.hasMore, true);
  assert.match(response.notice, /time-limited signed links/);

  const result = response.results[0];
  assert.equal(result.title, "用 Claude + Temporal.io 构建流水线");
  assert.equal(result.url, `https://weixin.sogou.com${link}`);
  assert.equal(result.account, "从黑客到保安");
  assert.equal(result.snippet, "Pipeline Agent 的工程实践 snippet");
  assert.equal(result.publishedAt, "2026-03-25T11:39:21.000Z");
  assert.equal(result.publishedAtSource, "sogou-timeConvert");
  assert.equal(result.coverImage, "https://img01.sogoucdn.com/v2/thumb?url=https%3A%2F%2Fmmbiz.qpic.cn%2Fa.jpg");
  assert.equal(result.dateMissing, false);
});

test("weixin search sorts by publish timestamp when sort is date", () => {
  const html = `<ul class="news-list">
    ${articleResult({ timestamp: "1774438761" })}
    ${articleResult({ title: "更新的一篇", timestamp: "1787673844" })}
  </ul><div id="pagebar_container"><span>1</span></div>`;

  const relevance = parseWeixinResults(html, { query: "q", sort: "relevance" });
  const byDate = parseWeixinResults(html, { query: "q", sort: "date" });
  assert.equal(relevance.results[0].publishedAt, "2026-03-25T11:39:21.000Z");
  assert.equal(byDate.results[0].title, "更新的一篇");
  assert.equal(byDate.results[1].title, "用 Claude + Temporal.io 构建流水线");
});

test("weixin search rejects unsupported freshness filters", async () => {
  await assert.rejects(
    () => import("../src/lib/weixin.js").then(({ searchWeixin }) =>
      searchWeixin("test", { freshness: "week" })),
    /not supported by the weixin engine/,
  );
});

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

test("resolveSogouLink concatenates the fragmented WeChat article URL", async () => {
  const server = http.createServer((request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end(`<script>
      var url = '';
      url += 'https://mp.';
      url += 'weixin.qq.c';
      url += 'om/s?src=11';
      url += '&timestamp=1788359577&';
      url += 'ver=6942&signature=abc&new=1';
      window.location.replace(url)
    </script>`);
  });
  const port = await listen(server);
  try {
    const resolved = await resolveSogouLink(`http://127.0.0.1:${port}/link?url=x`);
    assert.equal(
      resolved,
      "https://mp.weixin.qq.com/s?src=11&timestamp=1788359577&ver=6942&signature=abc&new=1",
    );
  } finally {
    server.close();
  }
});

test("resolveSogouLink detects the Sogou anti-crawler page", async () => {
  const server = http.createServer((request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end("<html><title>异常流量</title><body>请输入验证码</body></html>");
  });
  const port = await listen(server);
  try {
    await assert.rejects(
      () => resolveSogouLink(`http://127.0.0.1:${port}/link?url=x`),
      /anti-crawler/,
    );
  } finally {
    server.close();
  }
});

const weixinArticleHtml = `<!doctype html><html><head>
  <meta property="og:title" content="og title">
  <meta name="author" content="meta author">
  <script>var ct = "1774438680"; var createTime = '2026-03-25 19:38';</script>
  </head><body>
  <h1 class="rich_media_title" id="activity-name"><span class="js_title_inner">真实标题</span></h1>
  <span class="rich_media_meta_nickname" id="js_name">公众号名称</span>
  <div id="js_content" style="visibility: hidden; opacity: 0; ">
    <section><span leaf="">这是正文第一段。</span></section>
    <p><img src="data:image/png;base64,xxx" data-src="https://mmbiz.qpic.cn/mmbiz_png/real.png?wx_fmt=png"></p>
    <pre><span>const x = 1;</span></pre>
    <script>evil()</script>
  </div>
  </body></html>`;

test("weixin article extraction reads hidden js_content and promotes data-src images", () => {
  const article = weixinArticleToMarkdown(weixinArticleHtml, "https://mp.weixin.qq.com/s?x=1");
  assert.ok(article);
  assert.match(article.markdown, /^# 真实标题/);
  assert.match(article.markdown, /> 公众号名称 · 2026-03-25 19:38/);
  assert.match(article.markdown, /这是正文第一段。/);
  assert.ok(article.markdown.includes("![](https://mmbiz.qpic.cn/mmbiz_png/real.png?wx_fmt=png)"));
  assert.ok(article.markdown.includes("```\nconst x = 1;\n```"));
  assert.ok(!article.markdown.includes("evil()"));

  assert.equal(article.meta.platform, "weixin");
  assert.equal(article.meta.title, "真实标题");
  assert.equal(article.meta.account, "公众号名称");
  assert.equal(article.meta.publishedAt, "2026-03-25T11:38:00.000Z");
  assert.equal(article.meta.publishedAtText, "2026-03-25 19:38");
});

test("isWeixinArticleUrl matches only the mp.weixin.qq.com host", () => {
  assert.equal(isWeixinArticleUrl("https://mp.weixin.qq.com/s?src=11"), true);
  assert.equal(isWeixinArticleUrl("https://weixin.sogou.com/weixin?type=2"), false);
  assert.equal(isWeixinArticleUrl("not a url"), false);
});
