#!/usr/bin/env node

import { writeFile } from "node:fs/promises";
import { fetchFromWeb } from "../src/commands/fetch.js";

const TIMEOUT_MS = 20_000;
const CONCURRENCY = 5;

export const siteMatrix = [
  { group: "domestic", name: "BigModel Docs", url: "https://docs.bigmodel.cn/cn/coding-plan/tool/claude", minLength: 1500, expects: ["Claude Code", "ANTHROPIC_BASE_URL"] },
  { group: "domestic", name: "Juejin", url: "https://juejin.cn/post/7514981949480976396", minLength: 1500, expects: ["npm publish", "package.json"] },
  { group: "domestic", name: "CSDN", url: "https://blog.csdn.net/weixin_45801664/article/details/149000138", minLength: 500, expects: ["Open-WebSearch"] },
  { group: "domestic", name: "SegmentFault", url: "https://segmentfault.com/t/javascript", minLength: 300, expects: ["JavaScript"] },
  { group: "domestic", name: "Cnblogs", url: "https://www.cnblogs.com/cate/javascript/", minLength: 300, expects: ["博客园"] },
  { group: "domestic", name: "OSChina", url: "https://www.oschina.net/question", minLength: 200 },
  { group: "domestic", name: "Vue.js Chinese Docs", url: "https://cn.vuejs.org/guide/introduction.html", minLength: 500, expects: ["Vue"] },
  { group: "domestic", name: "Vite Chinese Docs", url: "https://cn.vitejs.dev/guide/", minLength: 300, expects: ["Vite"] },
  { group: "domestic", name: "VitePress Chinese Docs", url: "https://vitepress.dev/zh/guide/getting-started", minLength: 300, expects: ["VitePress"] },
  { group: "domestic", name: "Ant Design", url: "https://ant.design/docs/react/introduce-cn", minLength: 300, expects: ["Ant Design"] },
  { group: "domestic", name: "Element Plus", url: "https://element-plus.org/zh-CN/guide/installation.html", minLength: 300, expects: ["Element Plus"] },
  { group: "domestic", name: "TDesign", url: "https://tdesign.tencent.com/vue/getting-started", minLength: 200 },
  { group: "domestic", name: "Semi Design", url: "https://semi.design/zh-CN/start/getting-started", minLength: 200 },
  { group: "domestic", name: "Arco Design", url: "https://arco.design/vue/docs/start/overview", minLength: 200 },
  { group: "domestic", name: "UmiJS", url: "https://umi.dev/zh-CN/docs/introduce/introduce", minLength: 200, expects: ["Umi"] },
  { group: "domestic", name: "Taro", url: "https://taro-docs.jd.com/docs/", minLength: 200, expects: ["Taro"] },
  { group: "domestic", name: "Nacos", url: "https://nacos.io/zh-cn/docs/v2/quickstart/quick-start.html", minLength: 300, expects: ["Nacos"] },
  { group: "domestic", name: "Dubbo", url: "https://dubbo.apache.org/zh/overview/quickstart/", minLength: 300, expects: ["Dubbo"] },
  { group: "domestic", name: "Alibaba Cloud OSS", url: "https://help.aliyun.com/zh/oss/get-started/what-is-oss", minLength: 300, expects: ["OSS"] },
  { group: "domestic", name: "Tencent Cloud COS", url: "https://cloud.tencent.com/document/product/436/6242", minLength: 200 },
  { group: "international", name: "Wikipedia", url: "https://en.wikipedia.org/wiki/Web_scraping", minLength: 2000, expects: ["web scraping"] },
  { group: "international", name: "MDN", url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript", minLength: 500, expects: ["JavaScript"] },
  { group: "international", name: "Python Docs", url: "https://docs.python.org/3/tutorial/index.html", minLength: 500, expects: ["Python"] },
  { group: "international", name: "Node.js Docs", url: "https://nodejs.org/en/learn/getting-started/introduction-to-nodejs", minLength: 300, expects: ["Node.js"] },
  { group: "international", name: "TypeScript Docs", url: "https://www.typescriptlang.org/docs/handbook/intro.html", minLength: 300, expects: ["TypeScript"] },
  { group: "international", name: "Rust Book", url: "https://doc.rust-lang.org/book/ch01-01-installation.html", minLength: 500, expects: ["Rust"] },
  { group: "international", name: "Go Docs", url: "https://go.dev/doc/install", minLength: 300, expects: ["Go"] },
  { group: "international", name: "Docker Docs", url: "https://docs.docker.com/get-started/docker-overview/", minLength: 500, expects: ["Docker"] },
  { group: "international", name: "Kubernetes Docs", url: "https://kubernetes.io/docs/tutorials/kubernetes-basics/create-cluster/cluster-intro/", minLength: 300, expects: ["Kubernetes"] },
  { group: "international", name: "PostgreSQL Docs", url: "https://www.postgresql.org/docs/current/tutorial-start.html", minLength: 300, expects: ["PostgreSQL"] },
  { group: "international", name: "MySQL Docs", url: "https://dev.mysql.com/doc/refman/8.0/en/tutorial.html", minLength: 300, expects: ["MySQL"] },
  { group: "international", name: "Bash Manual", url: "https://www.gnu.org/software/bash/manual/bash.html", minLength: 1000, expects: ["Bash"] },
  { group: "international", name: "Ubuntu Server Docs", url: "https://ubuntu.com/server/docs", minLength: 200, expects: ["Ubuntu"] },
  { group: "international", name: "Debian FAQ", url: "https://www.debian.org/doc/manuals/debian-faq/", minLength: 300, expects: ["Debian"] },
  { group: "international", name: "GitHub README", url: "https://github.com/Aas-ee/open-webSearch/blob/main/README-zh.md", minLength: 5000, expects: ["open-websearch", "Docker"] },
  { group: "international", name: "Stack Overflow", url: "https://stackoverflow.com/questions/231767/what-does-the-yield-keyword-do-in-python", minLength: 500, expects: ["yield"] },
  { group: "international", name: "Hacker News", url: "https://news.ycombinator.com/item?id=1", minLength: 100 },
  { group: "international", name: "npm", url: "https://www.npmjs.com/package/commander", minLength: 300, expects: ["commander"] },
  { group: "international", name: "PyPI", url: "https://pypi.org/project/requests/", minLength: 300, expects: ["Requests"] },
  { group: "international", name: "Anthropic Docs", url: "https://docs.anthropic.com/en/docs/welcome", minLength: 300, expects: ["Anthropic"] },
];

const challengeMarkers = [
  "just a moment",
  "verify you are human",
  "enable javascript and cookies",
  "access denied",
  "unusual traffic",
  "captcha",
];

function classify(result, site, error) {
  if (error) {
    const message = String(error.message ?? error);
    if (/robots/i.test(message)) return { status: "robots_blocked", message };
    if (/status code (\d+)/i.test(message)) return { status: "http_error", message };
    return { status: "network_error", message };
  }

  const content = result.content.toLowerCase();
  if (challengeMarkers.some((marker) => content.includes(marker))) {
    return { status: "bot_challenge", message: "Challenge marker found" };
  }

  const missing = (site.expects ?? []).filter((needle) => (
    !result.content.toLowerCase().includes(needle.toLowerCase())
  ));
  const tooShort = result.contentLength < (site.minLength ?? 0);
  if (missing.length > 0 || tooShort) {
    return {
      status: "quality_fail",
      message: [
        tooShort ? `contentLength ${result.contentLength} < ${site.minLength}` : null,
        missing.length > 0 ? `missing: ${missing.join(", ")}` : null,
      ].filter(Boolean).join("; "),
    };
  }
  return { status: "pass", message: `${result.contentLength} chars` };
}

async function testSite(site) {
  try {
    const result = await fetchFromWeb(site.url, {
      timeoutMs: TIMEOUT_MS,
      ignoreRobotsTxt: false,
    });
    return { ...site, ...classify(result, site), httpStatus: result.status, markdown: result.markdown };
  } catch (error) {
    return { ...site, ...classify(null, site, error) };
  }
}

async function runPool(items, worker, limit = CONCURRENCY) {
  const results = [];
  let cursor = 0;
  async function lane() {
    while (cursor < items.length) {
      const index = cursor++;
      process.stderr.write(`[${index + 1}/${items.length}] ${items[index].name}\n`);
      results[index] = await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  return results;
}

function summarize(results) {
  const counts = {
    pass: 0,
    robots_blocked: 0,
    bot_challenge: 0,
    http_error: 0,
    network_error: 0,
    quality_fail: 0,
  };
  for (const result of results) {
    counts[result.status] = (counts[result.status] ?? 0) + 1;
  }
  return counts;
}

function render(results) {
  const counts = summarize(results);
  const lines = [
    `Site matrix: ${results.length} sites`,
    `Pass ${counts.pass}; robots blocked ${counts.robots_blocked}; challenges ${counts.bot_challenge}; HTTP ${counts.http_error}; network ${counts.network_error}; quality failures ${counts.quality_fail}`,
    "",
  ];
  for (const result of results) {
    lines.push(`${result.status.padEnd(15)} ${result.group.padEnd(13)} ${result.name} — ${result.message}`);
  }
  return lines.join("\n");
}

function groupSummary(results) {
  const groups = { domestic: [], international: [] };
  for (const result of results) {
    groups[result.group].push(result);
  }
  return Object.fromEntries(Object.entries(groups).map(([group, entries]) => {
    const counts = summarize(entries);
    const attempted = entries.length;
    const extractable = counts.pass + counts.quality_fail;
    return [group, {
      total: attempted,
      pass: counts.pass,
      passRate: `${Math.round((counts.pass / attempted) * 100)}%`,
      extractablePassRate: `${Math.round((counts.pass / extractable) * 100)}%`,
      robotsBlocked: counts.robots_blocked,
      challenges: counts.bot_challenge,
      errors: counts.http_error + counts.network_error,
      qualityFailures: counts.quality_fail,
    }];
  }));
}

if (process.argv[1] && process.argv[1].endsWith("run-site-matrix.mjs")) {
  const results = await runPool(siteMatrix, testSite);
  console.log(render(results));
  const outputFlagIndex = process.argv.indexOf("--output");
  if (outputFlagIndex > -1) {
    const outputPath = process.argv[outputFlagIndex + 1];
    await writeFile(outputPath, JSON.stringify({ summary: summarize(results), groups: groupSummary(results), results }, null, 2));
  }
  process.exitCode = results.some((result) => result.status === "quality_fail") ? 1 : 0;
}
