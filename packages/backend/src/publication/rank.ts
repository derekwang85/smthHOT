// 精选相对择优（selection.rank）
// 在 rankMode="relative" 时，按 industry/selection.ts 的配置，在窗口内对真信号
// （analyses.signal = true）条目按平均分相对择优，把最终入选写回 publications.selected，
// 并走与 publish.ts 完全相同的 selected 同步 ledger。
// 纯排序 + 写回状态，不调用任何模型；只在 worker 的定时任务里触发，不暴露到 API。
import { SELECTION } from "@aihot/industry/selection";
import { addDays, beijingDate, beijingMidnight } from "@aihot/contracts/time";
import { sql, type Tx } from "../db.ts";
import { sha256, stableJson } from "../lib/ids.ts";
import { appendLedger, v1Payload } from "./publish.ts";

interface RankCandidate {
  articleId: string;
  title: string;
  originalTitle: string | null;
  summary: string | null;
  reason: string | null;
  category: string | null;
  score: number | null;
  selected: boolean;
  visibleAfter: Date | null;
  publishedAt: Date | null;
  discoveredAt: Date;
  sourceName: string;
  url: string;
}

const HOUR_MS = 3_600_000;

/**
 * 把某篇文章的 selected 回写，并用与 publish.ts 一致的 ledger 同步到公开精选集：
 * advisory lock + 下一 seq 写 selected_ledger、更新 selected_state。仅当状态/载荷真的变化才写。
 */
async function applySelected(tx: Tx, c: RankCandidate, selected: boolean, now: Date): Promise<"upsert" | "remove" | null> {
  const [state] = await tx<{ in_set: boolean; payload_hash: string | null }[]>`
    SELECT in_set, payload_hash FROM selected_state WHERE article_id = ${c.articleId}`;
  if (selected) {
    const payload = v1Payload({
      articleId: c.articleId, title: c.title, originalTitle: c.originalTitle, summary: c.summary, sourceName: c.sourceName,
      url: c.url, publishedAt: c.publishedAt, discoveredAt: c.discoveredAt, category: c.category, score: c.score, selected: true, reason: c.reason,
    });
    const payloadHash = sha256(stableJson(payload));
    if (!state || !state.in_set || state.payload_hash !== payloadHash) {
      const seq = await appendLedger(tx, c.articleId, "upsert", payload, now, now);
      await tx`INSERT INTO selected_state (article_id, in_set, payload_hash, last_seq) VALUES (${c.articleId}, true, ${payloadHash}, ${seq})
               ON CONFLICT (article_id) DO UPDATE SET in_set = true, payload_hash = EXCLUDED.payload_hash, last_seq = EXCLUDED.last_seq`;
      await tx`UPDATE publications SET selected = true,
                 selected_ready_at = coalesce(selected_ready_at, now()), visible_after = coalesce(visible_after, now()),
                 revision = revision + 1
               WHERE article_id = ${c.articleId}`;
      return "upsert";
    }
  } else if (state?.in_set) {
    const seq = await appendLedger(tx, c.articleId, "remove", null, now, now);
    await tx`UPDATE selected_state SET in_set = false, payload_hash = NULL, last_seq = ${seq} WHERE article_id = ${c.articleId}`;
    await tx`UPDATE publications SET selected = false, revision = revision + 1 WHERE article_id = ${c.articleId}`;
    return "remove";
  }
  return null;
}

export interface RecomputeSelectedResult {
  mode: "relative" | "threshold";
  windowStart: string;
  signals: number;
  picked: number;
  upserted: number;
  removed: number;
  fellBack: boolean;
}

/**
 * 重算窗口内的精选入选。阈值模式直接返回（绝对门槛在 publish 时已应用）；
 * relative 模式：窗口内真信号数 >= minItems 时按平均分降序取前 topPercent（且平均分 >= floorAbs），
 * 对不在 keep-alive 窗口内的条目做入选/退选；信号数不足时回退 threshold 口径（什么都不做）。
 */
export async function recomputeSelected(nowVal = new Date()): Promise<RecomputeSelectedResult> {
  if (SELECTION.rankMode === "threshold") {
    return { mode: "threshold", windowStart: "", signals: 0, picked: 0, upserted: 0, removed: 0, fellBack: false };
  }
  const now = nowVal;
  const day = beijingDate(now);
  // 窗口起点：rolling24h = 近 24 小时；slot_backfill_day = 当天 00:00（Asia/Shanghai）起。
  const windowStart = SELECTION.rankWindow === "rolling24h"
    ? new Date(now.getTime() - 24 * HOUR_MS)
    : beijingMidnight(day);
  const windowEnd = SELECTION.rankWindow === "rolling24h"
    ? now
    : beijingMidnight(addDays(day, 1));

  const candidates = await sql<RankCandidate[]>`
    SELECT p.article_id AS "articleId", p.title, p.original_title AS "originalTitle", p.summary, p.reason, p.category, p.score,
           p.selected, p.visible_after AS "visibleAfter", p.published_at AS "publishedAt", p.discovered_at AS "discoveredAt",
           s.name AS "sourceName", p.url
    FROM publications p
    JOIN analyses a ON a.id = p.analysis_id
    JOIN sources s ON s.id = p.source_id
    WHERE a.signal = true
      AND p.visibility = 'public'
      AND coalesce(p.published_at, p.discovered_at) >= ${windowStart}
      AND coalesce(p.published_at, p.discovered_at) < ${windowEnd}`;

  // 窗口内真信号太少：不做相对择优，回退阈值口径（publish 时已应用的绝对门槛就是兜底）。
  if (candidates.length < SELECTION.minItems) {
    return { mode: "relative", windowStart: windowStart.toISOString(), signals: candidates.length, picked: 0, upserted: 0, removed: 0, fellBack: true };
  }

  // keep-alive：已入选且公开未满 selectedKeepHours 的条目优先保留，永不主动退选。
  const keepMs = SELECTION.selectedKeepHours * HOUR_MS;
  const keepAlive = new Set(
    candidates
      .filter((c) => c.selected && (c.visibleAfter === null || now.getTime() - c.visibleAfter.getTime() < keepMs))
      .map((c) => c.articleId),
  );
  const pool = candidates.filter((c) => !keepAlive.has(c.articleId));

  // 池内按平均分降序，取前 topPercent 比例且平均分 >= floorAbs 的作为新的 selected 目标。
  pool.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  const n = Math.max(1, Math.ceil(pool.length * SELECTION.topPercent));
  const floor = SELECTION.floorAbs;
  const target = new Set(
    pool.filter((c, i) => i < n && c.score !== null && c.score >= floor).map((c) => c.articleId),
  );

  let upserted = 0;
  let removed = 0;
  await sql.begin(async (tx) => {
    for (const c of pool) {
      const want = target.has(c.articleId);
      if (want && !c.selected && (await applySelected(tx, c, true, now))) upserted += 1;
      if (!want && c.selected && (await applySelected(tx, c, false, now))) removed += 1;
    }
  });

  return {
    mode: "relative",
    windowStart: windowStart.toISOString(),
    signals: candidates.length,
    picked: target.size,
    upserted,
    removed,
    fellBack: false,
  };
}