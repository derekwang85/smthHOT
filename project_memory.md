# project_memory — CommodityHOT / smthHOT 项目记忆

> **作用域**：本项目私有记忆（ADR-001 个人项目层，默认 `private`）。
> 确认可共享的经验才升级 `visibility: team` 并写入独立团队仓 `team-memory/`（derekwang85/smthhot-team-memory）。
> 规约体系见 submodule `.coding-framework/`（derekcoding-framework）。

## Lessons Learned（经验教训）

（暂无 · 沉淀后在此登记；需团队共享的复制进 team-memory/patterns/）

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