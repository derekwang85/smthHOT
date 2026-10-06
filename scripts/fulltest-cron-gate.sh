#!/usr/bin/env bash
# ============================================================================
# fulltest-cron-gate.sh — CommodityHOT fulltest 基线 cron 门禁包装
# ============================================================================
# 把「全量质量门禁（typecheck + node --test junit）+ 失败模式自进化」收敛为
# 一个可被 cron 定时触发的守门命令，喂给 fulltest-cron-worker.py 做
# 历史追踪与连续失败告警（DCF fulltest 定时执行路径）。
#
# 与根 AGENTS.md「运行与检查」保持一致：开发/跑测安全阀关闭、测试自隔离外部请求；
# 此处只做 DATABASE_URL 指向 *test 空库 + migrate，不做任何外部服务调用。
#
# 用法（手动验证）:
#   bash scripts/fulltest-cron-gate.sh
#
# 环境变量:
#   TEST_DB_URL    测试库连接串（默认 postgres://test:test@127.0.0.1:5432/smthhot_test）
#   FULLTEST_RUNNER  runner 脚本路径（默认 scripts/fulltest-node-runner.sh）
#   FULLTEST_CMD    若设置，跳过默认 runner，改跑此任意命令（供 CI 复用）
#
# 退出码: 0=通过 1=回归/失败 2=环境/配置错误
# ============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="${PROJECT_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
WORKDIR="$(cd "$PROJECT_ROOT" && pwd)"
PATH="/home/cbnb/.nvm/versions/node/v24.15.0/bin:$PATH"
export PATH

TEST_DB_URL="${TEST_DB_URL:-postgres://test:test@127.0.0.1:5432/smthhot_test}"
DATABASE_URL="$TEST_DB_URL"
export DATABASE_URL

HISTORY_FILE="${HISTORY_FILE:-/tmp/fulltest-history.json}"
export HISTORY_FILE

DB_NAME="$(printf '%s' "$TEST_DB_URL" | sed -n 's|.*/\([^/]*\)$|\1|p')"
CONTAINER="${TESTDB_CONTAINER:-smthhot-testdb}"

log() { echo "[fulltest-gate $(date '+%F %T')] $*"; }

# ── Step 0: 校验测试库是为空库（规约：invariant 测试写行，只允许 *_test / *_ci）──
if ! printf '%s' "$DB_NAME" | grep -qE '_(test|ci)$'; then
  log "❌ DATABASE_URL 必须指向 *_test 或 *_ci 空库，收到「$DB_NAME」"; exit 2
fi

# 容器可用性失败安全：reset 不了就直接报环境错误，不让满库脏数据跑出假基线
if ! docker exec "$CONTAINER" true 2>/dev/null; then
  log "❌ 测试库容器 $CONTAINER 不可达，无法重建空库"; exit 2
fi

# ── Step 1: 重建空库 + 迁移（可复现基线，防止跨 run 残留行污染结果）──
log "重建空库 $DB_NAME (容器 $CONTAINER)"
docker exec "$CONTAINER" psql -U test -d postgres \
  -c "DROP DATABASE IF EXISTS $DB_NAME;" \
  -c "CREATE DATABASE $DB_NAME OWNER test;" >/dev/null
log "执行数据库迁移"
node "$WORKDIR/scripts/migrate.ts" >/dev/null || { log "❌ 迁移失败"; exit 2; }

# ── Step 2: 走 fulltest-cron-worker 跑门禁 runner + 历史/连续失败告警 ──
log "运行 fulltest 门禁 runner"
if [ -n "${FULLTEST_CMD:-}" ]; then
  # CI/自定义通道：直接跑命令，成败以退出码为准（不额外写 history）
  bash -c "$FULLTEST_CMD"
  RC=$?
else
  cd "$PROJECT_ROOT"
  python3 "$WORKDIR/scripts/fulltest-cron-worker.py" \
    --runner "$PROJECT_ROOT/scripts/fulltest-node-runner.sh" --timeout 950
  RC=$?
fi

# ── Step 3: 自进化喂料 — 用 junit 真实 pass/fail 计数字段接 fulltest-evolve ──
# 失败→模式匹配诊断 + unknown 记录 + 基线自动递增/回归告警（DCF 自成长闭环）。
# 基于刚跑出的 junit 现场解析，不重复跑测。
EvolveFeed() {
  # 允许外部直接注入计数（如 CI 已解析），否则从 junit 现场解析
  local PASS FAIL_X
  if [ -n "${FULLTEST_PASS:-}" ]; then
    PASS="$FULLTEST_PASS"; FAIL_X="$FULLTEST_FAIL"
  else
    local junit="${FULLTEST_JUNIT_XML:-$WORKDIR/tests/.fulltest-junit.xml}"
    FAIL_X=$(grep -o '<failure' "$junit" | wc -l) || FAIL_X=0
    local T
    T=$(grep -o '<testcase' "$junit" | wc -l) || T=0
    PASS=$((T - FAIL_X))
  fi
  cd "$PROJECT_ROOT"
  PROJECT_ROOT="$PROJECT_ROOT" python3 "$WORKDIR/scripts/fulltest-evolve.py" \
    --passes "$PASS" --failures "$FAIL_X" 2>&1 | grep -E "REG|Baseline|Index|Improvement|All pass|Flat" || true
}
EvolveFeed

if [ "$RC" -ne 0 ]; then
  log "❌ fulltest 基线回归或失败（exit=$RC），历史=$HISTORY_FILE"
  exit 1
fi
log "✅ fulltest 基线通过（exit=$RC）"
exit 0