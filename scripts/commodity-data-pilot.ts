// ─────────────────────────────────────────────────────────────────────────────
// 数据层最小试点 —— external 通道架构验证（commodityHOT 有色金属）
//
// 目的：验证「外部采集脚本 → POST /api/ingest/items → 结构化落库 → 前端/查询层可读」
//       这条 external 通道能否跑通。仅架构验证，全程模拟数据，非真实交易所数据。
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
// 如何把真实 LME/SHFE 每日库存 PDF/网页转成这种结构：
//   - 定位每日「库存/仓单」数据源：LME daily stock（lme.com 的 DailyReport / Inventory）与
//     SHFE 每日仓单日报（shfe.com.cn 数据下载→按品种导出 XLS/网页），或经授权的数据服务商 API。
//   - 对每个品种抓当日报文 → 提取关键字段（品种、交易所、库存/仓单总量、增减量 delta、日期、
//     备注），构造成本脚本中每条的 raw.data{value, delta, unit, asOf} + title/url/publishedAt。
//   - 给 stable 的 URL（同品种同交易所每日是同一模板 URL，仅在追加重叠时要本地去重），
//     或把日期拼进 URL 使其稳定唯一；publishedAt 取报文实际发布时间（北京时间）。
//   - 无需自己写中文正文：正文/category/点评由 ingest 后的模型流程生成；如需自查可在
//     raw.note 放一条原文英文要点，仅作记录，不影响正文生成。
//
// 合规注意：
//   - 交易所/官方发布是公开数据，站内默认「只展示摘要 + 原文链接」，不要为了展示全文而开
//     site_fulltext，除非来源明确授权。
//   - 价格、仓单等数据若来自第三方再分发服务（SMM 等），再分发与引用按它的授权等级分级，
//     未授权的不得落库展示或再导出；优先只用交易所一手、可核验的官方口径。
//   - 本脚本不接真实数据、不真正外发（除非显式置 COMMODITY_PILOT_SEND=true 且已获允许）。
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

/**
 * 一条模拟库存日报的构造器。
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
) {
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

const CATEGORY_LABEL = {
  copper: "铜",
  aluminum: "铝",
  // 可扩展铅/锌/镍/macro/multi，见 industry/taxonomy.ts。
} as const;

/** 3 条模拟 LME/SHFE 库存日报（铜 LME、铝 SHFE、铜 SHFE）。 */
const items = [
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

/** 发送前本地判定必填关键字段是否齐全（schema 所需：title/url，尽量补 publishedAt）。 */
function localValidate(it: (typeof items)[number]): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  if (!it.title || !it.title.trim()) problems.push("缺 title(原文标题)");
  if (!it.url || !/^https?:\/\//.test(it.url)) problems.push("缺/非法 url");
  if (!it.publishedAt || Number.isNaN(new Date(it.publishedAt).getTime())) problems.push("publishedAt 非法或缺失");
  return { ok: problems.length === 0, problems };
}

async function main() {
  const send = process.env.COMMODITY_PILOT_SEND === "true";
  const token = process.env.INGEST_TOKEN ?? "";
  const tokenOk = token.length >= 16;

  console.log("== commodityHOT 数据层最小试点（架构验证，模拟数据）==");
  console.log(`发送开关 COMMODITY_PILOT_SEND=${String(send)}；INGEST_TOKEN 已${token ? "设置" : "未设置"}(需 ≥16 位)\n`);

  let allOk = true;
  for (const it of items) {
    const v = localValidate(it);
    if (!v.ok) allOk = false;
    // console.error 打印每条摘要，供运行日志/告警采样。
    console.error(
      [v.ok ? "PASS" : "FAIL",
       `kind=external(sourceId 自动建源)`,
       `标题=${it.title}`,
       `时间=${it.publishedAt}`,
       `category→(模型判定)`,
       `delta=${it.raw.data.delta} ${it.raw.data.unit}`,
       v.ok ? "" : `问题=[${v.problems.join(", ")}]`,
      ].join(" | "));
  }
  console.log(`\n本地校验：${allOk ? "全部通过 ✅" : "存在缺项 ❌"}（共 ${items.length} 条）`);

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
      sourceId: "commodity-inventory-pilot",
      sourceName: "模拟库存日报（架构验证）",
      items,
    }),
  });
  const body = (await resp.json().catch(() => null)) as { ok?: boolean; created?: number } | null;
  console.log(`POST 状态=${resp.status}，响应=${JSON.stringify(body)}`);
  process.exit(resp.ok && body?.ok ? 0 : 1);
}

await main();