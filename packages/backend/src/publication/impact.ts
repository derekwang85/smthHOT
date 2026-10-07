// Public read layer + impact job: "今日影响".
//   - 今日影响是与精选**独立**的商品级编辑判断：候选池 = 当日公开的精选信号 + 过了内容理解底分的文章；
//     每个候选都逐品种判断「利润/基差/库存」三落点的强度、方向与传导逻辑（见 industry/prompts/
//     impact-assessment.md），写进 impact_basis.verdicts。真命中某个品种(该品种某落点 >= SELECTION.impactFloor)
//     的按品种归组成「今日影响」，影响多品种就在多组重复出现；未入选(强度不足或无关)的统一收进
//     omitted「其余当日观察」并带判断句。
//   - computeTodayImpact 是 worker 的定时 job（见 apps/worker/src/schedules.ts 的 impact.assess）：
//     只写 publications（impact_score / impact_basis / revision），不新增对外读；模型调用走
//     chatJson + completeReceipt，reader 页面不触发。
import { z } from "zod";
import type { TodayImpact } from "@aihot/contracts/site";
import type { CategoryKey, ChannelKey } from "@aihot/contracts/taxonomy";
import { COMMODITY_KEYS, COMMODITY_LABELS, isCommodityKey } from "@aihot/contracts/taxonomy";
import { addDays, beijingDate, beijingMidnight } from "@aihot/contracts/time";
import { SELECTION } from "@aihot/industry/selection";
import { config } from "../config.ts";
import { sql } from "../db.ts";
import { chatJson } from "../providers/llm.ts";
import { completeReceipt } from "../providers/receipts.ts";
import { modelFor } from "../editorial/models.ts";
import { promptText, promptVersion } from "../editorial/prompts.ts";
import { ITEM_COLUMNS, ITEM_FROM, toFeedItemSummary, type ItemRow } from "./items.ts";

export const IMPACT_PROMPT_VERSION = promptVersion("impact-assessment");
export const IMPACT_SYSTEM = promptText("impact-assessment");

/** 多源共振：同一事实(fact_id)当日信号源 >= RESONANCE_THRESHOLD 时，冲击分上浮 RESONANCE_BOOST。 */
export const RESONANCE_THRESHOLD = 2;
export const RESONANCE_BOOST = 1.15;

/** 今日影响的候选池是**独立于精选**的：精选信号，或过了内容理解底分(understand)但未入选的文章。
 *  只要是池里的候选，都会被评估「是否影响利润/基差/库存」，最后靠三落点门槛决定谁进「今日影响」，
 *  ——干净地从候选里挑，而不是从精选信号里筛。查询依赖 analyses 别名为 an（读端 items.ITEM_FROM 里的 a
 *  是 articles，不能撞名）。用 sql.unsafe 包成 SQL 片段，否则 postgres.js 会把 ${} 里的字符串当绑定参数
 *  而非原始 SQL，导致条件恒假、候选池为空。 */
const IS_CANDIDATE = sql.unsafe(`(p.is_signal OR coalesce(an.output->'writing'->>'kind','') = 'understand')`);

/** 今日影响是独立于精选的判断：商品级——只判断每条候选影响哪些品种的「利润/基差/库存」三落点、
 *  方向与传导逻辑，并按品种归类（同一条影响多品种就归多条）。缺字段用 .catch 兜底，不让单篇没分
 *  或让整批失败；非法品种在读取端丢弃，不脑补。 */
const COMMODITY_VALUES = COMMODITY_KEYS as unknown as [string, ...string[]];
export const CommoditySchema = z.object({
  commodity: z.enum(COMMODITY_VALUES as [string, ...string[]]).catch("copper"),
  dir: z.enum(["bull", "bear", "neutral"]).nullable().catch(null),
  profit: z.coerce.number().int().min(0).max(100).catch(0),
  basis: z.coerce.number().int().min(0).max(100).catch(0),
  stock: z.coerce.number().int().min(0).max(100).catch(0),
  strength: z.coerce.number().int().min(0).max(100).catch(0),
  reason: z.string().max(160).catch(""),
});
export const ImpactSchema = z.object({
  verdicts: z.array(CommoditySchema).max(5).catch([]),
  reason_none: z.string().max(200).catch(""),
});
export type ImpactAssessment = z.infer<typeof ImpactSchema>;
export type ImpactCommodityAssessment = z.infer<typeof CommoditySchema>;

interface ImpactCandidate {
  articleId: string;
  revision: number;
  title: string;
  summary: string | null;
  factId: number | null;
  /** 已有评分的 signalReason（analyses.output 里若存过则带出来，否则为空，不脑补）。 */
  signalReason: string | null;
  body: string | null;
}

function buildImpactInput(c: ImpactCandidate): string {
  const parts = [
    `【标题】\n${(c.title ?? "").trim()}`,
    `【摘要/正文】\n${(c.body ?? c.summary ?? "").trim()}`,
    ...(c.signalReason ? [`【已评估的依据 signalReason】\n${c.signalReason}`] : []),
  ];
  return parts.join("\n\n");
}

/** 某条候选的总冲击分 = 全部命中品种里落点的最大强度，多源共振加成，四舍五入取整再 clamp 0–100。
 *  驱动「今日影响」入选判定；各组内排序另按各品种 verdict.strength。 */
function combineImpact(d: ImpactAssessment, resonanceSources: number): { score: number; resonance: number } {
  const resonance = resonanceSources >= RESONANCE_THRESHOLD ? RESONANCE_BOOST : 1;
  const strongest = Math.max(0, ...d.verdicts.map((v) => Math.max(v.profit, v.basis, v.stock)));
  return { score: Math.max(0, Math.min(100, Math.round(strongest * resonance))), resonance };
}

/** 是否真的算「影响」：至少一个品种的某落点强度 >= 门槛（够分量才算，噪音不入选）。 */
function clearsFloor(d: ImpactAssessment, floor: number): boolean {
  return d.verdicts.some((v) => Math.max(v.profit, v.basis, v.stock) >= floor);
}

/**
 * 评估当日候选（精选信号 + 过了内容理解底分的文章——独立于精选的池）对「利润/基差/库存」三落点的
 * 传导强度，把 impact_score / impact_basis 写回 publications。只有真命中三落点(某落点>=门槛)的才记
 * 有效 impact_score，否则记 0。用 sql.begin 事务包住查询与写回；单篇失败 try/catch 跳过，不让整批
 * 失败（计入 skipped）。安全阀：config.modelCallsEnabled 为 false 时不调用 chatJson（避免验证阶段触
 * 发真实模型），只统计有多少候选本来待评估并返回 "model disabled"。
 */
export async function computeTodayImpact(now = new Date()): Promise<{ assessed: number; skipped: number; error?: string }> {
  const day = beijingDate(now);
  const todayStart = beijingMidnight(day);
  const tomorrowStart = beijingMidnight(addDays(day, 1));

  if (!config.modelCallsEnabled) {
    const [{ n }] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n
      FROM publications p
      JOIN analyses an ON an.id = p.analysis_id
      WHERE p.visibility = 'public' AND ${IS_CANDIDATE} AND p.impact_score IS NULL
        AND coalesce(p.published_at, p.discovered_at) >= ${todayStart}
        AND coalesce(p.published_at, p.discovered_at) < ${tomorrowStart}`;
    return { assessed: 0, skipped: n ?? 0, error: "model disabled" };
  }

  return sql.begin(async (tx) => {
    const rows = await tx<ImpactCandidate[]>`
      SELECT p.article_id AS "articleId", p.revision, p.title, p.summary, p.fact_id AS "factId",
             an.output->>'signalReason' AS "signalReason",
             coalesce(nullif(left(coalesce(ar.body_text, ''), 60000), ''), nullif(p.summary, ''), p.title) AS "body"
      FROM publications p
      JOIN analyses an ON an.id = p.analysis_id
      JOIN articles ar ON ar.id = p.article_id
      WHERE p.visibility = 'public' AND ${IS_CANDIDATE} AND p.impact_score IS NULL
        AND coalesce(p.published_at, p.discovered_at) >= ${todayStart}
        AND coalesce(p.published_at, p.discovered_at) < ${tomorrowStart}`;

    // 多源共振：同一事实当日信号源计数（含本篇自身）。
    const factRows = await tx<{ factId: number; m: number }[]>`
      SELECT fact_id AS "factId", count(*)::int AS m
      FROM publications
      WHERE visibility = 'public' AND is_signal AND fact_id IS NOT NULL
        AND coalesce(published_at, discovered_at) >= ${todayStart}
        AND coalesce(published_at, discovered_at) < ${tomorrowStart}
      GROUP BY fact_id`;
    const factSourceCount = new Map(factRows.map((r) => [r.factId, r.m]));

    const model = await modelFor("impact");
    // 「够分量」底分：三落点强度入选门槛（独立于精选）。低于它的候选视为噪音，impact_score 记为 0，不进今日影响。
    const floor = SELECTION.impactFloor;
    let assessed = 0;
    let skipped = 0;
    for (const c of rows) {
      // 未归组（无 fact_id）的孤立信号按自身评估并记 resonanceSources=1；有 fact_id 的取当日共振源数。
      const resonanceSources = c.factId ? (factSourceCount.get(c.factId) ?? 1) : 1;
      try {
        const res = await chatJson({
          model,
          purpose: "impact_assess",
          subject: `article:${c.articleId}@${c.revision}`,
          promptVersion: IMPACT_PROMPT_VERSION,
          system: IMPACT_SYSTEM,
          user: buildImpactInput(c),
          schema: ImpactSchema,
          temperature: 0.2,
          maxTokens: 800,
        });
        const d = res.data;
        const { score } = combineImpact(d, resonanceSources);
        // 独立判断：只有某个品种真命中三落点(强度达门槛)才记为影响分，否则记 0（进「其余当日观察」）。
        const impactScore = clearsFloor(d, floor) ? score : 0;
        const assessedAt = new Date().toISOString();
        const basis = {
          verdicts: d.verdicts,
          reason_none: d.reason_none,
          resonSources: resonanceSources,
          strength: score,
          assessedAt,
        };
        await tx`
          UPDATE publications SET
            impact_score = ${impactScore},
            impact_basis = ${tx.json(basis as never)},
            revision = revision + 1
          WHERE article_id = ${c.articleId}`;
        await completeReceipt(tx, res.receiptId);
        assessed += 1;
      } catch {
        skipped += 1;
      }
    }
    return { assessed, skipped };
  });
}

/**
 * 「今日影响」：商品级独立判断——当天的每个候选都对具体品种的「利润/基差/库存」做过逐品种判断
 * （见 computeTodayImpact）。读端把候选按被影响的品种归组：选入(某品种强度达门槛)的按品种分组，
 * 影响多个品种就出现在多个组；未入选(强度不足或无关)的进 omitted「其余当日观察」带判断句。
 * category 参数在今日影响里指单品品种（铜/铝/铅/锌/镍），不再支持一手/宏观/多品种筛选。
 */
export async function loadTodayImpact(
  _channel: ChannelKey | null = null,
  category: CategoryKey | null = null,
  now = new Date(),
): Promise<TodayImpact | null> {
  const day = beijingDate(now);
  const todayStart = beijingMidnight(day);
  const tomorrowStart = beijingMidnight(addDays(day, 1));
  const floor = SELECTION.impactFloor;

  const rows = await sql<ItemRow[]>`
    SELECT ${ITEM_COLUMNS} ${ITEM_FROM}
    JOIN analyses an ON an.id = p.analysis_id
    WHERE p.visibility = 'public'
      AND ${IS_CANDIDATE}
      AND p.impact_basis IS NOT NULL
      ${category && isCommodityKey(category) ? sql`AND p.impact_basis->'verdicts' @> ${sql.json([{ commodity: category }])}` : sql``}
      AND coalesce(p.published_at, p.discovered_at) >= ${todayStart}
      AND coalesce(p.published_at, p.discovered_at) < ${tomorrowStart}
    ORDER BY p.impact_score DESC NULLS LAST, p.score DESC NULLS LAST
    LIMIT 200`;

  const selected: { row: ItemRow; verdict: ImpactCommodityAssessment }[] = [];
  const omitted: { row: ItemRow; reason: string; strength: number }[] = [];

  for (const r of rows) {
    const basis = (r.impact_basis ?? {}) as { verdicts?: ImpactCommodityAssessment[]; reason_none?: string };
    // 下钻到某品种 tab 时只看该品种的落点判断，多品种条目只在该 tab 下显示对应品种的 verdict。
    const verdicts = (basis.verdicts ?? [])
      .filter((v) => isCommodityKey(v.commodity))
      .filter((v) => !category || !isCommodityKey(category) || v.commodity === category);
    if (verdicts.length === 0) {
      // 无任何品种命中：一律按「其余观察」给出无关判断。
      const reason = basis.reason_none || `该消息与${COMMODITY_LABELS ? Object.values(COMMODITY_LABELS).join("、") : "五个品种"}的利润、基差、库存均无明显传导关系`;
      omitted.push({ row: r, reason, strength: 0 });
      continue;
    }
    const maxStrength = Math.max(0, ...verdicts.map((v) => v.strength));
    if (maxStrength < floor) {
      // 有品种判断但强度不足：进「其余观察」。
      omitted.push({ row: r, reason: verdicts.map((v) => v.reason).filter(Boolean).join("；") || basis.reason_none || "强度不足，未达入选门槛", strength: maxStrength });
      continue;
    }
    for (const v of verdicts) selected.push({ row: r, verdict: v });
  }

  if (selected.length === 0 && omitted.length === 0) return null;

  // 按品种归组；组序按词表顺序，组内按该品种落点强度降序。
  const byCommodity = new Map<string, TodayImpact["groups"][number]>();
  for (const ck of COMMODITY_KEYS) {
    if (!selected.some((s) => s.verdict.commodity === ck)) continue;
    const label = COMMODITY_LABELS[ck] ?? ck;
    const entries = selected
      .filter((s) => s.verdict.commodity === ck)
      .sort((a, b) => b.verdict.strength - a.verdict.strength)
      .map(({ row, verdict }) => {
        const item = { ...toFeedItemSummary(row), category: ck as CategoryKey, score: verdict.strength, selected: true };
        return {
          item,
          verdict: {
            commodity: verdict.commodity,
            label,
            dir: verdict.dir ?? null,
            strength: verdict.strength,
            profit: verdict.profit,
            basis: verdict.basis,
            stock: verdict.stock,
            reason: verdict.reason,
          },
        };
      });
    byCommodity.set(ck, { commodity: ck, label, entries });
  }

  const groups = COMMODITY_KEYS.filter((k) => byCommodity.has(k)).map((k) => byCommodity.get(k)!);
  const omittedOut = omitted
    .sort((a, b) => b.strength - a.strength)
    .map(({ row, reason, strength }) => ({ item: toFeedItemSummary(row), reason, strength }));

  return {
    day,
    basis: { threshold: floor, count: groups.reduce((n, g) => n + g.entries.length, 0) },
    groups,
    omitted: omittedOut,
    generatedAt: new Date().toISOString(),
  };
}