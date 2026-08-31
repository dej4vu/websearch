---
name: websearch
description: Search Bing CN and fetch live web pages through the npx-runnable websearch CLI, with readable markdown extraction, robots.txt handling, chunked pagination, raw mode, proxy support, and JSON output for Codex, Claude Code, and other CLI-capable agents.
---

# Websearch CLI

Use this skill when an agent needs current public web content, open-ended discovery, a direct URL preview, readable page text, or a raw response.

## Invocation

Prefer `npx` so users do not need a global installation. Use `-y` to avoid an interactive package-install prompt in non-interactive agent shells:

```sh
npx -y @dej4vu/websearch-cli@latest fetch https://example.com --json
```

For reproducible automation, pin the CLI version instead of using `@latest`:

```sh
npx -y @dej4vu/websearch-cli@0.3.0 fetch https://example.com --json
```

If the user already installed it globally, the shorter form is equivalent:

```sh
websearch fetch https://example.com --json
```

Run it from the repository checkout only when developing the CLI itself:

```sh
node ./bin/websearch.js fetch https://example.com --json
```

The CLI currently provides `search`, `fetch`, and `bing-fetch`.

## Search workflow

For open-ended discovery, start with Bing CN:

```sh
npx -y @dej4vu/websearch-cli@latest search "人工智能 最新进展" --count 10 --json
```

For model releases, incidents, prices, product changes, or any query where stale pages are misleading, rely on default `auto` ordering or be explicit:

```sh
npx -y @dej4vu/websearch-cli@latest search "GLM 最新模型" --count 15 --sort date --freshness month --json
```

Supported freshness windows are `any`, `day`, `week`, and `month`. Freshness is a scope filter, not a promise that every page has an exact publication date.

Paginate with `--offset`:

```sh
npx -y @dej4vu/websearch-cli@latest search "人工智能 最新进展" --count 20 --offset 20 --json
```

JSON results contain `rank`, `title`, `url`, `snippet`, `displayUrl`, `publishedAt`, `publishedAtText`, `publishedAtSource`, `dateMissing`, and `fetchBlocked`. Top-level metrics include `resultCount`, `pagesFetched`, `duplicatesRemoved`, `sort`, and `freshness`. Choose a non-blocked result and fetch it with the normal fetch workflow. `fetchBlocked` domains are marked, not deleted, by search; `bing-fetch` enforces the blacklist.

## Fetch workflow

1. Start with `--json` so you can inspect `truncated`, `contentLength`, and `nextStartIndex`.
2. If `nextStartIndex` is non-null, call again with `--start-index <value>`.
3. Prefer the default markdown mode for HTML. Use `--raw` only for JSON/XML/text APIs or when exact markup is required.
4. Leave robots.txt enforcement enabled unless the user explicitly authorizes ignoring it with `--ignore-robots-txt`.
5. For authentication-gated or subscription pages, do not bypass access controls; tell the user the page is unavailable.

### Bing fetch

Use this command when applying the `bing-search-cn` workflow:

```sh
npx -y @dej4vu/websearch-cli@latest bing-fetch https://example.com/article --json
```

It enforces the Bing skill blacklist for domains including Zhihu, Xiaohongshu, Weibo, WeChat, Douyin/TikTok, Bilibili, and CSDN. The generic `fetch` command does not add this blacklist.

## Useful options

- `--max-length <n>`: limit output; default 5000 and maximum 1,000,000 characters.
- `--start-index <n>`: continue a previous chunk.
- `--raw`: return raw response text.
- `--json`: emit structured output for reliable agent parsing.
- `--user-agent <ua>`: override the User-Agent.
- `--proxy-url <url>`: use an HTTP/HTTPS proxy.
- `--ignore-robots-txt`: bypass robots.txt only with explicit permission.
- `--timeout-ms <n>`: adjust the timeout; default 30000.

## Guidance for user-facing instructions

Show `npx -y @dej4vu/websearch-cli@latest ...` in onboarding docs. For CI, scheduled workflows, or skill configurations, show a pinned package version. Do not tell users to run `npm install -g` unless they explicitly want the `websearch` command on `PATH`.

## Output contract

Plain output is:

```text
Contents of <resolved-url>:
<content>
```

JSON output contains `ok`, `url`, `status`, `contentType`, `markdown`, `contentLength`, `startIndex`, `maxLength`, `nextStartIndex`, `truncated`, and `content`. On failure, JSON is written to stderr with `ok: false` and `error`.
