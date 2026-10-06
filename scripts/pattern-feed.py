#!/usr/bin/env python3
"""
pattern-feed.py — 失败模式"喂食"工具
======================================
将真实失败/经验自动转化为 failure-patterns.json 知识库条目，
形成 fulltest 自进化系统的"喂食"闭环。

数据源:
  1. failures-unknown.log — fulltest-evolve 记录的未知失败
  2. issue-log.json       — 已验证的 Issue（root_cause + solution → 模式）
  3. git commits          — fix/refactor 提交信息

流程:
  pattern-feed.py --source unknown [--merge]    # 未知失败 → 候选 → 合并
  pattern-feed.py --source issue  [--merge]     # Issue 根因 → 候选 → 合并
  pattern-feed.py --source git    [--merge]     # git fix 提交 → 候选 → 合并
  pattern-feed.py --list                        # 查看当前候选
  pattern-feed.py --merge --all                 # 合并所有候选

产出:
  - 候选草稿: tests/pattern-candidates.json（人工可编辑确认）
  - 合并时自动: 版本递增 R0→R1→R2, 去重, 更新 updated 时间戳

模式字段（对齐 SmartQuant R3 实践）:
  id, name, regex, severity(HIGH/MEDIUM/LOW), root_cause(L1/L2/L3),
  fix, module, test_impact, known_unavoidable, auto_check
"""
import json
import os
import re
import sys
import argparse
import subprocess
from datetime import datetime

# ── 配置 ──────────────────────────────────────────────────────────────
ROOT = os.environ.get("PROJECT_ROOT", os.getcwd())
PATTERNS_FILE = os.path.join(ROOT, "tests", "failure-patterns.json")
UNKNOWN_LOG = os.path.join(ROOT, "tests", "failures-unknown.log")
CANDIDATES_FILE = os.path.join(ROOT, "tests", "pattern-candidates.json")
ISSUE_FILE = os.path.join(ROOT, "archives", "issues", "issue-log.json")
TZ = os.environ.get("TZ", "Asia/Shanghai")

MAX_PATTERNS = 50  # 与 evolution_rules.max_patterns_recorded 对齐


def now():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def load_json(path, default):
    if os.path.exists(path):
        try:
            with open(path) as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError):
            return default
    return default


def save_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def load_patterns():
    return load_json(PATTERNS_FILE, {"version": "R0", "patterns": [],
                                     "evolution_rules": {}})


def load_candidates():
    return load_json(CANDIDATES_FILE, {"version": "R0", "candidates": []})


def save_candidates(data):
    data["updated"] = now()
    save_json(CANDIDATES_FILE, data)


def next_pattern_id(patterns, candidates):
    """生成下一个模式 ID (FP-NNN)"""
    ids = set()
    for p in patterns.get("patterns", []):
        m = re.search(r'FP-(\d+)', p.get("id", ""))
        if m:
            ids.add(int(m.group(1)))
    for c in candidates.get("candidates", []):
        m = re.search(r'FP-(\d+)', c.get("id", ""))
        if m:
            ids.add(int(m.group(1)))
    return f"FP-{max(ids, default=0) + 1:03d}"


def next_version(patterns):
    """版本递增 R0→R1"""
    m = re.search(r'R(\d+)', patterns.get("version", "R0"))
    cur = int(m.group(1)) if m else 0
    return f"R{cur + 1}"


def infer_severity(text):
    """根据文本内容推断严重度"""
    high_kw = ["crash", "exception", "错误", "失败", "500", "null", "无", "missing",
               "security", "安全", "xss", "注入", "丢失", "数据", "import"]
    low_kw = ["warning", "告警", "deprecat", "style", "格式", "lint", "注释"]
    t = (text or "").lower()
    if any(k in t for k in high_kw):
        return "HIGH"
    if any(k in t for k in low_kw):
        return "LOW"
    return "MEDIUM"


def summarize_root_cause(desc, fallback=""):
    """将失败描述转为 L1/L2/L3 三层根因模板"""
    d = (desc or fallback or "未知失败").strip()
    return (
        f"L1={d[:60]}; "
        f"L2=未定位直接技术原因; "
        f"L3=需补充流程/架构/规范分析"
    )


def build_candidate(source, raw_text, module="", severity=""):
    """从原始文本构建模式候选"""
    cand = {
        "id": "",  # 合并时分配
        "name": f"{source} 失败模式 — {raw_text[:40]}",
        "regex": "",  # 人工确认时补全
        "http_code": None,
        "root_cause": summarize_root_cause(raw_text),
        "fix": "TODO: 补充修复方案",
        "severity": severity or infer_severity(raw_text),
        "module": module or "unknown",
        "test_impact": [],
        "known_unavoidable": "false",
        "auto_check": "",
        "_source": source,
        "_raw": raw_text[:200],
        "_created": now(),
    }
    return cand


# ═══════════════════════════════════════════════════════════
#  数据源提取
# ═══════════════════════════════════════════════════════════

def extract_from_unknown_log():
    """从 failures-unknown.log 提取未知失败"""
    candidates = []
    if not os.path.exists(UNKNOWN_LOG):
        return candidates
    with open(UNKNOWN_LOG) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            # 格式: [timestamp] [severity] module: desc
            m = re.match(r'\[([^\]]+)\]\s*\[([^\]]*)\]\s*(.*)', line)
            if m:
                ts, sev, rest = m.group(1), m.group(2), m.group(3)
                module = ""
                if ":" in rest:
                    module, desc = rest.split(":", 1)
                else:
                    desc = rest
                cand = build_candidate("unknown-log", desc.strip()[:120],
                                       module=module.strip(),
                                       severity=sev.strip().upper() or "")
                cand["_timestamp"] = ts.strip()
                candidates.append(cand)
    return candidates


def extract_from_issues():
    """从 issue-log.json 提取已验证 Issue 的根因→修复"""
    candidates = []
    issues = load_json(ISSUE_FILE, {})
    items = issues.get("issues", {}) if isinstance(issues, dict) else issues
    for iid_str, iss in items.items():
        if not iss.get("solution") or not iss.get("iceberg"):
            continue
        cand = build_candidate(
            "issue",
            iss.get("desc", "")[:100],
            module=iss.get("category", "") or iss.get("module", ""),
            severity=iss.get("severity", ""),
        )
        cand["name"] = f"Issue {iid_str} — {iss.get('desc', '')[:40]}"
        cand["root_cause"] = iss.get("iceberg", "")
        cand["fix"] = iss.get("solution", "")
        cand["_issue_id"] = iid_str
        candidates.append(cand)
    return candidates


def extract_from_git(since_hours=24):
    """从 git fix 提交提取失败模式"""
    candidates = []
    try:
        since_time = (datetime.now().__class__.now() -
                      datetime.timedelta(hours=since_hours)).strftime("%Y-%m-%d %H:%M")
        r = subprocess.run(
            ["git", "-C", ROOT, "log", f"--since={since_time}", "--oneline", "--no-merges"],
            capture_output=True, text=True, timeout=10
        )
        for line in r.stdout.strip().split("\n"):
            line = line.strip()
            if not line:
                continue
            msg = line.split(" ", 1)[1] if " " in line else ""
            if re.search(r'\b(fix|bug|hotfix|resolve|patch)\b', msg, re.IGNORECASE):
                cand = build_candidate("git", msg[:100])
                cand["name"] = f"Git fix — {msg[:60]}"
                cand["_commit"] = line[:12]
                candidates.append(cand)
    except Exception:
        pass
    return candidates


# ═══════════════════════════════════════════════════════════
#  候选管理 & 合并
# ═══════════════════════════════════════════════════════════

def collect_candidates(sources):
    """从指定数据源收集候选"""
    all_cands = []
    if "unknown" in sources:
        all_cands.extend(extract_from_unknown_log())
    if "issue" in sources:
        all_cands.extend(extract_from_issues())
    if "git" in sources:
        all_cands.extend(extract_from_git())
    return all_cands


def dedup_candidates(candidates, existing_patterns):
    """去重: 跳过与已有模式 root_cause 前缀重复的候选"""
    existing_rc = {p.get("root_cause", "")[:30] for p in existing_patterns}
    unique = []
    seen_raw = set()
    for c in candidates:
        rc_key = c.get("root_cause", "")[:30]
        raw_key = c.get("_raw", "")[:60]
        if rc_key in existing_rc or raw_key in seen_raw:
            continue
        seen_raw.add(raw_key)
        unique.append(c)
    return unique


def merge_candidates(candidates, dry_run=False):
    """将候选合并进 failure-patterns.json"""
    patterns = load_patterns()
    existing = patterns.get("patterns", [])
    unique = dedup_candidates(candidates, existing)

    if not unique:
        print("  🟢 无新候选可合并")
        return 0

    if dry_run:
        print(f"  🔍 [dry-run] 将合并 {len(unique)} 条模式:")
        for c in unique:
            print(f"    · {c['name']} [{c['severity']}]")
        return 0

    # 检查容量
    if len(existing) + len(unique) > MAX_PATTERNS:
        print(f"  ⚠ 超过容量上限 {MAX_PATTERNS}（当前 {len(existing)} + {len(unique)}）")
        print(f"    请先清理冗余模式，或调整 evolution_rules.max_patterns_recorded")
        return 1

    # 分配 ID + 版本递增
    new_version = next_version(patterns)
    for c in unique:
        c["id"] = next_pattern_id(patterns, {"candidates": unique})
        c.pop("_source", None)
        c.pop("_raw", None)
        c.pop("_created", None)
        existing.append(c)

    patterns["version"] = new_version
    patterns["updated"] = now()
    save_json(PATTERNS_FILE, patterns)
    print(f"  ✅ 已合并 {len(unique)} 条模式 → {PATTERNS_FILE}")
    print(f"     知识库版本: {new_version}（共 {len(existing)} 条）")
    for c in unique:
        print(f"     · {c['id']} [{c['severity']}] {c['name']}")
    return 0


def show_candidates():
    """显示当前候选"""
    candidates = load_candidates().get("candidates", [])
    if not candidates:
        print("  🟢 当前无候选")
        return 0
    print(f"  候选 {len(candidates)} 条:")
    for i, c in enumerate(candidates, 1):
        print(f"  {i}. [{c.get('severity','?')}] {c.get('name','?')}")
        print(f"     根因: {c.get('root_cause','')[:80]}")
    return 0


# ═══════════════════════════════════════════════════════════
#  CLI
# ═══════════════════════════════════════════════════════════

def main():
    p = argparse.ArgumentParser(
        prog="pattern-feed",
        description="失败模式喂食工具 — 自动将真实失败转化为知识库条目",
    )
    p.add_argument("--source", help="数据源: unknown(未知失败日志) / issue / git / 逗号组合")
    p.add_argument("--merge", action="store_true", help="确认后合并进 knowledge base")
    p.add_argument("--all", action="store_true", help="合并所有候选（含已保存的 candidates 文件）")
    p.add_argument("--list", action="store_true", help="查看当前候选")
    p.add_argument("--dry-run", action="store_true", help="仅预览，不写入")
    p.add_argument("--since", default="24h", help="git 提取时间窗口 (e.g., 24h, 7d)")
    args = p.parse_args()

    if args.list:
        return show_candidates()

    # 合并已保存的候选文件
    if args.all:
        cands = load_candidates().get("candidates", [])
        if not cands:
            print("  🟢 candidates 文件中无候选，先运行 --source")
            return 0
        return merge_candidates(cands, dry_run=args.dry_run)

    if not args.source:
        print(__doc__)
        return 0

    sources = [s.strip() for s in args.source.split(",") if s.strip()]
    cands = collect_candidates(sources)
    print(f"  📥 数据源 [{', '.join(sources)}]: 提取 {len(cands)} 条候选")

    if not cands:
        print("  🟢 无新候选")
        return 0

    if args.merge:
        return merge_candidates(cands, dry_run=args.dry_run)

    # 保存为候选草稿供人工确认
    data = load_candidates()
    data["candidates"] = cands
    save_candidates(data)
    print(f"  📝 已保存候选草稿 → {CANDIDATES_FILE}")
    print(f"     人工确认后运行: pattern-feed.py --all --merge")
    return 0


if __name__ == "__main__":
    sys.exit(main())
