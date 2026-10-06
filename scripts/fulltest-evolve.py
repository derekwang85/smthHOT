#!/usr/bin/env python3
"""
🧬 fulltest-evolve.py — 测试自我进化引擎（通用版）
=============================================
每次全量测试执行后自动调用，完成:
  1. 失败模式匹配诊断（基于 failure-patterns.json 知识库）
  2. 未知模式记录（供人工审查后录入知识库）
  3. 基线版本号自动递增
  4. 通过率提升时自动更新基线
  5. 回归告警

适配任意项目: 通过配置文件指定路径，无需修改脚本。

用法:
  python3 fulltest-evolve.py --passes 50 --failures 4 --issues-file /tmp/issues.json
  python3 fulltest-evolve.py --passes 50 --failures 4 --issues '[{"module":"api","desc":"500 error"}]'
  python3 fulltest-evolve.py --init   # 初始化项目的 failure-patterns.json

配置:
  项目根目录由环境变量 PROJECT_ROOT 指定，默认为当前目录。
  失败模式库: $PROJECT_ROOT/tests/failure-patterns.json
  用例索引:   $PROJECT_ROOT/tests/cases/index.json
  基线前缀:   $PROJECT_ROOT/tests/fulltest-baseline-R
  未知失败日志: $PROJECT_ROOT/tests/failures-unknown.log
"""
import json, os, re, sys, time, glob, argparse
from datetime import datetime

# ── 配置（可通过环境变量覆盖）────────────────────────────────────────
ROOT = os.environ.get("PROJECT_ROOT", os.getcwd())
PATTERNS_FILE = os.path.join(ROOT, "tests", "failure-patterns.json")
INDEX_FILE = os.path.join(ROOT, "tests", "cases", "index.json")
BASELINE_PREFIX = os.path.join(ROOT, "tests", "fulltest-baseline-R")
UNKNOWN_LOG = os.path.join(ROOT, "tests", "failures-unknown.log")
TZ = os.environ.get("TZ", "Asia/Shanghai")

# ── 日志辅助（调试用，遵循日志驱动调试方法论）────────────────────────
VERBOSE = False  # 由 CLI --verbose 开启


def dbg(msg):
    """调试日志 — 仅在 --verbose 时输出到 stderr，不影响 stdout 正常输出"""
    if VERBOSE:
        ts = datetime.now().strftime("%H:%M:%S")
        print(f"  [DBG {ts}] {msg}", file=sys.stderr)


def warn(msg):
    """警告日志 — 始终输出（失败安全：解析异常等不致命问题）"""
    ts = datetime.now().strftime("%H:%M:%S")
    print(f"  ⚠ [WARN {ts}] {msg}", file=sys.stderr)


def error(msg):
    """错误日志 — 始终输出（写入失败等可恢复问题）"""
    ts = datetime.now().strftime("%H:%M:%S")
    print(f"  ❌ [ERROR {ts}] {msg}", file=sys.stderr)


def _empty_patterns():
    """默认空失败模式库（版本 R0）"""
    return {
        "version": "R0",
        "updated": datetime.now().isoformat(),
        "patterns": [],
        "evolution_rules": {
            "auto_baseline_update": True,
            "baseline_version_prefix": "fulltest-baseline-R",
            "min_improvement_for_update": 1,
            "regression_alert_threshold": 3,
            "max_patterns_recorded": 50,
            "unknown_failure_log": "tests/failures-unknown.log"
        }
    }


def load_patterns():
    """加载失败模式知识库。不存在或解析失败则返回默认空库（失败安全）。"""
    if os.path.exists(PATTERNS_FILE):
        try:
            with open(PATTERNS_FILE) as f:
                data = json.load(f)
            dbg(f"加载失败模式库 {PATTERNS_FILE}: version={data.get('version', '?')} "
                f"patterns={len(data.get('patterns', []))}")
            return data
        except (json.JSONDecodeError, OSError) as e:
            warn(f"失败模式库解析失败 {PATTERNS_FILE}: {e} — 使用默认空库")
            return _empty_patterns()
    dbg(f"失败模式库不存在 {PATTERNS_FILE} — 使用默认空库")
    return _empty_patterns()


def load_index():
    if os.path.exists(INDEX_FILE):
        try:
            with open(INDEX_FILE) as f:
                data = json.load(f)
            dbg(f"加载用例索引 {INDEX_FILE}: version={data.get('version', '?')} "
                f"suites={len(data.get('suites', {}))}")
            return data
        except (json.JSONDecodeError, OSError) as e:
            warn(f"用例索引解析失败 {INDEX_FILE}: {e} — 使用默认空索引")
            return {"version": "R0", "suites": {}}
    dbg(f"用例索引不存在 {INDEX_FILE} — 使用默认空索引")
    return {"version": "R0", "suites": {}}


def get_latest_baseline():
    """获取最新基线版本号"""
    baselines = sorted(glob.glob(f"{BASELINE_PREFIX}*.md"))
    if not baselines:
        dbg(f"未找到任何基线文件 ({BASELINE_PREFIX}*.md) — 从 R0 开始")
        return 0
    nums = []
    for b in baselines:
        m = re.search(r'R(\d+)', os.path.basename(b))
        if m:
            nums.append(int(m.group(1)))
        else:
            dbg(f"基线文件名无法解析版本号: {os.path.basename(b)}")
    latest = max(nums) if nums else 0
    dbg(f"发现 {len(baselines)} 个基线文件, 最新 R{latest}: "
        f"{[os.path.basename(b) for b in baselines]}")
    return latest


def match_failure(fail_text, patterns_db):
    """将失败文本与知识库匹配。单个模式正则非法时跳过（失败安全），不中断整体匹配。"""
    patterns = patterns_db.get("patterns", [])
    matches = []
    dbg(f"开始匹配: {len(patterns)} 条模式, 失败文本={fail_text[:120]!r}")
    for pat in patterns:
        regex = pat.get("regex", "")
        if not regex:
            continue
        try:
            if re.search(regex, fail_text, re.IGNORECASE):
                matches.append(pat)
                dbg(f"  命中 [{pat.get('id', '?')}] {pat.get('name', '?')} regex={regex!r}")
        except re.error as e:
            warn(f"模式 {pat.get('id', '?')} ({pat.get('name', '?')}) "
                 f"正则非法, 已跳过: {e}")
    dbg(f"匹配完成: {len(matches)}/{len(patterns)} 条命中")
    return matches


def diagnose_run(total_pass, total_fail, issues, suite_results, run_stdout=""):
    """主诊断入口 — 对所有失败进行模式匹配诊断"""
    patterns_db = load_patterns()
    current_baseline = get_latest_baseline()
    dbg(f"诊断启动: pass={total_pass} fail={total_fail} issues={len(issues)} "
        f"baseline=R{current_baseline} "
        f"evolution_rules={json.dumps(patterns_db.get('evolution_rules', {}), ensure_ascii=False)}")

    report = {
        "version": f"R{current_baseline + 1}",
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "timezone": TZ,
        "summary": {
            "pass": total_pass,
            "fail": total_fail,
            "total": total_pass + total_fail
        },
        "diagnoses": [],
        "unknown_failures": [],
        "evolution_actions": [],
        "baseline_updated": False
    }

    print("\n" + "=" * 56)
    print("  Self-Evolve Engine — Failure Diagnosis")
    print("=" * 56)

    # Step 1: 逐Issue诊断
    diagnosed_count = 0
    for idx, issue in enumerate(issues, 1):
        fail_text = (
            f"{issue.get('module', '')} "
            f"{issue.get('desc', '')} "
            f"{run_stdout}"
        )
        dbg(f"  诊断 issue #{idx}/{len(issues)}: module={issue.get('module', '?')!r} "
            f"desc={issue.get('desc', '')[:80]!r}")
        matched = match_failure(fail_text, patterns_db)

        if matched:
            dbg(f"  issue #{idx} 命中 {len(matched)} 条模式")
            for m in matched:
                known = m.get("known_unavoidable", False)
                sev = m.get("severity", "")
                sev_icon = {"HIGH": "🔴", "MEDIUM": "🟡", "LOW": "🟢"}.get(sev, "")
                icon = "[KNOWN]" if known else "[MATCH]"
                print(f"  {icon} [{m.get('id', '?')}] {m.get('name', '?')} {sev_icon}{sev}")
                if not known:
                    print(f"     Root Cause: {m.get('root_cause', 'N/A')}")
                    print(f"     Fix: {m.get('fix', 'N/A')}")
                report["diagnoses"].append({
                    "pattern_id": m.get("id", "?"),
                    "pattern_name": m.get("name", "?"),
                    "severity": sev,
                    "known_unavoidable": known,
                    "issue": issue.get("desc", "")[:120]
                })
                diagnosed_count += 1
        else:
            unknown = {
                "module": issue.get("module", "unknown"),
                "desc": issue.get("desc", ""),
                "severity": issue.get("severity", "?"),
            }
            report["unknown_failures"].append(unknown)
            print(f"  [UNKNOWN] {unknown['module']}: {unknown['desc'][:80]}")
            # 记录到未知失败日志
            try:
                os.makedirs(os.path.dirname(UNKNOWN_LOG), exist_ok=True)
                with open(UNKNOWN_LOG, "a") as f:
                    f.write(
                        f"[{report['timestamp']}] [{unknown['severity']}] "
                        f"{unknown['module']}: {unknown['desc']}\n"
                    )
                dbg(f"  issue #{idx} 已追加到未知失败日志 {UNKNOWN_LOG}")
            except OSError as e:
                error(f"未知失败日志写入失败 {UNKNOWN_LOG}: {e}")

    not_diagnosed = len(issues) - diagnosed_count
    if not_diagnosed > 0:
        print(f"\n  {not_diagnosed}/{len(issues)} failures unmatched → logged to {UNKNOWN_LOG}")
        report["evolution_actions"].append({
            "action": "record_unknown",
            "count": not_diagnosed,
            "file": UNKNOWN_LOG,
            "suggestion": "Review and add new patterns to failure-patterns.json"
        })
        # 喂食闭环: 提示可用 pattern-feed.py 自动转化未知失败
        print(f"\n  🐬 喂食闭环: 可用 pattern-feed.py 自动将未知失败转化为知识库条目")
        print(f"     python3 dispatch/scripts/fulltest-system/"
              f"pattern-feed.py --source unknown --dry-run")
        print(f"     python3 dispatch/scripts/fulltest-system/"
              f"pattern-feed.py --source unknown --merge")

    # Step 2: 自动基线更新决策
    if total_pass == 0 and total_fail == 0:
        dbg("无数据(pass=0 fail=0), 跳过基线决策")
        print("\n  [SKIP] No data, baseline update skipped")
        return report

    prev_baseline_file = f"{BASELINE_PREFIX}{current_baseline}.md"
    prev_pass = 0
    if os.path.exists(prev_baseline_file):
        with open(prev_baseline_file) as f:
            content = f.read()
        # auto_write_baseline 写的是英文 "Pass: NN"；早期版本写过中文 "通过…NN"。
        # 两者都要能解析，否则 prev_pass 永远为 0 → 每次都被当成改进、基线无限自增。
        m = re.search(r'(?:通过.*?|Pass:?\s*)(\d+)', content)
        if m:
            prev_pass = int(m.group(1))
            dbg(f"前次基线 {prev_baseline_file} 通过数={prev_pass}")
        else:
            dbg(f"前次基线 {prev_baseline_file} 中未解析到通过数 — prev_pass=0")
    else:
        dbg(f"无前次基线文件 {prev_baseline_file} — prev_pass=0")

    improvement = total_pass - prev_pass

    if improvement > 0 and patterns_db.get("evolution_rules", {}).get("auto_baseline_update",
         False):
        dbg(f"基线更新分支: prev_pass={prev_pass} → total_pass={total_pass} "
            f"improvement={improvement} auto_baseline_update=True")
        print(f"\n  Improvement: {prev_pass} → {total_pass} (+{improvement})")
        print(f"  Baseline update: {report['version']}")
        report["evolution_actions"].append({
            "action": "auto_baseline_update",
            "from": f"R{current_baseline} ({prev_pass}P)",
            "to": f"{report['version']} ({total_pass}P)",
            "improvement": improvement
        })
        report["baseline_updated"] = True
    elif improvement < 0:
        dbg(f"回归告警分支: prev_pass={prev_pass} → total_pass={total_pass} "
            f"improvement={improvement} regression={abs(improvement)}")
        print(f"\n  ⚠ REGRESSION: {prev_pass} → {total_pass} ({improvement})")
        report["evolution_actions"].append({
            "action": "regression_alert",
            "from": f"R{current_baseline} ({prev_pass}P)",
            "to": f"{report['version']} ({total_pass}P)",
            "regression": abs(improvement)
        })
    elif improvement == 0 and total_fail == 0:
        dbg("全通过分支: improvement=0 且无失败, 维持基线")
        print(f"\n  All pass! Baseline: R{current_baseline}")
    else:
        dbg(f"持平分支: improvement={improvement} total_fail={total_fail}, 维持基线")
        print(f"\n  Flat: R{current_baseline} → {total_pass}P/{total_fail}F")

    # Step 3: 自动检测脚本清单
    auto_checks = []
    for pat in patterns_db.get("patterns", []):
        if pat.get("auto_check"):
            auto_checks.append(pat["auto_check"])
    if auto_checks:
        dbg(f"自动检测脚本 {len(auto_checks)} 个: {sorted(set(auto_checks))}")
        print(f"\n  Auto-check scripts ({len(auto_checks)}):")
        for ac in sorted(set(auto_checks)):
            print(f"    {ac}")

    # Step 4: 用例库版本同步
    index = load_index()
    index["version"] = report["version"]
    index["last_fulltest"] = report["timestamp"]
    try:
        os.makedirs(os.path.dirname(INDEX_FILE), exist_ok=True)
        with open(INDEX_FILE, "w") as f:
            json.dump(index, f, ensure_ascii=False, indent=2)
        dbg(f"用例索引已同步 → {INDEX_FILE}")
    except OSError as e:
        error(f"用例索引写入失败 {INDEX_FILE}: {e}")
    print(f"\n  Index synced to {report['version']}")

    return report


def auto_write_baseline(report, suite_results):
    """自动写入新基线文件"""
    if not report.get("baseline_updated"):
        dbg("baseline_updated=False, 跳过基线写入（无通过率提升）")
        return None

    version = report["version"]
    baseline_num = version.replace("R", "")
    filename = f"{BASELINE_PREFIX}{baseline_num}.md"

    lines = [
        f"# Fulltest Baseline {version}",
        "",
        f"**Generated**: {report['timestamp']} ({report['timezone']})",
        "",
        "## Overview",
        "",
        f"Pass: {report['summary']['pass']}P / {report['summary']['fail']}F = "
        f"{report['summary']['pass'] / max(report['summary']['total'], 1) * 100:.0f}%",
        "",
        "## Suite Results",
        "",
    ]
    for suite in suite_results:
        lines.append(f"- {suite}")
    lines.append("")

    if report["diagnoses"]:
        lines.append("## Diagnoses")
        lines.append("")
        for d in report["diagnoses"]:
            known = " [KNOWN]" if d.get("known_unavoidable") else ""
            lines.append(f"- [{d['pattern_id']}] {d['pattern_name']}{known}")

    if report["unknown_failures"]:
        lines.append("")
        lines.append("## Unmatched Failures (needs review)")
        for u in report["unknown_failures"]:
            lines.append(f"- [{u['severity']}] {u['module']}: {u['desc'][:100]}")

    if report["evolution_actions"]:
        lines.append("")
        lines.append("## Evolution Actions")
        for a in report["evolution_actions"]:
            detail = a.get("suggestion", a.get("from", "") + " → " + a.get("to", ""))
            lines.append(f"- `{a['action']}`: {detail}")

    try:
        os.makedirs(os.path.dirname(filename), exist_ok=True)
        with open(filename, "w") as f:
            f.write("\n".join(lines) + "\n")
        dbg(f"新基线已写入 {filename}")
    except OSError as e:
        error(f"基线写入失败 {filename}: {e}")
        return None

    print(f"\n  Baseline written: {filename}")
    return filename


def init_patterns():
    """初始化项目的 failure-patterns.json 模板"""
    dbg(f"init_patterns: 目标 {PATTERNS_FILE}")
    if os.path.exists(PATTERNS_FILE):
        print(f"  ⚠ {PATTERNS_FILE} already exists, skipping init")
        return False

    template = {
        "version": "R0",
        "updated": datetime.now().isoformat(),
        "patterns": [],
        "evolution_rules": {
            "auto_baseline_update": True,
            "baseline_version_prefix": "fulltest-baseline-R",
            "min_improvement_for_update": 1,
            "regression_alert_threshold": 3,
            "max_patterns_recorded": 50,
            "unknown_failure_log": "tests/failures-unknown.log"
        }
    }
    os.makedirs(os.path.dirname(PATTERNS_FILE), exist_ok=True)
    with open(PATTERNS_FILE, "w") as f:
        json.dump(template, f, ensure_ascii=False, indent=2)
    print(f"  ✅ Created {PATTERNS_FILE}")
    return True


# ── CLI ────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Fulltest Self-Evolution Engine")
    parser.add_argument("--passes", type=int, default=0)
    parser.add_argument("--failures", type=int, default=0)
    parser.add_argument("--issues", type=str, default="[]")
    parser.add_argument("--issues-file", type=str, default="")
    parser.add_argument("--suites", type=str, default="")
    parser.add_argument("--stdout-file", type=str, default="")
    parser.add_argument("--dry-run", action="store_true", help="Do not write baseline")
    parser.add_argument("--init", action="store_true", help="Initialize failure-patterns.json")
    parser.add_argument("--verbose", action="store_true", help="Show detailed debug logs (stderr)")
    args = parser.parse_args()

    VERBOSE = args.verbose
    if VERBOSE:
        dbg(f"verbose 模式开启: {sys.argv}")

    if args.init:
        init_patterns()
        sys.exit(0)

    if args.issues_file and os.path.exists(args.issues_file):
        try:
            with open(args.issues_file) as f:
                issues = json.load(f)
            dbg(f"已加载 issues 文件 {args.issues_file}: {len(issues)} 条")
        except (json.JSONDecodeError, OSError) as e:
            error(f"issues 文件解析失败 {args.issues_file}: {e} — 使用空列表")
            issues = []
    else:
        if args.issues_file:
            warn(f"issues 文件不存在: {args.issues_file}")
        try:
            issues = json.loads(args.issues)
        except json.JSONDecodeError:
            warn(f"--issues JSON 解析失败, 使用空列表: {args.issues[:60]!r}")
            issues = []

    suite_results = args.suites.split("|") if args.suites else []
    dbg(f"suite_results={suite_results}")

    run_stdout = ""
    if args.stdout_file and os.path.exists(args.stdout_file):
        with open(args.stdout_file) as f:
            run_stdout = f.read()
        dbg(f"已读取 stdout 文件 {args.stdout_file} ({len(run_stdout)} chars)")
    elif args.stdout_file:
        warn(f"stdout 文件不存在: {args.stdout_file}")

    report = diagnose_run(args.passes, args.failures, issues, suite_results, run_stdout)

    if not args.dry_run:
        auto_write_baseline(report, suite_results)
    else:
        dbg("dry-run 模式, 跳过基线写入")

    sys.exit(0 if report["summary"]["fail"] == 0 else 1)
