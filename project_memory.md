# project_memory — CommodityHOT / smthHOT 项目记忆

> **作用域**：本项目私有记忆（ADR-001 个人项目层，默认 `private`）。
> 确认可共享的经验才升级 `visibility: team` 并写入独立团队仓 `team-memory/`（derekwang85/smthhot-team-memory）。
> 规约体系见 submodule `.coding-framework/`（derekcoding-framework）。

## Lessons Learned（经验教训）

### LL-001 · fulltest 双栈适配：Node/TS 项目走 custom_test 模式，不碰 Surefire（2026-10-06 实测）

**背景**：接入 DCF fulltest 自进化体系到 CommodityHOT（Node24 + npm workspaces + `node --test`）。

**理解（读透 fulltest-evolve.py / auto-loop / pattern-feed / init-project）**：
- `fulltest-auto-loop.sh` Step2 只解析 `backend/target/surefire-reports/*.txt`（Java 专属）；Node 项目直接跑会得 TOTAL=0。
- `fulltest-runner.py` 原生支持 **custom_test 模式**：`config.custom_test.command` 非空时跳过 API 登录与 8+1 Suite，直接执行项目测试命令，并解析 junitxml 失败明细自动衔接 evolve 模式匹配。
- `fulltest-evolve.py` 消费 `--passes/--failures/--issues-file`，用 `tests/failure-patterns.json` 模式库做 L1/L2/L3 诊断，未知失败写 `tests/failures-unknown.log`，`pattern-feed.py --source unknown` 喂食进知识库（FP-NNN + baseline R 递增）。
- `init-project.sh` 注入 55 个 DCF 脚本；其中 `dispatch/scripts/fulltest-system/*` 7 个脚本 + `tests/failure-patterns.json`（R0-SAMPLE 40 条模式，2 通用 + 38 SmartQuant 战例）对本项目直接可用。

**适配落地（本仓库）**：
1. 定向注入（未跑全量注入器，避免 swarm/specify/data_factory 等无关脚本污染 `scripts/`）：`scripts/fulltest-{runner,evolve,auto-loop,cron-worker,pattern-feed}.py/.sh` + `scripts/test-fail-to-issue.py`。
2. 项目专属配置 `tests/fulltest-config.json`（不是框架注入的 `scripts/fulltest-config.json`——后者模板会抢先命中、导致走 8+1 Suite；已删框架模板副本，让 runner 落到 `tests/`）。
3. 项目侧 wrapper `scripts/fulltest-node-runner.sh`（用户选定的接入方式，不动框架子模块符合只读上游规约）：typecheck + `node --test` 全量测试并产 junitxml，`npm run build -w @aihot/web` 由 runner command 串联。

**实测关键盲区 / 解法（回写 team-memory/patterns/fulltest-node-adoption.md）**：
- `--test-reporter-destination` 必须用**绝对路径**，相路径/相对 cwd 会在 npm script 子进程里找不到目标而静默不写文件。
- Node --test 的测试文件 glob 必须**整体加引号**（`"$ROOT/tests/*.test.ts"`）交给 node 展开；若由 bash 展开成多个文件参数，跨文件共享 DB 状态的测试（如 `x-article`/`x-shards`）会因隔离而误报 'test failed'。
- 不要给 wrapper 强制注入 `COLLECT_ENABLED=0 MODEL_CALLS_ENABLED=0 INDEXNOW_SUBMIT_ENABLED=0` 之类的安全阀——本项目测试内部已隔离外部请求，额外注入会污染测试环境、导致本可 151/151 的用例误失败；与根 `npm test` 完全同构即可。

**基线结果**：`npm test` junit 采集 154 pass / 0 fail；fulltest-evolve 诊断验证成功——`TS6133` 命中 seed 模式 `FP-021`，未知失败 `DB connection pool exhausted EAGAIN on postgres socket` 已记录 `tests/failures-unknown.log`，基线上抛至 `fulltest-baseline-R1.md`。

## Architecture Decisions（决策记录）

### ADR-001 · 多站并存的隔离机制（2026-10-05 实测验证）

**需求**：同时维护 AI 站（industry/ 原样、随上游升级）与 Commodity 有色金属站，同一台机两套容器、不同域名，各自独立发布。

**实测事实（npm 10.9.8）**：
- `@aihot/industry` 是 npm workspace 别名包（root `workspaces: ["industry"]`），被 contracts/backend/web/api/worker 以 `"*"` 依赖。
- npm **禁止** workspaces 里两个同名包 → `EDUPLICATEWORKSPACE`。故"单 repo 同时声明 industry/ 和 commodity/industry/ 两个同名包"不可行。
- 可行路径二：
  - 让 `commodity/industry` 进 workspaces、`industry` 移出 → 解析到 commodity（已验证 S3）。
  - 消费方用 `file:` 显式依赖可**覆盖 workspace 链接**（已验证 S4），但会改 4 个下游包声明、不干净。

**结论**：`@aihot/industry` 一个包只能有一个解析目标，"纯部署期零文件切换"在 npm 下做不到。多站并存的干净做法是共享框架代码 + 不同 `industry` 来源（submodule/分支/双实例），而非单 repo 内双同名包。尚未最终选定布局 1/2/3。

**已定最终布局（2026-10-05 用户拍板）**：布局 2-A（整个 industry/ 抽成独立 submodule）+ 手术 Y（干净重建、放弃 industry/ 逐条 git 历史，以最新内容作新仓基线快照）+ **两个独立 profile 仓**（`aihot-industry` 与 `commodityhot-industry`，各含一个完整 `@aihot/industry` 包）。
- 切站 = 改 `smthHOT/.gitmodules` 中 `industry` 条目的 url，指向两个 profile 仓之一；`workspaces:["industry"]` 与 `packages/*` 的 `"@aihot/industry":"*"` 均不需改动。
- **结构约束（已审计）**：`industry/tsconfig.json` 是 `extends: "../tsconfig.base.json"`，依赖主仓根 tsconfig。故 profile 仓**必须挂回主仓路径 `smthHOT/industry/` 才能解析/编译**，脱离开无法 standalone typecheck。按需决定是否让 profile 仓自洽（需在仓内加独立 tsconfig.base.json）。
- `industry/` 现含 51 文件 / 280K，全部被 `main` 追踪，无 git user.name/email（commit 需 env identity）。

## 项目约定

- 项目来源：AIHOT 开源框架 → 改造为大宗商品热点站（先跑有色金属）。
- 行业相关改动全在 `industry/`，代码层（`apps/`、`packages/`）不动。
- 验证命令按根 `AGENTS.md`「运行与检查」；开发/测试安全阀保持关闭。
- 接入 derekcoding-framework：规约子模块 `.coding-framework/` + 记忆分离团队仓 `team-memory/`。