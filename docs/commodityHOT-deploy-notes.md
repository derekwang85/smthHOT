# CommodityHOT 本地共存部署与治理说明

> 本文档记录当前这台机器上 **CommodityHOT（非有色金属站点，非 Docker 运行）** 与 **旧 AIHOT Docker 栈** 并存的部署方式、如何启动、如何用 systemd 守护，以及上线/治理时的注意事项。
> 状态：本机现状快照 + systemd 托管方案（仅提供 unit 文件，尚未启用）。

---

## 1. 两个栈，动哪个、别动哪个

| | 旧 AIHOT Docker 栈 | CommodityHOT（当前站点） |
|---|---|---|
| 运行方式 | Docker Compose（非 Docker 不可动） | 裸 node 进程 |
| Compose 项目 | `aihot`（containers 名 `aihot-*`） | 无（不使用 compose） |
| 配置 | `/media/cbnb/_opdata/smthHOT/docker-compose.yml` | `.env.commodity`（gitignored） |
| 对外端口 | `0.0.0.0:3000`（web），db 5432 容器内 | web `127.0.0.1:3200`，api `127.0.0.1:3002` |
| 数据库 | 容器内 Postgres（aihot-db-1） | 专用库 `commodityhot@127.0.0.1:5432` |
| 数据目录 | Docker volumes | `/media/cbnb/_opdata/smthhot-data/commodity-data` |
| 日志 | `docker compose logs` | 见 §4 |

**治理红线**：
- **不要动**旧 AIHOT Docker 栈（`aihot-*` 容器、其 compose 项目）。
- **不要**在本仓库根目录执行 `docker compose up --build` / `docker compose build` —— 本仓库的 `docker-compose.yml` 属于 `aihot` 项目，那样会用当前（CommodityHOT 化）的 `industry/` 内容去**重建并替换**旧 AIHOT 栈，导致旧栈被污染。要维持旧栈原样，就保持不动。
- CommodityHOT 走非 Docker 运行，与旧栈完全隔离，二者互不影响。

---

## 2. 目录与环境文件

- 仓库根：`/media/cbnb/_opdata/smthHOT`
- 运行时环境变量文件：`/media/cbnb/_opdata/smthHOT/.env.commodity`
  - 已被 `.gitignore`（规则 `.env.*`，例外的只有 `.env.example`）排除，**不会**进入 git，含的密钥不外泄。
  - 关键键：`SITE_URL`（3200）、`WEB_HOST/WEB_PORT`（3200）、`API_HOST/API_PORT`（3002）、`API_BASE_URL`、`DATABASE_URL`（`postgres://…@127.0.0.1:5432/commodityhot`）、`AIHOT_DATA_DIR`（数据目录）。
- 数据目录：`/media/cbnb/_opdata/smthhot-data/commodity-data`
- 治理相关项：安全阀（采集/模型/飞书/IndexNow）在 `.env.commodity` 里通过
  `COLLECT_ENABLED`、`MODEL_CALLS_ENABLED`、`FEISHU_*_ENABLED`、`INDEXNOW_SUBMIT_ENABLED` 控制；
  开发和测试时保持关闭。

---

## 3. 如何启动（当前现状所用命令）

需要 Node.js 24（当前用 nvm 管的 v24.15.0，bin 在
`/home/cbnb/.nvm/versions/node/v24.15.0/bin`），并配好专库 `commodityhot`。

先做一次迁移（幂等，可重复跑）：

```bash
cd /media/cbnb/_opdata/smthHOT
node --env-file=.env.commodity scripts/migrate.ts
# 需要示范信源时再跑 seeds（首次）
export PATH="/home/cbnb/.nvm/versions/node/v24.15.0/bin:$PATH"
npm run build -w @aihot/web            # web 端需先构建
```

三个进程分别启动（各自一个后台终端 / nohup / systemd）：

```bash
# 1) API（后端 HTTP + 后台 /admin），监听 127.0.0.1:3002
node --env-file=.env.commodity apps/api/src/main.ts

# 2) worker（抓取 + 模型处理 + 定时任务）
node --env-file=.env.commodity apps/worker/src/main.ts

# 3) web（SSR，监听 127.0.0.1:3200，代理 /api 到 3002）
cd apps/web && node --env-file=../../.env.commodity server.ts
```

> web 进程的 `server.ts` 依赖 `apps/web/build/*` 产物，改完前端源码后要先 `npm run build -w @aihot/web` 再重启 web。

---

## 4. systemd 托管（推荐；本次仅提供 unit 文件，未启用）

要用 `systemd` 守护这三个进程时，把 `deploy/commodityhot/` 下三个 unit 文件放到
`/etc/systemd/system/`，然后由系统管理员执行（**这里不执行、不碰 systemd 守护进程**）：

```bash
sudo cp deploy/commodityhot/*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now commodityhot-api commodityhot-worker commodityhot-web
```

- 依赖关系：`web → api`、`worker → api`；三者都 `After=postgresql.service`。
- `Restart=on-failure`、`RestartSec=5`。进程收到 `SIGTERM` 优雅退出（api/worker 会先关闭 DB 连接）。

日志：
- 现状：裸进程日志在 `/tmp/commodity-{api,web,worker}.log`（手工 nohup 时的落盘位置，重启/tmp 清理会丢）。
- 托管后：unit 文件把输出写到 `/var/log/commodityhot/{web,api,worker}.log`（需管理员先 `mkdir -p /var/log/commodityhot` 并授权 cbnb 写入），也可以用 `journalctl -u commodityhot-api -f` 查看。

也可让前端的 Caddy（`deploy/Caddyfile`，容器 `deploy` 项目）在域名方案下反代到 `web:3000` —— 注意那是旧栈的 Caddy；CommodityHOT 如需对外，应另配一条指向 `127.0.0.1:3200` 的反代。此方案未在本机启用。

---

## 5. 验证命令

```bash
# API 健康检查
curl -fsS http://127.0.0.1:3002/api/health

# 网页首页可用（返回 200/HTML）
curl -fsSI http://127.0.0.1:3200/

# 端口监听
ss -tlnp | grep -E ':3200|:3002'
#   3200 → web  3002 → api

# 数据库连通（先确认专库存在并能连上）
psql "postgres://USER:PASS@127.0.0.1:5432/commodityhot" -c '\conninfo'
# 已应用的迁移（应等于 database/migrations/ 最新编号，即 0038_x_article.sql）
psql "postgres://USER:PASS@127.0.0.1:5432/commodityhot" -c 'select name from schema_migrations order by name;'
# 站点内容是否在产出（表名以实际 schema 为准，可列全部表核对）
psql "postgres://USER:PASS@127.0.0.1:5432/commodityhot" -c '\dt'

# 端到端冒烟（可选，站点跑起后）
node scripts/smoke.ts --base http://127.0.0.1:3200
```

---

## 6. 治理与维护规则

- 改 `industry/` 是改行业内容，提交到对应的行业仓（submodule `commodityhot-industry`），**别**提交进主仓；改主仓代码（`apps/`、`packages/`）另按主仓流程走。
- **绝不**在本仓库执行把 `aihot` compose 项目 up/build/down 的操作，以免替换旧 Docker 栈。
- 数据库迁移只做向后兼容的增量，新迁移按编号追加到 `database/migrations/` 末尾，由 `scripts/migrate.ts` 对 `commodityhot` 库执行。
- 密钥只存在 `.env.commodity`，gitignored，不进 git、不进镜像（非 Docker 运行，无镜像）。
- 公开内容匿名：读者打开页面不触发模型调用；模型只在 worker 任务里调用；付费请求必须走回执/预算熔断。相关安全阀默认关闭。
- 上线对外前需处理：`industry/site.ts` 的 `contactEmail` / `icp`（目前为安全占位 `null`，填了才会显示）、`industry/pages/terms.md` 与 `privacy.md` 里的占位信息（运营主体、联系方式、ICP 备案号、生效日期），由运营者本人确认。