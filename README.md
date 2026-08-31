# @dej4vu/websearch-cli

Agent-oriented web tools for Codex, Claude Code, and other CLI-capable assistants. It currently provides Bing CN search, readable page fetching, and a blacklist-aware Bing result fetcher.

## Run with npx

No global installation is required:

```sh
npx -y @dej4vu/websearch-cli@latest fetch https://example.com --json
```

For automation, pin the version:

```sh
npx -y @dej4vu/websearch-cli@0.3.0 fetch https://example.com --json
```

If you prefer a short global command, this is optional:

```sh
npm install --global @dej4vu/websearch-cli
websearch fetch https://example.com --json
```

## Search Bing CN

Search with the integrated Bing CN engine:

```sh
npx -y @dej4vu/websearch-cli@latest search "人工智能 最新进展" --count 10 --json
```

Paginate through results:

```sh
npx -y @dej4vu/websearch-cli@latest search "人工智能 最新进展" --count 20 --offset 20 --json
```

Plain output shows ranked results with title, URL, site, snippet, and extracted date when available. JSON output includes `sort`, `freshness`, `requestedCount`, `resultCount`, `pagesFetched`, `pagesRequested`, `duplicatesRemoved`, `totalResults`, and `hasMore`. Each result includes `rank`, `title`, `url`, `snippet`, `displayUrl`, `publishedAt`, `publishedAtText`, `publishedAtSource`, `dateMissing`, and `fetchBlocked`.

### Search options

| Option | Description |
|---|---|
| `--engine <name>` | Search engine; currently `bing`. |
| `--count <n>` | Maximum results (default `10`, max `50`). |
| `--offset <n>` | Zero-based pagination offset. |
| `--sort <mode>` | `auto`, `relevance`, or `date`. |
| `--freshness <window>` | `any`, `day`, `week`, or `month`. |
| `--proxy-url <url>` | HTTP or HTTPS proxy for Bing. |
| `--timeout-ms <n>` | Search timeout (default `15000`). |
| `--json` | Emit structured search results. |

The first engine sends browser-like HTTP headers to `https://cn.bing.com/search`, uses Bing CN's web-result mode, follows its native next-page token when `count > 10`, decodes Bing redirect URLs, and aggregates/de-duplicates pages before sorting.

`auto` applies the Bing month freshness filter and date ordering for queries containing intent such as `最新`, `发布`, `上线`, `release`, `latest`, or `news`; ordinary technical queries stay in relevance order. Recency is not treated as a strict timestamp guarantee:

```sh
npx -y @dej4vu/websearch-cli@latest search "GLM 最新模型" --count 15 --json
```

Dates are parsed from Bing's `.news_dt`, snippet, title, and URL when possible. When no trustworthy date exists, `dateMissing` is `true`; the CLI does not invent a timestamp. Official domains receive a moderate tie-break boost, while dated results still dominate date ordering.

## Fetch

`fetch` performs an HTTP GET, follows redirects, checks `robots.txt`, extracts readable HTML, and converts it to Markdown. Non-HTML content is emitted as response text.

```sh
npx -y @dej4vu/websearch-cli@latest fetch https://example.com
```

Read a large page in chunks:

```sh
npx -y @dej4vu/websearch-cli@latest fetch https://example.com --max-length 5000 --json

# Use nextStartIndex from the JSON result.
npx -y @dej4vu/websearch-cli@latest fetch https://example.com --start-index 5000 --json
```

### Options

| Option | Description |
|---|---|
| `--max-length <n>` | Maximum characters to return (default `5000`, max `1000000`). |
| `--start-index <n>` | Return content from this character index. |
| `--raw` | Skip readability extraction and Markdown conversion. |
| `--user-agent <ua>` | Custom User-Agent. |
| `--proxy-url <url>` | HTTP or HTTPS proxy. |
| `--ignore-robots-txt` | Disable robots.txt checks. |
| `--timeout-ms <n>` | Per-request timeout (default `30000`). |
| `--json` | Emit structured metadata plus content. |

The command obeys `robots.txt` by default. Use `--ignore-robots-txt` only when the user explicitly asks for it and the use is otherwise permitted.

> Security note: this command can request network-reachable addresses, including internal hosts if allowed by the host. Put it behind an approval policy for untrusted agents.

### Bing result fetch

`bing-fetch` behaves like `fetch`, but also enforces the blacklist from the `bing-search-cn` skill:

```sh
npx -y @dej4vu/websearch-cli@latest bing-fetch https://example.com --json
```

It blocks matching root domains and subdomains:

```text
zhihu.com, xiaohongshu.com, xhs.com, weibo.com, weixin.qq.com,
douyin.com, tiktok.com, bilibili.com, csdn.net
```

JSON search results mark matching entries as `fetchBlocked: true`. The generic `fetch` command does not apply this extra blacklist.

## Agent skill

`skills/websearch/SKILL.md` is the canonical skill. Use [skills](https://www.npmjs.com/package/skills) as the primary installation path. The skill manager requires Node `>=22.20`; the websearch CLI itself still supports Node `>=20`.

### User-level install

Install for Codex, Claude Code, and Hermes Agent:

```sh
npx -y skills@latest add dej4vu/websearch --skill websearch --agent codex --agent claude-code --agent hermes-agent --global --yes
```

In `skills@1.5.23`, this creates the Codex canonical copy in `~/.agents/skills/`, then links Claude Code at `~/.claude/skills/` and Hermes at `~/.hermes/skills/`. Codex's nominal global path in the skills documentation is `~/.codex/skills/`, but the universal Codex installation path is used here.

If Hermes uses a custom home, set `HERMES_HOME` before installation so its symlink is placed correctly.

### Project-level install

Install into the current project only:

```sh
npx -y skills@latest add dej4vu/websearch --skill websearch --agent codex --agent claude-code --agent hermes-agent --yes
```

In `skills@1.5.23`, project-level Codex uses `.agents/skills/`. Project-level symlink installs skip Hermes when the consumer project has no `.hermes/` directory. Create it first if you want the Hermes symlink:

```sh
mkdir -p .hermes
npx -y skills@latest add dej4vu/websearch --skill websearch --agent codex --agent claude-code --agent hermes-agent --yes
```

Alternatively, use `--copy` to create real project directories for all agents:

```sh
npx -y skills@latest add dej4vu/websearch --skill websearch --agent codex --agent claude-code --agent hermes-agent --copy --yes
```

This repository ignores generated `.agents/`, `.claude/`, `.codex/`, and `.hermes/` directories so local installation artifacts are not accidentally committed.

### Manage installed skills

```sh
npx -y skills@1.5.23 list
npx -y skills@1.5.23 list --json
npx -y skills@1.5.23 remove websearch --yes
```

### Local development install

From this repository, install the local skill without requiring a GitHub tag:

```sh
npx -y skills@latest add . --skill websearch --agent codex --agent claude-code --agent hermes-agent --yes
```

For CI or reproducible automation, pin both the skill manager and source tag. The pinned source command becomes usable after the GitHub remote and `v0.3.0` tag are published:

```sh
npx -y skills@1.5.23 add 'dej4vu/websearch#v0.3.0@websearch' --skill websearch --agent codex --agent claude-code --agent hermes-agent --global --yes
```

Inspect the canonical skill without installing:

```sh
npx -y skills@1.5.23 add . --list
```

## Development

```sh
npm install
npm test
node ./bin/websearch.js --help
```

`npm test` is offline and includes:

- basic extraction, truncation, robots, raw mode, and proxy tests;
- regression tests for documentation sites and highlighted `pre > span` blocks;
- parity tests mapped from the 20 tests in the official [`mcp-server-fetch`](https://github.com/modelcontextprotocol/servers/tree/main/src/fetch) implementation.
- Bing search URL/freshness construction, date parsing, intent ordering, multi-page aggregation, redirect unwrapping, canonical de-duplication, and blacklist tests.

### Known-site matrix

There is also a network test matrix with 20 well-known Chinese sites and 20 international sites:

```sh
npm run test:sites -- --output /tmp/websearch-site-report.json
```

The matrix checks HTTP status, extraction success, expected text, and minimum content length. It intentionally does **not** bypass `robots.txt`; robots-blocked URLs are classified separately instead of counted as successful fetches. Network results change over time, so this command is not part of the default offline test suite.

## License

MIT
