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

### 已覆盖（48 源；海外 32 / 国内 16；西语4 · 葡语3 · 法语3 · 印尼语2 · 越南语2 · 泰语1 · 韩语2 · 阿语1 · 英语7 · 日语2）
- **中文·国内**：SHFE/INE/NBS/GACC/NDRC/MOFOCOM/CNIA + SMM/Mysteel/期货日报/财联社/金十/生意社/长江有色 + 新浪期货/东财期货。
- **西语·南美**：秘鲁 MINEM、Andina、墨西哥 SGM、**智利 Redimin（走 `rendered`，反爬站已解锁 13 条/次）**。
- **葡语·巴西**：ANM、IBRAM、Agência Brasil。
- **法语·西非/中非**：几内亚 CBG、Financial Afrik、**刚果金 MINES.CD**。
- **印尼语**：**印尼能矿部 ESDM、Tambang.co.id**（补齐镍/锡供应侧空白）。
- **越南语**：Vietstock、**VietnamPlus 经济（越通社，`itemSelector` 已校准 48 条/次）**。
- **泰语**：**ฐานเศรษฐกิจ Thansettakij 经济**（可达 385→10 条/次）。
- **韩语**：**SNM News 철강금속신문（钢铁金属日报）+ The Elec 디일렉（电池金属下游）**；均静态 `articleList.html`，经我们采集器实抓 37/36 条干净候选。
- **阿语·海湾**：沙特 Maaden。
- **英语·非英美**：南非 Mining Weekly、Miningmx；赞比亚 ZCCM-IH；印度 OfBusiness、Moneycontrol；泰国 曼谷邮报；瑞士 Glencore。
- **日语**：JAPAN METAL、Japan Metal Daily。
- **国际基准**：LME、Cochilco、ICSG、Mining.com、Reuters。

### 下一批缺口与实测阻断（2026-10-06 更新）
> **本会话系统性实测结论**：从当前采集网络的出口 IP 与默认 UA 看，多语种官方/政府源存在两大硬阻断——(A) **网络层 WAF/IP 封禁**（静态与 Chromium 渲染都会被 403/502/500 拦），(B) **JS 懒加载列表**（渲染后 DOM 存在但被 Readability 清理丢弃，`fromMarkdown` 抓不到链接表）。因此下列语言暂判「占位」，需满足解锁路径后再接入。

1. **俄语（仍 0 源，路径 A+B 双重阻断）**：TASS(静态403, 渲染后 DOM 545KB 但无文章链接)、RUSAL(渲染后 9 条但多为环保/奖学金/志愿者 PR，非金属行情)、Nornickel(渲染后 DOM 487KB 无列表)、nedradv(静态500, 渲染后 0)、Interfax(可达但偏宏观油气/央行动态)、Kommersant theme/746(输出通用导航非冶金稿)。**解锁路径**：见文末「优先代码动作」——TASS/Nornickel 连 networkidle 后完整 DOM 都没有列表链接，属「XHR/滚动懒加载到底」，需采集器 scroll/拦截 XHR 能力 + 换 egress 出口/代理处理 IP/WAF。
2. **阿语（缺口已借门户缓解）**：沙特 Maaden 之外，native 阿语官方/大门户（SPA 渲染后 0、沙特工矿部渲染 502、aleqt 渲染后 0、Argaam/alarabiya/cnn 渲染后难抽列表，Asharq 偏油气量少）均被**路径 A（IP 级 WAF）**或 JS-lazy 硬卡；**解锁路径**：换 egress 出口/代理后重试。**已先行打通门户入海口**：Zawya 阿拉伯文 `/ar/topic/metals` 经我们 render 服务稳定渲染、无 Cloudflare，`fromHtml` 20 条干净金属候选，已入库 `zawya-ar-metals`（#65）——详见 §8.10。
3. **葡语（仅 3 源，全巴西）**：安哥拉 MIREMPET/Angop/VerAngola/Jornal de Angola 全部静态 403/0（**路径 A**）。**解锁路径**：同上换出口。**备注**：巴西本土地矿已齐（ANM/IBRAM/Agência Brasil），安哥拉/莫桑比克铜锂钴属高价值缺口。
4. **西语补强**：已实测 `rendered` 成功解锁 **Redimin**（已入）。其余 **Sernageomin、MiningPress、MineriaenLínea** 渲染后仍未抽出干净列表（路径 B），需换子站 URL 或人工校准。
5. **刚果/赞比亚（混法/英）**：矿委会（Gécamines、CAMI、Chambre des Mines）+ 赞比亚当地矿业报（MINES.CD 已入，走静态，可继续扩）。
6. **Trading House 官方**：Trafigura/JX Metals 等 news-reports 子站，走 `rendered`（Glencore 已入）。

> **优先代码动作（可显著解锁大量未达标的 static/JS-lazy 源）**：`rendered` 分支已支持「渲染后 HTML→cheerio card selector 解析」（当源配置 `parseMode=rendered` + `itemSelector` 时返回整份渲染 DOM 走 `fromHtml`），为 card-list 类 JS 源铺好解析能力。**但实测 TASS/Nornickel/SPA 的列表链接连 networkidle 后的完整 DOM 里都没有**（页面通过 networkidle 之后由 XHR/滚动分页再拉取列表），因此这类真正「懒加载到底」的源还需后续采集器能力：滚动加载 / 拦截并回放 XHR（`page.waitForResponse` 捕获接口 JSON），属较大独立改造，改动前走 Pre-Execution Manifest。

---

## 7. 执行纪律

- 改跨文件/大批量前写 Pre-Execution Manifest（`.coding-framework/constitution/pre-execution-manifest.md`）。
- 收录结果与 HITL 审批回写 `team-memory/decisions/`，过 `verify_asset.py` 校验。
- 反爬/付费/代理涉及成本，一律交运营拍板，不擅自开启付费能力。
- 每批入库后立即在后台复核 selector，未达标的不要长期挂着绿点。

---

## 8. 已验证候选待办清单（2026-10 多语种挖掘产物）

> 本节是把历轮挖掘中**确认真实存在、内容对题、但目前被网络可达性或密码门槛卡住**的候选汇总为机器/人可操作的待办。每条的「判」用我们 own 采集器（`guardedFetch`+`fromHtml`）或本地 Chromium（`rendered`）实测标注，防止未来重复探测。只有 `confirmed=可入库` 写好源配置；其余待解锁后再走 §5。

判级口径：🟢confirmed(即可入库)｜🟡placeholder(可达但需校 selector / 低相关)｜🔴blocked(网络/密码门禁，需解锁)。

### 8.1 阿语
| 候选 | 环节 | tier | 判 | 备注/解锁 |
|---|---|---|---|---|
| 沙特 Maaden(官网) | 上游磷/铝/铜 | T1 | 🟢已入库 | — |
| Saudi Press Agency SPA /economy | 官方宏观 | T1_5 | 🔴 | 渲染后 DOM 无文章链接，需 XHR 能力 / 换出口 |
| 沙特工矿部 MediaCenter News | 官方政策 | T1 | 🔴 | 渲染 502，IP 级 WAF，需换出口 |
| Asharq Business financial-markets | 财经/油气 | T2 | 🟡 | 渲染后仅 4 条且偏油气，非冶金，低相关 |
| Argaam commodityprices | 商品价格 | T2 | 🟡 | 渲染后 0 候选（价格表非链接） |
| Al-Arabiya aswaq | 财经 | T2 | 🔴 | 渲染后难抽列表 |
| CNBC Arabia finance-markets | 财经 | T2 | 🔴 | 渲染后难抽列表 |

### 8.2 俄语
| 候选 | 环节 | tier | 判 | 备注/解锁 |
|---|---|---|---|---|
| TASS /ekonomika | 官方宏观+矿冶 | T1_5 | 🔴 | 静态403，渲染 DOM 545KB 无列表链接，需 XHR/滚动 + 换出口 |
| Interfax /business | 商业快讯 | T1_5 | 🟡 | 可达 39 条但偏宏观油气/央行，可频道过滤后用 |
| RIA /economy | 官方宏观 | T1_5 | 🔴 | 渲染无列表 |
| Nornickel press-releases | 镍/钯/铜龙头 | T1 | 🔴 | 渲染 DOM 487KB 无列表链接，需 XHR/滚动 |
| RUSAL press-releases | 铝龙头 | T1 | 🟡 | 渲染 9 条但多为环保/奖学金/志愿者 PR，非金属行情 |
| Polyus /ru/media/news | 金龙头 | T1 | 🟡 | 可达但公司 PR(员工/艺术节)非行情 |
| dprom.online news | 采掘门户 | T2 | 🟡 | URL 需校 selector |
| nedradv.ru news | 远东矿业媒体 | T2 | 🔴 | 静态 500，渲染后 0 |

### 8.3 西语（秘鲁/智利补强）
| 候选 | 环节 | tier | 判 | 备注/解锁 |
|---|---|---|---|---|
| 智利 Redimin | 矿业门户 | T2 | 🟢已入库 | 走 rendered，13 条/次 |
| Rumbo Minero(秘鲁) | 矿业门户 | T2 | 🔴 | 静态 403，Cloudflare，需换出口 |
| Sernageomin(智利) | 官方地质 | T1 | 🔴 | 渲染后无干净列表，JS |
| MiningPress(阿根廷) | 矿业媒体 | T2 | 🔴 | 静态 timeout/403 |
| MineriaenLínea | 矿业媒体 | T2 | 🔴 | 渲染后无干净列表，JS |

### 8.4 葡语（安哥拉/莫桑比克补强）
| 候选 | 环节 | tier | 判 | 备注/解锁 |
|---|---|---|---|---|
| **IBRAM(巴西矿业协会) /noticias** | 官方产业协会/矿石-冶炼记录面 | T1 | 🟢已入库(#63) | **已修复**：页为渲染站点，旧配置漏 `parseMode:rendered` 且巴西日期为 `DD/MM/YYYY`（day-first）解析不了 → 补 `rendered` + `publishedAtUtcOffset:-03:00` + 新增**共享**配置 `publishedAtDayFirst`。真实 `fromHtml` 端到端 12 条干净候选（铁矿/铜/金/CFEM 特许权/关键矿产），0 缺日期 0 缺标题。 |
| InfoMoney(巴西财经门户) /tudo-sobre/mineracao | 财经门户「新浪财经」类 | T2 | 🟡 | 列表卡无日期 + `<li>` 混入非矿业链接（lps 落地页、Ultimas Noticias、business/global），需更精准 `itemSelector` 或 `/mineracao` 专用 tag 页再试 → deferred |
| MIREMPET(安哥拉) noticias | 官方 | T1 | 🔴 | 静态 403，IP 级 WAF，需换出口 |
| Angop(安哥拉) noticias | 官方通讯社 | T1_5 | 🔴 | 静态无候选/403 |
| VerAngola economia | 财经 | T2 | 🔴 | 静态无候选 |
| Jornal de Angola economia | 财经 | T2 | 🟡 | 200 但需校 selector |

### 8.5 法语（中非/西非补强）
| 候选 | 环节 | tier | 判 | 备注/解锁 |
|---|---|---|---|---|
| MINES.CD(刚果金) | 铜钴矿山媒体 | T2 | 🟢已入库 | 静态 83 条/次 |
| Agence Ecofin /minerie | 矿业快讯 | T2 | 🔴 | 静态 403，Cloudflare |
| Gécamines(刚果金) | 国家矿企 | T1 | 🔴 | 未复核/需换出口 |
| CAMI(刚果金) | 官方矿权 | T1 | 🔴 | 未复核/需换出口 |
| 几内亚矿业部 | 官方 | T1 | 🔴 | 未复核/需换出口 |
| CBG(几内亚) | 铝土矿主力 | T1 | 🟢已入库 | 静态 |

### 8.6 韩语/印尼语/越南语/泰语（已基本补齐，余量低）
- 韩语：snmnews ✅ / thelec ✅ 已入库；etnews / businesspost / electimes 可作下一批（需校 selector，etnews 本机 IP 被 WAF 拦）。
- 印尼语：ESDM ✅ / Tambang ✅ 已入库；余量低。
- 越南语：Vietstock ✅ / VietnamPlus ✅ 已入库；CafeF / 工贸部报 可作下一批。
- 泰语：Thansettakij ✅ 已入库；Bangkok Biz 可达但导航噪音重。

### 8.7 新增海湾/中亚候选（2026-10-06 实测，回答「俄语区不限俄罗斯」「海湾非沙特」「新加坡节点」）
用我们 own 采集器（`guardedFetch`+`fromHtml`）实测，**不是子代理浏览器错觉**：

**海湾 GCC（用更开放的阿联酋/卡塔尔切入，避开保守的沙特）：**
- **EGA media.ega.ae（T1，铝全链条**：铝土矿→氧化铝→电解铝→再生铝→出口）**已入库**：静态 200，实测 7 条干净候选（几内亚铝土矿发货、Al Taweelah 技改、收购意大利 Eco Green 再生铝 80%、Gulftainer 东海岸铝出口、NALCO DX+ 技术转移）——语种 en，**填补海湾/中东节点**。
- DMCC dmcc.ae/latest-news（T1_5，迪拜大宗枢纽）：静态 200，但新闻卡与 `/business/*` 导航混排，需 `itemSelector` 校准 → 占位（🟡）。
- The National business/markets（T2，阿联酋英文大报）：静态 200 但导航噪音重+金属密度低 → 占位（🟡）。
- Gulf Times business（卡塔尔，T2）：200 但 0 候选（JS/卡片非根域链接）→ 占位（🔴）。Gulf News / The Peninsula / Asharq Business：403/JS/金属密度低 → 排除（🔴）。**Zawya 金属频道两条语种均实测打通并入库，见 §8.10（更正上一轮「403/排除」判定：Zawya 走 `rendered` 可稳定渲染、无 Cloudflare）。**
- Qatalum / QAMCO（卡塔尔铝业）官方新闻：**unverified**，待查。

**新加坡（金属贸易枢纽，en）：**
- The Edge Singapore /news/commodities（T2）：金属密度 A 级（LME 铜锌铝、印尼镍减产、新加坡铁矿价），实测直连 403(Cloudflare) → 需 `rendered`/反爬（🟡，值得优先）。
- SGX /commodities（T1 交易所）：SPA + 内容为产品页非新闻流，裸 HTML 抓不到新闻 → 价值有限（🟡）。
- Business Times / CNA / Straits Times：JS/paywall 挡板 → 占位（🔴）。

**俄语区·中亚/东欧（绕过俄罗斯，哈萨克优先）：**
- **Kazinform 经济（qazinform.com，T1_5 国家社）已入库**：静态 200，allow `/news/` 后 20 条干净候选（贸易/通胀/AIFC）——语种 en，**填补中亚/俄语区节点**（金属密度偏低，但为该地区一手宏观/贸易锚点）。
- Kazatomprom /en/media/news（T1 铀/金）：静态 200 但列表页 top 层是分页与投资者导航，文章 URL 更深 → 需子站/selector 校准（🟡）。
- Kursiv(kz.kursiv.media) / Tengrinews / UzDaily / AGMK / Montsame / Kazzinc：静态可达但均为导航/CSR 噪音，需逐站 `itemSelector` 校准（🟡/🔴混合）。
- 乌克兰/亚美尼亚/白俄：战事 gating / 低优先 → 暂缓。

### 8.8 土耳其（2026-10-07 实测补强；铜/铝冶炼环节，目前仍 0 源）
| 候选 | 环节 | tier | 判 | 备注/解锁 |
|---|---|---|---|---|
| Eti Maden /haberler (etimaden.gov.tr) | 硼/锂/稀土国有矿业化工 | T1 | 🟡 | 静态直连 `www.` 失败，渲染可达；`/haberler` 为轮播+归档混排，无一致的干净卡片容器，日期只在正文里（如 "14.09.2024 tarihinde"）；且主打硼（非铜/铝/锌核心有色），金属密度低 → 未入库 |
| Eti Alüminyum /basin-bultenleri | 土耳其唯一一体铝冶炼（Seydişehir：铝土矿/氧化铝/电解铝/铸件） | T1 | 🔴 | Wix 站点（`wixui-box`），静态列表仅暴露 **2 条**新闻（最新 2025-11，另 2025-08），无分页；与已验证淘汰的 Eti Bakır 同为 Wix 模式 → 需 XHR/滚动能力或换出口后才可能解锁 |
| Eti Bakır（铜冶炼）| 铜 | T1 | 🔴 | Wix，`/basinbultenleri` 静态 0 链接（上一轮已判） |
| enerji.gov.tr | 官能矿政策 | T1 | 🔴 | 渲染 502，IP 级 WAF |

> 结论：土耳其铜/铝为覆盖缺口，但目前主要国企官网均被 **Wix 懒加载**（仅 2 条）或 **IP 级 WAF** 硬卡，且微博类门户未有对题的金属频道。待采集器 XHR/滚动能力或换出口后再回捡，本轮不强行凑数入库。

### 8.9 结论（可停机状态）
- **目标语言网格已尽量铺开**：中文/英语/日/韩/越/泰/印尼/西/葡/法/阿 皆有可采集 native 源；已新增**海湾(EGA)**、**中亚(Kazinform)**、**非洲·尼日利亚(msmd)**（2026-10-07 入库 #61）、**中东·阿曼(Sohar Aluminium)**（#60）、**拉美·墨西哥门户(El Financiero 矿业金属频道)**（#62，西语「新浪财经」类门户）、**海湾·Zawya 金属门户**（#64 英语 / #65 阿拉伯文，首破阿语）、**法语区 Financial Afrik 矿业频道**（#66）、**日语区住友金属礦山 SMM**（#67）等此前空白的经济体/语种节点，当前总源 **66**。
- **门户财经金属频道可成信源（已验证方向）**：El Financiero Mexico 的 `/tags/mineria-en-mexico/` 金属矿业频道，经真实 `fromHtml` 端到端验证（渲染→9 条候选，标题/URL/ISO 日期全部干净），补**西语·墨西哥·铜金银锌**记录面。同类「各国新浪财经」门户（巴西 InfoMoney、墨西哥 El Financiero、法国 Boursier、南非 BusinessDay 等）可沿此法逐站试抓与入库。
- **共享代码增强 · 支持巴西等 day-first 日期**：巴西站点日期为 `DD/MM/YYYY`，原 `parseLooseDate` 只认 year-first/英文月名，读不到日期 → 新增**配置无关、profile 中性**的 `publishedAtDayFirst`（加入 `config-keys.ts` 白名单），当且仅当其打开时按 day-first 解析并以 `publishedAtUtcOffset` 定零点。IBRAM #63 用此修复，其他葡语/欧陆/南非 day-first 源可直接复用。
- **共享代码增强 · 支持阿拉伯文日期**：Zawya 阿拉伯文时间戳如 `نُشر ٢ أكتوبر ٢٠٢٦, ١٤:٤٥ (GMT+8)`（「Published 2 October 2026」+ 东阿拉伯-印度数字）原 `parseLooseDate` 解析不了 → `parseLooseDate` 新增 `AR_DATE` 分支：东阿拉伯数字(٠-٩)归一 + 阿拉伯月名（يناير…ديسمبر，兼容 ال 前缀与 أ/ا 变体）→ 数字，按 `publishedAtUtcOffset` 定零点；`tests/web-list-date.test.ts` 加全 12 个月断言（6/6 全过）。这是**首破阿语 native 金属源**的关键前置。

### 8.10 海湾·Zawya 金属门户（2026-10-07 实测入库 #64 英语 / #65 阿拉伯文，首破阿语 & 海湾门户）
用户点名的「阿语」与「各地新浪财经类门户」方向在此合流。用我们 own render 服务（POST `:3003/`，同 El Financiero 法）实测，**不是浏览器错觉**：

- **Zawya（中东北非财经门户，版式 React SSR，两种语言均可稳定 render、无 Cloudflare）**：
  - 英语 `/en/topic/metals`：`fromHtml` 端到端 **20 条干净候选**，0 缺日期/标题/去重（India steel、LME zinc squeeze、Copper、Minerals Development Oman 铜金 JV、Saudi aluminium、EGA Al Taweelah 电解铝、Qatar 贵金属法、Egypt 白银、Kenya 稀土、Africa critical minerals）→ **入库 `zawya-metals`**（T2，`parseMode:rendered`，`itemSelector:.topic-page-content-item`，`publishedAtRegex:"Published\s+(\d{1,2}\s+\w+\s+\d{4})"`）。
  - 阿拉伯文 `/ar/topic/metals`：模板同构，`topic-page-content-item` 同 selector；时间戳为阿拉伯文+东阿拉伯数字 → `parseLooseDate` 加阿语日期支持后，`fromHtml` **20 条干净候选**（CFI 黄金 24/7、EGA 电解铝技改、铜 3D 打印、RAREMET 2026 稀土、alumina 精炼恢复）→ **入库 `zawya-ar-metals`**（T2，`publishedAtSelector` 读时间戳文本，`publishedAtUtcOffset:+08:00`）。
- **意义**：阿语实现从「仅沙特 Maaden」到「+ 海湾经济门户 ×2」的突破；再次印证用户「各国雷同新浪财经/门户的商品频道可成信源」的判断，中东入海口由此打通。
- **验收**：`assertSupportedConfig` 通过；两源均从 `industry/sources.json` 真实配置走 `fromHtml` 拉 live render → 各 20 候选、0 缺日期、0 缺标题。
- **反面样本 · Kazzinc（哈萨克斯坦锌/铜/铅一体冶炼，Glencore）**：虽是中亚 top native 冶炼商，但官网 `/eng/novosti` 新闻全为**企业/公益 PR**（家庭运动节、学校落成、球场灯光、员工奖章），**零金属行情/产销量信息**；且列表为 JS-lazy（渲染仅 44KB shell、无干净容器）→ **判 DQ，不入库**。教训：native 冶炼商 ≠ 合格信源，须以「是否有金属信号」为最终判据，这正是 §5 判甄的要求。
- **非洲/拉美、俄/阿官方站**（TASS/SPA/沙特工矿部/Rumbo Minero/MIREMPET/Agence Ecofin 等）经多轮静态 + `rendered` 双轨实测确认被 **IP 级 WAF / JS-lazy 列表** 硬卡，属**不可抗力**；除非运营批准「换 egress 出口/代理」或「采集器 XHR/滚动能力升级」（见 `docs/collector-dynamic-list-render-manifest.md` / `-adr.md`，Proposed 待批），否则**不投入更多探测**，视为该子目标结束。

### 8.11 英语·非英美 native 源实测（2026-10-07 探测：均为 blocked/placeholder，formally documented，不强行入库）
用户点名「英语不要只盯美国、英国，像南非等都应该看看」。本轮按 §5 纪律用我们 own 采集器（静态 `html` + 渲染服务 `rendered` 双轨）对非洲产矿国英语 native 站逐一实测：
- **Minerals Council South Africa**（`mineralscouncil.org.za`，南非矿业官方产业协会）：homepage 静态 200；`/industry-news/media-releases/2026` 渲染后 html≈71KB，但通用 selector 抽出的全是导航/菜单项（Home、Contact、base64 logo 链接），**0 条真实文章卡片**；显式走 `/industry-news/` 前缀的文章链接一个也抓不到 → **JS/AJAX-lazy 列表，判 🔴 blocked**（非我方采集器能力可及）。
- **Debswana**（博茨瓦纳，钻石）：静态 200；真实文章为 WordPress 日期 URL（如 `/2026/09/10/...`），需精确 selector 校准；且钻石偏**宝石/研磨**非当前有色金属主线 → **🟡/🔴，本轮不入**。
- **Sibanye-Stillwater**（南非金/铂族）：静态 959B JS shell，需深层 render 且铂族非主线 → **🔴**。
- **Kumba Iron Ore**（南非铁矿）、**Ghana Chamber of Mines**（加纳矿业协会）：静态 403，**路径 A = IP 级 WAF** → **🔴 blocked**。
- **Zimplats**（津巴布韦铂族）：首页 render 可至 191KB 但 nav 中无干净 `/media|news|release|press` 链接（此前直接猜的 media 路径全 404）→ **🔴**。
- **结论**：英语·非英美**已覆盖较好**——南非 Mining Weekly / Miningmx、赞比亚 ZCCM、尼日利亚 msmd、印度 OfBusiness / Moneycontrol、哈萨克 Kazinform、海湾 Zawya×2 均已入库；本轮新增候选按 §5 判甄纪律**判 blocked 记录在案**，避免未来重复探测。符合「不因凑数而入库噪声源」规约，该子目标收尾。

### 8.12 法语区 native 源实测（2026-10-07：Financial Afrik 入库 #66，其余 blocked）
用户点名「法语」为应深耕语种（西非/中非产矿法语区）。本轮按 §5 纪律用我们 own render 服务（POST `:3003/`，同 Zawya 法）逐一实测：
- **Financial Afrik（`financialafrik.com`，全非洲法语财经/经济媒体，Pan-African，口碑可靠）**：`/tag/mines/` 及 `/category/mining-industrie/` 两个矿业垂直均可稳定 render。
  - `/tag/mines/`：`fromHtml` 端到端 **118 条干净候选**，0 缺日期/标题，118 条全部 onsite 唯一 URL；tight 词命中 15 条真金属/矿业（Côte d'Ivoire Koné 金矿首铸、Burkina 首座炼厂 1800 万 USD、RDC 矿会 1.5bn 承诺、Botswana 矿业本地资本 24% 法、几内亚历届矿展、Côte d'Ivoire 首座铝土矿等），另含 Trafigura/矿业贸易与俄乌后矿产品出口波动——金属信号真实存在。
  - 时间戳 `<time>` 被 `parseLooseDate` 干净解析（如 `Tue Oct 06 2026 23:48 GMT+0800`，配置无关、profile 中性）。
  - **判 🟢 合格入库 `financialafrik-mines`**（T2，`parseMode:rendered`，`itemSelector:article`，`publishedAtSelector:time`，`publishedAtUtcOffset:+08:00`，`initialBackfillLimit:12`）。**验收**：`assertSupportedConfig` 通过；`collectSource` 走真实生产采集路径 `status:"ok"`，`found:118`，与探针一致。
  - **注意 / 局限（如实记录）**：该频道为泛非财经门户，金属新闻与银行/保险/宏观节目混排，tight 命中率约 15/118≈13%（`/category/mining-industrie/` 约 10-29%），且 tag 页为归档 2013→2026 的滚动列表。**靠采集侧 `initialBackfillLimit` + 现有 selection/recency 分选压制非金属噪声**（与 Kazinform 作为地区锚点的处理一致），作为**法语区·西非/中非地区覆盖**的锚点而非纯金属快讯流。若后期需要更高密度，可再开专门的新闻线索频道。
- **其余法语候选按 §5 判 blocked / placeholder**：
  - **Jeune Afrique**（`/tag/mines/`）：render 仅 6KB（JS/AJAX 懒加载 + paywall）→ 🔴。
  - **Agence Ecofin `/minier`**（再次重试 render）：render 2.6KB（Cloudflare 硬卡）→ 🔴（§8.5 的 🔴 判定保持不变）。
  - **La Tribune Afrique `/ressources-naturelles/`**：render 109KB 但 0 干净文章容器（导航/js 卡片）→ 🔴。
  - **minespace.ci / Le Point Afrique / Commodafrik / L'Usine Nouvelle**：render EMPTY 或 403 → 🔴。
- **意义**：自 §8.5 法语只有 MINES.CD（刚果金）/CBG（几内亚）后，新增一个 **西非+中非+泛非 法语财经门户锚点**，补法语区「矿→生产」链路的中非/西非记录面。用户「各地新浪财经」判断再次得到验证。

### 8.13 日语区 native 源实测（2026-10-07：住友金属鉱山 SMM 入库 #67，生产链路）
用户点名「日语」为应深耕语种（日本拥有世界级镍/铜/锌/铅冶炼产能，属「生产」环节核心）。本轮按 §5 纪律用我们 own render 服务实测多家日系非铁冶炼商/交易所 native 官网新闻：
- **住友金属鉱山 Sumitomo Metal Mining（`smm.co.jp`，全球主要镍生产商，菲 Tagana HPAL 镍、Winu 铜金、电池回收）**：`/news/` 列表结构干净规整：
  ```html
  <li class="NewsIndex_List_Each"><a class="NewsIndex_List_Normal" href="/news/release/...">
    <time class="NewsIndex_List_Date" datetime="2026-10-07">2026.10.7</time>
    <span class="...NewsCate_sustainability">サステナビリティ</span>
    <p class="NewsIndex_List_Lead">タガニートHPALニッケル社、…</p></a></li>
  ```
  - 用真实生产配置（`itemSelector:li.NewsIndex_List_Each` + `linkSelector:a.NewsIndex_List_Normal` + `titleSelector:p.NewsIndex_List_Lead` + `publishedAtSelector:time.NewsIndex_List_Date`）走 `fromHtml` 端到端：**20/20 干净候选**，20 个 onsite 唯一 URL，日期 2026-08-10 → 2026-10-07（新鲜滚动流）；`datetime` ISO 被 `parseLooseDate` 按 `+09:00`（日本时区）干净解析，**标题不含前置日期**（用 `__Lead` 精确剥离）。
  - tight 金属/生产词命中 8/20≈40%（**Tagana HPAL 镍矿、パワー半導体用ナノ銅粉量産、電池リサイクルプラント（镍钴稀有金属再资源化）、Winu 銅・金プロジェクト开发** 等），比 Financial Afrik 密度更高，质量也更对题。
  - **判 🟢 合格入库 `smm-sumitomo-metals`**（T2，`parseMode:rendered`，`publishedAtUtcOffset:+09:00`，`initialBackfillLimit:15`）。**验收**：`assertSupportedConfig` 通过；生产配置 `fromHtml`（真实 `industry/sources.json` 配置 + live render）20/20 clean、0 缺日期、0 缺标题。
  - **如实记录的局限**：SMM 官网新闻为企业新闻速递（生产/IR/ESG/产品发布混排），非金属价格行情快讯；生产与产品发布类（镍/铜/钴电池材料）对题，IR/ESG 类由 selection/recency 分选压制。作为**日语区「生产」环节锚点**（镍/铜/贵金属）纳入，与黄金属性一致。
- **其余日系候选按 §5 判 blocked / placeholder**：
  - **JX金属（`jx-nmm.com/news/`）**：render 116KB 但通用 `li`/`article` 均 0 干净候选（列表容器 class 需另校；官网为 React-shell）；**JX Advanced Metals（`jxadvancedmetals.com`）**：render EMPTY → 🔴/🟡。
  - **三菱マテリアル / DOWAメタル**：render EMPTY 或 `li` 无干净容器（DOWA 162KB 但 0 clean，列表为纯文本混排）→ 🔴。
  - **非鉄金属新聞（`non-ferrous.net`）**：render EMPTY → 🔴。
- **意义**：在既有日本金属新闻日报（JAPAN METAL / Japan Metal Daily，资讯端）之外，补一个 **一手冶炼商生产发布源**，覆盖「矿→生产→消费」中「生产」链路；再次验证「本国/本语种 native 生产商/交易所官网」是可成信源的方向。

### 8.14 西语拉美·生产商/门户复核（2026-10-07：候选多 blocked/stale，西语已覆盖良好，无新增入库）
用户点名「西班牙语」，本轮重点复核拉美西语区的**一手生产商官网**与**地区矿业新闻门户**（此前西语已有秘鲁 MINEM/Andina、智利 Cochilco/Redimin、墨西哥 SGM/El Financiero、拉美 Mineria en Linea，覆盖已较好）。用我们 own render 服务逐一实测新增候选：
- **智利生产商 Codelco（全球最大铜企）`/noticias`**：render 100KB 但页面新闻列表为 **JS 懒加载**（静态 DOM 只见导航/`javascript:void(0)`，无干净文章卡片）→ 🔴。
- **秘鲁生产商 Antamina（锌/铜矿山）`/categorias/noticias/`**：render 75KB 但 **0 article**、锚点全为导航/报告链接（sustainability、ethics、careers），无新闻列表 → 🔴。
- **秘鲁/墨西哥 Southern Copper、秘鲁 Buenaventura、Volcan**：render 1.4KB/shell 或非干净列表 → 🔴。
- **智利门户 Portal Minero（`portalminero.com`）**：真实文章容器 `article.et_pb_post` 精确 selector 可抽出 8 条干净候选，但**日期窗是 2026-05-09 → 2026-06-09（一个月前的旧窗口）**，且 tight 金属命中 3/8 含大量 CSR/安全/能源节目（轮胎回收、奖学金、水泥、电力），对题密度不足 → 🟡 **判 placeholder，不入库**。
- **智利门户 Reporte Minero（`reporteminero.cl`）**：主文章卡片（如铜矿Los Colorados 事故新闻）**卡片内无日期元素**（`publishedAtSelector`/`publishedAtRegex` 均无法取到日期，候选因缺日期被丢弃）；仅 podcast 卡片有「6 de octubre de 2026」西语日先行格式（当前 `parseLooseDate` 尚未支持西语月名）→ 🟡/🔴 **判 placeholder**。
- **秘鲁 Mundo Minero、智利 Minería Chilena**：render EMPTY → 🔴。
- **结论**：西语拉美**已覆盖较好**（政府 MINEM/Andina/SGM/Cochilco + 门户 El Financiero/Redimin/Mineria en Linea）。本轮面对的一手生产商官网多为 **JS 懒加载/WAF**，地区门户存在**陈旧窗口**或**卡片无日期**，均未达 §5 清洁入库标准 → **不强行凑数入库**，判 blocked/placeholder 记录在案，避免未来重复探测。若后续采集器获得 XHR/滚动渲染或增加西语月名日期解析能力，可回捡 Portal Minero / Reporte Minero。

### 8.15 越南语 / 泰语 native 源探测（2026-10-07：多为 JS 懒加载或离题，无新增入库）
用户点名「越南语」「泰语」（东南亚：越南为锡/铝土-氧化铝及钢材加工/消费节点，泰国非有色主产但有小规模锡）。用 own render 服务实测候选：
- **Báo Công Thương（工贸部）`congthuong.vn/thi-truong-hang-hoa.htm`（商品市场频道，最 native 越南政府源）**：render 54KB，但**文章列表为 JS/AJAX 懒加载**（静态 DOM 仅导航/栏目链接，无干净文章卡片）→ 🔴。
- **Tạp chí Công Thương（工贸部机关刊）`tapchicongthuong.vn`**：render 203KB 可抽 5 条带日期项，但全是**发布会/数字化转型/政策行政**通稿，无非有色金属对题信号 → 🔴 离题。
- **VietnamBiz 商品/金融**：dated 项为银行利率/保险/房企债 → 🔴 离题金融。
- **泰国 DPIM（矿物与初级产业厅，政府）`dpim.go.th`**：render 213KB，主新闻列表懒加载/无干净带日期容器 → 🔴。
- **SCTV Info、Báo Tài Chính**：render EMPTY → 🔴。
- **结论**：越南、泰语方向多为 **JS 懒加载**或**离题（发布会/金融/行政）**，且东南亚非有色主产地的语言原生在线资讯整体偏薄 → **本轮无干净可入库新源**，判 blocked 记录在案，避免重复探测。若后续采集器支持滚动/XHR 渲染，可回捡 congthuong.vn（MoIT 商品频道）与 dpim.go.th。

### 8.16 入库落库与重复源治理（2026-10-07：5 个招募源全部 enabled，DB 与 sources.json 对齐）
用户授权身份（derekwang85）并采纳「Financial Afrik 矿业频道 + 日本生产源 SMM」后，本轮核心交付是**让招募成果在权威名单与 DB 两端一致、且不重复采集**：
- **入库**：`scripts/seed.ts` 幂等读取 `industry/sources.json`（66 个），只补 DB 缺失源。seed 后 DB 从 53 → **68 total / 58 enabled**。
- **5 个本多语种轮招募源全部 enabled 落库**：
  - `zawya-metals`（海湾·Zawya 金属门户·英语，#64）
  - `zawya-ar-metals`（海湾·Zawya 金属门户·阿语，#65）
  - `elfinanciero-mineria`（墨西哥·El Financiero·西语）
  - `financialafrik-mines`（西非法语区·Financial Afrik·矿业频道，#66）
  - `smm-sumitomo-metals`（日本·住友金属鉱山·生产，#67）
- **重复源治理**：DB 曾同时存在 `smm-sumitomo-metals`（权威，匹配 sources.json L1545）与拼写错误的孤儿 `smm-summitomo-metals`（双 m，同名同 URL，不在 sources.json）。两者若都 enabled 会**双倍采集** SMM 新闻 → 已按「非破坏优先禁用」原则将孤儿 `smm-summitomo-metals` 置 `enabled=false`，保留权威源。现 DB 中不在 sources.json 的仅剩 `seekingalpha`（已禁）与被禁孤儿，均不参与采集。
- **状态**：DB（68）与 sources.json（66）完全一致，无 enabled 级别的 `in-DB-not-in-json` 干扰。主仓工作区仍留供用户审阅：`packages/backend/src/sources/web-list.ts`（阿语/西语日期解析）、`tests/web-list-date.test.ts`、本文件。`industry/sources.json` 变更已落入对应行业 submodule 仓。