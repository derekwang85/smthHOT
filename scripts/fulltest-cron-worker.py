#!/usr/bin/env python3
"""
fulltest-cron-worker.py — Fulltest 定时执行器（通用版）
=====================================================
不调用任何大模型。被 cron 触发后：
  1. 跑项目配置的 fulltest runner
  2. 写日志到 /tmp/fulltest-history.json
  3. 按 exit code 输出 PASS/FAIL
  4. 连续失败检测

适配任意项目: 通过环境变量指定 runner 路径。

用法:
  python3 fulltest-cron-worker.py
  python3 fulltest-cron-worker.py --runner scripts/fulltest-runner.py

环境变量:
  FULLTEST_RUNNER  全量测试执行器路径（必需）
  HISTORY_FILE     历史文件路径（默认 /tmp/fulltest-history.json）
  MAX_HISTORY      最大历史数量（默认 50）
"""
import subprocess, json, time, os, sys, argparse

HISTORY_FILE = os.environ.get("HISTORY_FILE", "/tmp/fulltest-history.json")
MAX_HISTORY = int(os.environ.get("MAX_HISTORY", "50"))


def load_history():
    if os.path.exists(HISTORY_FILE):
        try:
            with open(HISTORY_FILE) as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            pass
    return {"runs": []}


def save_history(history):
    history["runs"] = history["runs"][-MAX_HISTORY:]
    os.makedirs(os.path.dirname(HISTORY_FILE), exist_ok=True)
    with open(HISTORY_FILE, "w") as f:
        json.dump(history, f, indent=2)


def run(runner_path, timeout=600):
    if not os.path.isfile(runner_path):
        print(f"[fulltest-cron] ERROR: Runner not found: {runner_path}")
        return 2

    start = time.time()
    ext = os.path.splitext(runner_path)[1]
    cmd = (
        ["python3", runner_path] if ext in (".py",) else
        ["bash", runner_path] if ext in (".sh",) else
        [runner_path]
    )

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        elapsed = time.time() - start
        entry = {
            "ts": time.strftime("%Y-%m-%d %H:%M:%S"),
            "exit": -1,
            "elapsed_s": round(elapsed, 1),
            "status": "TIMEOUT",
        }
        print(f"[fulltest-cron] TIMEOUT after {elapsed:.0f}s")
        history = load_history()
        history["runs"].append(entry)
        save_history(history)
        return 2

    elapsed = time.time() - start
    passed = result.returncode == 0

    entry = {
        "ts": time.strftime("%Y-%m-%d %H:%M:%S"),
        "exit": result.returncode,
        "elapsed_s": round(elapsed, 1),
        "status": "PASS" if passed else "FAIL",
    }

    # 从 stdout 摘汇总行
    for line in result.stdout.split("\n"):
        if "通过:" in line and "失败:" in line:
            entry["summary"] = line.strip()

    history = load_history()
    history["runs"].append(entry)
    save_history(history)

    print(
        f"[fulltest-cron] {entry['status']} "
        f"exit={entry['exit']} {entry.get('elapsed_s', '?')}s"
    )
    if entry.get("summary"):
        print(f"  {entry['summary']}")

    # 连续失败检测
    recent = history["runs"][-5:]
    fails = [r for r in recent if r["status"] in ("FAIL", "TIMEOUT")]
    if len(fails) >= 3:
        print(f"[fulltest-cron] WARNING: {len(fails)}/5 consecutive "
              f"failures. Manual review recommended.")

    return 0 if passed else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Fulltest Cron Worker")
    parser.add_argument(
        "--runner",
        default=os.environ.get("FULLTEST_RUNNER", ""),
        help="Path to fulltest runner script"
    )
    parser.add_argument("--timeout", type=int, default=600, help="Timeout in seconds")
    args = parser.parse_args()

    if not args.runner:
        print("ERROR: --runner or FULLTEST_RUNNER env required")
        sys.exit(2)

    sys.exit(run(args.runner, timeout=args.timeout))
