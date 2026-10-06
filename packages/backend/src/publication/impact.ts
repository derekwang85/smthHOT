// Public read layer + impact job: "今日影响".
//   - Today's impact list = 当日信号条目（public）按「冲击传导分」排序：已评估冲击分的排前
//     （impact_score DESC），未评估的回落到编辑均分（score DESC），LIMIT 5。注意力分与 T1_5
//     门槛的语义保留在 basis 里供前端解释。
//   - computeTodayImpact 是 worker 的定时 job（见 apps/worker/src/schedules.ts 的 impact.assess）：
//     只写 publications（impact_score / impact_basis / revision），不新增对外读；模型调用走
//     chatJson + completeReceipt，reader 页面不触发。
import { z } from "zod";
import type { TodayImpact } from "@aihot/contracts/site";
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

/** 供6需4：供给侧事件（减产/停产/出口管制/新矿/物流/天气）供给侧权重大；宏观/政策两侧都可能。 */
export const sideWeights = { supply: 0.6, demand: 0.4 } as const;
/** 多源共振：同一事实(fact_id)当日信号源 >= RESONANCE_THRESHOLD 时，冲击分上浮 RESONANCE_BOOST。 */
export const RESONANCE_THRESHOLD = 2;
export const RESONANCE_BOOST = 1.15;

/** 模型给一篇信号条目的冲击传导评估；缺字段用 .catch 兜底，不让单篇没分或让整批失败。 */
export const ImpactSchema = z.object({
  kind: z.enum(["supply", "demand", "macro", "price-only"]).catch("price-only"),
  hit: z.array(z.enum(["stock", "basis", "margin"])).catch([]),
  supplyImpact: z.coerce.number().int().min(0).max(100).catch(0),
  demandImpact: z.coerce.number().int().min(0).max(100).catch(0),
  summary: z.string().max(160).catch(""),
});
export type ImpactAssessment = z.infer<typeof ImpactSchema>;

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

/** 冲击传导分：供6需4加权，多源共振加成，四舍五入取整再 clamp 0–100，落 numeric(5,2)。 */
function combineImpact(d: ImpactAssessment, resonanceSources: number): { score: number; resonance: number } {
  const resonance = resonanceSources >= RESONANCE_THRESHOLD ? RESONANCE_BOOST : 1;
  const raw = (sideWeights.supply * d.supplyImpact + sideWeights.demand * d.demandImpact) * resonance;
  return { score: Math.max(0, Math.min(100, Math.round(raw))), resonance };
}

/**
 * 评估当日信号条目（含未精选）的冲击传导，把 impact_score / impact_basis 写回 publications。
 * 用 sql.begin 事务包住查询与写回；单篇失败 try/catch 跳过，不让整批失败（计入 skipped）。
 * 安全阀：config.modelCallsEnabled 为 false 时不调用 chatJson（避免验证阶段触发真实模型），
 * 只统计有多少候选本来待评估并返回 "model disabled"。
 */
export async function computeTodayImpact(now = new Date()): Promise<{ assessed: number; skipped: number; error?: string }> {
  const day = beijingDate(now);
  const todayStart = beijingMidnight(day);
  const tomorrowStart = beijingMidnight(addDays(day, 1));

  if (!config.modelCallsEnabled) {
    const [{ n }] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n
      FROM publications p
      JOIN analyses a ON a.id = p.analysis_id
      WHERE p.visibility = 'public' AND p.is_signal AND p.impact_score IS NULL
        AND coalesce(p.published_at, p.discovered_at) >= ${todayStart}
        AND coalesce(p.published_at, p.discovered_at) < ${tomorrowStart}`;
    return { assessed: 0, skipped: n ?? 0, error: "model disabled" };
  }

  return sql.begin(async (tx) => {
    const rows = await tx<ImpactCandidate[]>`
      SELECT p.article_id AS "articleId", p.revision, p.title, p.summary, p.fact_id AS "factId",
             a.output->>'signalReason' AS "signalReason",
             coalesce(nullif(left(coalesce(ar.body_text, ''), 60000), ''), nullif(p.summary, ''), p.title) AS "body"
      FROM publications p
      JOIN analyses a ON a.id = p.analysis_id
      JOIN articles ar ON ar.id = p.article_id
      WHERE p.visibility = 'public' AND p.is_signal AND p.impact_score IS NULL
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
        const assessedAt = new Date().toISOString();
        await tx`
          UPDATE publications SET
            impact_score = ${score},
            impact_basis = ${tx.json({ kind: d.kind, hit: d.hit, resonSources: resonanceSources, assessedAt } as never)},
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

/** Top "today impact" picks: today's signal items by impact_score (falling back to editorial mean
 *  score when not yet assessed), above the T1_5 floor. */
export async function loadTodayImpact(now = new Date()): Promise<TodayImpact | null> {
  const day = beijingDate(now);
  const todayStart = beijingMidnight(day);
  const tomorrowStart = beijingMidnight(addDays(day, 1));
  // Phase 2: 今日影响 = 当日信号条目按冲击传导分排序（未评估的回落编辑均分）。T1_5 仍作门槛，
  // 标出最值得读者花时间的那几条。
  const floor = SELECTION.thresholds.T1_5;

  const rows = await sql<ItemRow[]>`
    SELECT ${ITEM_COLUMNS} ${ITEM_FROM}
    WHERE p.visibility = 'public'
      AND p.is_signal
      AND coalesce(p.published_at, p.discovered_at) >= ${todayStart}
      AND coalesce(p.published_at, p.discovered_at) < ${tomorrowStart}
    ORDER BY p.impact_score DESC NULLS LAST, p.score DESC NULLS LAST
    LIMIT 5`;

  // Adaptive gate: no big event today → don't push an empty "impact".
  if (rows.length === 0) return null;

  const entries = rows.map(toFeedItemSummary);
  return { day, basis: { threshold: floor, count: entries.length }, entries, generatedAt: new Date().toISOString() };
}