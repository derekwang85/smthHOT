# Jina 自研替代方案（本地渲染服务）

> 目标：用一套**自研的本地无头 Chromium 渲染服务**替代对第三方 Jina Reader（`r.jina.ai`）的按次付费依赖，
> 打通「JS 渲染（CSR）列表页」的抓取，并使现有 `fromMarkdown()` 解码逻辑**零改动**复用。
> 本文档是设计决策；落地前按 `.coding-framework` 写 Pre-Execution Manifest / ADR。

---

## 0. TL;DR（决策摘要）

| 项 | 决策 |
|---|---|
| 替代什么 | Jina「URL → 渲染后 markdown + title + publishedTime」这一层 |
| 用什么替代 | 独立旁挂的 **Node Playwright（headless Chromium）渲染服务**，通过内部 HTTP 暴露 `POST /render` |
| 契约 | **逐字段对齐 `JinaPage`**（`Title / URL Source / Published Time / Markdown Content`），`fromMarkdown` 不改 |
| 计费 | 本地渲染成本≈0（cpu/内存/时间），但仍走 `receipts` 记账与预算熔断（cost=0）防放大 |
| 调度 | 全新 `RENDER_ENABLED` 安全阀；Jina 作为**回退**保留，`RENDER_ENDPOINT` 未配时自动回落 Jina |
| 反爬边界 | **只承诺非对抗性 CSR 站**（Glencore/Codelco/RUSAL/Trafigura/KRX）；Cloudflare 等硬反爬**不承诺突破** |
| 合规 | 遵守 `robots.txt`、限频、隐式等待、不隐藏真实爬虫身份、不绕过登录/付费墙 |

---

## 1. 背景与动机

现有链路上，`web_list` 的 `fetchListingText()`（`packages/backend/src/sources/web-list.ts`）作者按 URL 分流：

```
url 以 https://r.jina.ai/ 开头  → jinaRead()   （第三方付费渲染 → markdown）
否则                          → guardedFetch()（undici 静态抓 SSR HTML → cheerio）
```

**问题**：我们挖掘到的多语种一手站点里，一批高价值源（Trading House：Glencore/Codelco/RUSAL/Trafigura，及 KRX）是 **JS 渲染（CSR）**——静态 HTML 只有菜单壳、没有新闻列表 DOM（已在试抓中复现：`http 200` 但 `itemSelector` 匹配不到任何正文）。只有两条路：

1. 配 `JINA_API_KEY`（第三方按次付费，约 ¥0.36/百万 token）；
2. **自己造一个本地渲染服务**（本方案）。

自研的好处：成本趋于固定（一次性机器资源，不再按次计费）、数据不出内网、可长期稳定调度、可控抓取频率与合规。代价：要自己承担渲染基础设施与运维、内存/并发优化，且对硬反爬没有银弹。

---

## 2. 现状（已核实的接入点）

| 文件 | 角色 | 与本方案的集成点 |
|---|---|---|
| `packages/backend/src/sources/web-list.ts` | 抓列表页、详情页 | `fetchListingText()` 的分流点；`JINA_PREFIX` 常量；`fromMarkdown()` 消费 Jina 输出 |
| `packages/backend/src/providers/jina.ts` | Jina 客户端 | `JinaPage` 契约；`parseJinaText()` 解析头字段；`jinaRead()` |
| `packages/backend/src/providers/receipts.ts` | 付费回执/熔断 | `paidRequest()` + `budgets` 表（per minute/hour/day） |
| `packages/backend/src/sources/config-keys.ts` | 信源配置白名单 | `web_list` 的 `parseMode` / `adapter` 枚举需扩展 |
| `packages/backend/src/sources/collect.ts` | 采集调度 | `scheduleDueSources()` 的 `COLLECT_SKIP_JINA` 开关；`adaptIntervals()` 的 `paid_listing` 判断 |
| `packages/backend/src/config.ts` | 配置读取 | `credential("collectors", "JINA_API_KEY")` / `config.egressProxyUrl` |

**CommodityHOT 部署约束**：裸 node（`.env.commodity`），web :3200 / api :3002 / worker 独立进程，**不碰 docker**。渲染服务也必须以同样的裸 node 方式旁挂。

---

## 3. 方案总览：本地渲染为「Jina 的一次可替换实现」

不要新造一套抽取逻辑——**Jina 的职责在框架里已被定义为「注入管线的渲染层」**。我们只替换这一层：

```
         ┌────────────────────────────────────────────────────────┐
         │                      worker 进程                        │
         │                                                        │
   url ──▶ fetchListingText()/fetchDetail()                       │
         │   │  render? = config.parseMode==='rendered' 或         │
         │   │           config.url 以 RENDER_PREFIX 开头          │
         │   ▼                                                    │
         │  renderRead(url) ── HTTP ──▶ ┌──────────────────┐      │
         │                              │ 本地渲染服务(独立) │      │
         │      ◀── JinaPage 结构 ────── │ Playwright+Chrom │      │
         │                              └──────────────────┘      │
         │   ▼                                                    │
         │  fromMarkdown(md) / fromHtml(html)   ← 与 Jina 完全一致 │
         └────────────────────────────────────────────────────────┘
```

渲染服务对外只暴露一个接口：**`POST {endpoint}` 传入 `{url, format}`，返回与 Jina Reader 相同格式的文本**。
这样 `parseJinaText()` 可以直接复用，`fromMarkdown()` 完全不用改。

---

## 4. 关键设计决策

### 4.A 渲染服务进程模型 —— 独立旁挂（推荐）
- 独立 Node 进程监听内网端口（如 `127.0.0.1:3003`），worker 通过 `guardedFetch` 调它。
- **理由**：渲染崩溃/内存膨胀不拖垮主 worker；可独立扩缩、独立重启、独立健康检查；符合「采集与模型分离」的可运维原则。
- 备选（不推荐）：在 worker 进程内直接 `playwright.launch()` —— 省一个进程但把不稳定带进主链。

### 4.B 抓取库 —— Node Playwright（推荐）
- 项目全 TS/node，Playwright 有 first-class TS 与 headless Chromium，单一运行时最贴合。
- Puppeteer 也可，但 Playwright 的 `route` 拦截、便捷的 `wait_for_selector`、多浏览器支持更省事。
- **默认无沙箱限制**：`chromium.launch({ args: ['--no-sandbox','--disable-dev-shm-usage'] })`（容器/裸机 root 场景需要）。

### 4.C 输出契约 —— 对齐 `JinaPage`
渲染后先 `page.content()` 拿完整 DOM，再产出与 Jina 相同的 header + markdown：
```
Title: <h1 或 og:title>
URL Source: <最终 URL>
Published Time: <article:published_time 或 time/datePublished，可空>
Markdown Content:
<正文 markdown>
```
- 复用 `providers/jina.ts` 的 `parseJinaText()`（不必改）。
- markdown 生成用同一套策略：mozilla `Readability`（提取正文）→ HTML → markdown（`turndown` 或轻量自写）。
- `publishedAt` 缺失时由现有 `fromMarkdown()`/`fetchDetail()` 的次级规则兜底，**与走 Jina 时行为一致**。

### 4.D 计费与熔断 —— 仍走 receipts（cost=0）
- 本地渲染没有 token 费，但**每次渲染是一个昂贵的抓取动作**（数秒 + 数百 MB 内存），同样要防放大：
  - 调 `paidRequest({ service: "render", ... })`，`cost = null`（不记账额），但**占用 receipts 行 + attempt + 预算 quota**。
  - `budgets` 表为 `render` 服务建行，per minute/hour/day 设上限，配 0 即熔断停抓。
- 好处：与 Jina 相同的「去重（同 URL 同日只渲染一次）/ 记账 / 观察」语义自动成立。

---

## 5. 需新增/修改的代码（逐项）

### 5.1 渲染服务本体（新增目录）
```
packages/backend/src/render/
  server.ts        # 独立进程入口，http.createServer 监听 127.0.0.1:3003
  playwright.ts    # launch / context 池 / close
  extract.ts       # Readability 提取正文 → HTML
  markdown.ts      # HTML → markdown（对齐 JinaPage.Markdown Content）
  robots.ts        # robots.txt 白名单判断（gated）
  health.ts        # /healthz，返回池占用、qps、最近错误
```
- context 池（如 2–4 个）复用，避免每请求冷启动。
- 每个请求默认 `waitUntil:'networkidle'` + `page.setDefaultTimeout(25s)`；失败超时就返回已渲染 DOM 而非放弃（Jina 行为）。
- 渲染失败置 `--disable-web-security`？**不要**，保持真实浏览器语义；只加真实 UA。

### 5.2 客户端 `providers/render.ts`（新增，镜像 jina.ts）
```ts
export interface RenderPage = JinaPage;            // 复用同一结构
export async function renderRead(url, opts): Promise<JinaPage & { raw: string }> {
  // POST config.renderEndpoint，body {url, format}
  // 解析返回文本 → parseJinaText()
  // 包 in paidRequest({ service:'render', ... })
}
```

### 5.3 `web-list.ts`（修改）
- 加 `RENDER_PREFIX` 常量（如 `http://127.0.0.1:3003/…` 或 token `render:`）。
- `fetchListingText()`：当 source 声明需渲染（见 5.4），走 `renderRead`；未配置 `renderEndpoint` 时回退 `jinaRead`。
- `fetchDetail()`：同理——需要日期/标题的 detail 若源走渲染，用 `renderRead` 结果喂 `publishedAtRegex/titleRegex`。

### 5.4 `config-keys.ts`（修改）
- 为 `web_list` 增加：
  - `parseMode: ["rendered"]`（在现有 `html/markdown/docusaurus_changelog` 之外），让信源显式声明「需要渲染」；
  - 可选 `render.isolation: ["own_context","share_context"]`（默认 share），用于对抗性页隔离。
- 新增 service 级的配置键不安全（config-key 是 per-source），渲染服务参数走 `.env.commodity`（见 5.6）。

### 5.5 `collect.ts`（修改）
- `scheduleDueSources()`：`COLLECT_SKIP_JINA` 之外，新增 `COLLECT_SKIP_RENDER` 安全阀；默认开 `COLLECT_ENABLED` 保护。
- `adaptIntervals()`：把 `parseMode='rendered'` 的源视为「低频付费语义」（不该高频），加入 `paid_listing`-like 判断（安静源拉长间隔）；渲染服务 qps 由 worker 限流，避免一次调度把池打爆。

### 5.6 `.env.commodity`（新增项，**不改现有键**）
```
RENDER_ENDPOINT=http://127.0.0.1:3003/render   # 未配 → 自动回退 Jina
RENDER_ENABLED=true                              # 安全阀
COLLECT_SKIP_RENDER=false                        # dev/test=true
```
> 遵守依托线：**不改 `.env` 与 `.env.commodity` 现有内容**，只在文件中追加新键；渲染服务端口不与 :3200/:3002 冲突。

---

## 6. 抓取流水线 / 去重

- 复用现有 `cursor`/`identityKeyFor`/`storedTitles` 去重，二次渲染同一 URL 会被 receipts 同日 key 命中，不重复烧资源。
- `renderRead` 对「同一 URL + 同 format + 同一天」幂等（与 `jinaRead` 的 `day` key 一致）。
- 只对**明确声明 `parseMode:'rendered'` 的源**启用渲染，静态 SSR 的源继续走 `guardedFetch`，成本可控、不会被误渲染。

---

## 7. 合规与反爬策略

- **robots.txt**：渲染前 `robots.isAllowed()`；不抓 Disallow（这是自研的优势——Jina 未必遵守，我们可强约束）。
- **身份透明**：沿用 `DEFAULT_UA`（`SITE.crawlerName`），不伪装成浏览器广告 bot。
- **限频**：每源抓取由 worker 调度天然限频；渲染服务侧再设全局并发上限与每域节流。
- **隐式等待**：用 `waitUntil:'networkidle'`，**不**写死 `sleep(大)`;
- **不绕过**登录、付费墙、验证码。若某页需登录才出列表 → 判为「不可公开抓取」，不加入（与 `site_fulltext=false` 规矩一致）。
- **反爬边界（诚实声明）**：对 Cloudflare Turnstile、Apptrana 等**对抗性**反爬，本地 headless 同样可能被识别/拦截。**本方案不承诺突破硬反爬**；JS 渲染但非对抗性站点（Glencore/Codelco 等）是主要受益目标。

---

## 8. 资源与降载（本地也要预算）

| 指标 | 建议初始值 | 说明 |
|---|---|---|
| Chromium context 池 | 2–4 | 每 context ≈ 150–300MB；避免 OOM |
| 每请求超时 | 25s | 超时返回已渲染 DOM |
| 渲染服务内存上限 | 独占 1–1.5GB | 用 cgroup / `--max-old-space` 约束 |
| 全局并发上限 | 池数 | 超出排队，不并行开进程 |
| `budgets(render)` | 60/min · 600/hr · 3000/day | 熔断默认值，可运营调整 |

**降载顺序**（预算超限后）：渲染源→Jina 源→静态 SSR 源保持。确保关键免费源不停。

---

## 9. 分阶段实施计划

| 阶段 | 内容 | 验证 |
|---|---|---|
| **M0** 契约与隔离 | 定义 `RenderPage` 契约 + receipts service='render' + 配置键；写单测解析 `parseJinaText` 兼容 | typecheck + 单测 |
| **M1** 渲染服务 | `packages/backend/src/render/*` 本体，能对给定 URL 返回对齐结构文本；本地活页评测 | 用 Glencore/Codelco 真实 URL 手工渲染出列表 |
| **M2** 接入 `web_list` | `fetchListingText`/`fetchDetail` 加 rendered 分支 + 回退；`config-keys` 加 `parseMode:'rendered'` | 把 1–2 个源切 rendered，`collectSource` 能产出 articles |
| **M3** 迁移第一批 | 把 Trading House（Glencore/Codelco/RUSAL/Trafigura/KRX）等 CSR 源标成 rendered | 后台无红点、有真实条目，`npm run typecheck` + smoke |
| **M4** 关闭 Jina（可选） | 若渲染稳定且想去掉第三方计费 → `JINA_API_KEY` 设为空，仅保留回退 | 跑满一天无回退路径告警 |

> 每阶段过门禁：改 >3 文件或 >30min 先写 Pre-Execution Manifest；涉及新三方/DB schema 先 ADR/Swarm。

---

## 10. 监控与回滚

- **健康端点** `/healthz`（池占用、qps、错误率、队列长）纳入现有 `operations/{heartbeat,monitor}.ts` 上报。
- **回滚**：
  - 渲染服务挂了且 `RENDER_ENABLED` 仍为 true → worker 自动探测失败后**回退 Jina**（`renderRead` 捕获连接错误）。
  - 极简回退：`RENDER_ENABLED=false` + 源切回 `jina` 或 `html` 模式，一次 compose/env 生效（裸 node 重启 worker 即可）。
- **告警条件**：渲染成功率 <80%、池等待 >5s、单请求 >60s、内存 >80%。

---

## 11. 已知限制与风险

| 风险 | 应对 |
|---|---|
| headless 被硬反爬拦截（Cloudflare 等） | 不承诺；此类源继续走 Jina 或标占位 |
| 内存/CPU 拖垮宿主 | 独立进程 + 池上限 + 内存约束 |
| markdown 抽取质量低于 Jina 的专有渲染 | 用 Readability + turndown，达标读通过后手工评测再切;保留 Jina 回退 |
| 渲染服务单点 | 失败回退 Jina；可跑双实例（后续） |
| 合规（过度抓取/抓 robots 禁用页） | 渲染前 robots 白名单 + 限频，宁严勿快 |

---

## 12. 需要你决策的点

1. **进程模型**：独立旁挂渲染服务（推荐）vs worker 内嵌 —— 选哪个？
2. **同步迁移源码**：把第一批 CSR 源（Glencore/Codelco/RUSAL/Trafigura/KRX）全部切 `rendered`，还是先只切 1–2 个试水？
3. **Jina 保留**：作为回退保留（推荐，成本接近 0，仅兜底），还是彻底移除？
4. **环境**：宿主内存是否够再常驻 1–1.5GB Chromium 池？（当前 CommodityHOT 是裸 node 运行，需评估）