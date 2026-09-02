# @dej4vu/websearch-cli

[English](README.md) | 简体中文

面向 Codex、Claude Code 及其他 CLI 助手代理的网页工具。目前提供 Bing 中文搜索、网页正文抓取、带黑名单的 Bing 结果抓取。

## 使用 npx 运行

无需全局安装：

```sh
env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY \
  -u http_proxy -u https_proxy -u all_proxy \
  npx -y --registry=https://registry.npmjs.org/ \
  @dej4vu/websearch-cli@latest fetch https://example.com --json
```

自动化场景可将 `latest` 替换为已发布版本。查询最新发布版本：

```sh
npm view @dej4vu/websearch-cli version
```

```sh
npx -y @dej4vu/websearch-cli@<version> fetch https://example.com --json
```

> 提示：npx 命令请保留 `@latest`，始终解析最新发布版本。如果 npx 仍运行旧的缓存副本，先清空 npx 缓存再重试：
>
> ```sh
> rm -rf ~/.npm/_npx
> ```

如果想使用全局短命令（可选）：

```sh
npm install --global @dej4vu/websearch-cli
websearch fetch https://example.com --json
```

## Bing 中文搜索

```sh
npx -y @dej4vu/websearch-cli@latest search "人工智能 最新进展" --count 10 --json
```

翻页：

```sh
npx -y @dej4vu/websearch-cli@latest search "人工智能 最新进展" --count 20 --offset 20 --json
```

普通文本输出按排名展示标题、URL、站点、摘要和可解析出的日期。JSON 输出包含 `sort`、`freshness`、`requestedCount`、`resultCount`、`pagesFetched`、`pagesRequested`、`duplicatesRemoved`、`totalResults`、`hasMore`；每条结果包含 `rank`、`title`、`url`、`snippet`、`displayUrl`、`publishedAt`、`publishedAtText`、`publishedAtSource`、`dateMissing`、`fetchBlocked`。

### 搜索选项

| 选项 | 说明 |
|---|---|
| `--engine <name>` | 搜索引擎，目前仅支持 `bing`。 |
| `--count <n>` | 返回结果条数（默认 `10`，最大 `50`）。 |
| `--offset <n>` | 从该偏移量开始分页。 |
| `--sort <mode>` | `auto`、`relevance` 或 `date`。 |
| `--freshness <window>` | `any`、`day`、`week` 或 `month`。 |
| `--proxy-url <url>` | 为 Bing 请求指定 HTTP/HTTPS 代理。 |
| `--timeout-ms <n>` | 搜索超时（默认 `15000`）。 |
| `--json` | 输出结构化搜索结果。 |

引擎会向 `https://cn.bing.com/search` 发送浏览器风格请求头，启用 Bing 中文网页结果模式；当 `count > 10` 时跟进原生「下一页」token、解码 Bing 跳转 URL，并在排序前聚合与去重。

`auto` 模式识别 `最新`、`发布`、`上线`、`release`、`latest`、`news` 等时效意图词，自动应用 month 时间过滤和日期排序；普通技术类查询保持相关性排序。这里的「时效」并不等同于严格的发布时间保证：

```sh
npx -y @dej4vu/websearch-cli@latest search "GLM 最新模型" --count 15 --json
```

### npm registry / 代理问题排查

`npx` 会继承 shell 的代理变量和 npm registry 配置。在沙箱化 shell 中，本地代理如 `127.0.0.1:7890` 可能被拦截，出现：

```text
EPERM ... connect 127.0.0.1:7890
```

请去掉继承的代理变量，并显式使用官方 registry：

```sh
env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY \
  -u http_proxy -u https_proxy -u all_proxy \
  npx -y --registry=https://registry.npmjs.org/ \
  @dej4vu/websearch-cli@latest search "GLM 最新模型" --json
```

包同时发布在 npmjs.com 与 npmmirror.com；此报错通常是代理连接被拦截，而不是版本缺失。

日期尽量从 Bing 的 `.news_dt`、摘要、标题和 URL 解析；无法得到可信日期时 `dateMissing` 为 `true`，不伪造时间戳。官方域名获得适度加权用于同分场景；有明确日期的结果在日期排序中仍占主导。

## Fetch 抓取

`fetch` 执行 HTTP GET、跟随重定向、检查 `robots.txt`、提取正文 HTML 并转换为 Markdown。非 HTML 内容按原始响应文本返回。

```sh
npx -y @dej4vu/websearch-cli@latest fetch https://example.com
```

大页面分块读取：

```sh
npx -y @dej4vu/websearch-cli@latest fetch https://example.com --max-length 10000 --json

# 使用 JSON 结果中的 nextStartIndex 继续。
npx -y @dej4vu/websearch-cli@latest fetch https://example.com --start-index 10000 --json
```

### 选项

| 选项 | 说明 |
|---|---|
| `--max-length <n>` | 返回最大字符数（默认 `10000`，最大 `1000000`）。 |
| `--start-index <n>` | 从该字符偏移量开始返回。 |
| `--raw` | 跳过 readability 提取和 Markdown 转换。 |
| `--user-agent <ua>` | 自定义 User-Agent。 |
| `--proxy-url <url>` | HTTP/HTTPS 代理。 |
| `--ignore-robots-txt` | 关闭 robots.txt 检查。 |
| `--timeout-ms <n>` | 单请求超时（默认 `30000`）。 |
| `--json` | 输出结构化元数据与内容。 |

默认遵守 `robots.txt`。除非用户明确要求且用途合规，否则不要使用 `--ignore-robots-txt`。

> 安全提示：该命令可访问网络可达地址，包括内网地址（取决于宿主机策略）。请为不可信代理配置审批策略。

### Bing 结果抓取

`bing-fetch` 与 `fetch` 行为一致，但额外执行 `bing-search-cn` skill 的黑名单：

```sh
npx -y @dej4vu/websearch-cli@latest bing-fetch https://example.com --json
```

拦截以下根域名及其子域名：

```text
zhihu.com, xiaohongshu.com, xhs.com, weibo.com, weixin.qq.com,
douyin.com, tiktok.com, bilibili.com, csdn.net
```

JSON 搜索结果会把命中的条目标记为 `fetchBlocked: true`。通用 `fetch` 命令不会应用这份额外黑名单。

## Agent Skill

`skills/websearch/SKILL.md` 是规范 skill 文件。请使用 [skills](https://www.npmjs.com/package/skills) 作为主要安装方式。skill 管理器与 websearch CLI 都要求 Node `>=22.20`。

### 用户级安装

```sh
npx -y skills@latest add dej4vu/websearch --skill websearch --agent codex --agent claude-code --agent hermes-agent --global --yes
```

在 `skills@1.5.23` 中，Codex 规范副本放 `~/.agents/skills/`，Claude Code 链接到 `~/.claude/skills/`，Hermes 链接到 `~/.hermes/skills/`。skills 文档里 Codex 的名义全局路径是 `~/.codex/skills/`，实际使用通用安装路径。Hermes 使用自定义 home 时，安装前设置 `HERMES_HOME`。

### 项目级安装

```sh
npx -y skills@latest add dej4vu/websearch --skill websearch --agent codex --agent claude-code --agent hermes-agent --yes
```

在 `skills@1.5.23` 中，项目级 Codex 使用 `.agents/skills/`。当项目不存在 `.hermes/` 目录时，项目级软链安装会跳过 Hermes；如需生成 Hermes 软链，先创建该目录：

```sh
mkdir -p .hermes
npx -y skills@latest add dej4vu/websearch --skill websearch --agent codex --agent claude-code --agent hermes-agent --yes
```

或使用 `--copy` 为所有 agent 生成真实目录：

```sh
npx -y skills@latest add dej4vu/websearch --skill websearch --agent codex --agent claude-code --agent hermes-agent --copy --yes
```

本仓库已忽略生成的 `.agents/`、`.claude/`、`.codex/`、`.hermes/` 目录，避免本地安装产物误提交。

### 管理已安装的 skill

```sh
npx -y skills@1.5.23 list
npx -y skills@1.5.23 list --json
npx -y skills@1.5.23 remove websearch --yes
```

### 本地开发安装

```sh
npx -y skills@latest add . --skill websearch --agent codex --agent claude-code --agent hermes-agent --yes
```

CI 或可复现自动化建议同时固定管理器版本和源码 tag。将 `<release>` 替换为 [Releases 页面](https://github.com/dej4vu/websearch/releases) 中已发布的 tag：

```sh
npx -y skills@1.5.23 add 'dej4vu/websearch#v<release>@websearch' --skill websearch --agent codex --agent claude-code --agent hermes-agent --global --yes
```

不安装即可查看规范 skill：

```sh
npx -y skills@1.5.23 add . --list
```

## 开发

```sh
npm install
npm test
node ./bin/websearch.js --help
```

`npm test` 为离线回归，覆盖：

- 基础提取、截断、robots、raw 模式与代理测试；
- 文档站与 `pre > span` 高亮代码块场景的回归；
- 对齐官方 [`mcp-server-fetch`](https://github.com/modelcontextprotocol/servers/tree/main/src/fetch) 的 20 项测试；
- Bing 搜索 URL/freshness 构造、日期解析、意图排序、多页聚合、跳转还原、canonical 去重与黑名单测试。

### 知名站点矩阵

另有包含 20 个国内知名站点和 20 个国际站点的联网测试矩阵：

```sh
npm run test:sites -- --output /tmp/websearch-site-report.json
```

矩阵检查 HTTP 状态、提取成功率、预期文本和最小内容长度。它刻意**不**绕过 `robots.txt`，被 robots 拦截的 URL 会单独分类而非计为成功抓取。网络结果会随时间变化，因此该命令不属于默认离线测试套件。

## 开源协议

MIT
