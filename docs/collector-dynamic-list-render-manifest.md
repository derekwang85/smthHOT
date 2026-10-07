# Pre-Execution Manifest · 采集器「XHR / 滚动懒加载」能力升级

> 状态：**待评审**（HITL 批准后实施）｜日期：2026-10-06
> 关联 ADR：`docs/collector-dynamic-list-render-adr.md`
> 满足门禁：涉及**架构级采集能力变更**，且需新增配置键（`config-keys.ts`）与渲染协议改动，按
> `.coding-framework/constitution/pre-execution-manifest.md` 先行外化。

## WHAT（我要改什么）

给本地 Chromium 渲染服务（`src/render/`）新增「动态列表抓取」能力：渲染清单页时可**滚动加载分页**并
**拦截/捕获页面发起的 XHR/JSON 接口**，把「networkidle 之后才由 JS 拉取的文章列表」也解析出来；
采集器侧新增一个 list mode（暂名 `web_list.parseMode = "scrolled"`）与配套 `xhrPaths` 配置，把捕获的
JSON 走 `json_path` 抽取成候选。

## WHY（为什么要改）

多语种挖掘实测（见 `docs/source-mining.md §6`）反复确认：俄/阿多区官方源（TASS、Nornickel、SPA、
沙特工矿部）在 networkidle 之后的**完整渲染 DOM 里也没有文章链接**——列表由页面在 networkidle 之后触发的
**滚动分页 / XHR 接口**再拉取（已实测 TASS 545KB DOM、Nornickel 487KB DOM 均无文章锚点）。现有
`rendered` 分支（`render.ts:goto networkidle → page.content()`）抓不到这类列表，导致这些高价值官方信源
无法接入。「无法接入」是能力缺失，不是源本身不可用；补齐此项即可一并解锁目标清单里 15+ 个源。

## APPROACH（怎么改）

- **方案选择**：滚动 + XHR 捕获双轨（对齐 `rendered` 现有形态，向后兼容）。为什么不做浏览器级
  playwright 脚本接管：过度侵入、难维护；`xhrPaths` 内核实测确认这些源无静态列表（见 source-mining §6/§8，
  全部 🔴），故需浏览器执行 JS 才拿得到列表，不能纯静态降级。依据 ADR。
- **技术路径**（每项标注 SWARM 强制护栏，未达标不合并）：
  1. `render/render.ts`：`wait:"dynamic"` 时 `goto networkidle` 后 `page.evaluate` 滚动到底数次，
     再取 `page.content()`。**护栏 4**：整次 render 设 wall-clock 预算（建议 ≤45s，低于客户端 60s），
     含 scroll+XHR 等待，超预算立即截断返回部分结果。
  2. `render/server.ts`：`/render` 接受 `xhrPaths?: string[]`。**护栏 2**：对每个捕获 XHR 响应段设
     maxBytes（建议 ≤1MB）+ 段数上限（≤5）+ 段累计上限（≤6MB）；`waitForResponse` 设总超时。
     **护栏 3**：所有 waitForResponse promise 收进数组并在 `dispose()` 前 `Promise.allSettled` + `.catch`，
     显式卸载 listener（生命周期=单次 render）。
     **护栏 6**：`RENDER_ENDPOINT` 由 `RENDER_PORT` 派生或启动断言端口相等，杜绝双开关错位。
     **护栏 4-信号**：`handleRender` 把请求 `req` 的 `close`/`abort` 接到一个 `AbortController.signal`，
     透传给 `renderUrl(signal)`；客户端断开即取消进行中的 acquire/滚动/XHR 捕获并释放池槽位（作为
     wall-clock 预算之外的取消兜底）。
  3. `providers/render.ts`：`renderRead` 透传 `wait` / `xhrPaths`，返回 `{…page, xhrResponses}`，
     **护栏 8**：`usage.bytes` 如实入库，scrolled 源用更紧 per_read 额度。
  4. `sources/web-list.ts`：`parseMode==="scrolled"` 走新路径，`fromJsonList`（复用 json_list 抽取）抽候选；
     **护栏 5+回退**：失败回退 markdown→Jina；**护栏 5b**：`scrolled` 分支入口必须先判 `renderEnabled`，
     安全阀关闭时不得尝试连本地渲染服务，直接走 Jina/markdown。
     **护栏 7**：新 scrolled 源间隔按 `adaptIntervals` 的 costly 档（60–120 min）执行，manifest 文案与之一致，
     不再声称 240。
  5. `config-keys.ts`：`VALUES.parseMode` 加 `"scrolled"`；`web_list` KEYS 加 `xhrPaths`/`xhrJsonPath` 与
     **护栏 9**：`harvestCheck{minCandidates, allowTopic[], denyTopic[], dedupKey, baseResolver}`。
     **护栏 1**：新增迁移在 `budgets` 插入 `render` 行（低阈值）。
- **关键决策**：产物仍是信封纯文本，新增 `XHR Responses:` 尾段；`parseJinaText` 必须将其**剥离另存**
  （护栏 5），并有含/不含该段的双向单测；滚动次数、XHR 段大小与总时长均有硬上限（护栏 2）；receipt
  cost=null 但 bytes 如实记账（护栏 8）。

## FILES（涉及的文件）

- `packages/backend/src/render/render.ts` — `renderUrl` 增加 `wait:"dynamic"` 滚动逻辑；返回带上捕获的 XHR。
- `packages/backend/src/render/server.ts` — `/render` 解析 `wait`/`xhrPaths`，捕获响应 JSON，写 `XHR Responses:` 段。
- `packages/backend/src/render/playwright.ts` — （若需超时/次数常量）补充；接口本身不变。
- `packages/backend/src/providers/render.ts` — 透传 `wait`/`xhrPaths`；返回 `xhrResponses`。
- `packages/backend/src/providers/jina.ts` — `parseJinaText` 增解析 `XHR Responses:` 段（向后兼容）。
- `packages/backend/src/sources/web-list.ts` — `scrolled` 分支 + `fromJsonList`（复用 json_list 抽取）。
- `packages/backend/src/sources/config-keys.ts` — `parseMode` 加 `"scrolled"`；web_list KEYS 加 xhr 配置与 `harvestCheck` 门槛字段。
- `database/migrations/00NN_*.sql` —（新增）在 `budgets` 插入 `render` 服务行（SWARM 护栏 1，低阈值）。
- `tests/` — 新增 rendered/scrolled 信封解析单测、`parseJinaText` 含/不含 `XHR Responses:` 段双向回归（护栏 5）、既有 web-list 回归。
- `industry/selection.ts` —（如需）`harvestCheck` 门槛常量（护栏 9）。
- `docs/jina-selfhost-replacement.md` — 追加动态列表解锁段落。

（核心 6 个源码文件 + 测试 + 文档，>3 文件，符合门禁。）

## SUCCESS（怎么算成功）

- [ ] `npx tsc --noEmit -p packages/backend` 通过，workspace `npm run typecheck` 通过。
- [ ] **护栏 1**：`budgets` 已有 `render` 行，`checkBudget` 对该服务真正限流。
- [ ] **护栏 2/3/4**：渲染服务单次调用有字节/段数/时长预算；waitForResponse listener 在 `dispose()` 前卸载，
      无 unhandledRejection。
- [ ] **护栏 5**：`parseJinaText` 正确剥离 `XHR Responses:` 尾段另存，含/不含该段两种信封单测通过；既有
      `rendered`（Glencore/Redimin）与静态源抓取无一回归（跑 `tests/`）。
- [ ] **护栏 9**：任一 `parseMode="scrolled"` 源配置了 `harvestCheck`，seed-time 对真实可达的 JS-lazy 源
      通过 `minCandidates + allowTopic≥1 + denyTopic` 断言；否则不发布该源。
- [ ] **护栏 10（Jina 切除 gate）**：新增 scrolled 源若回退到 Jina，只有该源**连续 7 天本地 render 零回退**
      （抓取成功率 ≥99%）才关闭其 Jina 回退；回退率 >20% 的源自动降频到 costly 上限并告警。
- [ ] **护栏 6/7/8**：端口单点派生（或启动断言）、scrolled 源间隔入 costly 档、usage.bytes 如实记账。
- [ ] 验收实验：对**真实可达**的 JS-lazy 源（egress 修复后的 TASS/Nornickel，或已可达的 The Edge SG
      /commodities）起渲染服务 + `parseMode="scrolled"` 抽出 ≥1 条真实文章候选（title+url 合法、非导航）；
     若 egress/代理未修复导致当前机器仍够不到任何 JS-lazy 源，**验收判据顺延到能触达时再跑**，不得以
     模拟 DOM 冒充。

## STOP（什么情况该停下）

- 护栏 1/2/3 任一未合并 → 停止放行（避免熔断失效 + OOM + unhandledRejection 三重系统性风险）。
- 滚动到 N 次 / 捕获超预算仍 **0 候选**（说明该源列表经未捕获的接口/WebSocket），停止并为该源回退
  markdown/Jina，改记「需人工约定协议」，不无限加大抓取。
- `parseMode="scrolled"` 源若因本机路径 A（WAF/IP）无法真实验收 → 冻结该源，保留 Jina 回退，不硬推。
- 发现会破坏 receipt / 预算熔断语义时暂停并重评估。
- 时间超预估 2 倍即汇报，不硬扛。