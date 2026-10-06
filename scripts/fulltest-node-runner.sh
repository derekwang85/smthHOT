#!/usr/bin/env bash
# ============================================================================
# fulltest-node-runner.sh — CommodityHOT 项目侧 fulltest 跑法适配
# ============================================================================
# DCF fulltest 的双栈适配点：Node/TS 项目不产 Java Surefire 报告，
# 走 fulltest 的 custom_test 模式。此脚本把项目自身的质量门禁收敛为
# 一个可计 PASS/FAIL 的命令，并产出 junitxml 衔接 fulltest-evolve 模式匹配。
#
# 与根 package.json 的 `npm test` 完全同构（node --test --test-concurrency=1，
# glob 交由 node 自行展开），避免任何行为差异。
#
# 用法:
#   bash scripts/fulltest-node-runner.sh          # typecheck + 全量测试(junit)
#   FREPORTER=spec bash scripts/fulltest-node-runner.sh   # 终端用 spec 报告(不产 xml)
# ============================================================================
set -euo pipefail

ROOT="${PROJECT_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
JUNIT_DEST="${FULLTEST_JUNIT_XML:-$ROOT/tests/.fulltest-junit.xml}"
REPORTER="${FREPORTER:-junit}"

echo "━━━ [fulltest-node-runner] 门禁 1/2 — typecheck ━━━"
npm --prefix "$ROOT" run typecheck >/dev/null
echo "  ✅ typecheck 通过"

echo "━━━ [fulltest-node-runner] 门禁 2/2 — 全量 node --test（junit 采集） ━━━"
if [[ "$REPORTER" == "spec" ]]; then
  node --test --test-concurrency=1 --test-timeout=120000 "$ROOT/tests/*.test.ts"
  exit $?  # spec 模式直接透传 node --test 退出码（失败即非零）
else
  rm -f "$JUNIT_DEST"
  # 不从 --test 进程吞失败：用它真实的退出码作为测试失败的证据。
  # junit 只做采集，不参与成败判定，避免 "失败但退出码 0" 使 cron/CI 检测不到回归。
  node --test --test-concurrency=1 --test-timeout=120000 \
    --test-reporter=junit \
    --test-reporter-destination="$JUNIT_DEST" \
    "$ROOT/tests/*.test.ts" >/dev/null 2>&1
  NODE_EXIT=$?
  echo "  junit 汇总: $JUNIT_DEST"
  # 从 junit 提取 pass/fail 计数供 fulltest/CI 消费
  FAIL_BYTES=$(grep -o '<failure' "$JUNIT_DEST" | wc -l) || FAIL_BYTES=0
  TESTCASES=$(grep -o '<testcase' "$JUNIT_DEST" | wc -l) || TESTCASES=0
  echo "  total=$TESTCASES fail=$FAIL_BYTES pass=$((TESTCASES - FAIL_BYTES))"
  # 门禁以 node --test 真实结果为准；junit 采集异常（0 用例）也判失败（失败安全）。
  if [ "$NODE_EXIT" -ne 0 ] || [ "$TESTCASES" -eq 0 ]; then exit 1; fi
fi