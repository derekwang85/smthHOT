# commodityHOT —— 将 AIHOT 改造为有色金属 Commodity 监控站·规划文档

- 版本：v0.1（规划稿）
- 目标行业：有色金属（铜 / 铝 / 锌 / 铅 / 镍 / 锡 / 贵金属）
- 站名：**commodityHOT**（品牌名：commodityHOT）
- 一句话介绍（SITE.description，英文作标语 / 中文作正文）：
  » english tagline：**InfoInside of the commodity industry**
  » 中文描述：自动盯住全球有色金属信源，用模型筛选、打分、归并成事件，早上一份中文日报。
- 交付形态：**仅规划文档，不改代码**。本文档逐项给出 `industry/` 包的改法，供后续按 `docs/customize.md` 落地。

---

## 0. 改造边界（先划清，哪些能动、哪些不能动）

| 目录 / 文件 | 归属 | 本次是否修改 |
|---|---|---|
| `industry/` 全部 | 行业包（站名/分类/信源/提示词/门槛/主题/品牌/页面） | **是**，这是唯一要动的根目录 |
| `apps/`、`packages/` | 应用与业务代码 | **否**，遵循 customize.md“通常不需要改” |
| `database/migrations/` | 数据库迁移 | **否**（无 schema 变化），若加字段则在末尾新增迁移 |
| `tests/` | 测试（用 AI 示例行业） | 按需把 AI 示例换成有色对应项（见 §11） |
| `.coding-framework/` 子模块 | derekcoding 规约 | 否，只读 |
| `industry/features.ts` | 模块开关 | **是**（关闭两个 AI 专属模块） |

**硬规则（AGENTS.md / README 继承）**：不提交 `.env`/密钥/`.data/`；前端只读 `apps/api`；所有公开出口走 `packages/backend/src/publication/` 一个读取层；读者打开页面不触发模型调用；付费请求走回执 + 预算熔断；开发/测试关闭 `COLLECT_ENABLED`、`MODEL_CALLS_ENABLED`、`FEISHU_*_ENABLED`、`INDEXNOW_SUBMIT_ENABLED`；不用 AIHOT 名称/Logo。

---

## 1. 站名与文案 —— `industry/site.ts`

> 文件头注释明确：换行业先改它。`SITE` 常量只读配置，`ABOUT` 是“关于”页文案。

```ts
// SITE
name           : "commodityHOT"
subject        : "有色金属"                 // 决定“有色金属日报”“全部有色金属动态”
homeTitle      : "commodityHOT — 有色金属大宗商品监控 · 每日精选与中文日报"
description    : "自动盯住全球有色金属信源（交易所/矿山/行业媒体/宏观），用模型筛选、打分、把同一件事的报道归成事件，每天早上出一份中文日报。"
tagline        : "InfoInside of the commodity industry"   // 首页左上角 / 侧边栏
locale         : "zh-CN"                    // 展示统一中文（见 §9 多语言策略）
mcpPrefix      : "commodityhot"             // 上线前定死，接 MCP 后不可改
contactEmail   : 按需填写
footerNote     : "由 AIHOT 开源框架驱动"
icp            : 按要求填中国大陆备案号（需要时）
crawlerName    : "CommodityHOTBot"
organization.name: "commodityHOT"
```

`ABOUT` 各段（按有色语气重写）：
- `headline`：如 `["有色金属每天都在动，", "值得看的，只有几条。"]`
- `lead`：`${SITE.name} 替你盯着 {sources} 个信源：抓取、归并、打分、精选，每天早上 8 点出一份中文日报。免费，不用注册。`
- `steps`：
  - collect：`上期所、LME、SMM、生意社、矿山巨头的官网与媒体报道都在看；活跃的源 15 分钟就看一次。`
  - store：`抓到的都存下来；同一件事（如“某矿山停产”被多家报道）归到一起；只进热度的账号也算在内，热点榜从这算出。`
  - select：`模型先判断是不是有色金属行业的实质信息，再写中文标题、摘要和推荐理由；营销软文与重复转发进不来。`
  - publish：`每天 08:00 出日报，周一/每月 1 日出周报月报；最精选的几条可推到飞书群。`
- `copyright`：沿用模板句式，站名换 commodityHOT。

`withSubject` 拼接逻辑无需改代码（subject 为中文“有色金属”走中文无空格分支）。

---

## 2. 分类、标签与主体 —— `industry/taxonomy.ts`

> customize.md 明确：类别 `key` 会进网址/接口（`/all?category=`、`/feed/category/<key>.xml`），**上线后不可改**；标签与名录可随时增减。本规划给出初版，最终以上线前定的“关键不可改”版本为准。

### 2.1 CATEGORIES（分类体系 —— 当前脑图自然选择的结果）

用户要求“行情与产业新闻并重，让分类像 AIHOT 一样成为一个自然选择的过程”。AIHOT 的 6 类是“模型/产品/行业/论文/教程/观点”，本质是按**内容产生者在产业链的环节 + 信息形态**分层。据此，有色金属的对偶分类：

| key | label | section（日报分节） | guide（模型归类依据） |
|---|---|---|---|
| `price` | 行情 | 行情与价格 | 现货/期货价格异动、升贴水(现金/月差)、abs premium、back/contango 结构、关税引发的价格跳变、交易所结算价异常 |
| `inventory` | 库存 | 库存与到货 | 交易所库存(LME/SHFE/COMEX)、保税区库存、港口到货/出库、隐性库存、lithium/nickel 投放库存边际变化 |
| `supply` | 供给 | 供给与生产 | 矿山产量/停产/复产、品位下调、TC/RC 加工费、冶炼产能、能耗/限电/环保影响、罢工、事故、寒暑/暴雨扰动 |
| `demand` | 需求 | 需求与终端 | 下游(电网/电动车/光伏/空调/地产)采购、月度表观消费、镀锌/铝型材开工率、铜杆线缆订单、进口需求 |
| `policy` | 政策监管 | 政策与监管 | 关税/出口管制/配额、国储收抛储、环保督察、ESG 与反倾销、交易所风控(涨跌停/保证金/手续费调整) |
| `capital` | 资本与产能 | 资本与产能投资 | 绿地/棕地项目投资、并购、新产能投产、延期、撤项、融资、矿山出售/回购 |
| `company` | 企业动态 | 公司与机构 | 巨头财报、高管变动、战略调整、商业合作、诉讼、评级 |
| `macro` | 宏观 | 宏观与资金 | 美元指数/利率、美元指数与金属负相关、中国 PMI/社融、美联储、地缘(俄罗斯/刚果/智利/秘鲁)、进口关税政策风向、能源价格(对电解铝成本) |

> 说明：这是“初版”，真正的分类要让**真实信源跑 2–4 周后**在后台 SelectBench 里看归属误判率再微调。“自然选择”指：分类不靠臆想，而是由信源实际产出的报道类型催生，跑一段时间后按统计和误判收敛。规划文档状态为“待校准”。

### 2.2 CATEGORY_TAGS（第一个标签必须是分类标签）

```
"行情", "库存/到货", "供给/生产", "需求/终端", "政策/监管", "资本/产能", "企业动态", "宏观/资金",
"价格异动", "升贴水", "库存变动", "矿山事件", "冶炼/加工", "关税/贸易", "收储/抛储", "财报/业绩", "其他"
```

（首个为分类标签；其余为可打的主题性质细分。）

`CATEGORY_BY_ITEM_TYPE` 与 `CATEGORY_TAGS` 的关系、`CATEGORY_TAGS` 与 `ITEM_TYPES` 的映射，在 §5 重定义 ITEM_TYPES 后按新表联调（见 5.4）。

### 2.3 TOPIC_TAGS（主题标签，供主题页）

```
"铜", "铝", "锌", "铅", "镍", "锡", "黄金", "白银", "精矿", "冶炼", "TC/RC",
"新能源", "电动车", "光伏", "电网投资", "地产链", "美元/美债", "能源成本", "库存周期",
"矿山开发", "并购/产能", "关税/贸易", "地区:刚果", "地区:智利", "地区:秘鲁", "地区:印尼", "地区:俄罗斯", "地区:澳大利亚"
```

### 2.4 ENTITIES（公司/机构主题 → entity page）

三个方向：
- 矿企：Glencore(GLEN)、Freeport-McMoRan(FCX)、BHP、Rio Tinto、Anglo American、Codelco、Ivanhoe、Nornickel、First Quantum、紫金矿业(Zijin)、洛阳钼业(CMOC)、江西铜业、铜陵有色、Antam、印尼镍(Inco/Vale)
- 交易所/机构：SHFE、LME、COMEX/CME、ICSG、ITA、ILZSG、INSG、WBMS、SGG、世界黄金协会、中国有色金属工业协会(ChinaNIA)
- 贵金属/回收：WGC、LBMA、上海黄金交易所(SGE)、行业回收龙头

（每条 `id` / `name` / `displayTag` / `aliases`，多语言别名进 aliases，示例见 §3.2。）

### 2.5 IDENTITY_LEXICON & PUBLISHER_DOMAINS（防张冠李戴）

AIHOT 用它防止模型在摘要里写进原文没提到的公司。有色金属跨 7 种语言，这个防护**必不可少**：
- 每个语种保留正确的公司名：Codelco/Codelco、Nornickel/诺里尔斯克、First Quantum/第一量子、紫金/Zijin、铜陵/Tongling 等。
- alias 覆盖西/葡/法/荷/俄/中写法，例如 `{ id: "codelco", patterns: [/codelco|科德尔科/i] }`。
- `PUBLISHER_DOMAINS` 对官方一手站做归属判定（Codelco→codelco.com、LME→lme.com、SHFE→shfe.com.cn…），这决定了“第一手”标注是否准确。

> 跨语言如果 alias 做不全，宁可留空词表（AXAHOT 原注释：行业没有这个问题可以留空数组），也比漏配导致误标强。规划建议先配矿企/交易所最核心 20 个实体的别名，覆盖中/英/西/俄即可，法葡荷日后再补。

---

## 3. 主题目录 —— `industry/topics.json`

按 customize.md，主题分三组 `company`/`field`/`genre`。`slug` 上线后不可改。

- **company**：铜业(铜)、铝业(铝)、锌铅、镍、锡、黄金、白银、以及主要巨头（Codelco、Glencore、紫金、LME、SHFE…）。每条 `entityId` 指向 ENTITIES。
- **field**（方向，按产业链/驱动因子）：
  - `supply-chain` 供给链：矿山+冶炼+TC/RC
  - `energy-transition` 新能源金属：电池金属(锂 铜 镍)在绿色转型的需求
  - `macro-driver` 宏观驱动：利率/美元/中国需求
  - `accumulation` 库存周期
  - `trade-policy` 关税与贸易政策
- **genre**（内容形态）：
  - `price-moves` 行情异动
  - `mining-incidents` 矿山事件（事故/罢工/停产）
  - `capacity-moves` 产能与投资
  - `policy-actions` 政策与监管
  - `macro-watch` 宏观评议
  - `reports-and-data` 数据与报告（每月供需、库存周报、产量公告）
  - `opinion` 观点与深度

每个主题的 `tags` 对应 §2.3 的词表，`related` 给出关联（铜 ↔ 铝、新能源 ↔ 铜/镍 …）。

---

## 4. 功能模块开关 —— `industry/features.ts`

```ts
export const FEATURES = {
  leaderboard: false,        // 模型榜 —— 有色金属不需要
  codexResetMonitor: false,  // Codex 重置监控 —— 不需要，且需 SocialData
} as const;
```

关闭后导航/定时任务/页面/接口自动随 customize.md 收敛（无需删代码；如后续想精简再整块删）。

---

## 5. 精选标准 —— `industry/prompts/*`（最花时间的一步）

> customize.md 强调“保留结构（五轴加权、噪声压制、安全边界），只换例子”。以下是**结构保持不变**的替换方案。

### 5.1 prefilter.md（宽召回相关性预筛）

把 PASS/BLOCK/UNKNOWN 的判定从 AI 换成有色金属：
- PASS：明确有色金属（Cu/Al/Zn/Pb/Ni/Sn/Au/Ag/Li…，交易所、精矿、冶炼、TC/RC、升贴水、库存、CTA/套保、相关股票）的行情、供需、政策、产业链、企业、宏观资金或数据报告的信息/观点。
- BLOCK：只有普通股市、普通科技、无关商品(原油/农产品单列)、纯生活类内容；金属只作为无关背景一次带过，且非主标题。
- UNKNOWN：无法确认。同源规则：不能因公司名（BHP/Glencore）或“金属”单词就机械放行，要看在内容里的实际作用。

### 5.2 ITEM_TYPES 重定义（内容类型 → 评分权重表依据）

AIHOT 7 类：model_release / product_launch / tool_or_prompt / research_paper / industry_event / opinion_analysis / tutorial_explainer。

有色金属对偶 7 类（名字在 `taxonomy.ts` 的 `ITEM_TYPES` 改，**同步**改 `content-understanding.md` 与 `selection-score.md` 里的引用）：
1. `price_move` 行情异动（价格/升贴水/跨市结构/关税引发跳变）
2. `inventory_change` 库存变动（交易所/保税区/港口/隐性）
3. `supply_event` 供给事件（矿山停产/复产/品位/TC-RC/冶炼）
4. `demand_signal` 需求信号（终端开工/采购/表观消费）
5. `policy_action` 政策与监管（关税/收储/环保/配额）
6. `industry_event` 产业事件（产能投资/并购/财报/人事/诉讼）← 与 AIHOT 同名，语义沿用
7. `opinion_data` 观点与数据（分析师观点、深度报告、统计公报）

### 5.3 五轴 × 类型权重表（新）

保留五轴结构，Re 定义每类权重（权重行和=10）：

| 类型 | sig | nov | cred | reson | act |
|---|---:|---:|---:|---:|---:|
| price_move | 3 | 2 | 2 | 2 | 1 |
| inventory_change | 3 | 2 | 2 | 2 | 1 |
| supply_event | 4 | 2 | 2 | 2 | 0 |
| demand_signal | 3 | 2 | 2 | 2 | 1 |
| policy_action | 3 | 2 | 2 | 3 | 0 |
| industry_event | 3 | 1 | 2 | 4 | 0 |
| opinion_data | 1 | 3 | 1 | 3 | 2 |

（`attentionScore = sig·w1 + nov·w2 + cred·w3 + reson·w4 + act·w5`，行和 10 → 0–100。初版建议值，最终以 `eval-selection.ts` 在有色样本上的结果校准，见 §7。）

### 5.4 “必须正常评价的价值” vs “必须压住的噪声”（示例替换）

**正常评价**：某大矿品位下调或年产量指引修正；TC/RC 骤降领先冶炼利润；主要现货升贴水结构性切换（back↔contango）；交易所新库存/离场/补库超预期；出口管制或关税确认落地；新消费税/环保督察影响产能；并购落定或撤销；月度全球供需平衡超预期。行情+库存数据类信源因“对决策有用”也能独立高分（对应 pivot “对普通有色重度用户有用的数据几乎不受尺寸限制”）。

**压住**：期货开户/课程/资讯 End 段广告（sig≤2）；无数据的“大涨大跌”标题党（nov≤3）；单纯营销式“某平台客户案例”；叠盘多条价格快报无焦点（sig≤3）；非主线的普通宏观杂谈；矿业 PR 空泛公告（无规模/成本/时间/可验证效果）。

### 5.5 understand.md / content-understanding.md / structure.md

- 内容理解写中文标题、答案先行摘要、推荐理由、标签（最终给客户是中文，见 §9）。
- structure 抽取“事件主体(公司/交易所) + 品种 + 时间 + 事件类型 + 事实字段(数量/价位/方向) ”，供主题页聚合。
- 多语言原文也走同一结构化契约，只是输入语言不同。

### 5.6 group-*.md（事件归组）/ story-digest / report-*.md

沿用 AIHOT 现有方法论文件结构，把示例换成有色：SAME_OCCURRENCE（同一矿山事故的跨语言转述）、SAME_STORY（停产传闻→官方确认→产量影响评估→股价/升水反应）、ROUNDUP（SMM 日报 vs 单点报道）。综述/日报导语/周报月报提示词只换示例，不换结构。

---

## 6. 领域术语规则 —— `industry/prompts/rules-domain.md`（多语言的关键）

这是多语言落到中文的重头。在保留现有“歧义默认值 / 专名保留 / 中文品牌名 / 代码数字一字不改”四条结构下，重写为**有色金属领域**：

1. **歧义默认值（必须按金属含义）**
   - `Cu` 铜 / `cathode` 阴极铜 vs 中学“阴极” → 阴极铜
   - `premium` 现货/地区升水（不是“保险费”）
   - `cash` / `cash settlement` LME 现金结算 / 现金升水
   - `backwardation` (back) 现货升水/远月贴水；`contango` 期货升水/近月贴水
   - `lot` 一手/一批（金属合约张数，不译“大量”）
   - `concentrate` 精矿（不译“集中物”）
   - `smelter` 冶炼厂；`refinery` 精炼厂
   - `TC/RC` 冶炼加工费（Tackling charge/refining charge，保留英文缩写）
   - `delivery` 交割；`warrant` LME 仓单
2. **专名一律保留英文**（加中文品牌时括注）
   - 交易所/机构：LME / SHFE / COMEX / COMEX / ICE / SGE / LBMA / ICSG / ILZSG / INSG / WBMS / S&P GSCI
   - 品种代码：CU(沪铜) / LME-Cu / AL / ZN / PB / NI / SN / AU / AG / SHFE-CU-主力
   - 矿企：Glencore / Freeport-McMoRan / Codelco / BHP / Rio Tinto / Anglo American / Nornickel / First Quantum / Ivanhoe
3. **中文厂商优先官方中文名**（首次可双标）：紫金矿业(Zijin Mining) / 洛阳钼业(CMOC) / 江西铜业(Jiangxi Copper) / 中国铝业(Chinalco) / 铜陵有色(TLME)…
4. **数字/单位一字不改**：价格(6,800$/t, 55,000¥/t)、库存(180,000 t)、TC($35/tc)、日期、币种、%一律保留阿拉伯数字与单位；不要把“$6,800/t”改写为“每吨六千八百美元”。
5. **跨语言等价词转写**：西/葡/法/俄/荷同物种用标准中文译名（cobre=铜、aluminio=铝、zinc/zinco=锌、plomo=铅、níquel=镍、estaño=锡、oro=金、plata=银；俄语 медь→铜、алюминий→铝…）。规则给出一张官方映射表，模型据此一致性翻译。

---

## 7. 门槛与校准 —— `industry/selection.ts`

保留结构：
```ts
export const SELECTION = {
  thresholds: { T1: 55, T1_5: 60, T2: 70 },   // 初版建议（有色：官方一手门槛放低，媒体偏高）
  understandFloor: 50,
} as const;
```

必须用有色样本重新校准（不凭感觉改数）：
1. 从首批信源挑 100–200 条，人工标“选/不选”，存 `.data/gold.jsonl`（参考 `industry/gold.example.jsonl`）。
2. `node --env-file=.env scripts/eval-selection.ts --gold .data/gold.jsonl`。
3. 后台 SelectBench 逐条看误判，改 §5 提示词或门槛再跑，收敛到可接受的查准/查全。

---

## 8. 信源体系 —— `industry/sources.json`（多语言 · 六类型）

> 原则：并重行情/库存数据源 + 产业新闻/政策源；语言上中英为主，法俄西葡荷为辅；**最终展示统一中文**（§9）。participation：官方/权威一手 `editorial`，高噪声行情快讯设 `hot_signal`（只作热度），纯流量媒体 `T2 editorial`。付费源(公众号/X)需对应 key。

### 8.1 六类型映射表（config 字段见 config-keys.ts）

| kind | 用于 | 关键 config |
|---|---|---|
| `rss` | 有源媒体 | feedUrl / summaryIsBody / allowCategories |
| `web_list` | 无 RSS 官网列表 | url / itemSelector / linkSelector / titleSelector / parseMode(html\|markdown) / detail.* |
| `json_list` | JSON 接口 | url / itemsPath / titlePaths / publishedAtPath / urlTemplate |
| `x_search` | X 账号 | query:"from:A -filter:replies" / 需 SocialData |
| `mp_account` | 公众号 | ghid / nickname / 需极致了 |
| `external` | 自抓推送 | —（走 INGEST_TOKEN） |

### 8.2 建议首批信源（分语种，标注 kind / tier / interval / participation）

**中文（一手优先）**
| 信源 | 品种覆盖 | kind | tier | interval | participation |
|---|---|---|---|---|---|
| 上海有色网 SMM smm.cn | 六基+贵金属 | web_list (资讯列表) | T1_5 | 30–60 | editorial |
| 生意社 100ppi.com | 现货全线 | web_list | T2 | 60 | editorial |
| 我的有色 Mymetal | 有色现货 | web_list | T2 | 60 | editorial |
| 长江有色金属网 ccmn.cn | 现货+资讯 | web_list | T2 | 60 | editorial |
| 中国有色金属工业协会 chinania.org.cn | 政策/产量 | web_list | T1 | 120 | editorial |
| 各交易所官方公告(SHFE/LME中文/上金所SGE) | 交易所动态 | web_list | T1 | 60 | editorial |
| 主流财经(新浪期货/和讯/网易财经有色频道) | 新闻 | rss/web_list | T2 | 120 | editorial |

**英文（国际一手）**
| 信源 | 品种覆盖 | kind | tier | interval | participation |
|---|---|---|---|---|---|
| LME 官方 news/data lme.com | 六基全球定价 | web_list(或人工 detail) | T1 | 60 | editorial |
| LBMA lbma.org.uk | 贵金属 | web_list | T1 | 120 | editorial |
| 世界黄金协会 WGC gold.org | 黄金供需 | web_list | T1 | 120 | editorial |
| ICSG icsg.org | 铜供需 | web_list | T1 | 1440(按数据周/月) | editorial |
| ILZSG / INSG / WBMS | 锌铅镍锡数据 | web_list | T1 | 1440 | editorial |
| Fastmarkets fastmarkets.com | 金属价格/电池材质 | web_list | T1_5 | 60 | editorial |
| Argus Media（metals） argusmedia.com | 价格/运费 | web_list | T1_5 | 60 | editorial |
| Mining.com mining.com | 矿业新闻 | rss/web_list | T2 | 120 | editorial |
| Kitco kitco.com | 贵金属+基本金属 | rss | T2 | 60 | editorial |
| Reuters commodity (reuters.com/markets/commodities) | 硬商品 | rss/web_list | T2 | 60 | editorial（需可达性处理） |
| 主要矿企官网/新闻稿 Glencore/FCX/BHP/Rio/Codelco | 供给/产能 | web_list(json_list) | T1 | 120–180 | editorial |

**法语 / 俄语 / 西班牙语 / 葡萄牙语 / 荷兰语（辅助 · editorial 或 hot_signal）**
| 语种 | 候选信源 | 覆盖 |
|---|---|---|
| 西 | Codelco(es) / 智利矿业媒体(MineriaChilena、Mining & Metals LatAm) | 铜、拉美供给 |
| 西 | Reuters America Economia 金属段 | 拉美行情 |
| 葡 | BR Metals / 巴西矿业媒体(Brasil Mineral、Reuters Brasil) | 铝土/铁合金/巴西供给 |
| 法 | 法文矿业新闻(Challenges Commodités、Agence Ecofin) | 非洲铜钴(刚果/赞比亚)，法语区 |
| 俄 | 俄语矿业媒体(Metal Expert、Polymetal/俄镍 Nornickel 官网新闻) | 镍/钯/铝、俄罗斯制裁断供 |
| 荷 | 荷语大宗品媒体(Metal Achievements、某些 Substack) | 欧洲需求/鹿特丹升贴水 |

> 多语种信源多为无 RSS 官网 → `web_list` + 必要时 `parseMode:"markdown"`(Jina 按次计费)或 `detail`. 语种多时建议分阶段(en→zh 先跑通，再逐个加 es/fr/pt/ru/nl)。

### 8.4 多语种一手信源清单（实测验证 · 本规划追加）

> 以下信源经本机 curl 实测（2026-10，模拟浏览器 UA）。状态码说明：`200` 可直接接入；(403/526) 有反爬，需 `web_list` + `parseMode:"markdown"`（Jina 渲染）或 `detail` 兜底；(000) 连接/地区封锁，建议人工复核或换镜像。**实际抓取仍以后台"信源"页"试抓"结果为准。** 语种理由已按"产地一手才领先半步"筛选，不是凑数。

#### 西班牙语 → 南美（智利铜 / 秘鲁铜锌 / 阿根廷锂）

| 信源 | 国家/区域 | 覆盖品种/题材 | 实测 | 推荐 kind | tier |
|---|---|---|---|---|---|
| Codelco 官网首页/新闻 codelco.com | 智利 | 全球最大铜企：产量、罢工、劳资、Capex 一手公告 | 200 | web_list（官方一手） | T1 |
| Minería Chilena mineriachilena.com + /feed | 智利 | 智利采矿：铜矿项目、政策、行业工会 | 200 / RSS 可用 | rss 优先 | T1_5 |
| Mch.cl（矿业公报）+ /feed/ | 智利 | 智利矿业日报：供给/罢工/监管 / 安第斯铜矿带 | 200 / RSS 可用 | rss 优先 | T1_5 |
| Minería Argentina mineria-argentina.com + /feed | 阿根廷 | **锂**（盐湖提锂）、铜、金；南锥体矿业政策 | 200 / RSS 可用 | rss 优先 | T1_5 |
| El Periodico Minero（博客源，备用） | 泛拉美/玻利维亚 | 玻利维亚锂、拉美小矿种线索 | 404（不稳定） | 备用，不首推 | T2 |
| Ministerio de Minería de Chile（政府，备） | 智利 | 官方采矿统计、产量数据、许可 | 需复核 | web_list | T1 |

要点：智利（codelco/工会罢工）与秘鲁（Las Bambas、Antamina、社区封锁）是全球铜供给的"事件源头"，西语一手通常比英文转述快 24–48h。阿根廷盐湖（锂）是新能源金属新增选点。

#### 葡萄牙语 → 巴西（铝土矿 / 铁合金 / 镍）

| 信源 | 国家/区域 | 覆盖品种/题材 | 实测 | 推荐 kind | tier |
|---|---|---|---|---|---|
| Vale 淡水河谷官网新闻 vale.com | 巴西 | 铁矿石之外：**镍（Onça Puma）、铜（Salobo）、铝（Albras）**；季报/产量指引 | 200（英文 PT 站点） | web_list / json_list | T1 |
| CBNA（巴西铝业协会）cbna.com.br | 巴西 | 巴西**铝**：产量、出口、行业数据 | 200 | web_list | T1 |
| Agência Brasil（官媒）agenciabrasil.ebc.com.br | 巴西 | 官方宏观、矿业政策、出口统计 | 200 | web_list | T1_5 |
| G1 Economia /g1/ g1.globo.com/economia | 巴西 | 巴西商业与大宗品综合 | 200 | web_list | T2 |

要点：巴西是几内亚之外的铝土矿+冶炼重要产地，Vale 的镍铜与 CBNA 的铝是"南美冶炼端"一手。多数巴西站无 RSS，走 web_list。

#### 法语 → 法语非洲（几内亚铝土 / 刚果金铜钴 / 尼日尔）＋全球商品

| 信源 | 国家/区域 | 覆盖品种/题材 | 实测 | 推荐 kind | tier |
|---|---|---|---|---|---|
| Boursorama Matières Premières boursorama.com/bourse/matieres-premieres | 法国/全球 | 法文商品行情：基本金属、贵金属、能源、费率 | 200 | web_list | T2 |
| LiveBourse livebourse.com | 法国/全球 | 法文金属报价：铜/铝/锌/铅/镍/锡 + LME 结构 | 200 | web_list | T2 |
| Agence Ecofin（矿业专栏）agenceecofin.com | 非洲/法语区 | **非洲矿业一手**：刚果金铜钴、几内亚铝土、赞比亚铜 | 403（需 Jina fallback） | web_list+markdown | T1_5 |
| Jeune Afrique jeuneafrique.com | 非洲/法语区 | 非洲政经与矿产资源国动态 | 403（需 Jina fallback） | web_list+markdown | T2 |
| Guinée Matin guineematin.com | 几内亚 | **西非铝土**（几内亚存量/Boffa 等）、铁矿 | 200 | web_list | T1_5 |

要点：法语非洲是 commodityHOT"非洲源头"的关键——几内亚铝土占全球出口大头、刚果金钴铜带是电池金属核心。Agence Ecofin/Jeune Afrique 有反爬，(403) 必须配 Jina fallback 或 detail。

#### 俄语 → 俄罗斯（镍 / 钯 / 铝 / 铜 · 制裁断供链）

| 信源 | 国家/区域 | 覆盖品种/题材 | 实测 | 推荐 kind | tier |
|---|---|---|---|---|---|
| RUSAL 俄铝官网 rusal.ru | 俄罗斯 | **铝**产能、出口制裁、氢铝影响、原料 | 200 | web_list | T1 |
| Rusmet 俄罗斯冶金市场 rusmet.ru | 俄罗斯 | 独联体冶金/金属市场、出口禁令、钢铝 | 200 | web_list / json_list | T1_5 |
| Interfax 商务频道 interfax.ru/business | 俄罗斯 | 官方社讯：制裁、关税、公司动向一手 | 200 | rss（如无走 web_list） | T1_5 |
| PRIME 1prime.ru | 俄罗斯 | 俄罗斯商品/金属新闻、出口数据 | 200 | rss 优先 | T1_5 |
| Nornickel 诺里尔斯克 nornickel.com/.ru | 俄罗斯 | **镍、钯、铜、铂**：产量、制裁、停产 | 000（连接/封锁，需复核） | web_list+Jina | T1 |
| TASS 经济 tass.ru/ekonomika | 俄罗斯 | 国家通讯社：制裁/出口/宏观一手 | 200 | rss | T1_5 |
| RIA 经济 ria.ru/economy | 俄罗斯 | 俄官方经济新闻源 | 200 | rss | T1_5 |

要点：俄语是"镍/钯/铝制裁断供"的最快一手（Nornickel 停产、出口禁令对 LME 钯/镍价直接冲击）。nornickel.com 本机 000 多半是地区/Cloudflare 封锁，接入时配 Jina fallback。

#### 阿拉伯语 → 海湾（铝冶炼 / 中亚/中东宏观）＋中东

| 信源 | 国家/区域 | 覆盖品种/题材 | 实测 | 推荐 kind | tier |
|---|---|---|---|---|---|
| Al-Eqtisadiah（沙特经济日报）aleqt.com | 沙特 | 海湾宏观、能源价格对铝冶炼成本的传导、石化 | 200 | web_list | T1_5 |
| Emirates 24/7 商业 emaratalyoum.com/business | 阿联酋 | 中东商业、经贸、宏观 | 200 | web_list | T2 |
| Al Arabiya Business alarabiya.net/aswaq | 阿联酋/沙特 | 中东财经主流（原油-金属联动、海湾工业） | 403（需 Jina fallback） | web_list+markdown | T2 |

要点：海湾是"低成本铝冶炼"与能源成本传导的关键（中东铝产能占全球可观份额），阿拉伯语财经源覆盖"油气-铝成本-海湾工业出口"这条独特链路。alarabiya 有反爬需 Jina fallback。

### 8.5 多语种信源接入注意事项（好用性保障）

1. **kind 选择优先级**：有稳定 RSS 的用 `rss`（省采集成本）；无 RSS 但列表规律的用 `web_list`；被反爬(403/526)的必须 `parseMode:"markdown"`(Jina 按次计费) 或配 `detail`，并在预算熔断里给 Jina 单独限额。
2. **regional 字段建议**：给每个多语种源打 `region`（南美/非洲/俄罗斯/海湾）与 `commodityGroup`（铜/铝/锌/镍/锡/锂/贵金属），便于 taxonomy 把产地信号路由到品种主题页——这是"产地一手"转化成投资信号的落点。
3. **语言 → 品种映射内置进 rules-domain.md(§6)**：西语 cobre=铜、俄语 никель=镍、法语 aluminium=铝等等价词表，保证多语种标题/摘要在归组和展示阶段归一化成中文。
4. **一手判定**：官方域(codelco.com/vale.com/rusal.ru/nornickel.com)标 `first_party:true`、`tier:T1`；行业媒体(ecofin/jeuneafrique/metallplace)标 `T1_5`；财经转载标 `T2`。十字可信度(第四部分任务C)据此给事件打可信度。
5. **分阶段接入**：先拉通 塞西语(智利/阿根廷锂) + 俄语(镍钯铝) 两条"产地一手"干道 → 再加法语(西非/刚果金) + 葡语(巴西) → 阿拉伯语(海湾) 收尾。每条干道先 2-3 源验证去重+翻译质量(任务G)后再扩。
6. **小语种翻译质量护栏**：荷兰语等边缘语种暂缓或只入 `hot_signal`；对 es/pt/ru/ar/fr 都要有"人工抽检样本"确认翻译不出错，否则不进 editorial(呼应决策点4)。

**外部推送 external（可选增强）**
- 自己抓的交易所库存/升贴水结构化数据，经 `POST /api/ingest/items` 推进站，带 `_aihot.backfill` 控制旧文。

（具体 URL 与选择器需在后台“信源”页逐条试抓后确认；本规划不臆造已失效地址，以试抓结果为准。）

---

## 9. 多语言 → 中文展示策略（交付形态）

目标：**采多语言，展统一中文**。框架的原生能力：原文入库 → 判重(跨语言) → 评分 → 内容理解写中文 → 归组成事件 → 中文日报/RSS/API 输出。`translate-*.md` 负责全文/长帖翻译。要点：

1. **原文语言检测**：来源语言不必写死；采集层保留原文、原文标题作 fallback（对应“信源默认只显示摘要和原文链接，不显示全文”）。
2. **中文标题/摘要为第一输出**：`content-understanding.md` 明确“标题、摘要、推荐理由一律简体中文”，保证最终给客户统一中文。
3. **专名/价格/单位保留原样**（§6 规则），避免翻译失真（尤其铜镍金的价格、升贴水、仓单数）。
4. **不翻译的部分**：英文缩写、公司名、交易所代码、价位、日期一律保留，仅在必要时中文括注。
5. **RSS/API/MCP 输出简体中文正文 + 原文链接**（`syndicate_fulltext` 默认关）。
6. 若遇极长或稀缺语种(荷兰语)优先用 `web_list` 摘要 + `translate-*` 走标准流程，未覆盖到 GET 全文时保留“信息不足，附原文”的摘要。

> 多语言质量风险：法/荷小众语种模型翻译偶尔退化。建议 `understandFloor` 不因语种放宽；噪声压制对多语种同样生效；首批抓取后人工抽查 3 语种样本校准。

---

## 10. 品牌与页面 —— `industry/brand/`、`industry/pages/`

- **品牌**：`logo.svg`、`icon.png(512)`、`icon-192.png`、`apple-icon.png(180)`、`favicon.ico` 换成 commodityHOT 图标。
- **报头字**：`scripts/nameplates.ts` 重新生成“有色金属日报/周报/月报”报头（`npm pack @fontsource/noto-sans-sc` + `node scripts/nameplates.ts package`），对应目录更新到 `industry/brand/nameplates/*.svg` 与 `index.json`。
- **条款页**：`pages/terms.md`、`pages/privacy.md` 现为模板 → 上线前按 commodityHOT 实际改写（必要时请专业人士），并在 `site.ts` 填 contactEmail/icp。
- **changelog.json**：加一条 commodityHOT 首版记录，更新 `latestVersion`。
- 前端 `apps/web/app/components/Logo.tsx` 默认用站名文字，暂不换图标组件；如需图片 Logo 再替换。

---

## 11. 测试与验收

按 AGENTS.md：
```bash
npm run typecheck
DATABASE_URL=postgres://127.0.0.1:5432/commodityhot_test npm test   # 库名 _test/_ci 结尾；先 node scripts/migrate.ts
npm run build -w @aihot/web && node --test apps/web/tests/*.test.ts
node scripts/smoke.ts --base http://localhost:3000
```

- `tests/` 中 AI 示例分类/标签/公司（openai、gemini 等）→ 换成有色对应项（铜、Glencore、LME、SHFE…）。
- 校准：`eval-selection.ts --gold .data/gold.jsonl` 看查准/查全。
- 试抓：后台“信源”页逐个“试抓”，确认 URL/选择器/日期解析可用，识别失败原因并调整。
- 旧文不刷屏：新信源存量与 >48h 资料按原文时间归档，不进“今天”、不推送（规则内置，多语种同样生效）。

---

## 12. 落地路线图（建议顺序）

| 阶段 | 任务 | 验收 |
|---|---|---|
| P0 | site.ts / features.ts / brand / 报头字 | 站名 commodityHOT；AIHOT 专属模块入口消失 |
| P1 | taxonomy.ts(类/标签/实体) + topics.json | Rypecheck 过；分类归属可跑 |
| P2 | 首批中文信源 sources.json + 试抓 20 个源 | 试抓全部成功或可解释失败；无付费源也能出内容 |
| P3 | prompts/ 全量替换(§5)+ rules-domain(§6) | 用 AIHOT 方法跑通一条“沪铜+国际铜价”联合事件 |
| P4 | 英文国际源加入(en)、校准明细 | 双语言事件归组正常 |
| P5 | 法/俄/西/葡/荷陆续加入 | 多语言统一中文展示达标(抽检) |
| P6 | selection.ts 用 gold 校准 + SelectBench 审核 | 查准/查全收敛 |
| P7 | 上线：条款/privacy/icp/飞书推送/公开出口核对 | smoke 通过；公开内容匿名可审计 |

---

## 13. 风险与决策点（需要 Derek 本人决定）

1. **站名**：commodityHOT（品牌名），subject“有色金属”——已定。是否需要覆盖贵金属“黄金/白银”作为独立主题（建议要，黄金是独立流量点）。
2. **首批信源范围**：先只上中文 8 个 + 英文核心 8 个跑通，还是直接全量 20+（含付费 X/公众号）？规划推荐分阶段，P0–P4 先免费源。
3. **数据源成本**：X(需 SocialData)、公众号(需极致了)、部分 web_list 用 Jina markdown（按次计费）。是否投入这些付费通道？预算熔断已内置，但需你的预算与 key。
4. **分类是否聚焦**：“行情+库存”as 第一信号，还是“产业+政策”为主？本规划按并重设计，但日报首页焦点板块排序（§2.1 section 顺序）可调。
5. **多语种节奏**：先 en+zh 稳定，还是 7 语种并行试跑？规划推荐前者。
6. **站点监管合规**：ICP / 备案 / 内容转载边界（聚合摘要可转载，全文需授权）——请按实际域名规划，条款页需本人确认。
7. **展示时区/币种**：日报默认按沪铜(home, RMB/tonne)还是 LME($/tonne)？建议双轨并在摘要注明结算币种。

---

## 附：待办落地 checklist（按 customize.md 顺序）

- [ ] `site.ts`：SITE/ABOUT 全替换（§1）
- [ ] `taxonomy.ts`：CATEGORIES/CATEGORY_TAGS/TOPIC_TAGS/ENTITY_TAGS/ENTITIES/IDENTITY_LEXICON/PUBLISHER_DOMAINS（§2/§3）
- [ ] `topics.json`：三组主题（company/field/genre）（§3）
- [ ] `sources.json`：首批 20 源，含语种/kind/tier/interval/participation（§8）
- [ ] `prompts/`：prefilter/understand/content-understanding/structure/selection-score/group-*/story-digest/report-*/translate-* （§5/§6）
- [ ] `selection.ts`：阈值初版 + gold 校准（§7）
- [ ] `rules-domain.md`：有色术语表 + 跨语言映射（§6）
- [ ] `features.ts`：两项 false（§4）
- [ ] `brand/*`、`nameplates/*`、`pages/*`、`changelog.json`（§10）
- [ ] `tests/`：AI 示例 → 有色示例（§11）
- [ ] typecheck / test / smoke / eval-selection（§11/§12）

---

*本文档为规划稿，未改动任何源码。落地按以上章节逐一执行并复验。*