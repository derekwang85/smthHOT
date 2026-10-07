# 给 Agent 的说明

这是一个行业热点网站的框架：采集信源、用模型筛选和写作、归组事件、出日报，并通过网站、RSS、公开 API 和 MCP 对外提供。默认配置是一个 AI 行业的示例站。先读 README，再按任务读 `docs/` 里对应的文档。

## 最常见的任务：改成另一个行业

按 `docs/customize.md` 的顺序做。行业相关的一切都在 `industry/`：站名文案（`site.ts`）、分类标签（`taxonomy.ts`）、主题（`topics.json`）、示范信源（`sources.json`）、提示词（`prompts/`）、门槛（`selection.ts`）、模块开关（`features.ts`）、品牌（`brand/`）、条款页（`pages/`）。通常不需要改 `apps/` 和 `packages/`。

这些事要问使用者本人，不要替他决定：站名；要盯哪些信源；什么消息重要、什么是噪声；分类怎么分；条款和隐私说明的内容（`industry/pages/` 是模板，上线前需要他本人确认）。

改评分标准时保留原有结构（内容类型、五个维度加权、噪声压制、安全边界），替换的是“什么算重要”“什么算噪声”的例子。门槛要用使用者标注的样本重新校准（`docs/selection.md`），不要凭感觉改数字。

## 运行与检查

- Node.js 24 直接运行 TypeScript，后端没有构建步骤。npm workspaces：`apps/*`、`packages/*`、`industry`。
- 本机运行和 Docker 见 `docs/deploy.md`。
- 改完至少跑：
  ```bash
  npm run typecheck
  DATABASE_URL=postgres://127.0.0.1:5432/<名字>_test npm test   # 空库，名字必须以 _test 或 _ci 结尾，先 node scripts/migrate.ts
  npm run build -w @aihot/web && node --test apps/web/tests/*.test.ts
  node scripts/smoke.ts --base http://localhost:3000             # 站点跑起来以后
  ```
- `tests/` 里部分测试用的是示例行业的分类、标签和公司，改了 `industry/taxonomy.ts` 后把这些例子换成新行业的对应项。

## 要守住的规则

- 前端（`apps/web`）只通过 HTTP 读 `apps/api`，数据库、模型调用和密钥只在后端。
- 所有公开出口都从 `packages/backend/src/publication/` 这一个读取层读，新增公开出口也一样。
- 读者打开页面不触发模型调用；模型只在 worker 的任务里调用。
- 付费请求都经过回执（`providers/receipts.ts`）和预算熔断，不要绕开。
- 开发和测试时保持安全阀关闭：`COLLECT_ENABLED`、`MODEL_CALLS_ENABLED`、`FEISHU_*_ENABLED`、`INDEXNOW_SUBMIT_ENABLED`。测试不访问任何外部服务。
- 信源默认只展示摘要和原文链接（`site_fulltext` 关）；只有来源明确允许时才打开全文。
- 公开内容匿名，管理员和访客看到的一样；后台只允许管理员。
- 数据库迁移只做向后兼容的增量，新迁移按编号加在 `database/migrations/` 末尾。
- 不要提交 `.env`、密钥和 `.data/`。
- 不要使用 AIHOT 的名字和 Logo。

## 写代码

匹配周围代码的写法、命名和注释密度。选能清楚解决问题的简单方案，只定义正在使用的抽象。验证改动涉及的重要行为，不为简单的样式改动写测试。

---

## 协作规约（derekcoding-framework）

本项目已接入 derekcoding-framework 规约体系，采用「规约子模块 + 记忆分离」：

- **规约层（子模块，只读上游）**：`.coding-framework/`。会话开始时读
  `constitution/coding-ten-commandments.md`（十诫）与 `methodology/index.md`（方法论路由），
  按场景按需加载对应方法论。工程纪律、认知纪律（置信度/来源/反谄媚）、提交队列与门禁均按其执行。
- **记忆层（独立团队仓）**：`team-memory/`（derekwang85/smthhot-team-memory），已 gitignore，不与本仓混淆。

### 会话启动

1. 读 `.coding-framework/constitution/coding-ten-commandments.md`
2. 读 `.coding-framework/methodology/index.md`，按当前任务选方法论
3. 任务前 recall 团队经验：`python3 .coding-framework/scripts/team-core/recall.py --team team-memory --query "<关键词>"`
4. 按三轨制跟踪：WBS（造什么）/ Issue（修什么）/ TestCase（验对了没）

### 强制门禁（改动前）

- 改动 >3 文件 或 >30 分钟 → 写 Pre-Execution Manifest（`constitution/pre-execution-manifest.md`）
- 设计 DB schema / API 契约 / 新三方集成 → 写 ADR；多方冲突先 Swarm（`methodology/13`）
- 修 Bug → 冰山三层分析 + 涟漪 R1/R2/R3（复杂 Bug 还须 Reporter/Fixer/Verifier 三权隔离）

### DCF 三轨落地约定（本仓已启用，必须遵守）

> 背景：三轨数据落 `archives/`（已被本仓 `.gitignore` 显式纳入追踪），CLI 默认会写进
> 只读 submodule `.coding-framework/archives/`，导致"建了也留不住"。故所有三轨命令
> **必须显式设 `CODING_FW_PROJECT_DIR=/media/cbnb/_opdata/smthHOT`**，让数据落项目根。

- **每次调用三轨 CLI 前**：
  ```bash
  export CODING_FW_PROJECT_DIR=/media/cbnb/_opdata/smthHOT
  ```
- **高涟漪任务强制建 WBS**（影响以下任一项 → 先用 `wbs add/…` 记录，再动手）：
  `industry/` 的分类 `taxonomy.ts`、主题 `topics.json`、信源名单 `sources.json`、评分门槛
  `selection.ts`、提示词 `prompts/*`、数据库 schema `database/migrations/`、API 契约
  `apps/api/src/routes/`
- **低涟漪任务**（文案、样式、纯文档）→ 不强制 WBS，但提交信息带 `wbs:`/`iss:`/`tc:` 前缀。
- **提交前缀规约**：`wbs:3.04 实现…` / `iss:ISS-042 RESOLVED` / `tc:ORD-007 PASS` / `verify:…`。
  非三轨前缀（如 `CommodityHOT:`、`feat:`）视为历史兼容，新提交统一走三轨前缀。
- **一致性自检**：提交前跑 `bash .coding-framework/dispatch/scripts/triple-track/wbs-consistency-audit.sh`。
- 分析留档见 [docs/dcf-adoption-analysis.md](docs/dcf-adoption-analysis.md)。

### 经验回写（十诫 IX）

1. 项目私有经验 → 写本文件目录旁的 `project_memory.md`（默认 private）
2. 确认可团队共享 → 追加 `team-memory/patterns/` 或 `team-memory/decisions/`，过
   `python3 .coding-framework/scripts/verify_asset.py <资产>` 校验，按 commit-protocol 提交推送到团队仓
3. 同类 Bug 第三次出现 → 替换工具（十诫 X），不补第四个补丁

### 命令形态

- 三轨 CLI：`.coding-framework/dispatch/scripts/triple-track/{wbs,issue,testcase,spec}-cli.py`
- 提交前校验：`.coding-framework/dispatch/scripts/gates/verify-commit.py verify <agent> <task> <wbs>`
- 门禁一键：`.coding-framework/dispatch/scripts/gates/run-all-gates.sh`

## 多站并存（行业 profile = submodule）

主仓框架代码不绑定任一行业；`industry/` 是 git submodule，指向当前激活的行业 profile。决策见
`team-memory/decisions/dual-profile-multisite.md`。

- AI 站基线：`git@github.com:derekwang85/aihot-industry.git`（站名 `MyHOT`）
- Commodity 站：`git@github.com:derekwang85/commodityhot-industry.git`（站名 `CommodityHOT`）

切换站点（在 `industry/` 内 fetch + checkout 目标仓 commit），并把 `.gitmodules` 的 url 一并改到
对应仓后 `git submodule sync industry && git submodule update --init --force industry`；再在新内容下
跑 `npm run typecheck` 验证。改 `industry/` 本身时提交到对应的行业仓，别提交进主仓。

## 部署约束（当前机器 · CommodityHOT）【所有 Agent 开新任务前必读】

当前这台机器上**激活的站点是 CommodityHOT（有色金属产业链情报台）**，另有旧 AIHOT Docker 栈共存。排查、改码、走查、重启前必须先确认落点在哪个栈，不要在错误的一端动手。

**现状速查**
- **当前站点 = CommodityHOT**：`industry/` 指向 `commodityhot-industry` submodule（站名 `CommodityHOT`）。
- **数据目录**：`/media/cbnb/_opdata/smthhot-data/commodity-data`
- **数据库**：`commodityhot`，位于 `smthhot-testdb` 容器（宿主 `127.0.0.1:5432`，用户 `test`，见 `.env.commodity`）。
- **端口**：web **`127.0.0.1:3200`**（对外全网络），API **`127.0.0.1:3002`**（仅本机）。**只对 `:3200` 做 UX 走查，不要碰其它端口。**

**CommodityHOT 运行方式（非 Docker，裸 node）**
三个进程分别后台运行，web 需先构建：
```bash
export PATH="/home/cbnb/.nvm/versions/node/v24.15.0/bin:$PATH"
node --env-file=.env.commodity scripts/migrate.ts        # 幂等，可重复
npm run build -w @aihot/web                               # 改前端后必须重建

node --env-file=.env.commodity apps/api/src/main.ts &          # API :3002
node --env-file=.env.commodity apps/worker/src/main.ts &       # worker（抓取/模型/定时）
(cd apps/web && node --env-file=../../.env.commodity server.ts)  # web :3200
```

**治理红线（违反即事故）**
- **不要改动 `.env` 与 `.env.commodity`**（密钥、端口、开关都在里面）。
- **docker（`aihot-*` 容器、`docker-compose.yml`）是旧 AIHOT 站的部署，不要动它**；也不要在本仓库根目录执行 `docker compose up/build`（那会用当前 commodity 化的 `industry/` 去重建替换旧 AIHOT 栈）。
- CommodityHOT 的数据库操作只到 `commodityhot` 库；**不要写 AIHOT 库**（除非使用者明确单独授权修复数据）。
- 开发/测试安全阀保持关闭：`COLLECT_ENABLED`、`MODEL_CALLS_ENABLED`、`FEISHU_*_ENABLED`、`INDEXNOW_SUBMIT_ENABLED`；测试不访问任何外部服务。
- 多站并存意味着同一主仓代码会被切到不同行业，改动 `apps/`、`packages/` 时确保对两个 profile 都成立（`industry/*` 差异在 submodule 层）。
- 改 `industry/` 内容提交到对应的行业仓，别提交进主仓。

## 运行环境

- 宿主 Node 用 nvm 管，default = v24（`.bashrc`/`.profile` 已用 `nvm which default` 前置 v24 bin）。
- 项目 Docker-first（见 `docs/deploy.md`）；宿主无 node_modules 时先 `npm i -w industry` / 由 docker 构建。
