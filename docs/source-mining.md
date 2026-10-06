# 多语种 · 多地区 · 全球产业链信源挖掘 SOP

> 这份文档是把「按产业链环节反推信源」的方法固化成可复用作业规范。每次新增语种、地区、环节的信源，都按第 5 章流程走一遍：候选 → 试抓 → 判甄 → 校准 → 入库 → 后台验证 → HITL。
> 配置机制见 `docs/sources.md`，门槛校准见 `docs/selection.md`，后台试抓见 `docs/customize.md`。
> 2026-10-06：本版经一轮 DCF Swarm 审查（`methodology/13`，verdict 见 `.data/swarm-sop-verdict.md`），新增母语搜索词库、判甄打分模板、时效分级、Tier 公告型/行情型两分法、验证门与停止条件、结局留档。

---

## 1. 目标与原则

- **目的**：为商品/金属产业链找各个国家与地区最 native、最一手、最相关的资讯与数据网站，覆盖「矿 → 冶炼/精炼 → 贸易/物流 → 下游制造 → 消费/回收」全链路。
- **不按语言堆站**：先定产业链环节 + 产业聚集地，再找该地该环节的官方/行业/媒体信源。语言只是索引，不是目标。
- **一手优先**：当事方自己的公告（能矿部、交易所、冶炼厂、贸易商）优先于媒体转述。
- **不虚造**：未抓到真实 DOM 的站不臆造 selector，保留 url/baseUrl 占位并在后台标红待甄别。
- **尊重成本与合规**：付费墙只录摘要（`site_fulltext=false` 默认关）；反爬需代理/Jina（按次计费）的站先标记，由运营决定是否开启；飞书/IndexNow 默认关。

---

## 2. 全覆盖框架：产业链环节 × 信源角色

每一环节对应一批「信源角色」。找到一批角色等于得到该环节的候选清单。

### 2.1 七段产业链与目标信源

| 环节 | 权重 | 目标信源角色 | 典型例子 |
|---|---|---|---|
| **采矿/上游** | 高 | 各国能矿部、地质调查局、矿业协会、矿业杂志、矿山运营商公告 | 秘鲁 MINEM、墨西哥 SGM、刚果/赞比亚矿委会、澳大利亚 GSWA |
| **冶炼/精炼** | 高 | 交易所、精炼厂协会、冶炼产能/检修公告、副产品(如金/银/铂族)精炼商 | LME/SHFE、日本矿研、韩国冶炼商、俄罗斯诺里尔斯克 |
| **招标/项目投资** | 中 | 工程项目招标平台、矿业投融资新闻 | 印尼 ESDM、智利 Cochilco 项目库 |
| **贸易/物流** | 高 | **跨国贸易商官网、港口/海关数据、航运/运费指数、贸易商市场周报** | Trafigura/Glencore 官网、鹿特丹港、伦敦金属周、印尼矿产品出口申报 |
| **价格/金融** | 高 | 交易所行情、数据商、财经快讯、门户商品频道 | LME/SHFE/SMM/金十/东财/新浪 |
| **下游/消费** | 中高 | 汽车/家电/电子/线缆行业协会、终端采购指数 | 泰国汽车、越南电子、中国线缆协会 |
| **回收/再生** | 中 | 再生金属协会、废料交易平台、二次合金报价 | 日刊鉄鋼(已有)、欧洲废料网、美国 ISRI |

### 2.2 明确纳入：跨国贸易商（Trading House）官网

**结论：应纳入，作为「贸易/物流」环节的一手信源层。** 理由与口径：

- **定位**：贸易商是供应链承上启下的环节，其官网是需求/供给/物流/库存信号的一手出口；且规模巨头定期发产量指引、市场报告、可持续披露。
- **Tier 两分法（重要，Swarm 共识）**：这些官方源须区分「**公告型**」与「**行情型**」，避免把低频公告当高频行情管理：
  - **公告型 T1**：产量/季报/ESG/投资者关系（Glencore 产量、Trafigura 市场报告、Codelco 官方）→ `tier=T1`、`first_party=true`、`interval_minutes` 可放宽（240–360），实时性不是重点。
  - **行情/资讯型**：交易所价、贸易商快讯、会员周报（若公开）→ 才配更勤的抓取与时效告警（见第 4 章时效分级）。
  - 若某家官网实则以 ESG/营收宣传为主、产量公告低频 → 一律当「低频背书源」，不得抬到高频行情 Tier。
- **监控口径（重要）**：
  - 抓他们**官方新闻墙 + 市场报告/产量公告**（如 Glencore 产量更新、Trafigura 的 World Copper/World Aluminium 报告、Codelco 官方）。
  - **不**追求实时盘中价：价格是交易商商业核心，一般不给实时行情，也很可能是付费墙——只录摘要，不冒险打开全文权限。
- **候选名录**（按环节价值排）：Glencore、Trafigura、Codelco、BHP/Rio（矿商兼贸易）、IXM、Noble、JX Metals（日本）、三井物产/丸红（日本综合商社金属部门）、佛山/保税区铜库存、LME 注册仓单。
- **坑**：多数首页是轮播/营收宣传，需切到 `news` / `media-centre` / `reports` / `investors` 子站才成列表；部分整体反爬或仅 App。逐家试抓后按真实 DOM 判定。

---

## 3. 找站方法（跨地区，按性价比排序）

1. **官方漏斗**：各国能矿部 / 统计局 / 海关 / 地调局的「新闻·公开数据」栏目。母语搜索词每组一个（西语 `"minería noticias"`、葡语 `"mineração notícias"`、阿语 `"أخبار التعدين"`、俄语 `"новости горнодобычи"`、印尼语 `"berita tambang"` 等）。
2. **交易所 + 行业协会新闻墙**：金属交易所与行业组织官网新闻页。
3. **专业媒体 / 通讯社母语版**：各国财经媒体的 metals/commodity 频道（中文模板 = 新浪期货）。
4. **二手引用溯源**：从已有报道末尾的「来源字段 / 引用链接」反向找源头站，天然相关省力。
5. **交易商 / 巨头官网**：见 2.2，直接访问各 Trading House 的 news/reports 子站检索。

### 3.1 母语搜索词库（直接可抄，落地首选）

> 用法：搜 `站点(语言目标)` + 词库里的 `mining`/`metals` 类词；政府站再加 `ministry` 词。以下词条可直接进搜索引擎或站内搜索。

| 语言 | 矿业/采矿 | 金属/大宗 | 能矿部/统计局 | 交易所/价格 |
|---|---|---|---|---|
| 俄语 (RU) | новости горнодобычи · шахта · руда | цветная металлургия · металлы · никель · алюминий | Министерство энергетики · Росстат | биржа · цена металлов |
| 印尼语 (ID) | berita tambang · pertambangan · bijih | logam · nikel · timah · tembaga | Kementerian ESDM · Badan Pusat Statistik | harga logam · bursa |
| 韩语 (KO) | 광업 뉴스 · 채굴 · 광산 | 금속 · 비철금속 · 니켈 · 알루미늄 | 산업통상자원부 · 통계청 | 거래소 · 금속시세 |
| 刚果/赞比亚（法/英） | mines RDC · mining zambia · cuivre · cobalt · katanga | copper · cobalt · copperbelt | Ministère des Mines · ZEMA · ZCCM | LME · CCJ (铜精矿售价) |
| 澳/加（英，基准） | mining news · hard rock · resources | base metals · coal · iron ore | Department of Mines · USGS · Geoscience | ASX · TSX · COMEX |
| 德语/中东欧 | bergbau nachrichten · hütte · erz | buntmetalle · kupfer · zink | Ministerium · Statistikamt | börse · metallpreis |

### 3.2 试抓失败处理决策树（Swarm 增补）

抓一个候选先“静态结合 DOM 试抓”，按结果分流：

```
HTTP 200 + 干净列表(重复正文链接) → 推导 selector → 入库
HTTP 200 + Elementor/轮播壳(无SSR列表) → 换具体子站(news/media-centre/具体栏目) 再试；仍无 → 占位待 JS 渲染/Jina
HTTP 200 + 付费墙 → 仅录摘要(site_fulltext=false)，记为“付费-摘要”
HTTP 2xx 但空/全导航(无正文) → 弃，记录“壳页/无内容”
HTTP 30x → 跟随后按上述。HTTP 403/406/508+Cloudflare/Apptrana → 标“待代理/Jina”，进占位
HTTP 000/超时/连不上 → 标“网络不可达”，进占位，待 EGRESS_PROXY 或换 region 源
robots.txt 明确 Disallow → 弃，合规红线
```

---

## 4. 判甄标准与分级

逐站按以下维度打分，任一硬伤则不做正式信源（或降级/占位）：

| 维度 | 判定 | 硬伤 |
|---|---|---|
| 可达性 | 静态抓包能否拿到列表 DOM | 拿不到 → 标「待代理/Jina」占位，不臆造 |
| 时效 | 有无稳定更新节奏 | 长期停滞 → 不采用 |
| 原创/一手 | 一手公告 > 行业 > 转载 | 纯聚合无边际价值 → 不采用 |
| 相关度 | 是否聚焦商品/金属产业链 | 泛财经且频道无关 → 用 allow/deny 过滤，仍难则弃 |
| 付费 | 全付费 or 摘要 | 全付费 → 只录摘要，不许全文 |
| 合规 | 来源是否明确允许全文 | 未允许 → `site_fulltext=false` |

**Tier 定级**：官方/交易所/地调局/Trading House 官网 = `T1`；官方通讯社/准官方 = `T1_5`；行业媒体/门户快讯 = `T2`。对齐 `docs/sources.md` 与 `industry/selection.ts` 门槛。

### 4.1 判甄打分模板（每人可照填，≥某分才成为正式信源；Swarm 增补）

对每个候选按 0–3 分填，满分 18：

| 维度 | 3 | 2 | 1 | 0 |
|---|---|---|---|---|
| 可达性 | 静态 DOM 清洁列表 | 需子站切换可得 | 需 Jina/代理可抓 | 不可达/需付费渲染 |
| 时效 | 日更或更快 | 周更 | 月更 | 长停滞 |
| 一手指数 | 当事方一手 | 行业协会/官方通讯社 | 专业媒体 | 聚合/转载 |
| 相关度 | 纯金属/矿业 | 大宗商品含金属 | 泛财经可频道过滤 | 主题无关 |
| 合规 | 明确允许引用 | 未明确但不禁止 | 付费墙(可摘要) | 禁止/robots Disallow |
| 反爬稳定性 | 长期 200 | 偶发挑战可退避 | 需代理稳定抓 | 反爬多变 |

- **推荐门槛**：≥13 正式入库；9–12 占位待试抓复核；<9 弃（记档）。
- 后端加载时若失败即后台标红，方案不成熟的不长期挂着绿点。

### 4.2 时效分级（Swarm 共识：按“信息类型”分时效档，而非按产区/语言）

| 档 | 适合 | interval 建议 | 告警 |
|---|---|---|---|
| **行情/价格/盘中** | 交易所、快讯、门户期货频道 | 15–60 分钟 | 连续失败即浮出 |
| **产研/公告** | 巨头产量、协会、政府部门 | 240–360 分钟 | 周检 |
| **事件/政策** | 政策、关税、收储抛储、出口管制 | 60–240 分钟 | 日检 |

> 规则：低产出+低频公告源不要抬到高频档，否则烧调频预算又触发反爬。框架 04:20 自动调频，SOP 只给初始建议。

---

## 5. 落地作业流程（每批必走）

```
第0步 先跑通：先做 1-2 个真实候选站端到端跑通，再批量
候选清单(含环节/地区/语种标注 + 每候选结局字段)
   → 静态试抓(可达?)   [不可达 → 占位+后台红点+记录待代理/Jina]
   → 推导选择器(RSS 直接 feedUrl / web_list 写 selector / DOM 校准)
   → [校验门] 判甄打分 ≥13 → 写入 industry/sources.json；9-12 占位；<9 弃(记档)
   → npm run typecheck + JSON 校验
   → docker compose build && up -d (setup 迁移+seed 新源, ON CONFLICT DO NOTHING)
   → worker 抓取 → 后台红点甄别 → 达标后 HITL 确认留痕
   → 每个候选记录结局：confirmed / placeholder(附原因) / dropped(附原因)
```

**验证门与停止条件（Swarm 共识）**：
- **每批先小样本**：新地区/新类型的第一批先只采 3–5 个，端到端跑通（可达→selector→seed→后台无红点→有真实条目）再铺开同一模式。
- **冻结标准**：满足任一即暂停扩张、转维护——① 达到当批/当季设定的**目标源规模**（增量清零）；② 每个目标产区×金属×环节都至少 1 个**已确认可抓**的源；③ 连续两批新增源实际产出为 0 或全部转占位。
- **结局留档**：候选表给每条补 `confirmed / placeholder(原因) / dropped(原因)`，防止“为什么没配上”无从回溯；复盘用。

校验命令（对齐 AGENTS.md）：

```bash
node -e "JSON.parse(require('fs').readFileSync('industry/sources.json','utf8'))"
npm run typecheck
docker compose build && docker compose up -d --force-recreate
docker compose exec -T db psql -U aihot -d aihot -tAc "select count(*) from sources;"
```

---

## 6. 当前覆盖基线与缺口（2026-10-06 基线）

### 已覆盖（38 源；海外 22 / 国内 16；西语3 · 葡语3 · 法语2 · 阿语1 · 英语5 · 日语2 · 越南语1）
- **中文·国内**：SHFE/INE/NBS/GACC/NDRC/MOFOCOM/CNIA + SMM/Mysteel/期货日报/财联社/金十/生意社/长江有色 + 新浪期货/东财期货。
- **西语·南美**：秘鲁 MINEM、Andina、墨西哥 SGM。
- **葡语·巴西**：ANM、IBRAM、Agência Brasil。
- **法语·西非**：几内亚 CBG、Financial Afrik。
- **阿语·海湾**：沙特 Maaden。
- **英语·非英美**：南非 Mining Weekly、Miningmx；印度 OfBusiness、Moneycontrol；泰国 曼谷邮报。
- **越南语**：Vietstock；**日语**：JAPAN METAL、Japan Metal Daily。
- **国际基准**：LME、Cochilco、ICSG、Mining.com、Reuters。

### 下一批缺口（优先级）
1. **俄语**：俄传统镍铝钯上游（诺里尔斯克、俄铝）+ 俄语金属通讯社。
2. **印尼语**：镍/锡新区（印尼能矿部 ESDM、当地行业门户）。
3. **刚果/赞比亚（混法/英）**：铜/钴矿委会 + 当地矿业报。
4. **韩语**：冶炼/下游（KRX、主流韩媒 metal 版）。
5. **Trading House 官方**（见 2.2 名录）：Glencore/Trafigura/JX Metals 等 news-reports 子站。

---

## 7. 执行纪律

- 改跨文件/大批量前写 Pre-Execution Manifest（`.coding-framework/constitution/pre-execution-manifest.md`）。
- 收录结果与 HITL 审批回写 `team-memory/decisions/`，过 `verify_asset.py` 校验。
- 反爬/付费/代理涉及成本，一律交运营拍板，不擅自开启付费能力。
- 每批入库后立即在后台复核 selector，未达标的不要长期挂着绿点。