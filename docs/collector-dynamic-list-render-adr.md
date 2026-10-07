# ADR · 采集器动态列表渲染能力（XHR / 滚动）

- 状态：**Proposed**（待 HITL 批准）
- 关联：`docs/collector-dynamic-list-render-manifest.md`；前序 `docs/jina-selfhost-replacement.md`
- 日期：2026-10-06

## Context

多语种信源挖掘（本会话多轮，见 `docs/source-mining.md §6/§8`）在俄/阿等区官方源（TASS、Nornickel、
SPA、沙特工矿部、aleqt）上反复触到同一个硬墙：这批源的文章列表**既不在静态 SSR HTML 里，也不在
networkidle 之后的完整渲染 DOM 里**。已实测：
- TASS /ekonomika：静态 403；Chromium 渲染后 DOM 545KB，但 grep 不到 `/ekonomika/<digits>` 文章锚点。
- Nornickel press-releases：渲染后 DOM 487KB，同样无列表链接。
- SPA /economy、沙特工矿部：渲染 502/0。

原因不是「不可达」，而是「**列表由页面在 networkidle 之后触发的 XHR 接口 / 滚动分页再拉取**」。现有
`rendered` 分支的实现是 `goto(url, {waitUntil:"networkidle", …}) → page.content()`（`render/render.ts`），
它等的是「网络静默」而非「列表已注入」，因此 capture 不到这类动态列表。

这个缺口卡住了目标里约 15+ 个高价值官方/门户源（TASS、RIA、Nornickel、SPA、沙特工矿部、Rumbo
Minero、MIREMPET、Agence Ecofin 等），分值上多为 T1/T1_5（官方口径），是供应链上游第一手的关键一环。
不能因为「现有采集器抓不到」就把它们扫地出门——需要的是补齐采集能力。

## Decision

**给本地渲染服务新增「动态列表抓取」双轨能力：**

1. **滚动加载**：`renderUrl` 支持 `wait:"dynamic"` → `goto networkidle` 后再 `page.evaluate` 滚动到底
   数次（有限次 + 超时保护），随后取 `page.content()`。用于「滚动即分页 / 懒加载注入」的列表。
2. **XHR 捕获**：`render/server.ts` 的 `/render` 接收可选 `xhrPaths[]`；对命中路径的
   `page.waitForResponse` 收集响应 JSON，写进信封新增段 `XHR Responses:`。用于「列表由独立 JSON 接口
   返回」的源。
3. **采集器侧**：`web_list` 新增 `parseMode="scrolled"`（+ `xhrPaths`/`xhrJsonPath`），把
   `XHR Responses:` 段走复用自 `json_list` 的 `json_path` 抽取器转候选；失败回退 markdown/Jina。

**关键取舍：产物仍是 Jina 信封纯文本**，只是新增一段 `XHR Responses:`（`parseJinaText` 兼容切段）；
receipt 与预算熔断语义（service=render, cost=null）保持。这样 `providers/render.ts`、`sources/web-list.ts`
的既有路径零破坏，向后兼容。

## Consequences

**Positive:**
- 一次性补齐「networkidle 后懒加载到底」这一普适缺口，可解锁目标里约 15+ 个官方/门户源，不再因能力
  缺失把 T1 官方源判「不可用」。
- 增量、非侵入：新 mode 与既有 `rendered`/静态共存，回退链（scrolled → markdown → Jina）保持纪律，
  不破坏现有各语言已入库源。
- 复用 `json_list` 的抽取器，不重复造解析逻辑。

**Negative / Risks:**
- 滚动与 XHR 捕获比静态抓取贵（每个渲染服务调用都走 receipt，cost=null 但按次计数），需把这类源
  `interval_minutes` 压到低频档（60–120 分钟，与 `adaptIntervals` 的 costly 档 max=120 一致；勿再写 240），
  避免烧预算/触发反爬。
- 捕获到的 XHR payload 可能含渲染噪音（用户态 / 埋点 / 子页数据），`xhrJsonPath` 需逐源校准，非一次性。
- Playwright 滚动/XHR 行为对个别站不稳定，故保留回退与「记 0 候选即降级」的 STOP 规则。

> **SWARM 评审（2026-10-06，见 `.data/swarm-xhr-upgrade-verdict.md`）**：本 ADR 的 Decision 保持待批，
> 但实施前须满足评审的一致门槛：① `budgets` 新增 `render` 行（现无该行→`checkBudget` 对其**不限流**）；
> ② XHR 捕获设逐段 maxBytes/段数/累计上限；③ waitForResponse 监听器在 dispose 前卸载（防 unhandledRejection
> 杀进程）；④ 动态 render 设整次 wall-clock 预算（≤45s）；⑤ `parseJinaText` 剥离 `XHR Responses:` 尾段并加
> 含/不含该段双单测；⑥ `renderEndpoint` 由 `renderPort` 派生（现为两根独立开关）；⑦ scrolled 源补
> `harvestCheck` 门槛与 interval 入 costly 档；⑧ `usage.bytes` 如实记账 + scrolled 源更紧 per_read 额度与
> 告警线；⑨ seed-time `harvestCheck` 不过不发布；⑩ **Jina 切除 gate**：某 scrolled 源只有连续 7 天本地
> render 零回退（成功率 ≥99%）才关闭其 Jina 回退，回退率 >20% 自动降频并告警。其中 ①②③ 为放行硬门槛。

## Alternatives Considered

| Alternative | Why not chosen |
|---|---|
| 直接 fetch 清单页的 XHR 接口 URL（URI 静态可猜） | 接口需要鉴权 token / 签名，且形态逐源不同，猜测不可靠；仍要浏览器拿真 payload 才稳。 |
| playwright 脚本按源接管整页（byte script） | 过度侵入、每源一份脚本难维护；偏离「低成本统计源」定位。 |
| 放弃这批官方源，改用聚合商 | 官方口径丢失，违背「first-party + 一手指数」的选源原则；且 T1 源的分值不可替代。 |
| 只加滚动、不加 XHR 捕获 | 对「滚动即注入」的站（部分门户）够；但对「纯 JSON 接口」站（SPA/部分 TASS 分页）仍抓不到，两轨都要。 |

> 本 ADR 仅记录「是否/如何升级采集器」的架构决策。**实施**以 `docs/collector-dynamic-list-render-manifest.md`
> 为准，且须 HITL 批准后进行。