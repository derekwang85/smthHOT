# commodityHOT 战略稿 · 研判批注与执行记录（v0.3）

> 对 `docs/commodityHOT-strategy-swarm.md`（v0.2，面向未来的前瞻规划稿）的落地研判、取舍裁决、一次实施记录。
> 定位：**战略稿 = roadmap 参考，不当作当前 sprint 的执行清单**。以下为对计划重新评估后的结论与本轮已落地动作。

---

## 一、SWARM 研判结论（对应战略稿三支柱/一底座）

### 🟢 立即落地 · 已实施（A 组四项 + B 试点）

| 项 | 战略稿出处 | 落地动作 | 状态 |
|:--|:--|:--|:--|
| **A1 定位·产业链** | 决策点1 | `industry/site.ts` 话术收敛为「有色金属产业链情报台 · 为决策排序」，弱化「模型/新闻流」字眼 | ✅ |
| **A2 首页·今日影响+品种罗盘** | 决策点2-C（叠层） | 首页 `HotTopics` 置顶区标题改「今日影响」（纯前端 `titleOverride` prop）；新增 `CategoryCompass` 品种罗盘（复用 taxonomy 分类键，纯前端，不新增契约） | ✅ |
| **A3 诚信时间标注** | 决策点2护栏 | 信息流卡片在原文发布旁加低调小标注「发布于 X 分钟/小时/天前」（复用 `publishedAt` + `lib/format.relativeTime`，纯展示层） | ✅ |
| **B 数据层·external 最小试点** | 决策点3-B架构 | 新增 `scripts/commodity-data-pilot.ts`：验证「外部脚本→POST /api/ingest/items→落库→读取层可见」，模拟铜/铝 LME·SHFE 库存数据，`raw.data` 承载数值/环比；默认不发外，`COMMODITY_PILOT_SEND=true` 才发送 | ✅ |

> 实现事实（重要）：
> - 卡片层 `FeedItemSummary` 未暴露 `discoveredAt`，因此 A3 目前只显示「原文发布时间」；若要「首发 vs 原文」并排，需改 `packages/contracts`（属契约变更，本次未做）。
> - external 通道真实 schema 是 `{sourceId, sourceName?, items:[{title,url,publishedAt?,author?,raw?}]}`，`kind=external` 由接口自动写、`category`/中文正文由 ingest 后模型生成、自定义数据放 `raw`。external 源由 worker 采集器跳过（只收上报），且默认 `isolated`，要进公开页面需在后台改为 `editorial`。

### 🟡 探讨 · 留作后续决策点（已收敛方向，待条件触发再拍）

| 未决点 | 当前认识 | 触发/回决条件 |
|:--|:--|:--|
| 数据层反哺 editorial 评分 | 数据层不止展示，更应把「库存/基差信号」注入 selection 的 sig 轴 | 先跑通 B 的铜·LME/SHFE 试点，再做「信号→sig 输入」中间表示 |
| 跨语言去重能力 | 现有归组按 `storyPublicId`/`factKey`，无标题归一化/跨语言判重；多语种扩大必须先有它 | 中文同义 + 中英同事件判重先跑顺，再扩语种 |
| 授权分级机制（引用/展示/链接） | 代码无 license-tier 字段，需随数据源登记 | 建 external 数据源时人工登记分级 |

### 🔴 冻结 · 明确不做（需 HITL 才能改判）

以下四项在当前阶段明确**不做**。任何改判必须由 Derek 本人通过 **HITL（Human-In-The-Loop）** 环节明确批准并记录在案，Agent 不得自行放开。

1. **做顶级 desk trader 终端竞品**（战略稿决策点1-B）
   - 理由：与 BBG/Eikon 正面竞争，数据深度/成本不可行，且当前定位（产业链）天然避开它。**长期不考虑。**
2. **全语种一路铺开**（决策点4-A）
   - 理由：5 套信源 + 翻译 + 跨语言判重成本，去重引擎未跑顺前铺开 = 自乱。**≤P4 阶段只做定点补强（西/俄优先）。**
3. **P3 前为付费数据授权砸钱**（决策点3-C过早）
   - 理由：无付费样板前买 LME/SMM 全量 API = 没验证需求先烧成本。**P3 且以「整合有付费需求」为前提才考虑。**
4. **P0 阶段新增独立「小时报」ReportKind 契约**
   - 理由：前一轮 SWARM 已裁决——当前样本/预算下，hourly kind = 24× 算力 + 契约 breaking + 在坏数据上加速。用现有 hourly catch-up + 首页即时性替代。**保留触发条件（详见下方）再评估。**

> **冻结项触发条件（仅当全部满足方可经 HITL 复审）**
> 校准采集 + 提高采样频率跑 2 周后，gold 池仍偏单一 stratum（price/noise >60% 且 supply/demand 选例 <10%），且用户明确要求独立高频报告页 → 才重新评估冻结项 4（hourly kind）。冻结项 1/2/3 无预设触发条件，须由用户主动提出并经 HITL 逐条评审。

---

## 二、shmet.com（上海金属网 SHMET）信源评估

**结论：shmet.com 合法、官方、可解析，但不是当前应加的「高频 web_list 新闻源」；它真正的价值应走 external 数据层通道。**

实证（2026-10-06 实测首页快讯频道）：
- **可解析**：快讯列表为 SSR 渲染，锚点稳定形如 `https://www.shmet.com/newsFlash/newsFlashDetail-<NNNN>.html`，标题文本 = 快讯内容摘要，可被 `web_list` 的 `fromHtml()` 通用 `a[href]` 解析。
- **高价值金属数据**：其中含【COMEX 铜/铝/白银/黄金库存统计】【LME 现货结算价/现货到三个月升贴水】等，正是战略稿「数据层（库存/升贴水/价差）」想要的（一手、结构化、每日更新）。
- **致命噪声**：同一频道被宏观/AI 快讯淹没（日本国债、澳消费信心、韩国 KOSPI、也门冲突、特朗普竞选、马斯克/OpenAI 融资等），非金属相关内容占比 >80%。若整频道作 web_list 抓取，会以极高噪声灌入 prefilter/selection，污染选稿质量。

**裁决与建议**：
- **暂缓**把 shmet 作为 `web_list` 新闻源入库（避免噪声污染），这**不是「不合适」，而是「当前 web_list 新闻通道承载不了它的恰当用法」**。
- **正确归宿**：用 **external 上报通道（即 B 试点）**，脚本按授权分级结构化提取它的**金属库存/LME 结构与现货升贴水**公开数据上报（`raw.data{value,delta,unit,asOf}`），作为 P2「数据根」的候选源之一。这才是它对既有 SMM/CCMN 的差异价值。
- 若未来要它的金属新闻/快讯，应只采其「铜/铝/铅锌/镍」等属相关的分类页（需确认是否有稳定独立 URL，当前锚点 `#newsFlash-<id>` 为前端路由，非独立 URL，故不推荐现在配 selector）。

---

## 三、定点语种源（第一批）现状

| 语种 | 源 | 判定 | 说明 |
|:--|:--|:--|:--|
| 西语（智利铜供给） | `cochilco-reports`（cochilco.cl，智利铜业委员会） | ✅ **已存在**（既有 19 源之一，T1，first_party，1440min） | 第一批强价值西语一手信源已具备，暂不加更多 |
| 俄语（Nornickel/铝制裁） | Nornickel nornickel.com / RUSAL | 🔴 **DEFER** | 未实证到干净 web_list 列表（JS/反爬常见）；需后台试抓或走 external 通道，当前不虚造源 |
| 法语/葡语/荷兰语 | — | 🔴 DEFER（≤P4） | 按决策点4 分阶段，先跑顺西/俄与跨语言判重再说 |

> 原则（战略稿采纳）：每个导出语种源须「授权分级 + 一手判定 + 交叉验证」三要素齐备才进 editorial；西/俄当前分别以 cochilco（一手官方）为准，俄候选待实证。

---

## 四、运行校验记录

- `npm run typecheck` ✅（contracts/backend/api/worker/tests + web 全部通过）
- `npm run build -w @aihot/web` ✅（client + SSR built 无错误）
- 改动文件：`industry/site.ts`（A1）、`apps/web/app/routes/home.tsx` / `features/feed/HotTopics.tsx` / `features/feed/FeedItem.tsx`（A2/A3）、新增 `apps/web/app/features/feed/CategoryCompass.tsx`（A2）、新增 `scripts/commodity-data-pilot.ts`（B）。
- **未改动**：`packages/contracts/`、`industry/taxonomy.ts`、后端 publication/API、数据库；未新增依赖。
- 计入 commitments：A 组四项已实施，B 试点脚本就绪（未发外），冻结四项已锁（HITL）。

---

*本文件为依据 derekcoding-framework method/13（SWARM 对抗）与本文档保证的三轨制，对战略稿的研判批注；任何对冻结项的改判需严格 HITL。*