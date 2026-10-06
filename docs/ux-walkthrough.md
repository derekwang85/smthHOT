# UX 走查流程（CommodityHOT）

> 针对 commodityHOT 的走查 SOP（P5 走查）。范围不止首页，覆盖**后台 /admin、信源数量/管理**等运营细节。
> 本体是一个「移动端 + 桌面端」双端、按角色/场景推进的流程审计清单，配合
> `.coding-framework/methodology/18-ux-flow-audit.md`（推单/数据流转/反馈三层心智）使用。
>
> 触发时机：新增页面/后台功能后、上线前、每轮运营配置变更后、以及走查评审时。

**走查对象恒常提醒（部署约束）**：
- 只对 **CommodityHOT :3200** 走查，不要碰 :3000/:3300 与 docker AIHOT 栈。
- 前端只读 `apps/api`（HTTP），后台只走管理员会话；读页面不触发模型调用。
- 数据检查落到 `commodityhot` 库（宿主 `127.0.0.1:5432`，容器 `smthhot-testdb`，用户 `test`）。

---

## 0. 走查前准备

- [ ] 确认目标站 = commodityHOT，端口 3200（web）/ 3002（api）。
- [ ] 拿到管理员账号（`.env.commodity` 的 `ADMIN_PASSWORD`，仅在后台路径使用，不走公开读层）。
- [ ] 准备两个视口：**手机 ≤390px** 与 **桌面 ≥1280px**（同一页面两档都要看）。
- [ ] 打开浏览器开发工具 Console，走查全程记录报错/告警（0 console error 为过关红线）。
- [ ] 记录基线数据：`select count(*), sum(enabled::int) from commodityhot.public.sources;`

---

## 1. 前台公开浏览（匿名访客）— 每页两档视口

**入口 / 导航**
- [ ] `/` 首页=**纯精选**：只含「今日热点 + 最新精选 feed + 分类筛选」，**不得出现「今日影响」板块或品种罗盘**。
- [ ] 底部 Tab（手机）：含 **精选 / 今日 / 全部 / 日报 / 更多** 五项；「今日」高亮仅当位于 `/impact`。
- [ ] 侧栏（桌面）：「内容」分组含 精选、今日影响、全部、热点榜、日报、主题、收藏。
- [ ] 无孤儿页面：`/impact` 在移动端有「今日」Tab、桌面端有侧栏入口，两者都可直达。

**页面清单（两档视口逐个 200 + 无 console error）**
- [ ] `/` 首页
- [ ] `/impact`（今日影响 + 品种罗盘；有分量大事→列表，无→空态卡，罗盘始终渲染）
- [ ] `/all`（全部动态，含 `?search=1` 搜索、分页、busy 重定向 `/all/search-busy`）
- [ ] `/daily` 与 `/daily/:key`、`/weekly`、`/monthly`
- [ ] `/topics`、`/topics/:slug`
- [ ] `/hot`、`/starred`、`/agent`、`/about`、`/changelog`、`/feedback`、`/terms`、`/privacy`
- [ ] `/items/:id` 详情（原标题/摘要/原文链接；`site_fulltext` 关时只给摘要+原文）
- [ ] `/feed.xml`（301 为合法 RSS 重定向）

**内容真实性 / 双时间戳**
- [ ] feed 非空：首页/全部页能看到真实精选/全部条目（若为空→走数据链检查，不是前端改样式就能解决）。
- [ ] 条目时间：`published_at` 存在时显示双时间戳「首发 X · 原文 Y」；仅有 `discovered_at` 时只显示「发布于 …」。
- [ ] 分类筛选、信源筛选、主题、标签交互可用；移动端横滑、桌面端换行无错位。

---

## 2. 后台 /admin（管理员，默认需登录）— 重点：信源数量与信源管理

**后台总览**
- [ ] `/admin` 首页各统计卡可读，聚合数与 `commodityhot` 库真实值一致（抽 2 项核对 SQL）。
- [ ] `/admin/content`、`/admin/content/:id`：内容链（story/fact/article）展开正确，visibility/override/rerun 可操作且有反馈。
- [ ] `/admin/runs`、`/admin/monitor`、`/admin/feedback`、`/admin/settings` 各页 200、结构与数据对有、无数据两态都不崩。

**信源数量 / 信源管理（本流程重点）**
- [ ] `/admin/sources` 顶部四个统计（全部/启用/失败/不稳定）与库内一致：
      失效时对照 `select health, count(*) from sources group by health;`
- [ ] 每行列：**信源名+ID / 类型 / 参与+分级+一手 / 健康 / 上次成功 / 频率 / 7天条目 / 30天精选**，两档视口列不溢出（窄屏检查横向滚动/截断是否可读）。
- [ ] 搜索、按类型/健康筛选、分页可用；「失败」按健康度排最前。
- [ ] `/admin/sources/:id` 详情：预览抓取、手动采集、调整频率与参与方式按钮存在且点了有反馈；保存走 PATCH 并有版本/reason 审计。
- [ ] 新建信源 `/admin/sources/new`：字段校验（kind/tier/url 或 feedUrl）、预览、保存闭环，创建后**显式推单**回列表。
- [ ] 信源分级（T1/T1_5/T2）与 `industry/selection.ts` 门槛对应关系在界面上可辨（T1 一手/官方 门槛低、T2 媒体/个人 门槛高）。

**后台安全边界**
- [ ] 未登录访问 `/admin/*` 重定向到登录页；普通公开 read 层不暴露后台数据。
- [ ] 所有后台写操作带 CSRF/会话，提交后 Console 无 401/500。
- [ ] 公开匿名视角与管理员视角一致（`site.ts` 的 contact/icp 等占位不影响浏览）。

---

## 3. 信源数量/质量数据链检查（发现问题时跑）

首页/全部页空、或某项统计异常时，按序查数据链（**数据层问题别用改前端样式掩盖**）：

```bash
docker exec smthhot-testdb psql -U test -d commodityhot -Atc \
  "select count(*) total, sum(eligible::int) eligible, sum(selected::int) selected from publications;"
# 若 eligible 多而 selected=0：查分级门槛，可能 T2(70) 过严或 T1 源零产出
docker exec smthhot-testdb psql -U test -d commodityhot -Atc \
  "select source_id, tier, count(*), sum(selected::int) from publications p join sources s on s.id=p.source_id group by 1,2 order by 3 desc;"
# 若大量 published_at is null：查采集器/回填是否解析原文 pubDate
docker exec smthhot-testdb psql -U test -d commodityhot -Atc \
  "select count(*) filter (where published_at is null), count(*) from publications;"
```

---

## 4. 输出（走查报告模板）

走查后产出三栏表（P0 必须修 / P1 建议修 / P2 信息）：

| 级别 | 类型 | 位置 | 现象 | 证据(console/快照/数据) | 建议修复 |
|:--|:--|:--|:--|:--|:--|
| P0 | 断裂/崩溃 | … | … | … | … |
| P1 | 流程/数据 | … | … | … | … |
| P2 | 观感/一致性 | … | … | … | … |

- 前端样式断裂 → 直接修代码 + 重建 `apps/web` + 重启 web。
- 数据/运营断裂（信源零产出、门槛过严、时间为空）→ 记入报告与 `project_memory.md`，交使用者决策，**不要擅自改数字**。

---

## 5. 与既有规约衔接

- 复用 `.coding-framework/methodology/18-ux-flow-audit.md` 的推单（L2）/数据流转（L3）/反馈（L4）三层判断。
- 提交前与 `11 Bad90`、`07 Fulltest` 一并跑；改动 >3 文件先写 Pre-Execution Manifest。
- 每次走查把新发现的断裂回写本文件 §4 模式与 `project_memory.md`，让流程随经验成长。