// Public read layer: "今日影响" — the few selected items with the day's highest editorial
// attention scores (mean score above the T1_5 floor), as judged this session. Nothing until a
// selected item clears the bar today; the page reads this through the shared read layer only.
import type { TodayImpact } from "@aihot/contracts/site";
import { addDays, beijingDate, beijingMidnight } from "@aihot/contracts/time";
import { SELECTION } from "@aihot/industry/selection";
import { sql } from "../db.ts";
import { ITEM_COLUMNS, ITEM_FROM, selectedCondition, toFeedItemSummary, type ItemRow } from "./items.ts";

/** Top "today impact" picks: today's `p.selected` items by editorial mean score, above the T1_5 floor. */
export async function loadTodayImpact(now = new Date()): Promise<TodayImpact | null> {
  const day = beijingDate(now);
  const todayStart = beijingMidnight(day);
  const tomorrowStart = beijingMidnight(addDays(day, 1));
  // The flag "editorial" (p.score) already gates by selection tier in the worker; T1_5 is the
  // floor that separates the handful most worth a reader's attention today. Only the exact
  // semantic of "today's published/selected items" is in this file — the number lives in industry.
  const floor = SELECTION.thresholds.T1_5;

  const rows = await sql<ItemRow[]>`
    SELECT ${ITEM_COLUMNS} ${ITEM_FROM}
    WHERE ${selectedCondition(now)}
      AND coalesce(p.published_at, p.discovered_at) >= ${todayStart}
      AND coalesce(p.published_at, p.discovered_at) < ${tomorrowStart}
    ORDER BY p.score DESC NULLS LAST
    LIMIT 5`;

  // Adaptive gate: no big event today → don't push an empty "impact".
  if (rows.length === 0) return null;

  const entries = rows.map(toFeedItemSummary);
  return { day, basis: { threshold: floor, count: entries.length }, entries, generatedAt: new Date().toISOString() };
}