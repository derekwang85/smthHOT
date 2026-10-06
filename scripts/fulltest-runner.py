#!/usr/bin/env python3
"""
fulltest-runner.py — 通用全量 E2E 系统测试执行器
==============================================
derived from TradeOMS fulltest practice → generalized for any project.

设计原则:
  1. 自动发现 (Auto-Discovery): 扫描项目结构，自动发现 UAT/集成/模块测试脚本
  2. 配置驱动 (Config-Driven): 项目特定配置通过 fulltest-config.json
  3. 优雅降级 (Graceful Degradation): 缺失的 Suite 自动跳过，不阻塞整体流程
  4. 自进化挂钩 (Self-Evolve Hook): 运行结束后自动调用 fulltest-evolve.py

8+1 Suite 架构（从 TradeOMS 提炼，按需启用）:
  Suite 1: 数据播种 (seed)
  Suite 1.5: 数据完整性勾稽 (SQL checks)
  Suite 2: 角色 UAT (auto-discovered from tests/uat/)
  Suite 3: 集成测试 (auto-discovered from tests/cases/scripts/integration/)
  Suite 4: 模块专项 (configurable endpoint smoke tests)
  Suite 5: 路由门禁 (API route consistency)
  Suite 6: 烟雾测试 (edge cases)
  Suite 7: 前端代码质量 (menu integrity, i18n alignment)
  Suite 8: 后端代码质量 (orphan code, API contracts)

用法:
  python3 fulltest-runner.py                           # 使用默认配置
  python3 fulltest-runner.py --config my-config.json   # 指定配置
  python3 fulltest-runner.py --suite 1,2,3             # 只运行指定 Suite
  python3 fulltest-runner.py --dry-run                 # 预览模式
"""
import subprocess, sys, os, json, time, glob, re
import urllib.request, urllib.error

# ── 全局状态 ─────────────────────────────────────────────────────────
PASS = 0; FAIL = 0; ISSUES = []; START = time.time()
SUITE_PASS = {}; SUITE_FAIL = {}
CONFIG = {}; ROOT = ""


def ok(m, suite=None):
    global PASS; PASS += 1; print(f"  ✅ PASS: {m}")
    if suite: SUITE_PASS[suite] = SUITE_PASS.get(suite, 0) + 1


def fail(m, d="", suite=None):
    global FAIL; FAIL += 1
    print(f"  ❌ FAIL: {m}" + (f" ({d})" if d else ""))
    if suite: SUITE_FAIL[suite] = SUITE_FAIL.get(suite, 0) + 1
    return True


def info(m):
    print(f"  ℹ️  {m}")


def issue(severity, module, desc, root_cause="", fix=""):
    ISSUES.append({"severity": severity, "module": module, "desc": desc,
                   "root_cause": root_cause, "fix": fix})
    print(f"  📋 ISSUE [{severity}] {module}: {desc[:60]}...")


def _build_suite_summary():
    parts = []
    all_suites = sorted(set(list(SUITE_PASS.keys()) + list(SUITE_FAIL.keys())))
    for s in all_suites:
        p = SUITE_PASS.get(s, 0); f = SUITE_FAIL.get(s, 0)
        parts.append(f"{s}:{p}/{p+f}")
    return "|".join(parts) if parts else "N/A"


# ═══════════════════════════════════════════════════════════
#  CONFIG LOADING & AUTO-DETECTION
# ═══════════════════════════════════════════════════════════

def _auto(resolve_path, config, key, *fallback_subdirs):
    """Return config value if explicit; else auto-detect by existence check."""
    val = config_value(config, key)
    if val and val != "auto":
        return val
    root = config.get("project_root", os.getcwd())
    path = resolve_path(root, *fallback_subdirs)
    return path


def config_value(cfg, dotted_key):
    """Safely navigate nested dict with dot-separated keys."""
    keys = dotted_key.split(".")
    val = cfg
    for k in keys:
        if isinstance(val, dict) and k in val:
            val = val[k]
        else:
            return None
    return val


def load_config(config_path=None):
    """Load and auto-detect project structure."""
    global CONFIG, ROOT

    root = os.environ.get("PROJECT_ROOT", os.getcwd())
    ROOT = root

    cfg_paths = [
        config_path,
        os.path.join(root, "fulltest-config.json"),
        os.path.join(root, "scripts", "fulltest-config.json"),
        os.path.join(root, "tests", "fulltest-config.json"),
    ]
    cfg_path = next((p for p in cfg_paths if p and os.path.isfile(p)), None)

    if cfg_path:
        with open(cfg_path) as f:
            CONFIG = json.load(f)
    else:
        CONFIG = {"paths": {}, "api": {}, "database": {}, "suites": {}, "evolution": {}}

    # Ensure all expected leaf keys exist with defaults
    CONFIG.setdefault("paths", {})
    CONFIG.setdefault("api", {})
    CONFIG.setdefault("database", {"enabled": False})
    CONFIG.setdefault("suites", {})
    CONFIG.setdefault("evolution", {"enabled": True})
    CONFIG.setdefault("timeout", {})
    CONFIG["project_root"] = root

    # ── Auto-detect paths ──
    p = CONFIG["paths"]
    p.setdefault("backend_dir", _auto_detect(root, "backend", "src/main"))
    p.setdefault("frontend_dir", _auto_detect(root, "frontend", "src"))
    p.setdefault("tests_dir", _auto_detect(root, "tests", "test"))
    p.setdefault("seed_dir", _auto_detect(root, "scripts/seed", "scripts/data"))
    p.setdefault("uat_dir", os.path.join(p.get("tests_dir", root + "/tests"), "uat"))
    p.setdefault("integration_dir",
                  os.path.join(p.get("tests_dir", root + "/tests"), "cases", "scripts",
                       "integration"))
    p.setdefault("module_dir",
                  os.path.join(p.get("tests_dir", root + "/tests"), "cases", "scripts",
                       "auto-generated"))

    s = CONFIG["suites"]
    s.setdefault("suite1_seed", {"enabled": True, "scripts": ["auto"]})
    s.setdefault("suite1_5_integrity", {"enabled": False, "tables": []})
    s.setdefault("suite2_uat", {"enabled": True, "roles": ["auto"]})
    s.setdefault("suite3_integration", {"enabled": True, "scripts": ["auto"]})
    s.setdefault("suite4_module", {"enabled": True, "endpoints": []})
    s.setdefault("suite5_routes", {"enabled": False})
    s.setdefault("suite6_smoke", {"enabled": True})
    s.setdefault("suite7_frontend_qa", {"enabled": False})
    s.setdefault("suite8_backend_qa", {"enabled": False})

    a = CONFIG["api"]
    a.setdefault("base_url", os.environ.get("API_BASE_URL", "http://127.0.0.1:8080"))
    a.setdefault("login_endpoint", os.environ.get("LOGIN_ENDPOINT", "/api/v1/auth/login"))

    return cfg_path


def _auto_detect(root, *candidates):
    for c in candidates:
        fp = os.path.join(root, c)
        if os.path.isdir(fp):
            return fp
    return ""


# ═══════════════════════════════════════════════════════════
#  API HELPERS
# ═══════════════════════════════════════════════════════════

def login(username, password_env="FULLTEST_ADMIN_PW"):
    """Login and return access token. Password via env var or .pw file."""
    pw = os.environ.get(password_env, "")
    if not pw:
        pw_path = os.path.join(ROOT, ".fulltest-pw")
        if os.path.isfile(pw_path):
            with open(pw_path) as f:
                pw = f.read().strip()
    if not pw:
        return None, "No password configured"

    base = CONFIG["api"]["base_url"]
    login_ep = CONFIG["api"]["login_endpoint"]
    data = json.dumps({"username": username, "password": pw}).encode()
    req = urllib.request.Request(f"{base}{login_ep}", data=data,
                                  headers={"Content-Type": "application/json"}, method="POST")
    try:
        resp = urllib.request.urlopen(req, timeout=10)
        b = json.loads(resp.read())
        token = b.get("data", {}).get("accessToken", "") or b.get("token", "")
        return token, None
    except Exception as e:
        return None, str(e)


def api(method, path, token, data=None):
    """Generic API call with auth."""
    base = CONFIG["api"]["base_url"]
    url = f"{base}{path}"
    hdrs = {"Authorization": f"Bearer {token}"}
    body = json.dumps(data).encode() if data else None
    if body: hdrs["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=body, headers=hdrs, method=method)
    try:
        resp = urllib.request.urlopen(req, timeout=15)
        return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read())
        except:
            return e.code, {}
    except Exception as e:
        return 0, {"message": str(e)}


# ═══════════════════════════════════════════════════════════
#  SCRIPT RUNNERS
# ═══════════════════════════════════════════════════════════

def run_script(path):
    if not path or not os.path.exists(path):
        return False
    r = os.system(f"bash {path} 2>/dev/null")
    return r == 0


def run_python(path):
    if not path or not os.path.exists(path):
        return False
    r = os.system(f"python3 {path} 2>/dev/null")
    return r == 0


def run_python_subprocess(path, timeout_s=120):
    if not path or not os.path.exists(path):
        return None
    r = subprocess.run(["python3", path], capture_output=True, text=True,
                       timeout=timeout_s)
    return r


# ═══════════════════════════════════════════════════════════
#  AUTO-DISCOVERY HELPERS
# ═══════════════════════════════════════════════════════════

def discover_uat_roles():
    """Auto-discover UAT scripts from tests/uat/run-uat-*.sh"""
    uat_dir = CONFIG["paths"].get("uat_dir", "")
    if not uat_dir or not os.path.isdir(uat_dir):
        return {}
    roles = {}
    for f in sorted(glob.glob(os.path.join(uat_dir, "run-uat-*.sh"))):
        role = re.sub(r'^run-uat-|\.sh$', '', os.path.basename(f))
        roles[role] = f
    return roles


def discover_integration_tests():
    """Auto-discover integration test scripts."""
    int_dir = CONFIG["paths"].get("integration_dir", "")
    if not int_dir or not os.path.isdir(int_dir):
        return []
    tests = []
    for f in sorted(glob.glob(os.path.join(int_dir, "tc-int-*.py"))):
        name = re.sub(r'^tc-int-|\.py$', '', os.path.basename(f)).replace("-", " → ")
        tests.append((name, f))
    for f in sorted(glob.glob(os.path.join(int_dir, "tc-int-*.sh"))):
        name = re.sub(r'^tc-int-|\.sh$', '', os.path.basename(f)).replace("-", " → ")
        tests.append((name, f))
    return tests


def discover_seed_scripts():
    """Auto-discover seed scripts."""
    seed_dir = CONFIG["paths"].get("seed_dir", "")
    scripts = []
    if seed_dir and os.path.isdir(seed_dir):
        scripts = sorted(glob.glob(os.path.join(seed_dir, "*.sh")))
    # Also check root scripts/
    root_scripts = os.path.join(ROOT, "scripts")
    if os.path.isdir(root_scripts):
        master = os.path.join(root_scripts, "master-seed.sh")
        if os.path.isfile(master):
            scripts.insert(0, master)
    return scripts


# ═══════════════════════════════════════════════════════════
#  SUITE EXECUTION
# ═══════════════════════════════════════════════════════════

def run_suite1_seed():
    """Suite 1: Data seeding."""
    if not CONFIG["suites"]["suite1_seed"]["enabled"]:
        info("Suite 1 (种子数据) 已跳过 (disabled)")
        return
    print("\n━━━ SUITE 1 — 测试数据播种 ━━━")
    seed_scripts = discover_seed_scripts()
    if seed_scripts:
        for s in seed_scripts:
            r = run_script(s)
            ok(f"种子: {os.path.basename(s)}", "Suite1") if r else fail(
                f"种子: {os.path.basename(s)}", "", "Suite1")
    else:
        info("未发现种子脚本，跳过")


def run_suite1_5_integrity():
    """Suite 1.5: Data integrity SQL checks."""
    if not CONFIG["suites"]["suite1_5_integrity"]["enabled"]:
        return
    if not CONFIG["database"]["enabled"]:
        info("Suite 1.5 (数据勾稽) 已跳过 (DB not enabled)")
        return

    print("\n━━━ SUITE 1.5 — 数据勾稽验证 ━━━")
    db = CONFIG["database"]
    mysql_cmd = (f"mysql -h{db['host']} -P{db['port']} "
                 f"-u{db['user']} {db['name']} -N")

    tables = CONFIG["suites"]["suite1_5_integrity"].get("tables", [])
    for t in tables:
        name = t.get("name", "unknown")
        sql = t.get("sql", f"SELECT COUNT(*) FROM {t.get('table', '')}")
        min_count = t.get("min_count", 1)
        r = os.system(
            f'echo "{sql}" | {mysql_cmd} 2>/dev/null | grep -q "[1-9]"')
        ok(f"数据勾稽: {name}", "Suite1.5") if r == 0 else fail(
            f"数据勾稽: {name}", "数据不完整", "Suite1.5")


def run_suite2_uat(tokens):
    """Suite 2: Role-based UAT."""
    if not CONFIG["suites"]["suite2_uat"]["enabled"]:
        info("Suite 2 (角色UAT) 已跳过")
        return
    print("\n━━━ SUITE 2 — 角色UAT ━━━")
    roles = discover_uat_roles()
    if not roles:
        info("未发现 UAT 脚本 (tests/uat/run-uat-*.sh)")
        return

    for role, script in roles.items():
        token = tokens.get(role, "")
        if not token:
            fail(f"{role} UAT", "no token", "Suite2")
            continue

        base_url = CONFIG["api"]["base_url"]
        timeout = CONFIG["timeout"].get("uat_per_role", 120)
        rr = subprocess.run(["bash", script, base_url, f"Bearer {token}"],
                            capture_output=True, text=True, timeout=timeout, errors='ignore')
        m_pass = re.search(r"通过:\s*(\d+)", rr.stdout)
        m_fail = re.search(r"失败:\s*(\d+)", rr.stdout)
        p = int(m_pass.group(1)) if m_pass else 0
        f = int(m_fail.group(1)) if m_fail else 0
        if rr.returncode == 0 and f == 0:
            ok(f"{role} UAT ({p}P {f}F)", "Suite2")
        else:
            fail(f"{role} UAT ({p}P {f}F)", f"exit={rr.returncode}", "Suite2")
            issue("HIGH", role, f"UAT: {f} failures")


def run_suite3_integration(tokens):
    """Suite 3: Integration tests."""
    if not CONFIG["suites"]["suite3_integration"]["enabled"]:
        info("Suite 3 (集成测试) 已跳过")
        return
    print("\n━━━ SUITE 3 — 集成测试 ━━━")
    int_tests = discover_integration_tests()
    if not int_tests:
        info("未发现集成测试脚本")
        return

    timeout = CONFIG["timeout"].get("integration_per_test", 120)
    for name, path in int_tests:
        r = subprocess.run(["python3", path] if path.endswith('.py') else ["bash", path],
                           capture_output=True, text=True, timeout=timeout)
        m_p = re.search(r'通过:\s*(\d+)', r.stdout)
        m_f = re.search(r'失败:\s*(\d+)', r.stdout)
        p = int(m_p.group(1)) if m_p else 0
        f = int(m_f.group(1)) if m_f else 0
        if r.returncode == 0 and f == 0:
            ok(f"{name} 集成 ({p}P)", "Suite3")
        else:
            fail(f"{name} 集成 ({p}P {f}F)", f"exit={r.returncode}", "Suite3")
            issue("HIGH", name, f"集成: {f} failures")


def run_suite4_module(token):
    """Suite 4: Module-specific endpoint tests."""
    if not CONFIG["suites"]["suite4_module"]["enabled"]:
        info("Suite 4 (模块专项) 已跳过")
        return
    print("\n━━━ SUITE 4 — 模块专项E2E ━━━")
    endpoints = CONFIG["suites"]["suite4_module"].get("endpoints", [])
    if not endpoints:
        info("未配置模块专项端点 (fulltest-config.json → suites.suite4_module.endpoints)")
        return

    for ep in endpoints:
        name = ep.get("name", "unknown")
        method = ep.get("method", "GET")
        path = ep.get("path", "/")
        body = ep.get("body")
        expected = ep.get("expected_code", 200)
        code, resp = api(method, path, token, body)
        if code == expected:
            ok(f"{name} (HTTP {code})", "Suite4")
        else:
            fail(f"{name}", f"HTTP {code} (expected {expected})", "Suite4")


def run_suite5_routes():
    """Suite 5: API route gate."""
    if not CONFIG["suites"]["suite5_routes"]["enabled"]:
        return
    print("\n━━━ SUITE 5 — 路由门禁 ━━━")
    route_script = os.path.join(ROOT, "scripts", "check-api-route-consistency.py")
    if os.path.isfile(route_script):
        ret = os.system(f"cd {ROOT} && python3 {route_script} 2>&1")
        ok("路由一致性", "Suite5") if ret == 0 else fail("路由一致性", "门禁失败", "Suite5")
    else:
        info("未发现路由一致性检查脚本")


def run_suite6_smoke(token):
    """Suite 6: Smoke tests."""
    if not CONFIG["suites"]["suite6_smoke"]["enabled"]:
        info("Suite 6 (烟雾测试) 已跳过")
        return
    print("\n━━━ SUITE 6 — 烟雾测试 ━━━")

    # Auto-generated smoke: 404 checks for all configured modules
    smoke_paths = [
        "/nonexistent/resource/99999",
    ]
    # Also pick from Suite4 endpoint paths
    for ep in CONFIG["suites"]["suite4_module"].get("endpoints", []):
        path = ep.get("path", "")
        if path and "?" not in path:
            smoke_paths.append(f"{path}/99999")

    for sp in smoke_paths:
        code, resp = api("GET", sp, token)
        if code in (200, 201, 404):
            ok(f"烟雾 {sp} (HTTP {code})", "Suite6")
        else:
            fail(f"烟雾 {sp}", f"unexpected HTTP {code}", "Suite6")


def run_suite7_frontend_qa():
    """Suite 7: Frontend code quality."""
    if not CONFIG["suites"]["suite7_frontend_qa"]["enabled"]:
        return
    print("\n━━━ SUITE 7 — 前端代码质量 ━━━")
    qa_dir = CONFIG["paths"].get("frontend_qa_dir",
                                  os.path.join(CONFIG["paths"].get("tests_dir", ""), "cases",
                                       "scripts", "frontend"))

    fe_tests = []
    if os.path.isdir(qa_dir):
        for f in sorted(glob.glob(os.path.join(qa_dir, "tc-fe-*.py"))):
            fe_tests.append((os.path.basename(f).replace("tc-fe-", "").replace(".py", ""), f))

    if not fe_tests:
        info("未发现前端 QA 测试脚本")
        return

    for name, path in fe_tests:
        r = subprocess.run(["python3", path], capture_output=True, text=True, timeout=60)
        m_p = re.search(r'结果:\s*(\d+)P/(\d+)F', r.stdout)
        p = int(m_p.group(1)) if m_p else 0
        f = int(m_p.group(2)) if m_p else 0
        if r.returncode == 0 and f == 0:
            ok(f"FE {name} ({p}P)", "Suite7")
        else:
            fail(f"FE {name} ({p}P {f}F)", f"exit={r.returncode}", "Suite7")
            issue("MEDIUM", "frontend", f"FE {name}: {f} failures")


def run_suite8_backend_qa():
    """Suite 8: Backend code quality."""
    if not CONFIG["suites"]["suite8_backend_qa"]["enabled"]:
        return
    print("\n━━━ SUITE 8 — 后端代码质量 ━━━")
    be_dir = CONFIG["paths"].get("backend_qa_dir",
                                  os.path.join(CONFIG["paths"].get("tests_dir", ""), "cases",
                                       "scripts", "backend"))

    be_tests = []
    if os.path.isdir(be_dir):
        for f in sorted(glob.glob(os.path.join(be_dir, "tc-be-*.py"))):
            be_tests.append((os.path.basename(f).replace("tc-be-", "").replace(".py", ""), f))

    if not be_tests:
        info("未发现后端 QA 测试脚本")
        return

    for name, path in be_tests:
        r = subprocess.run(["python3", path], capture_output=True, text=True, timeout=60)
        m_p = re.search(r'结果:\s*(\d+)P/(\d+)F', r.stdout)
        p = int(m_p.group(1)) if m_p else 0
        f = int(m_p.group(2)) if m_p else 0
        if r.returncode == 0 and f == 0:
            ok(f"BE {name} ({p}P)", "Suite8")
        else:
            fail(f"BE {name} ({p}P {f}F)", f"exit={r.returncode}", "Suite8")
            issue("MEDIUM", "backend", f"BE {name}: {f} failures")


def run_custom_test():
    """自定义测试命令模式（Python / 非 Java 项目专用）。

    当 config.custom_test.command 非空时，替代 8+1 Suite 架构直接执行
    项目自身测试命令（如 pytest），并解析 junitxml 采集结果——
    失败明细进入 ISSUES，自动衔接 fulltest-evolve.py 失败模式匹配。
    返回命令退出码；无 custom_test 配置返回 None（Java 项目不受影响）。
    """
    ct = CONFIG.get("custom_test", {})
    cmd = (ct.get("command") or "").strip()
    if not cmd:
        return None

    info(f"自定义测试命令: {cmd}")
    timeout_s = int(ct.get("timeout_s", 600))
    try:
        r = subprocess.run(cmd, shell=True, text=True, timeout=timeout_s)
    except subprocess.TimeoutExpired:
        fail("自定义测试命令超时", f"timeout={timeout_s}s")
        return 2

    if r.returncode != 0:
        fail(f"自定义测试命令返回非零: {r.returncode}")

    # 可选 junitxml 采集（pytest --junitxml 产物），失败明细进 ISSUES
    jxml = ct.get("junit_xml", "")
    if jxml and os.path.isfile(jxml):
        _collect_junitxml(jxml)
    elif jxml:
        warn_custom(f"junitxml 未生成: {jxml}（检查测试命令的 --junitxml 参数）")

    return r.returncode


def _collect_junitxml(jxml):
    """解析 junitxml（pytest/Surefire 通用），统计计数并把失败写入 ISSUES。"""
    import xml.etree.ElementTree as ET
    try:
        root = ET.parse(jxml).getroot()
    except (ET.ParseError, OSError) as e:
        warn_custom(f"junitxml 解析失败: {e}")
        return
    n_fail = 0
    n_pass = 0
    for tc in root.iter("testcase"):
        cid = tc.attrib.get("classname", "") + "::" + tc.attrib.get("name", "")
        failed = False
        for kind in ("failure", "error"):
            node = tc.find(kind)
            if node is not None:
                n_fail += 1
                failed = True
                detail = (node.attrib.get("message", "") or node.text or "")[:200]
                issue("HIGH", cid, detail)
                fail(cid, detail[:80])
        if not failed:
            n_pass += 1
            ok(cid)
    info(f"junitxml 采集: {n_pass + n_fail} cases, {n_pass}P/{n_fail}F")


def warn_custom(m):
    print(f"  ⚠️  {m}")


def run_self_evolve():
    """Call self-evolve engine after fulltest completes."""
    if not CONFIG["evolution"].get("enabled", True):
        return

    iss_file = "/tmp/fulltest-issues.json"
    with open(iss_file, "w") as f:
        json.dump(ISSUES, f, ensure_ascii=False)

    suite_summary = _build_suite_summary()
    all_pass = FAIL == 0
    evolve_flags = (
        f"--passes {PASS} --failures {FAIL} "
        f"--issues-file {iss_file} --suites '{suite_summary}'"
    )
    if all_pass:
        evolve_flags += " --dry-run"

    evolve_script = os.path.join(
        os.path.dirname(os.path.abspath(__file__)),
        "fulltest-evolve.py"
    )
    # Try project-local copy first
    local_evolve = os.path.join(ROOT, "scripts", "fulltest-evolve.py")
    if os.path.isfile(local_evolve):
        evolve_script = local_evolve

    if os.path.isfile(evolve_script):
        try:
            cmd = f"python3 {evolve_script} {evolve_flags}"
            r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=30)
            print(r.stdout)
            if r.stderr:
                print(f"  ⚠️ 进化引擎: {r.stderr[:300]}")
        except Exception as e:
            print(f"  ⚠️ 进化引擎启动失败: {e}")


# ═══════════════════════════════════════════════════════════
#  MAIN
# ═══════════════════════════════════════════════════════════

def main():
    """Main entry point — orchestrate all suites."""

    import argparse
    p = argparse.ArgumentParser(description="Generalized Fulltest Runner")
    p.add_argument("--config", help="Path to fulltest-config.json")
    p.add_argument("--suite", help="Comma-separated suite numbers to run (e.g., 1,2,3)")
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--login-only", action="store_true",
         help="Test login and print tokens then exit")
    args = p.parse_args()

    cfg_path = load_config(args.config)
    project_name = CONFIG.get("project", {}).get("name", os.path.basename(ROOT))
    dry = args.dry_run
    selected = [int(x) for x in args.suite.split(",")] if args.suite else None
    # 自定义命令模式：Python/非 Java 项目（config.custom_test.command 非空）替代 8+1 Suite
    custom_mode = bool((CONFIG.get("custom_test", {}) or {}).get("command", ""))

    print("╔═══════════════════════════════════════════════════════╗")
    print(f"║  Fulltest Runner — {project_name}                    ║")
    print("╠═══════════════════════════════════════════════════════╣")
    print(f"║  Root: {ROOT}")
    print(f"║  Config: {cfg_path or 'auto-detected'}")
    print(f"║  API: {CONFIG['api']['base_url']}")
    if dry:
        print(f"║  MODE: DRY-RUN")
    if selected:
        print(f"║  Suites: {selected}")
    print(f"║  Time: {time.strftime('%Y-%m-%d %H:%M:%S')}")
    print("╚═══════════════════════════════════════════════════════╝")

    if dry:
        print("\nDRY-RUN — listing what would run:\n")
        if custom_mode:
            print(f"  Custom [{CONFIG['custom_test'].get('command')}]")
        else:
            _print_dry_run()
        return

    # ── Login（custom 模式跳过）──
    print("\n── Login ──")
    tokens = {}
    if custom_mode:
        info("custom 模式 — 跳过 API 登录")
    else:
        login_users = CONFIG.get("api", {}).get("login_users", {})
        if not login_users:
            # Default: single admin user
            login_users = {"admin": {"username": "admin", "password_env": "FULLTEST_ADMIN_PW"}}

        for role, ucfg in login_users.items():
            username = ucfg.get("username", role)
            pw_env = ucfg.get("password_env", f"FULLTEST_{role.upper()}_PW")
            token, err = login(username, pw_env)
            if token:
                tokens[role] = token
                info(f"Token {role}: {token[:16]}...")
            else:
                fail(f"Login {role}", err)
                if role == "admin":
                    print("Admin login failed — aborting")
                    sys.exit(1)

    if args.login_only:
        for role, t in tokens.items():
            print(f"{role}: {t}")
        return

    admin_token = tokens.get("admin", list(tokens.values())[0] if tokens else "")

    def _should(n):
        return selected is None or n in selected

    if custom_mode:
        run_custom_test()
    else:
        if _should(1): run_suite1_seed()
        if _should(2): run_suite1_5_integrity()
        if _should(3): run_suite2_uat(tokens)
        if _should(4): run_suite3_integration(tokens)
        if _should(5): run_suite4_module(admin_token)
        if _should(6): run_suite5_routes()
        if _should(7): run_suite6_smoke(admin_token)
        if _should(8): run_suite7_frontend_qa()
        if _should(9): run_suite8_backend_qa()

    # ── Summary ──
    DURATION = time.time() - START
    print(f"\n╔═══════════════════════════════════════════════════════╗")
    print(f"║  Fulltest Complete                                   ║")
    print(f"╠═══════════════════════════════════════════════════════╣")
    print(f"║  PASS: {PASS}  |  FAIL: {FAIL}  |  Issues: {len(ISSUES)}")
    print(f"║  Duration: {DURATION:.0f}s")
    print(f"╚═══════════════════════════════════════════════════════╝")

    if ISSUES:
        print(f"\n── Issues ──")
        for i, iss in enumerate(ISSUES, 1):
            print(f"  [{iss['severity']}] #{i}: {iss['module']} — {iss['desc'][:80]}")

    # ── Self-Evolve ──
    run_self_evolve()

    sys.exit(FAIL)


def _print_dry_run():
    """Print what would be executed."""
    suites = [
        (1, "数据播种", (CONFIG["suites"]["suite1_seed"]["enabled"], discover_seed_scripts())),
        (2, "数据勾稽", CONFIG["suites"]["suite1_5_integrity"]["enabled"]),
        (3, "角色UAT", (CONFIG["suites"]["suite2_uat"]["enabled"], discover_uat_roles())),
        (4, "集成测试", (CONFIG["suites"]["suite3_integration"]["enabled"],
             discover_integration_tests())),
        (5, "模块专项", CONFIG["suites"]["suite4_module"]["enabled"]),
        (6, "路由门禁", CONFIG["suites"]["suite5_routes"]["enabled"]),
        (7, "烟雾测试", CONFIG["suites"]["suite6_smoke"]["enabled"]),
        (8, "前端 QA", CONFIG["suites"]["suite7_frontend_qa"]["enabled"]),
        (9, "后端 QA", CONFIG["suites"]["suite8_backend_qa"]["enabled"]),
    ]
    for num, name, enabled in suites:
        if isinstance(enabled, tuple):
            e, detail = enabled
            icon = "✅" if e else "⏭"
            extra = f" → found {len(detail)} items" if isinstance(detail, (list, dict)) else ""
            print(f"  Suite {num} [{icon}] {name}{extra}")
        else:
            icon = "✅" if enabled else "⏭"
            print(f"  Suite {num} [{icon}] {name}")


if __name__ == "__main__":
    main()
