// ─────────────────────────────────────────────────────────────────────────────
// 数据层最小试点 —— external 通道架构验证（commodityHOT 有色金属）
//
// 目的：验证「外部采集脚本 → POST /api/ingest/items → 结构化落库 → 前端/查询层可读」
//       这条 external 通道能否跑通。默认全程模拟数据（非真实交易所数据）；
//       可选地，当 COMMODITY_PILOT_USE_SHMET=true 时，尝试抓一次 shmet.com 的
//       快讯详情页，把真实库存/升贴水条目转成同样的 ingest 结构。
//
// 重点（以实际代码为准，勿凭文档猜 schema）：
//   apps/api/src/routes/ingest.ts  +  packages/backend/src/ingest/items.ts
//   真实请求体是：
//     { "sourceId": 必填, "sourceName": 可选, "items": [{ "title": 必填, "url": 必填,
//       "publishedAt": 可选, "author": 可选, "raw": 可选 }] }
//   注意：接口并不接受 kind/bodyZh/bodyOriginal/category/enrichment/sourcePublicId 这些字段——
//   那是「分析/读取层」的概念（kind='external' 是接口自动给信源写死的，category 与中文正文
//   由 ingest 之后的内容理解模型生成，随选与归组模型填写），不是上报入参。
//   自由格式的自定义数据只能放在 `raw`（jsonb 落库），本脚本用 raw.data 承载库存数值/环比，
//   raw.note 承载「库存变化+可持续性点评」。
//
// 三种运行方式：
//   1) 默认：只「构造 + 本地校验」，不发送（架构验证，最安全）。
//      node scripts/commodity-data-pilot.ts
//   2) 带上 INGEST_TOKEN 本地校验（不发送）：
//      INGEST_TOKEN=xxxxxxxx node scripts/commodity-data-pilot.ts
//   3) 真正发送（需用户明确允许、且本地站点 3002 已起）：
//      COMMODITY_PILOT_SEND=true INGEST_TOKEN=xxxxxxxx node scripts/commodity-data-pilot.ts
//
// 可选的真实数据源（shmet.com 上海金属网）：
//   - 由 COMMODITY_PILOT_USE_SHMET=true 打开；默认关闭，绝不主动外连。
//   - 只做「浅抓一次」：以 https://www.shmet.com/newsFlash/ 为入口，扫到形如
//     newsFlashDetail-<id>.html 的库存/升贴水类快讯链接，再抓第一条第详页。
//     https://www.shmet.com/newsFlash/newsFlashDetail-<id>.html
//   - 详页发布时间落在 #infosNewDetailDateStr（内容客户端注入，正文在对应 JSON 里），
//     因此解析一律容错：抓不到 / 解析不到结构化数字时打警告，并回退到模拟数据继续构造，
//     绝不因真实源失败而崩脚本。
//
// 合规注意：
//   - 交易所/官方发布是公开数据，站内默认「只展示摘要 + 原文链接」，不要为了展示全文而开
//     site_fulltext，除非来源明确授权。
//   - 价格、仓单等数据若来自第三方再分发服务（SHMET/SMM 等），再分发与引用按其授权等级分级，
//     未授权的不得落库展示或再导出；优先只用交易所一手、可核验的官方口径。
//   - shmet 部分内容付费/VIP 专享（HTTP 层返回 500000 付费码），本脚本只取公开可浏览的
//     摘要与公开数字，不做深链批量爬取，更不下付费内容。
//   - 本脚本默认不接真实数据、不真正外发（除非显式置 COMMODITY_PILOT_SEND=true 且已获允许）。
// ─────────────────────────────────────────────────────────────────────────────

/** 北京时区的「今天」日期字符串 YYYY-MM-DD。 */
function beijingTodayISO(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

const CATEGORY_LABEL = {
  copper: "铜",
  aluminum: "铝",
  // 可扩展铅/锌/镍/macro/multi，见 industry/taxonomy.ts。
} as const;

// ── B. 把 shmet 源登记为 external 上报源（不动 industry/sources.json）──────────
// 发送时作为 sourceId/sourceName；调用 /api/ingest/items 后，后端会按需自动建
// external 源（默认参与模式 isolated，见 packages/backend/src/ingest/items.ts:
// INSERT ... kind 'external', participation_mode 'isolated' ...）。
const SHMET_SOURCE = {
  id: "shmet-external-inventory",
  name: "上海金属网 SHMET 库存/升贴水",
} as const;

/** 上报 item 的结构（对齐 ingest schema：title/url 必填，publishedAt/author/raw 可选）。 */
interface IngestItem {
  title: string;
  url: string;
  publishedAt?: string;
  author?: string;
  raw?: {
    data: {
      category: string;
      exchange: string;
      value: number;
      delta: number;
      unit: string;
      asOf: string;
      // 若从标题/正文解析到升贴水，附带（如 COMEX/LME 现货升贴水快讯）。
      basisQuote?: string;
      basisSpread?: number;
    };
    note?: string;
    [k: string]: unknown; // 兼容额外字段（如来源抓取元信息）。
  };
}

/**
 * A. 一条模拟库存日报的构造器（fallback 数据）。
 * 字段对齐真实 ingest schema（title/url/publishedAt/author/raw）。
 * @param category 用于命名与提示，真实 CATEGORY 键；注意它只出现在标题/raw 里，
 *                 真正的 category 由 ingest 后的模型按正文判定（copper/aluminum/...）。
 */
function inventoryItem(
  category: keyof typeof CATEGORY_LABEL,
  exchange: string,
  value: number,
  delta: number,
  unit: string,
  bodyNote: string,
): IngestItem {
  const asOf = beijingTodayISO();
  const url = `https://sim.example.com/${exchange}/inventory/${category}/daily/${asOf}`;
  return {
    title: `${exchange} ${CATEGORY_LABEL[category]}库存日报`,
    url,
    publishedAt: `${asOf}T08:00:00+08:00`,
    author: exchange,
    raw: {
      // 架构验证：库存数值/环比 delta 的唯一承载位（jsonb 落库）。
      data: { category, exchange, value, delta, unit, asOf },
      // 仅记录要点，供沙箱自查；正文展示由 ingest 后的模型流程生成。
      note: bodyNote,
    },
  };
}

/** 默认 3 条模拟 LME/SHFE 库存日报（铜 LME、铝 SHFE、铜 SHFE）。 */
function mockItems(): IngestItem[] {
  return [
    inventoryItem(
      "copper",
      "LME",
      271_850,
      -3_475,
      "吨",
      "LME copper registered warrants fell 3,475 t day-over-day; headline on-warrant levels remain the main forward-supply signal for the nearby curve.",
    ),
    inventoryItem(
      "aluminum",
      "SHFE",
      172_940,
      +2_610,
      "吨",
      "SHFE aluminium deliverable warrants rose 2,610 t; exchange stocks stayed near the seasonal low, keeping the cash-to-next-week carry tight.",
    ),
    inventoryItem(
      "copper",
      "SHFE",
      128_660,
      +1_085,
      "吨",
      "SHFE copper bonded+feeds warehouse warrants edged up 1,085 t; import arrivals outweighed domestic off-take this session.",
    ),
  ];
}

// ── A. shmet 真实取数路径（可选，COMMODITY_PILOT_USE_SHMET=true 打开）────────────
// 结构+链路是能保证的；真实 HTML 解析一律容错，解析失败回退到模拟数据。

/** 从一段 HTML 里剥掉标签，拿纯文本。 */
function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** 从中文标题里识别品种关键字 → CATEGORY 键（拿不到就回退 copper + 原样保留标签）。 */
const EXCHANGE_KEYS = ["LME", "SHFE", "COMEX", "SOCAL", "SHMET"] as const;

function sniffExchangeAndCheckTitle(title: string): { exchange?: string; basis: boolean } {
  const up = title.toUpperCase();
  const exchange = EXCHANGE_KEYS.find((k) => up.includes(k));
  return { exchange, basis: /升贴水|升水|贴水/.test(title) };
}

/**
 * 从 shmet 快讯标题/正文里尽量解析出「库存/升贴水」的公开数字。
 * 纯正则启发式，抓到几个就构造几个字段；抓不到就返回 null 交给调用方回退。
 * 不做深链批量提取，只取单页可见的公开数字。
 */
function parseShmetNumbers(text: string): {
  value?: number;
  delta?: number;
  unit?: string;
  basisSpread?: number;
} {
  const out: { value?: number; delta?: number; unit?: string; basisSpread?: number } = {};
  // 库存总量，例：「库存 269,800 吨」「铜库存 26.99万吨」
  const value = /(?:库存|仓单)\s*(?:为|至|约)?\s*([\d,]+(?:\.\d+)?)\s*(万吨|万手|吨|吨\/日|桶)/.exec(text);
  if (value) {
    const num = Number(value[1].replace(/,/g, ""));
    out.unit = value[2];
    // 「万吨/万手」等带「万」的按万倍换算到基本单位，其他（吨/桶）原值。
    out.value = /万/.test(value[2]) ? num * 10000 : num;
  }
  // 环比增减，例：「较上日减少 3,475 吨」「环比 +1,085 吨」
  const delta = /(较[上昨今]日|环比|单日)[^数字]{0,12}(增加|减少|增|减|[-+]?\s*)([\d,]+(?:\.\d+)?)\s*(吨)?/.exec(text);
  if (delta) {
    const n = Number(delta[3].replace(/,/g, ""));
    const neg = /减少|减|-\s*/.test(delta[2]) && !/增加|增/ .test(delta[2]);
    out.delta = (neg ? -1 : 1) * n;
    if (!out.unit && delta[4]) out.unit = delta[4];
  }
  // 现货升贴水，例：「伦铜现货升水 124.75 美元/吨」
  const basis = /(现货)?[上下贴]{0,3}(升水|贴水)\s*([\d,]+(?:\.\d+)?)\s*(美元\/吨|美元|元\/吨|\))?/.exec(text);
  if (basis) {
    const b = Number(basis[3].replace(/,/g, ""));
    out.basisSpread = /贴水/.test(basis[2]) ? -b : b;
  }
  return out;
}

/** 从 shmet 详页 HTML 中尽量取发布时间（优先 DOM id，其次 JSON pubDateStr，最后放弃）。 */
function extractShmetPublishedAt(html: string): string | undefined {
  const idMatch = /id="infosNewDetailDateStr"[^>]*>\s*([^<]+)</.exec(html);
  if (idMatch) {
    const t = idMatch[1].trim().replace(/[：:]\d{2}$/, "T");
    const m = /(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/.exec(t);
    if (m) return `${m[1]}T${m[2]}:00+08:00`;
  }
  const js = /"(?:pubDateStr|publishTimeStr|createTimeStr)"\s*:\s*"([^"]+)"/.exec(html);
  if (js) {
    const m = /(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/.exec(js[1]);
    if (m) return `${m[1]}T${m[2]}:00+08:00`;
  }
  return undefined;
}

/**
 * 抓写 shmet 库存/升贴水条目并转成 ingest item。
 * @param url 要抓的详页 URL（newsFlashDetail-<id>.html）。
 * @param title 从列表拿到的标题（若为空则从页面 DOM 尝试兜底）。
 * @returns item | null（任何一步失败都返回 null，由调用方回退模拟数据）。
 */
async function shmetItemFromPage(url: string, expectedTitle: string): Promise<IngestItem | null> {
  const resp = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 commodityHOT-pilot/1.0 (public-flash-summary)", Accept: "text/html" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!resp.ok) {
    console.warn(`  [shmet] 详页 ${url} HTTP ${resp.status}，回退模拟数据。`);
    return null;
  }
  const html = await resp.text();
  const title =
    (/id="infosNewDetailTitle"[^>]*>\s*([^<]+)</.exec(html)?.[1]?.trim() ?? expectedTitle) ||
    (/<title>\s*([^<]+)</.exec(html)?.[1]?.trim() ?? "");
  const text = stripHtml(html);
  const publishedAt = extractShmetPublishedAt(html);
  const nums = parseShmetNumbers(text);

  // 标题/正文都识别不出品种与库存数字 → 放弃该条目。
  if (!title || (nums.value === undefined && nums.basisSpread === undefined)) {
    console.warn(`  [shmet] ${url} 未解析到结构化库存/升贴水数字，回退模拟数据。`);
    return null;
  }

  const { exchange, basis } = sniffExchangeAndCheckTitle(title);
  const category = /铝/.test(title) ? "aluminum" : "copper";
  const asOf = publishedAt ? publishedAt.slice(0, 10) : beijingTodayISO();

  return {
    title,
    url,
    ...(publishedAt ? { publishedAt } : {}),
    author: exchange ?? "shmet",
    raw: {
      data: {
        category,
        exchange: exchange ?? "shmet",
        value: nums.value ?? 0,
        delta: nums.delta ?? 0,
        unit: nums.unit ?? "-",
        asOf,
        ...(basis && nums.basisSpread !== undefined ? { basisQuote: "美元/吨", basisSpread: nums.basisSpread } : {}),
      },
      note: text.slice(0, 180),
      source: "shmet-public-flash",
      channel: "inventory-basis",
    },
  };
}

/**
 * A. 打开真实抓取路径的入口。浅抓一次，最多抓取 1 条详页；抓不到/解析失败全部
 * 打警告并回退到调用方的模拟数据，绝不让脚本崩。
 */
async function pullShmetInventory(): Promise<IngestItem[]> {
  console.log("\n[shmet] COMMODITY_PILOT_USE_SHMET=true：尝试真实抓取上海金属网库存/升贴水快讯（浅抓一次）");
  // 入口：快讯列表页。只扫公开可浏览的标题链接。
  const indexUrl = "https://www.shmet.com/newsFlash/";
  let listHtml: string;
  try {
    const r = await fetch(indexUrl, {
      headers: { "User-Agent": "Mozilla/5.0 commodityHOT-pilot/1.0 (public-flash-summary)", Accept: "text/html" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    listHtml = await r.text();
  } catch (e) {
    console.warn(`  [shmet] 列表页抓取失败（${(e as Error).message}），回退模拟数据。`);
    return mockItems();
  }

  // 在列表里找「库存/升贴水」类快讯的第一条详情链接（newsFlashDetail-<id>.html）。
  const flashRe = /href="([^"]*newsFlashDetail-(\d+)\.html)"[^>]*>([^<]{2,80})/g;
  const candidate: { url: string; title: string } | undefined = (() => {
    let m: RegExpExecArray | null;
    while ((m = flashRe.exec(listHtml))) {
      const title = stripHtml(m[3] ?? "");
      if (/库存|仓单|升贴水|升水|贴水|LME|COMEX|SHFE/.test(title)) return { url: m[1], title };
    }
    return undefined;
  })();
  if (!candidate) {
    console.warn("  [shmet] 列表页未找到库存/升贴水类快讯，回退模拟数据。");
    return mockItems();
  }
  const detailUrl = /^https?:/.test(candidate.url) ? candidate.url : `https://www.shmet.com${candidate.url}`;
  console.log(`  [shmet] 命中第一条快讯：${candidate.title} → ${detailUrl}`);

  const item = await shmetItemFromPage(detailUrl, candidate.title);
  if (!item) return mockItems();
  console.log(`  [shmet] 解析成功：${item.title}（库存=${item.raw?.data.value}${item.raw?.data.unit}，delta=${item.raw?.data.delta}）`);
  return [item];
}

/** 发送前本地判定必填关键字段是否齐全（schema 所需：title/url，尽量补 publishedAt）。 */
function localValidate(it: IngestItem): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  if (!it.title || !it.title.trim()) problems.push("缺 title(原文标题)");
  if (!it.url || !/^https?:\/\//.test(it.url)) problems.push("缺/非法 url");
  if (!it.publishedAt || Number.isNaN(new Date(it.publishedAt).getTime())) problems.push("publishedAt 非法或缺失");
  return { ok: problems.length === 0, problems };
}

/** 数据中心化：按 品种×exchange 汇总当前库存值，输出「今日数据快照」文本。 */
function snapshotSummary(items: IngestItem[]): string[] {
  const lines: string[] = [];
  for (const it of items) {
    const d = it.raw?.data;
    if (!d) continue;
    const label = CATEGORY_LABEL[d.category as keyof typeof CATEGORY_LABEL] ?? d.category;
    let line = `${label} 库存 ${(d.value / 10_000).toFixed(2)}万吨 delta ${d.delta} 交易所 ${d.exchange} asOf ${d.asOf}`;
    if (d.basisSpread !== undefined) line += ` ${d.basisQuote ?? ""}升/贴水 ${d.basisSpread}`;
    lines.push(`  • ${line}`);
  }
  return lines;
}

async function main() {
  const send = process.env.COMMODITY_PILOT_SEND === "true";
  const useShmet = process.env.COMMODITY_PILOT_USE_SHMET === "true";
  const token = process.env.INGEST_TOKEN ?? "";
  const tokenOk = token.length >= 16;

  console.log("== commodityHOT 数据层试点（架构验证；supply=external 通道）==");
  console.log(
    `发送开关 COMMODITY_PILOT_SEND=${String(send)}；真实源 COMMODITY_PILOT_USE_SHMET=${String(useShmet)}；` +
      `INGEST_TOKEN 已${token ? "设置" : "未设置"}(需 ≥16 位)\n`,
  );

  // 决定数据来源：优先真实 shmet，失败/未开启则用模拟数据。
  const items = useShmet ? await pullShmetInventory() : mockItems();
  const dataSource = useShmet ? "shmet(真实/或回退模拟)" : "模拟数据(默认)";

  let allOk = true;
  for (const it of items) {
    const v = localValidate(it);
    if (!v.ok) allOk = false;
    // console.error 打印每条摘要，供运行日志/告警采样。
    console.error(
      [v.ok ? "PASS" : "FAIL",
       `kind=external(sourceId 自动建源)`,
       `标题=${it.title}`,
       `时间=${it.publishedAt ?? "-"}`,
       `category→(模型判定)`,
       `delta=${it.raw?.data.delta} ${it.raw?.data.unit}`,
       v.ok ? "" : `问题=[${v.problems.join(", ")}]`,
      ].join(" | "));
  }
  console.log(`\n本地校验：${allOk ? "全部通过 ✅" : "存在缺项 ❌"}（共 ${items.length} 条，来源=${dataSource}）`);

  // C. 「今日数据快照」——为后续前端「数据概览」面板提供数据形态示例。
  console.log("\n── 今日数据快照（数据概览面板的数据形态示例）──");
  const lines = snapshotSummary(items);
  for (const l of lines) console.log(l);
  if (!lines.length) console.log("  (无结构化 data，无快照可输出)");

  // B. 发送前打印将要 POST 的完整 source + items 摘要。
  console.log("\n── 待上报 ingest payload（摘要）──");
  console.log(`sourceId=${SHMET_SOURCE.id}`);
  console.log(`sourceName=${SHMET_SOURCE.name}`);
  for (const it of items) console.log(`  title="${it.title}" url=${it.url} raw=${JSON.stringify(it.raw?.data)}`);
  console.log(`items 条数=${items.length}\n`);

  // 仅当显式开启「真正发送」才外发（默认不外发）。
  if (!send) {
    console.log("模式=本地校验（未发送）。如需真正 POST，设 COMMODITY_PILOT_SEND=true 且带上 INGEST_TOKEN。");
    process.exit(allOk ? 0 : 1);
  }
  if (!tokenOk) {
    console.error("COMMODITY_PILOT_SEND=true 但 INGEST_TOKEN 为空或 <16 位，接口会 401，跳过发送。");
    process.exit(1);
  }

  const resp = await fetch("http://127.0.0.1:3002/api/ingest/items", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      sourceId: SHMET_SOURCE.id,
      sourceName: SHMET_SOURCE.name,
      items,
    }),
  });
  const body = (await resp.json().catch(() => null)) as { ok?: boolean; created?: number } | null;
  console.log(`POST 状态=${resp.status}，响应=${JSON.stringify(body)}`);
  process.exit(resp.ok && body?.ok ? 0 : 1);
}

await main();