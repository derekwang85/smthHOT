# CommodityHOT 改造方案（Spec v0.1 · 待 Derek 确认）

> 基于 AIHOT 开源框架（本地 `/media/cbnb/_opdata/smthHOT`）改造为大宗商品热点站。
> 本文件是 Pre-Execution Manifest：方向对齐后，改动几乎全部落在 `industry/` 文件夹，代码不动。

## 1. 目标与边界（已由 Derek 确认）

| 项 | 决策 |
|---|---|
| 定位 | **监控**（情报追踪 + 告警 + 日报），服务交易员和分析师。非合规监察。 |
| 品种范围 | 全品种（最终），**先跑通有色金属**（铜/铝/铅/锌/镍，以铜为主） |
| 排序增强 | 在原有"独立来源数热度"之上，**补充 impact（冲击力）维度**。 |

## 2. 核心设计决策

### 2.1 站点身份（`site.ts`）
- name: `CommodityHOT`；subject: `有色`（全品种铺开后再改 `大宗商品`）
- mcpPrefix: `commodityhot`；crawlerName: `CommodityHOTBot`

### 2.2 分类体系（`taxonomy.ts` + `topics.json`）
- **CATEGORIES（品种维度，key 上线后不改）**：
  `copper` 铜 / `aluminum` 铝 / `lead` 铅 / `zinc` 锌 / `nickel` 镍 / `macro` 宏观与政策 / `multi` 多品种与行业
- **ITEM_TYPES（事件类型，驱动五轴权重）**：
  `supply_event` 供给事件 · `demand_event` 需求事件 · `inventory_data` 库存数据 · `policy_macro` 政策与宏观 · `price_market` 行情与资金 · `company_ops` 企业与产业 · `analyst_view` 观点与预测
- **标签词表**：分类标签（供给/需求/库存/政策宏观/行情资金/企业产业/观点预测/数据发布）+ 主题标签（矿山/冶炼/加工/新能源/基建/地产/出口/TC-RC/保税区/逼仓/收储/抛储…）+ 实体标签（铜/电解铜/铜精矿/铝/氧化铝/铅/锌/镍/LME/SHFE/INE/智利/Escondida/Codelco/国储局/发改委/海关总署…）
- **topics.json 三组**：`metal` 品种 / `chain` 产业链环节（矿端/冶炼/加工/下游）/ `genre` 事件类型

### 2.3 impact 五轴（`prompts/selection-score.md` 重定义，代码结构不变）
沿用框架固定的五轴名 `sig/nov/cred/reson/act`，仅重写**含义 + 类型权重 + 品味规则**：

| 轴 | AIHOT 原义 | CommodityHOT 新义 |
|---|---|---|
| `sig` 实质份量 | 时间线节点 | **供需基本面的实质冲击力**（减产/停产/收抛储/关税的力度） |
| `nov` 信息增量 | 新认知 | **市场预期差**（是否尚未被定价的新信息） |
| `cred` 证据强度 | 证据支持 | **证据强度**（官方数据/交易所公告 vs 传闻/自媒体） |
| `reson` 共振面 | 读者相关度 | **影响辐射面**（单品种 → 有色板块 → 大宗/宏观） |
| `act` 可用性 | 能否马上用 | **交易可操作性**（能否据此调仓/下单） |

- 七类事件类型各自设定五轴权重（供给/需求/库存类重 `sig`+`cred`；观点类重 `nov`+`reson`；行情类重 `act`）。
- 品味规则重写：压住营销软文、行情复盘、搬运早报、无数据支撑的看涨看跌；正常评价减产停产、库存异动、收抛储、关税反倾销、官方产量/进出口数据。

### 2.4 关闭 AI 专属模块（`features.ts`）
- `leaderboard: false`、`codexResetMonitor: false`

## 3. 信源名单 v1（待 Derek 补充/纠正）

### 官方一手 T1（免费/公开优先）
1. 上海期货交易所 SHFE — 公告、仓单、周度库存
2. 上海国际能源交易中心 INE — 国际铜合约公告/库存
3. 伦敦金属交易所 LME — 日度库存、官方结算价、公告（英文）
4. 国家统计局 NBS — 有色金属月度产量
5. 海关总署 GACC — 铜精矿/精炼铜进出口月度数据
6. 国家发改委 — 政策、抛储/收储
7. 商务部 — 反倾销/关税/贸易政策
8. 中国有色金属工业协会 CNIA — 行业产量/景气
9. 智利铜业委员会 Cochilco — 智利铜产量/出口（英文）
10. 国际铜研究组 ICSG — 全球铜供需月报（英文）
11. SMM 上海有色网 — 现货报价/库存（核心付费，部分公开）

### 媒体/资讯 T2（免费可爬）
12. 期货日报（公众号）· 13. 金十数据（快讯）· 14. 财联社 · 15. 我的钢铁 Mysteel 有色 · 16. 生意社 · 17. 长江有色金属网（现货价）· 18. 隆众/卓创 · 19. 文华财经/新浪财经有色/东方财富 · 20. Mining.com（英文）· 21. Reuters Metals（英文）

### 付费（标注，后续可选接 API）
Wind · Bloomberg · Fastmarkets · S&P Global Platts · 安泰科 Antaike · SMM 会员

## 4. 改造步骤（对齐后执行）

1. `features.ts` 关 AI 模块
2. `site.ts` 改站名/文案
3. `taxonomy.ts` 重写分类/标签/实体词表
4. `topics.json` 重写三组主题
5. `prompts/selection-score.md` 重写五轴 + 权重 + 品味规则
6. `prompts/` 其余（prefilter / content-understanding / rules-domain / identity-context 等）同步改
7. `sources.json` 换成有色信源
8. `selection.ts` 调门槛（有色官方数据 T1 门槛可更低）
9. `docker compose up -d --build` 重建 + 用标注样本跑 `scripts/eval-selection.ts` 校准

## 5. 成功标准

- 站名/文案/分类/标签/实体全切换为有色金属
- 五轴评分体现"供需冲击力"而非"注意力价值"
- 铜品种样板：一条减产/库存异动/收抛储新闻能被正确评分并聚簇
- AI 模型榜/Codex 监控模块已关闭
- 编译通过、首页能跑、日报能出

## 6. 待 Derek 拍板

1. **分类粒度**：品种维度 + 事件类型维度的划分是否 OK（尤其 `macro`/`multi` 两个跨品种类要不要）
2. **impact 五轴定义**：上述重定义是否认可
3. **信源名单 v1**：补/删/纠（哪些有 RSS/JSON 接口、哪些要爬、哪些付费、漏了哪些关键源）
