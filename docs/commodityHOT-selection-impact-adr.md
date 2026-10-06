# ADR · CommodityHOT 精选相对择优 + 今日影响冲击传导

- 状态：待评审（HITL）→ 批准后实施
- 日期：2026-10-07

## 1. 背景与根因

当前入选判定是「单篇 + 绝对分 + 按信源分级固定门槛」，实现在
`packages/backend/src/editorial/analyze.ts#L367-L403`：每篇文章在分析阶段独立计算评分，
达标即入精选，与其它条目的相对表现无关。

「今日影响/当日大事」则只从「当天已入选精选」里按 `p.score` 取前 5 条（见
`packages/backend/src/publication/impact.ts`）。因此精选为空时，大事必然为空——二者是
级联依赖，根因完全一致。

更深层的问题：这套门槛是从 AI 行业移植而来的偏严绝对分数。对有色金属产业链的
行情、库存、TC-RC 数据这一类「边际高价值」信息，按 AI 行业的口径过滤过严，大量
有分析价值的数据型内容被卡在门外，导致精选长期为空。

## 2. 用户的四个拍板决策

(a) **精选由绝对外线改为「窗口内相对择优」**：不再看单篇绝对分是否越过固定门槛，而是
把窗口内全部条目按评分排名，取前 `topPercent`（初始 15%）相对靠前的入精选，同时设
一个兜底绝对分 `floorAbs` 防止尾部低质内容借相对排名混入。

(b) **信号闸门**：区分「例行数据报价 = 噪声」与「大波动 / 实质事件 / 预期反转 = 信号」。
放行的依据是内容是否有信息增量，而不是其类型名恰好是 price / inventory 就放行。

(c) **今日影响 = 显式编辑判断 + 多源共振**：只看候选事件对「库存 / 基差 / 利润」三个
落点的潜在影响是否明显；供给端与需求端给不同权重（供 6 需 4）；候选范围是「当日所有
信号条目（含未精选）」，与「精选页 / 今日影响页」两个独立菜单保持一致。

(d) 以上配置全部做进 `industry/selection.ts` 常量，可切换。

## 3. 核心架构取舍

相对择优有一个硬约束：**它无法在单篇分析期完成**。要「取池内前 15%」，必须先在整池
范围内完成排序，才能切出前比例。这与现行「分析期逐篇归一化并直接判 selected」的结构
冲突。

因此把「入选判定」从单篇归一化阶段**后移**到一个新增的「池化排名任务」
`selection.rank`（`recomputeSelected`），做如下分工：

- `analyses` 阶段继续产出两次评分，并新增一个 `signal` 布尔（信号闸门），但不再由绝对分
  直接判 selected；
- `selection.rank` 按 `rankWindow` 口径（day 或 rolling24h，可配置）对窗口内全部信号条目
  按平均分降序，取前 `topPercent` 且 `mean ≥ floorAbs`，回写 `p.selected`，并复用现有
  `publications/publish.ts` 的 `selected_ledger` / `selected_state` 账本与 release gate 逻辑；
- 明确将本改动定位为**「后置排名覆盖」**，不重构单篇发布流水线，把对现有系统的回归风险
  压到最小。

这样，排名的边界与容错都收敛在新增的 `rank` 任务上，分析期的既有行为保持不变。

## 4. 决策B · 保活窗口

条目入选公开后，在 `selectedKeepHours`（初始 48 小时）内保持 selected 状态，即使窗口内
评分排名暂时滑出前比例，也不会被滚动排名挤掉；到期后再回到按排名去留。

该保活逻辑**只作用于 relative 模式**；threshold 模式维持现状，不做保活。

## 5. 决策C · 信号闸门实现

作为 scoring schema 的额外输出：`signal`（布尔）+ 简短的 `signalReason`（说明判定依据）。
`signal = false` 的条目不进排名池，只进「全部动态」；`signal = true` 的条目才参与
`selection.rank` 与今日影响候选。

## 6. Schema 变更

新增迁移 `database/migrations/0039_selection_signal_impact.sql`（向后兼容增量）：

- `analyses` 增加列 `signal boolean`；
- `publications` 增加列 `is_signal boolean NOT NULL DEFAULT false`、`impact_score numeric(5,2)`、`impact_basis jsonb`；
- 建部分索引 `publications_impact_idx (impact_score DESC) WHERE visibility='public' AND impact_score IS NOT NULL`；
- `impact_basis` 结构：
  - `kind ∈ {supply, demand, macro, price-only}`：端侧 / 类型归属；
  - `hit ∈ [stock, basis, margin]`：命中库存 / 基差 / 利润哪些落点；
  - `resonSources`：共振的独立信源数；
  - `assessedAt`：判定时间。

## 7. 今日影响冲击传导定量规则

```
impactScore = 端侧冲击 × 端侧权重（供6需4；price-only / macro 不背端侧）
            + 命中落点加成
            + 多源共振加成
```

- **共振是准入前提之一**：需 `≥ resonMinSources` 个独立信源（初始 2）才具备准入资格；
  冲击极强时可按配置豁免该前提。
- `impactScore` 达到 `impactFloor`（初始值待样本校准）才上列；
- 按 `impactScore` 降序，最多 `impactMaxItems = 5` 条；
- 当天无一达标则呈现空态，「宁缺毋滥」；
- **候选** = 当日 `is_signal AND eligible`（含未精选条目），按事件归组后对事件代表稿判定。

## 8. 实现文件清单

| 文件 | 类型 | 改动内容 |
| --- | --- | --- |
| `database/migrations/0039_selection_signal_impact.sql` | 新增 | signal / impact_score / impact_basis 列与部分索引 |
| `industry/selection.ts` | 修改 | 所有决策常量化（topPercent、floorAbs、sideWeights、selectedKeepHours、resonMinSources、impactMaxItems 等），可切换 |
| `packages/contracts/src/site.ts` | 修改（如需） | 透出 impact 判据相关公开契约 |
| `industry/prompts/selection-score.md` | 修改 | 新增 signal / signalReason 输出，及「例行报价 vs 大波动」判据 |
| `industry/prompts/impact-assessment.md` | 新增 | 冲击传导 / 三落点 / 端别判定提示词 |
| `packages/backend/src/editorial/analyze.ts` | 修改 | scoring schema 加 signal、normalizeAnalysis 调整 selected 语义 |
| `packages/backend/src/selection/rank.ts` | 新增 | `recomputeSelected` 池化排名 + 回写 + 账本 |
| `packages/backend/src/publication/impact.ts` | 修改 | 改读 impact 字段，候选=当日信号 |
| `packages/backend/src/jobs/*` | 修改 | 注册 selection.rank 与当日影响任务 |
| `apps/worker/src/schedules.ts` | 修改 | 加 selection.rank cron |
| `tests/` | 修改 | 相对排名 / 保活 / impact 用例 |

## 9. 风险与回滚

- `p.selected` 由确定值变为窗口校正值，排名任务异常可能影响精选 feed / v1 / RSS。缓解：
  幂等设计 + 短事务 + 失败沿用上次快照 + 观察 `job_runs`。
- `rankMode: "threshold"` 可一键回滚旧行为，作为逃生舱。
- 迁移为向后兼容增量，可安全回退。
- 先对 `_test` 库做空库迁移 + 测试，再对 `commodityhot` 库谨慎执行；**不写 AIHOT 库**。
- impact 只对当日候选信号跑，量小，运行开销可忽略。

## 10. 验证计划

- `npm run typecheck`
- `DATABASE_URL=postgres://127.0.0.1:5432/commodityhot_test npm test`（先 `node scripts/migrate.ts`）
- `npm run build -w @aihot/web && node --test apps/web/tests/*.test.ts`
- 构造样本验证：
  - relative 排名的前比例取法是否正确；
  - 保活窗口内不抖动、到期后按排名去留；
  - impact 的端权 / 落点 / 共振计算是否符合定量规则。