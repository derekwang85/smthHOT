// UX 走查回归：admin 端与业务端的联动链路完整性。
//
// 走查（methodology 18）发现 admin 页里有一批"业务端↔admin端"交叉链接——运营在后台修改内容、事件或
// Codex 重置识别后，靠这些链接回到业务站核对最终呈现。它们是单向的（admin→业务站，业务站匿名不反链，
// 这是设计），因此一旦业务端路由改名/删除，后台的"公开页/事件/打开公开页"等入口会静默失效。
// smoke.ts 只查公开页面可达，不覆盖 admin→业务站这些交叉链接的目标是否存在。本测试把这些目标锁定为
// 不变量：任何 admin→业务站的字面量链接目标，都必须能在 routes.ts 注册表中解析到对应路由。
//
// 这是纯静态测试：读文件、不用数据库，也不 import setup.ts，可在无 postgres 时安全单独运行。

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ROUTES = readFileSync(join(ROOT, "apps/web/app/routes.ts"), "utf8");
const ADMIN_DIR = join(ROOT, "apps/web/app/routes/admin");

/** 从 routes.ts 提取所有路由 path（route("x", ...)、layout("x", ...)、index(...)）。 */
const routePaths = (() => {
  const out: string[] = [];
  const re = /\b(?:route|layout)\(\s*"([^"]+)"/g;
  for (const m of ROUTES.matchAll(re)) out.push(m[1]!);
  // @react-router 的 index(...) 没有 path 字符串，代表当前布局的 "/" 根。
  if (/^\s*index\(/m.test(ROUTES)) out.push("/");
  return out;
})();

/** 去掉段位参数，返回路由的段级前缀（如 items/:id -> ["items"]，story/:publicId -> ["story"]）。 */
const segmentPrefix = (path: string): string[] => path.replace(/^\//, "").split("/").filter(Boolean).map((s) => (s.startsWith(":") ? ":" : s));

/**
 * 某段级前缀是否能被某条路由匹配。
 * 匹配到路由比字面前缀多出的静态段也接受（例如链接 /story/xxx，路由是 /story/:publicId）。
 * 业务站根 "/" 视为 todo 中的通配基准，不在此校验（layout/index 已覆盖）。
 */
function resolvesTo(segments: string[], route: string[]): boolean {
  if (segments.length === 0) return route.length === 0;
  // 逐段匹配：路由段可与链接等长或同前缀扩展（最多允许多出的静态段落在参数之后）。
  for (let i = 0; i < segments.length && i < route.length; i++) {
    const a = segments[i]!;
    const b = route[i]!;
    if (b !== ":" && a !== b) return false;
  }
  return true;
}

const routeSegments = routePaths.map(segmentPrefix);
/** 链接目标（段级 /items/x）能否被任一业务路由匹配。 */
const resolvesToAny = (segments: string[]) => routeSegments.some((r) => resolvesTo(segments, r) && r.length >= segments.length);

/**
 * 扫描 admin 源码里的字面量内链：`to={`/admin/...`}`、`href={`/items/${...}`}`、`href="/codex-reset"` 等。
 * 只关心以 "/" 开头、且是模板字面量或纯字符串的内链；站外 http(s) 与相对 query 忽略。
 */
function scanLinks(source: string): Array<{ value: string; line: number }> {
  const links: Array<{ value: string; line: number }> = [];
  // 形式一：`href={`/xxx/${...}`}` / `to={`/admin/xxx/${...}`}` —— 抓 "/" 开头并含 ${} 的模板字面量
  const tmpl = /(?:href|to)=\{`(\/(?:[^`$]|\$\{[^}]*\})*)`\}/g;
  for (const m of source.matchAll(tmpl)) {
    links.push({ value: m[1]!, line: source.slice(0, m.index).split("\n").length });
  }
  // 形式二：`href="/codex-reset"` / `to="/admin/..."` —— 静态字符串
  const str = /(?:href|to)="(\/(?:[^"]|<[^>]*>)*)"/g;
  for (const m of source.matchAll(str)) {
    const v = m[1]!;
    if (v.includes("<") || v.includes("http")) continue;
    links.push({ value: v, line: source.slice(0, m.index).split("\n").length });
  }
  return links;
}

const adminFiles = readdirSync(ADMIN_DIR).filter((f) => f.endsWith(".tsx"));

test("走查锁定：admin 端已知的业务站交叉链接目标均能在 routes.ts 解析（R7 RegisteredNavTargetRule）", () => {
  // 走查在 methodology 18 下逐条核对过的 admin→业务站字面量链接：
  //   - content-item.tsx:91  公开页   -> /items/${a.id}        （业务路由 items/:id）
  //   - content-item.tsx:235 事件     -> /story/${m.story_public_id}（业务路由 story/:publicId）
  //   - monitor.tsx:310      打开公开页 -> /codex-reset          （业务路由 codex-reset）
  // 若任一目标被改名/删除，后台返回业务站核对呈现的入口即断。
  for (const [href, reason] of [
    ["/items/", "content-item 的「公开页」链接业务条目页 items/:id"],
    ["/story/", "content-item 的「事件」链接业务事件页 story/:publicId"],
    ["/codex-reset", "monitor 的「打开公开页」链接业务重置页 codex-reset"],
  ] as Array<[string, string]>) {
    const segs = segmentPrefix(href);
    assert.ok(resolvesToAny(segs), `${href} —— ${reason}，但 routes.ts 无对应路由`);
  }
});

test("扫描 admin 全部页面：任何指向业务站的模板字面量内链都必须有业务路由承接", () => {
  // 被明确排除的业务站入口：
  //   - href="/"                 业务站首页（layout.tsx:73、admin-login.tsx）—— 根路由恒存在，跳过
  //   - /admin/...               后台内部路由，走 admin layout 子树，不在此校验
  const esc = /^\/admin\//;
  const rootIndex = new Set(["/"]);
  const broken: string[] = [];
  for (const file of adminFiles) {
    const src = readFileSync(join(ADMIN_DIR, file), "utf8");
    for (const { value, line } of scanLinks(src)) {
      if (rootIndex.has(value) || esc.test(value) || !value.startsWith("/")) continue;
      // 只抓含参数占位（说明是走业务资源的动态链接，如 /items/${id}）或纯业务静态页
      const staticPart = value.split("${")[0]!.replace(/\/+$/, "");
      if (!staticPart) continue;
      if (!resolvesToAny(segmentPrefix(staticPart))) {
        broken.push(`${file}:${line}  ->  ${value}`);
      }
    }
  }
  assert.deepEqual(broken, [], ["admin→业务站链接目标在 routes.ts 中解析失败："].concat(broken).join("\n  "));
});

test("走查覆盖剂：admin 端已知的业务站交叉链接字面量确实存在于源码中（防被静默改掉而不自知）", () => {
  // 反向锁：三条核心交叉链接必须仍在源码里，保证上面的解析测试在测真实的东西。
  const sources = adminFiles.map((f) => join(ADMIN_DIR, f));
  for (const [expect, reason] of [
    ["/items/", "content-item 公开页入口"],
    ["/story/", "content-item 事件入口"],
    ["/codex-reset", "monitor 打开公开页入口"],
  ] as Array<[string, string]>) {
    const hit = sources.some((p) => readFileSync(p, "utf8").includes(expect));
    assert.ok(hit, `admin 源码里找不到「${reason}」的链接目标 ${expect}，走查基线已变`);
  }
});