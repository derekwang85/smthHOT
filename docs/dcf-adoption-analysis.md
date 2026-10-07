# DCF 规约落地分析：为什么 CommodityHOT 没建 WBS / 契约先行

> 日期：2026-10-07　作者：derek（与 Agent 协作分析）
> 类型：分析 + 落地复盘　状态：已确认采纳「完整三轨工具链」方向

## 背景

项目引用了 derekcoding-framework（DCF）作为编码规约，但实际开发 CommodityHOT 时，
几乎看不到 Agent 建 WBS、写策略 / 契约再动手。本文件回答"为什么"，并记录已确认的落地方向。

---

## 一、实测到的硬证据（[COMPUTED] / [KNOWN]）

| 检查项 | 结果 |
|---|---|
| 主仓提交数 | 25 条，`wbs:` / `iss:` / `tc:` / `verify:` 前缀 **= 0** |
| industry submodule 提交数 | 5 条，三轨前缀 = 0 |
| `tasks/wbs.json` / `tasks/issue-log.json` / `tests/test-case-register.json` / `tasks/specs/spec-register.json` | **全部缺失** |
| 唯一的 WBS 文件 `archives/reports/project-wbs.json` | 一次性批量导入、Agent 全是 `derek`、9 项全 `✅`、集中在 1005 20:40→21:10 |
| 策略 / 契约文档 | `CommodityHOT.spec.md`（90 行）、`docs/commodityHOT-plan.md`（477 行）、`docs/commodityHOT-strategy-*.md` 均存在 |

**客观结论**：策略与契约其实一直是写了的（spec / plan / strategy 三个 markdown 就是），
但它们是**文档**，不是 DCF 三轨 CLI 维护的**数据文件**。三轨工具链在这个项目里从未被真正启动。

---

## 二、根因（冰山三层）

### R1 直接层——没有触发回路，Agent 没被"逼着"建 WBS

DCF 的强制门禁（改动 >3 文件 / >30 分钟 → Manifest、schema/API → ADR、提交前 → verify-commit）在
分散执行模式下是**一次性提示**。每会话新上下文，Agent 读完 AGENTS.md 后，若不把"建 WBS / 跑门禁"设为
第一动作，就会退回"读码 → 改 → 验证"的本能路径。本仓 [AGENTS.md](../AGENTS.md) 把"改成另一个行业"
列为最常见任务、把 WBS/门禁埋在"治理红线"小节，**优先级低于"怎么改内容"**，等于告诉 Agent 直接干活。

### R2 间接层——成本 / 收益在单 Agent 小迭代下为负

三轨体系（含 work-stealing、agent-queue、三权时间隔离）是为**多 Agent 并行工作区**设计的
（见 methodology/06 与 20）。而 CommodityHOT 是单 Agent（derek）+ 密集小迭代 + 仅 25 条提交，
没有并发 / 排队 / 防冲突需求。此时每一步都建 WBS + spec + 跑 ripple-scan + verify-commit，
**摩擦成本 > 收益**，Agent 合理判定不值得。这不是不听话，是规约默认配置与项目规模不匹配。

### R3 系统层——三轨路径在多处各说各话，WBS 永远是空的

`project-adapter.py` 生成的配置指向 `tasks/wbs.json`，但 `wbs-cli.py` 硬编码读写
`archives/reports/project-wbs.json`，而 `config.sh` 又用 `tasks/project-wbs.md`。
三个入口三套路径，且 `archives/` 被 `.gitignore` 忽略（"三轨制运行数据不入库"）。
CLI 每次 load() 空 dict，Agent 看到"永远空的 WBS"，自然不去维护它。

实测三轨路径分裂全貌（2026-10-07 复核）：

| 轨 | CLI 入口 | 实际数据路径 |
|---|---|---|
| WBS | `wbs-cli.py` | `archives/reports/project-wbs.json`（↯ 被 ignore） |
| WBS md | `wbs-cli.py` | `archives/reports/project-wbs-full.md`（↯ 被 ignore） |
| WBS audit | `wbs-consistency-audit.sh` | `tasks/project-wbs.md` |
| Issue | `issue-cli.py` | `archives/issues/issue-log.json`（↯ 被 ignore，且为模板占位数据） |
| Test Case | `testcase-cli.py` | `tests/test-case-register.json` |
| Spec | `spec-cli.py` | `tasks/specs/` |
| Queue | `queue-refill.py` | 同时读 `archives/reports/...` 与 `tasks/...` |
| 配置 | `triple-track-config.json` | `tasks/wbs.json` / `tests/test-case-register.json` |
| 调度 | `config.sh` | `tasks/project-wbs.md` |

**架构性根因（R3 深化）**：WBS 与 Issue 落在 `archives/`，而 `archives/` 被 `.gitignore`
故意忽略（注释原文"三轨制运行数据（WBS/Issue 归档）不入库"）。也就是说——**即便 Agent 建了
WBS，也不会进 git、不可版本回溯**。一个"建了也会丢"的轨道，Agent 自然不会再建。
这是"从来没有看到 WBS"最硬核的技术原因。

---

## 三、是不是规约的锅？

- **不是**：契约先行的理念是对的，且本项目确实是 spec → plan → 实现推进，站能跑通即证明该方法在场。
- **是**：DCF 把"契约先行"**强制绑定在三轨工具链**上。工具链在这个规模下没被启动，
  于是"WBS"这个 **载体**消失——尽管"契约"其实有替代载体（markdown）。

一句话：**理念有用，载体没落地；不是没写策略，是策略没进 WBS 工具。**

---

## 四、已确认的落地方向：完整三轨工具链（含关键约束）

经确认，本项目走**完整三轨工具链**，而非轻量文档替代。但落地前必须正视一个**架构约束**：

> `.coding-framework/` 是 **git submodule（上游 `derekwang85/derekcoding-framework.git`）**，
> 本仓 AGENTS.md 定为"只读上游"。因此**不能直接改子模块里的 `wbs-cli.py` / `issue-cli.py` /
> `queue-refill.py` 的路径**；且 `archives/` 已被 `.gitignore` 忽略。
>
> 一个"建了也会丢、不可版本回溯"的轨道，Agent 永远不会去维护。要让三轨真正"看得见、可追踪、可维护"，
> 必须在**主仓侧**做适配，而不是改上游脚本。

### 落地候选方案（需 Derek 拍板战术）

**方案 A：数据落 `archives/`，仅解除 gitignore**
- 保留 DCF CLI 默认路径（零脚本改动，符合只读上游）。
- 改 `.gitignore`：把 `!archives/reports/project-wbs*.json|.md`、`!archives/issues/issue-log.json` 重新纳入追踪。
- 优点：最符合"只读上游"规约、改动最小。
- 缺点：触碰 `archives/` 的 ignore 策略；`config.sh`/audit 与 CLI 仍路径不一致（但可接受，CLI 是唯一真源）。

**方案 B：主仓侧 wrapper，重定向到 `tasks/`**
- 在 `scripts/` 或项目根建薄封装 CLI，设 `CODING_FW_PROJECT_DIR` 指向项目根后调用上游脚本，并把
  数据落 `tasks/`（已符合 config）。不直接改子模块。
- 优点：数据落 `tasks/` 入库直观；config 与数据一致。
- 缺点：wrapper 自身是本地资产，需维护；`archives/` 仍有残留半套状态易混淆。

**方案 C：不动三轨工具，仅固化为文档纪律**
- 维持现状工具，依赖 AGENTS.md 触发条件约束 Agent"先写 WBS markdown 再动手"，用 git 提交前缀记录。
- 优点：完全不碰工具与 gitignore。
- 缺点：仍是"文档替代工具"——与已确认的"完整三轨"方向不一致，仅作备选。

> 采纳建议：**方案 A 优先**（最契合只读上游 + 完整三轨），若 Derek 更看重数据落 `tasks/` 则用方案 B。

### 统一后的目标路径（无论 A/B 都以 CLI 为准）

| 轨 | 统一目标 | 说明 |
|---|---|---|
| WBS JSON | `archives/reports/project-wbs.json`（A）或 `tasks/wbs.json`（B） | 单一真源 |
| WBS md | CLI 导出同目录 | 人类可读 |
| Issue | `archives/issues/issue-log.json`（A）或 `tasks/issue-log.json`（B） | 单一真源 |
| Test Case | `tests/test-case-register.json` | 保持 |
| Spec | `tasks/specs/` | 保持 |

---

## 五、操作清单（落地顺序，待 Derek 选定 A/B 后执行）

- [x] 写本分析文档（完成）
- [ ] **Derek 选定方案 A / B**（README 末尾已问）
- [ ] 按选定方案解除或重定向三轨数据路径
- [ ] `git add` 相关数据文件，确认不受 `.gitignore` 误伤
- [ ] 清理占位数据（现有 9 条 derek WBS、2 条 Test issue）
- [ ] 按任务粒度校准 AGENTS.md 门禁触发条件（高涟漪强制）
- [ ] 验证 `wbs-cli.py list/stats`、`issue-cli.py list`、`testcase-cli.py list` 可用
- [ ] 跑 `wbs-consistency-audit.sh` 确认一致

---

## 附：置信度

硬证据 [KNOWN]+[COMPUTED]；R1/R2 根因为 [INFERRED]；落地动作为 [INFERRED]。