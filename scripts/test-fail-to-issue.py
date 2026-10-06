#!/usr/bin/env python3
"""
🔄 test-fail-to-issue.py — 测试失败→Issue 自动桥接器（通用版）
==========================================================
从多来源自动发现测试失败:
  1. JSON 格式报告 (/tmp/*-test-report-*.json)
  2. XML 格式报告 (target/surefire-reports/TEST-*.xml 等)
  3. 文本格式报告 (target/surefire-reports/*.txt)

若 Issue Log 中无对应 issue 则自动创建，支持按根因聚类。

适配任意项目: 通过环境变量或参数指定路径。

用法:
  python3 test-fail-to-issue.py
  python3 test-fail-to-issue.py --surefire-dir target/surefire-reports
  python3 test-fail-to-issue.py --threshold=5 --dry-run
  python3 test-fail-to-issue.py --report-only

环境变量:
  PROJECT_ROOT          项目根目录（默认当前目录）
  ISSUE_LOG             项目 Issue Log 路径（默认 archives/issues/issue-log.json）
  SUREFIRE_DIR          Surefire 报告路径（默认 backend/target/surefire-reports）
  REPORT_DIR            测试报告目录（默认 /tmp）
"""
import argparse, glob, json, os, sys, re
import xml.etree.ElementTree as ET
from datetime import datetime
from collections import Counter, defaultdict

# ── 配置 ────────────────────────────────────────────────────────────────
ROOT = os.environ.get("PROJECT_ROOT", os.getcwd())
ISSUE_LOG = os.environ.get(
    "ISSUE_LOG",
    os.path.join(ROOT, "archives", "issues", "issue-log.json")
)
SUREFIRE_DIR = os.environ.get(
    "SUREFIRE_DIR",
    os.path.join(ROOT, "backend", "target", "surefire-reports")
)
REPORT_DIR = os.environ.get("REPORT_DIR", "/tmp")

# ── 失败根因分类规则（可按项目扩展）────────────────────────────────────
ROOT_CAUSE_RULES = [
    (r"unnecessarystubbing", "Mockito Unnecessary Stubbing", "P3"),
    (r"potentialstubbingproblem", "Mockito Stubbing Mismatch", "P2"),
    (r"notamock", "Mockito Not A Mock", "P2"),
    (r"nullinsteadofmock", "Mockito Null Instead of Mock", "P2"),
    (r"nullpointerexception|NullPointerException", "Null Pointer (NPE)", "P1"),
    (r"classcastexception", "Class Cast Error", "P2"),
    (r"found multiple @springbootconfiguration", "Spring Boot Config Conflict", "P1"),
    (r"sqlsessionfactory|sqlsessiontemplate", "MyBatis Config Missing", "P1"),
    (r"stringredistemplate", "Redis Dependency Missing", "P1"),
    (r"dataintegrityviolation", "DB Integrity Violation", "P1"),
    (r"nosuchbeandefinition", "Spring Bean Missing", "P1"),
    (r"failed to load applicationcontext", "Spring Context Load Failed", "P1"),
    (r"unsatisfieddependency", "Spring DI Failed", "P1"),
    (r"assertionerror|expected.*but was", "Assertion Failure", "P2"),
    (r"jsonpath|pathnotfound", "JSON Path Error", "P2"),
    (r"http 500|500 internal", "Server 500", "P1"),
    (r"http 401|unauthorized", "Auth Failed (401)", "P2"),
    (r"http 403|forbidden", "Permission Denied (403)", "P2"),
    (r"http 404|not found", "Not Found (404)", "P2"),
    (r"http 409|conflict", "Conflict (409)", "P2"),
    (r"timeout|timed out", "Timeout", "P1"),
    (r"connection refused|connect refused", "Connection Refused", "P1"),
    (r"syntax error|SyntaxError", "Syntax Error", "P1"),
    (r"out of memory|OutOfMemory", "OOM", "P1"),
]


def load_issue_log():
    if not os.path.exists(ISSUE_LOG):
        return {"issues": {}}
    with open(ISSUE_LOG) as f:
        return json.load(f)


def save_issue_log(data):
    os.makedirs(os.path.dirname(ISSUE_LOG), exist_ok=True)
    with open(ISSUE_LOG, "w") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def next_issue_id(data):
    nums = []
    for k in data.get("issues", {}):
        m = re.match(r"ISS-(\d+)", k)
        if m:
            nums.append(int(m.group(1)))
    n = max(nums) + 1 if nums else 1
    return f"ISS-{n:03d}", n


def issue_exists(data, sig):
    for iss in data.get("issues", {}).values():
        text = iss.get("desc", "") + " " + iss.get("title", "")
        if sig in text:
            return True
    return False


def collect_json_reports():
    """从 /tmp/*-test-report-*.json 收集 FAIL 用例"""
    failures = []
    pattern = os.path.join(REPORT_DIR, "*-test-report-*.json")
    for f in glob.glob(pattern):
        if "aggregated" in f or "all" in f:
            continue
        try:
            with open(f) as fp:
                data = json.load(fp)
            for r in data.get("results", []):
                if r.get("status") == "FAIL":
                    failures.append({
                        "testCaseId": r.get("testCaseId", "unknown"),
                        "module": data.get("report", {}).get("module", "unknown"),
                        "detail": r.get("detail", "")[:200],
                        "script": r.get("script", ""),
                        "severity": r.get("severity", "major"),
                        "source": "json-report",
                    })
        except (FileNotFoundError, json.JSONDecodeError):
            pass
    return failures


def collect_surefire_xml():
    """从 surefire XML 报告解析失败和错误"""
    failures = []
    if not os.path.isdir(SUREFIRE_DIR):
        return failures

    xml_files = glob.glob(os.path.join(SUREFIRE_DIR, "TEST-*.xml"))
    for path in xml_files:
        try:
            tree = ET.parse(path)
            root = tree.getroot()
        except (FileNotFoundError, IOError, ET.ParseError):
            continue

        fa = int(root.attrib.get("failures", 0))
        e = int(root.attrib.get("errors", 0))
        if fa == 0 and e == 0:
            continue

        cls_name = root.attrib.get("name", "unknown")
        parts = cls_name.split(".")
        module = parts[3] if len(parts) > 3 else "unknown"

        for tc in root.findall("testcase"):
            test_name = tc.attrib.get("name", "unknown")
            failure = tc.find("failure")
            if failure is not None:
                msg = failure.attrib.get("message", "")[:150]
                failures.append({
                    "testCaseId": f"{cls_name}.{test_name}",
                    "module": module,
                    "detail": f"FAILURE: {msg}",
                    "severity": "major",
                    "source": "surefire-xml",
                    "failure_type": "FAILURE",
                })
            error = tc.find("error")
            if error is not None:
                msg = error.attrib.get("message", "")[:150]
                failures.append({
                    "testCaseId": f"{cls_name}.{test_name}",
                    "module": module,
                    "detail": f"ERROR: {msg}",
                    "severity": "critical",
                    "source": "surefire-xml",
                    "failure_type": "ERROR",
                })
    return failures


def identify_root_cause(msg, test_id=""):
    """识别失败根因类别"""
    full = (msg + " " + test_id).lower()
    for pattern, cause, priority in ROOT_CAUSE_RULES:
        if re.search(pattern, full, re.IGNORECASE):
            return cause, priority
    return "Other", "P2"


def cluster_failures(failures):
    """按根因聚类，去重"""
    clusters = defaultdict(list)
    seen = set()
    for f in failures:
        key = (f["testCaseId"][:80], f["detail"][:80])
        if key in seen:
            continue
        seen.add(key)

        root_cause, priority = identify_root_cause(
            f.get("detail", "") + " " + f.get("failure_type", ""),
            f["testCaseId"]
        )
        f["_root_cause"] = root_cause
        f["_priority"] = priority
        clusters[root_cause].append(f)
    return clusters


def format_cluster_report(clusters):
    lines = [
        f"# Test Failure Cluster Report",
        f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M')}",
        "",
    ]
    total = sum(len(v) for v in clusters.values())
    lines.append(f"Total {total} failures/errors, clustered into {len(clusters)} groups")
    lines.append("")

    for root_cause in sorted(clusters.keys(), key=lambda k: len(clusters[k]), reverse=True):
        items = clusters[root_cause]
        samples = items[:3]
        sample_modules = Counter(f["module"] for f in items)
        p = items[0]["_priority"]

        lines.append(f"### [{p}] {root_cause} — {len(items)} occurrences")
        lines.append(
            f"Modules: {', '.join(f'{m}({c})' for m, c in sample_modules.most_common(5))}"
        )
        lines.append("Samples:")
        for s in samples:
            lines.append(f"  - {s['testCaseId'][:60]}: {s['detail'][:100]}")
        lines.append("")
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description="Test Failures → Issue Bridge")
    parser.add_argument("--dry-run", action="store_true", help="Preview only")
    parser.add_argument("--surefire-only", action="store_true")
    parser.add_argument("--threshold", type=int, default=3,
                        help="Min failures to create issue (default: 3)")
    parser.add_argument("--report-only", action="store_true",
                        help="Only output cluster report")
    parser.add_argument("--surefire-dir", help="Surefire reports directory")
    parser.add_argument("--report-dir", help="JSON reports directory")
    args = parser.parse_args()

    global SUREFIRE_DIR, REPORT_DIR
    if args.surefire_dir:
        SUREFIRE_DIR = args.surefire_dir
    if args.report_dir:
        REPORT_DIR = args.report_dir

    print("Test Failures → Issue Bridge")
    print(f"  Sources: {'surefire+xml(+json)' if not args.surefire_only else 'surefire'}")
    print(f"  Threshold: {args.threshold}")
    print()

    data = load_issue_log()
    before = len(data.get("issues", {}))
    print(f"  Current issues: {before}")

    all_failures = []
    if not args.surefire_only:
        all_failures.extend(collect_json_reports())
    all_failures.extend(collect_surefire_xml())

    if not all_failures:
        print("  No failures found")
        return

    print(f"  Collected {len(all_failures)} failures (pre-dedup)")

    clusters = cluster_failures(all_failures)
    total_after = sum(len(v) for v in clusters.values())
    print(f"  After dedup: {total_after}, clustered into {len(clusters)} groups")
    print()

    report = format_cluster_report(clusters)
    report_path = os.path.join(REPORT_DIR, "fulltest-cluster-report.md")
    with open(report_path, "w") as f:
        f.write(report)
    print(f"  Cluster report: {report_path}")

    if args.report_only:
        print(f"\n{report}")
        return

    new_issues = 0
    for root_cause, items in sorted(
        clusters.items(), key=lambda kv: len(kv[1]), reverse=True
    ):
        count = len(items)
        if count < args.threshold:
            continue

        prefixes = list(set(
            f["testCaseId"].split(".")[-1][:10] for f in items
        ))
        cluster_sig = f"FULLTEST:{root_cause}:{','.join(sorted(prefixes)[:5])}"

        if issue_exists(data, cluster_sig):
            continue

        modules = Counter(f["module"] for f in items)
        module_str = ", ".join(f"{m}({c})" for m, c in modules.most_common(5))

        desc_lines = [
            f"## {root_cause}",
            "",
            f"- Occurrences: {count}",
            f"- Modules: {module_str}",
            f"- Priority: {items[0]['_priority']}",
            "",
            "### Affected Tests (sample)",
        ]
        for s in items[:8]:
            desc_lines.append(
                f"- [{s['source']}] {s['testCaseId'][:70]}: {s['detail'][:120]}"
            )
        if count > 8:
            desc_lines.append(f"- ... and {count - 8} more")
        desc_lines.extend([
            "",
            "### Suggested Actions",
            "1. Run full regression to confirm fix scope",
            "2. Assign by module to responsible developer",
            "3. Re-run fulltest after fix",
        ])
        desc = "\n".join(desc_lines)

        iid, no = next_issue_id(data)
        data.setdefault("issues", {})[iid] = {
            "no": no,
            "issueId": iid,
            "title": f"[Fulltest] {root_cause} — {count} failures",
            "desc": desc,
            "category": "testing",
            "status": "OPEN",
            "priority": items[0]["_priority"],
            "source": f"{datetime.now().strftime('%Y-%m-%d')} auto-bridge",
            "rootCause": root_cause,
            "iceberg": "pending",
            "solution": "",
            "assignee": "",
            "createdAt": datetime.now().isoformat(),
        }
        new_issues += 1
        print(f"  [NEW] {iid}: {root_cause} ({count} failures)")

    if new_issues == 0:
        print("\n  All failure clusters already have issues")

    if args.dry_run:
        print(f"\n  [DRY-RUN] Would create {new_issues} issues, not written")
    else:
        if new_issues > 0:
            save_issue_log(data)
            after = len(data.get("issues", {}))
            print(f"\n  Created {new_issues} issues → total {after}")

    print(f"\n{report}")


if __name__ == "__main__":
    main()
