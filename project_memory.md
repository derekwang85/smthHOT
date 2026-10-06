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

## 会话交接快照（2026-10-06 · fulltest 内化 + 首页改版已交付）

> 新会话启动先读本节 + 上方 LL-001/ADR-001，即可恢复上下文，无需重复调研。

### 本会话已交付（3 个 commit）
1. **主仓 `035deaa`** — fulltest 内化底座：`scripts/fulltest-{runner,evolve,auto-loop,cron-worker,pattern-feed}.py/.sh` + `scripts/test-fail-to-issue.py` + `tests/failure-patterns.json`（seed R0-SAMPLE 40 条）+ `tests/fulltest-config.json` + `scripts/fulltest-node-runner.sh`；`.gitignore` 加 fulltest 运行产物；`project_memory` LL-001。
2. **主仓 `196c738`** — 首页改版：新增今日影响读取层 `packages/backend/publication/impact.ts`、`/impact` 独立页、`TodayImpact` 组件（无内容也渲染空态框架）、品种罗盘从精选移入今日影响、FeedItem 双时间戳（首发 vs 原文）、nav/more 入口。
3. **团队仓 `6e2c892`（已 push 到 origin/main）** — fulltest Node 双栈适配经验 pattern + 既有 HITL v2 修订。

### fulltest 复现 / 使用命令
```bash
export PATH="$HOME/.nvm/versions/node/v24.15.0/bin:$PATH"
export DATABASE_URL="postgres://test:test@127.0.0.1:5432/smthhot_test"   # 空库，先 migrate
node scripts/migrate.ts
# 全量质量门禁（typecheck + node --test junit），供 fulltest-evolve 消费
PROJECT_ROOT=/media/cbnb/_opdata/smthHOT bash scripts/fulltest-node-runner.sh
# 自进化：喂已知失败模式 / 未知失败记录
python3 scripts/fulltest-evolve.py --passes N --failures M --issues '[{...}]'
python3 scripts/pattern-feed.py --source unknown
```
注意：测试库 `smthhot_test`（容器 `smthhot-testdb`，postgres:17，端口 5432，用户/密 `test`/`test`）；跑前需空库（规约）。全量 154 用例现已全绿（publication 13/13、typecheck、web build 均过）。

### 待办 / 余留（未做）
- 主仓仍有一批**既有文件未提交、与本次任务无关**：`docs/commodityHOT-plan.md`、`docs/commodityHOT-strategy-swarm.md`、`industry/`（submodule 状态 m）、`scripts/commodity-data-pilot.ts`、`dispatch/`（含孤立 ux-flow-patterns.json）、`tests/admin-ux-linkage.test.ts`。新会话按需决定是否整理提交。

## 会话交接快照（2026-10-06 · fulltest CI/cron 接入 + UX 走查完成）

> 基于上一快照继续。待办里「fulltest 未接 CI/cron」「UX 走查未做」两项本会话已完成，见下。

### 本会话完成情况

**目标 1 —— fulltest 绿基线接入 CI/cron（已完成并验证）**
- **修复 runner 退出码**（`scripts/fulltest-node-runner.sh`）：junit 分支不再用 `|| true` 吞错，改为透传 `node --test` 真实退出码；spec 模式同。此前"测试失败但退出码 0"会让 cron/CI 检测不到回归。已实测：正常路径 exit 0，强制失败路径 exit 1。
- **修复 evolve 基线比较 bug**（`scripts/fulltest-evolve.py`）：`prev_pass` 提取正则原先只匹配中文「通过…NN」，而 `auto_write_baseline` 写英文「Pass: NN」，导致 prev_pass 恒为 0、每次运行都被当改进、基线无限自增。改为双格式兼容匹配。已实测 154/0 → `All pass! Baseline: R2`（不再自增）；152/2 → `⚠ REGRESSION`。
- **cron 守护已装**：`scripts/fulltest-cron-gate.sh`（重置空库 → migrate → runner → evolve feed）+ crontab 每日 `30 3 * * *`。已实测 gate 全绿 GATE_EXIT=0（154P/0F，49s，守住 R2 基线）。注意：cron-gate 依赖本机 `docker exec smthhot-testdb` + 固定 nvm node 路径，只用于本机 cron，**不适用 GitHub CI**。
- **CI 接入**：`.github/workflows/check.yml` 新增 `fulltest` job —— 用独立 postgres service `commodityhot_ci`（满足 invariant `*_ci`），`node scripts/migrate.ts` 后跑 `scripts/fulltest-node-runner.sh`（junit），解析 pass/fail 交 `fulltest-evolve.py`，任何失败退出非零使 CI 变红。YAML 校验通过（jobs: check/fulltest/docker）。CI 用专用一次性空库，**不触碰生产 commodityhot 库**；DATABASE_URL 显式 `*_ci` 满足 tests/setup.ts invariant。

**目标 2 —— UX 走查（P5）：首页改版 移动端+桌面端（已完成）**
- **走查对象**：严格限定 commodity 站 `:3200`（按部署约束，未碰 :3000/:3300）。
- **前端代码层：无断裂**。桌面端首页/`/impact`/`/all` 均验证：品种罗盘 7 chips 响应式（移动 `overflow-x-auto` 横滑、桌面 `lg:flex-wrap` 换行）；今日影响空态 + 完整列表链接；FeedItem 双时间戳逻辑正确（`showDual` 判定 + `min-[400px]:inline`）；移动 tabbar + 底部导航渲染；无 console 错误；关键路由 `/?/impact//all//daily//topics//about//feedback` 200 无断链（`/feed`→`/feed.xml` 合法重定向；`/search` 无此路由，404 属正常）。
- **部署修复**：`:3200` commodity web 先前跑的是**陈旧 build**（`/impact` 缺罗盘，showCompass 未生效）。已按部署约束在 `apps/web` 目录重建 build 并重启 (pid 2271482)，`/impact` 罗盘现已出现；commodity 栈 3200/3002 自洽、连接 commodityhot 库。
- **数据层阻断（非前端 bug，已定位，需使用者决策）**：
  1. **commodity 库 `selected=0`**（568 条 publication，195 eligible）→ 首页「今日影响」+「最新精选」全空。根因：最有价值的市场新闻（铜价/铜产量 62 分，SMM/Mining.com）全来自 **T2 信源**，而 `industry/selection.ts` 的 **T2 门槛 = 70**，62 分过不了；T1 一手源（10 个）产出极差（最高商务部 38 分、5 个源 0 条如 LME/INE/SHFE/GACC/Cochilco）。按 AGENTS.md 门槛须用标注样本校准（`docs/selection.md` + `scripts/eval-selection.ts`），未擅改数字。
  2. **`published_at` 大量为空**（558/568 条）→ FeedItem 双时间戳（首发/原文）在 FeedItem 逻辑正确但缺数据无法渲染，`/all` 仅 rail 显示采集时间。属采集层未解析/回填原文发布时间。

### 后续建议
- 首页空态是数据层：建议跑 `scripts/eval-selection.ts` 在用户标注样本上校准 T2（或分级）门槛，并核对 5 个零产出 T1 源的采集失败原因。
- `published_at` 回填：核对 commodity 采集管线是否解析 RSS `pubDate`/页面发布时间并写入 `publications.published_at`。
- 本会话改动的脚本（runner/evolve/cron-gate/check.yml）未提交，移交时按需 commit。

### 关键约束提醒
- 不动 `apps/`、`packages/` 之外；行业相关改 `industry/`（submodule，提交到对应 profile 仓而非主仓）。
- 团队经验回写走 `team-memory/`（独立仓，gitignored from 主仓），资产须过 `.coding-framework/scripts/verify_asset.py`。
- 四项冻结项改判须严格 HITL（see `team-memory/decisions/commodityhot-holds-hitl.md` v2）。
- commit 需 env identity：`GIT_AUTHOR_NAME/EMAIL`、`GIT_COMMITTER_NAME/EMAIL`（禁改 git config）。

## 项目约定

- 项目来源：AIHOT 开源框架 → 改造为大宗商品热点站（先跑有色金属）。
- 行业相关改动全在 `industry/`，代码层（`apps/`、`packages/`）不动。
- 验证命令按根 `AGENTS.md`「运行与检查」；开发/测试安全阀保持关闭。

---

## 会话交接快照（2026-10-06 · 五人项修正 + 部署规约 + 信源隔离修复）

**本会话交付（全部已验证、已重建重启 commodityHOT）**：

1. **部署约束写入规约**：根 [AGENTS.md](AGENTS.md) 新增「部署约束（当前机器 · CommodityHOT）」小节——当前站=CommodityHOT、数据目录、`commodityhot` 库、端口 3200/3002、裸 node 启动命令、治理红线（不改 `.env.*`、不碰 aihot docker/`docker compose`、不写 AIHOT 库、安全阀关闭）。让后续 agent 开新任务前先读。

2. **信源隔离修复（数据层，直接改两库）**：
   - **commodityhot 库**：`scripts/seed.ts`（`ON CONFLICT DO NOTHING`）补回 18 个被混入 AIHOT 的有色信源 → 现 39 个 config 源全部在位（另剩 1 个杂源 `seekingalpha` 未动）。
   - **AIHOT docker 库**（显式授权修复）：删除混入的 39 个 commodity 信源及其 513 articles / 464 publications（级联），现仅剩 18 个真正的 AI `rss-*` 源（536 pubs）。清理后 `/api/admin/sources` 与库内一致（40/36/1failing/14degraded）。

3. **精选页分离**：`apps/web/app/routes/home.tsx` 移除首页内嵌「今日影响 + 品种罗盘」block，首页只留「今日热点 + 最新精选 feed」（沿用 AIHOT 精选逻辑）。

4. **移动端补「今日」菜单**：`components/shell/nav.ts` TABBAR 增 `/impact·今日`（置于精选后，`/impact` 移出 `MORE_PATHS`）；`MobileTabBar.tsx` 栅格 4→5 列。

5. **/admin 与信源管理 UX 走查流程**：新增 `docs/ux-walkthrough.md`（双端+管理后台+信源数量/质量数据链检查清单，含真实 SQL 与报告模板）。

**验证**：`npm run typecheck` 通过；`npm run build -w @aihot/web` 成功；web(PID 2532551) 已按部署命令在 `:3200` 重启。SSR 断言：`/` 无 `id="today-impact"`、无「品种罗盘」、含「最新精选」+底部「今日」Tab；`/impact` 200 含「品种罗盘」；全公开路由 200、`/feed` 301。admin 登录 + `/api/admin/sources` 数据与库一致。

**遗留/建议（数据·运营层，需使用者决策，未擅动）**：
- commodity 首页精选仍 0 selected（195 eligible）：T2 门槛 70 过严、T1 源仍部分缺内容（smm/lme 等刚补回尚未采集）。建议用 `scripts/eval-selection.ts` 在标注样本上校准分级门槛（见 `docs/selection.md`）。
- 5 个 T1 源（LME/INE/SHFE/GACC/Cochilco）长期 0 产出 → 核查采集器解析器回填（含 `published_at` 大量为空 558/568）。
- 本会话源码改动（home.tsx/nav.ts/MobileTabBar.tsx/AGENTS.md/ux-walkthrough.md/.github）未 commit，移交时按需提交。
- 数据仓库存在杂源 `seekingalpha`(commodityhot) 原已有、非本次目标，如需清理另行决策。
- 接入 derekcoding-framework：规约子模块 `.coding-framework/` + 记忆分离团队仓 `team-memory/`。