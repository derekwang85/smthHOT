# WBS 主计划 (自动生成)
> 更新: 1007 16:47 | 工具: wbs-cli.py

---
## 批次状态一览
| 批次 | 状态 | 说明 |
|:----:|:----:|:------|

## 详细任务表
| P | WBS | 任务 | 开始 | 完成 | Agent | 状态 | 已提交 | 批次 |
|:---:|:---:|:----|:----:|:----:|:-----:|:----:|:-----:|:---:|
| P2 | --title | 今日影响重构：独立逐品种判断+按品种归类 | 1007 16:47 |  |  | 🔲 | 🔲 |  |
| P1 | 1.01 | 迁移0039：analyses.signal / publications.is_signal,impact_score,impact_basis + 索引 | 1007 00:56 |  | trae | 🔲 | 🔲 |  |
| P1 | 1.02 | industry/selection.ts 配置化：rankMode/rankWindow/topPercent/floorAbs/minItems/selec | 1007 00:56 |  | trae | 🔲 | 🔲 |  |
| P1 | 1.03 | 信号闸门：selection-score.md 加 signal/signalReason；analyze.ts schema+normalizeAnalysi | 1007 00:56 |  | trae | 🔲 | 🔲 |  |
| P1 | 1.04 | 改造供6需4 单元：rank.ts recomputeSelected 池化排名+回写+账本（复用 publish 逻辑） | 1007 00:56 |  | trae | 🔲 | 🔲 |  |
| P1 | 1.05 | worker 调度接入 selection.rank cron + 一期回归验证(迁移/typecheck/test/build) | 1007 00:56 |  | trae | 🔲 | 🔲 |  |
| P1 | 1.08 | 今日影响页对齐精选：品种罗盘改筛选条(PillTabs)+按品种筛选(后端loadTodayImpact支持channel/category)+整体布局对齐 | 1007 10:49 |  |  | 🔲 | 🔲 |  |
| P1 | 1.09 | 今日影响独立于精选：候选池扩为信号+过理解底分，模型按利润/基差/库存三落点独立强度打分并驱动排序 | 1007 11:46 |  |  | 🔲 | 🔲 |  |
