#!/usr/bin/env bash
# ============================================================================
# fulltest-auto-loop.sh — 全量测试自动闭环（通用版）
# ============================================================================
# 功能:
#   1. 跑项目测试（可配置 RUNNER_CMD）
#   2. 解析测试结果
#   3. 自动创建 Issue（通过 test-fail-to-issue.py）
#   4. 与上次结果对比，标记修复和新失败的
#   5. 输出摘要到 stdout
#
# 用法:
#   bash fulltest-auto-loop.sh                          # 全量跑+分析
#   bash fulltest-auto-loop.sh --analyze-only           # 只分析已有结果
#   bash fulltest-auto-loop.sh --dry-run                # 预览不写Issue
#
# 环境变量:
#   PROJECT_ROOT        项目根目录（默认当前目录）
#   RUNNER_CMD          测试执行命令（默认: 跳过跑测，仅分析）
#   SUREFIRE_DIR        Surefire 报告路径
#   FAILURE_PATTERNS    失败模式库路径
#
# 输出 (均位于跨平台临时目录 platform_tmpdir, Unix=/tmp, Windows=$TEMP):
#   <tmp>/fulltest-cluster-report.md  — 聚类报告
#   <tmp>/fulltest-summary.txt        — 一行摘要
#   <tmp>/fulltest-history.json       — 历史对比
# ============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# 交叉平台基础库: 提供 PY_CMD / platform_tmpdir / cmdx 等
source "$SCRIPT_DIR/../lib/platform.sh"
PROJECT_ROOT="${PROJECT_ROOT:-$(pwd)}"
HISTORY_LOG="$(platform_tmpdir)/fulltest-history.json"
SUMMARY_FILE="$(platform_tmpdir)/fulltest-summary.txt"
RAW_LOG="$(platform_tmpdir)/fulltest-raw.log"

ANALYZE_ONLY=false
DRY_RUN=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --analyze-only) ANALYZE_ONLY=true; shift ;;
        --dry-run)      DRY_RUN=true; shift ;;
        *) echo "Unknown arg: $1"; exit 1 ;;
    esac
done

# ── Step 1: 跑测试 ─────────────────────────────────────────────────────
if [ "$ANALYZE_ONLY" = false ] && [ -n "${RUNNER_CMD:-}" ]; then
    echo "=== Round: Full Test ==="
    bash -c "$RUNNER_CMD" 2>&1 | tee "$RAW_LOG" | tail -5 || true
    echo ""
fi

# ── Step 2: 解析 Surefire 结果 ────────────────────────────────────────
echo "=== Analyzing Test Results ==="

SUREFIRE_DIR="${SUREFIRE_DIR:-$PROJECT_ROOT/backend/target/surefire-reports}"
TOTAL_TESTS=0
TOTAL_FAIL=0
TOTAL_ERROR=0
FAIL_MODULES_STR=""

if [ -d "$SUREFIRE_DIR" ]; then
    for txt in "$SUREFIRE_DIR"/*.txt; do
        [ -f "$txt" ] || continue
        STATS=$(grep -oP 'Tests run: \d+, Failures: \d+, Errors: \d+' "$txt" | tail -1 || true)
        if [ -n "$STATS" ]; then
            T=$(echo "$STATS" | grep -oP 'Tests run: \K\d+' || echo 0)
            F=$(echo "$STATS" | grep -oP 'Failures: \K\d+' || echo 0)
            E=$(echo "$STATS" | grep -oP 'Errors: \K\d+' || echo 0)
            TOTAL_TESTS=$((TOTAL_TESTS + T))
            TOTAL_FAIL=$((TOTAL_FAIL + F))
            TOTAL_ERROR=$((TOTAL_ERROR + E))
            if [ "$F" -gt 0 ] || [ "$E" -gt 0 ]; then
                MODNAME=$(basename "$txt" .txt | rev | cut -d. -f1 | rev)
                FAIL_MODULES_STR="${FAIL_MODULES_STR}${MODNAME}(F=${F},E=${E}) "
            fi
        fi
    done
fi

PASS=$((TOTAL_TESTS - TOTAL_FAIL - TOTAL_ERROR))
echo "  Tests: $TOTAL_TESTS | PASS: $PASS | FAIL: $TOTAL_FAIL | ERROR: $TOTAL_ERROR"

# ── Step 3: 失败→Issue 桥接 ───────────────────────────────────────────
echo ""
echo "=== Failure → Issue Bridge ==="
PY_ARGS=""
[ "$DRY_RUN" = true ] && PY_ARGS="$PY_ARGS --dry-run"

if [ -f "$SCRIPT_DIR/test-fail-to-issue.py" ]; then
    "$PY_CMD" "$SCRIPT_DIR/test-fail-to-issue.py" \
        --surefire-dir "$SUREFIRE_DIR" --threshold=3 $PY_ARGS
elif [ -f "$PROJECT_ROOT/scripts/test-fail-to-issue.py" ]; then
    "$PY_CMD" "$PROJECT_ROOT/scripts/test-fail-to-issue.py" \
        --surefire-dir "$SUREFIRE_DIR" --threshold=3 $PY_ARGS
else
    echo "  ⚠ test-fail-to-issue.py not found, skipping auto-issue creation"
fi

# ── Step 4: 对比历史 ──────────────────────────────────────────────────
echo ""
echo "=== History Comparison ==="
PREV_TOTAL=0; PREV_FAIL=0; PREV_ERROR=0
if [ -f "$HISTORY_LOG" ]; then
    PREV_TOTAL=$("$PY_CMD" -c "import json; d=json.load(open('$HISTORY_LOG')); \
print(d.get('total_tests',0))" 2>/dev/null || echo 0)
    PREV_FAIL=$("$PY_CMD" -c "import json; d=json.load(open('$HISTORY_LOG')); \
print(d.get('total_fail',0))" 2>/dev/null || echo 0)
    PREV_ERROR=$("$PY_CMD" -c "import json; d=json.load(open('$HISTORY_LOG')); \
print(d.get('total_error',0))" 2>/dev/null || echo 0)

    DIFF_T=$((TOTAL_TESTS - PREV_TOTAL))
    DIFF_F=$((TOTAL_FAIL - PREV_FAIL))
    DIFF_E=$((TOTAL_ERROR - PREV_ERROR))

    echo "  Current: T=$TOTAL_TESTS F=$TOTAL_FAIL E=$TOTAL_ERROR"
    echo "  Previous: T=$PREV_TOTAL F=$PREV_FAIL E=$PREV_ERROR"
    echo "  Delta: +${DIFF_T}T ${DIFF_F}F ${DIFF_E}E"

    if [ "$DIFF_F" -lt 0 ] || [ "$DIFF_E" -lt 0 ]; then
        echo "  IMPROVEMENT: Failures ${DIFF_F} Errors ${DIFF_E}"
    elif [ "$DIFF_F" -gt 0 ] || [ "$DIFF_E" -gt 0 ]; then
        echo "  REGRESSION: Failures +${DIFF_F} Errors +${DIFF_E}"
    fi
else
    echo "  First run, no history to compare"
fi

# ── Step 5: 写入历史 ──────────────────────────────────────────────────
"$PY_CMD" -c "
import json
h = {
    'total_tests': $TOTAL_TESTS,
    'total_fail': $TOTAL_FAIL,
    'total_error': $TOTAL_ERROR,
    'pass': $PASS,
}
with open('$HISTORY_LOG', 'w') as f:
    json.dump(h, f, ensure_ascii=False, indent=2)
"

# ── Step 6: 输出摘要 ──────────────────────────────────────────────────
summary="Fulltest: T=$TOTAL_TESTS PASS=$PASS FAIL=$TOTAL_FAIL ERROR=$TOTAL_ERROR"
echo "$summary" > "$SUMMARY_FILE"
echo ""
echo "=== Loop Complete ==="
cat "$SUMMARY_FILE"
