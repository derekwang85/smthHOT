// Public vocabularies shared by the website, the API and the worker. The categories themselves belong to
// the industry pack (industry/taxonomy.ts); their keys are external identities (URLs, API, RSS).
import { CATEGORIES } from "@aihot/industry/taxonomy";

export type CategoryKey = (typeof CATEGORIES)[number]["key"];
export const CATEGORY_KEYS = CATEGORIES.map((c) => c.key) as unknown as readonly [CategoryKey, ...CategoryKey[]];

/** Website tab labels. */
export const CATEGORY_LABELS = Object.fromEntries(CATEGORIES.map((c) => [c.key, c.label])) as Record<CategoryKey, string>;

/** The public API, RSS and MCP use the same categories as the website. */
export const PUBLIC_API_CATEGORY_KEYS = CATEGORY_KEYS;
export type PublicApiCategoryKey = CategoryKey;

export function toPublicApiCategory(category: string | null): PublicApiCategoryKey | null {
  return isCategoryKey(category) ? category : null;
}

export function isCategoryKey(value: unknown): value is CategoryKey {
  return typeof value === "string" && (CATEGORY_KEYS as readonly string[]).includes(value);
}

// ── 品种（commodity）词表 ────────────────────────────────────────────────────────
// 今日影响把每条候选都归并到具体品种，不再保留「宏观/多品种」大类。品种 = 类别里除
// macro/multi 外的单品种；换行业时若单品种含义变化，在这里调整排除规则即可。
const NON_COMMODITY_KEYS = new Set<CategoryKey>(["macro", "multi"]);
/** 单品种 key（copper/aluminum/lead/zinc/nickel…）。 */
export const COMMODITY_KEYS = CATEGORIES.filter((c) => !NON_COMMODITY_KEYS.has(c.key)).map((c) => c.key) as readonly string[];
/** 单品种显示名（铜/铝/铅/锌/镍…）。 */
export const COMMODITY_LABELS = Object.fromEntries(CATEGORIES.filter((c) => (COMMODITY_KEYS as readonly string[]).includes(c.key)).map((c) => [c.key, c.label])) as Record<string, string>;
/** 是否单品品种 key。 */
export function isCommodityKey(value: unknown): value is string {
  return typeof value === "string" && (COMMODITY_KEYS as readonly string[]).includes(value);
}

export const CHANNEL_KEYS = ["all", "news", "x", "firstParty"] as const;
export type ChannelKey = (typeof CHANNEL_KEYS)[number];

export const CHANNEL_LABELS: Record<ChannelKey, string> = {
  all: "全部",
  news: "资讯",
  x: "X",
  firstParty: "一手",
};

export function isChannelKey(value: unknown): value is ChannelKey {
  return typeof value === "string" && (CHANNEL_KEYS as readonly string[]).includes(value);
}

export const LEADERBOARD_PUBLIC_BOARDS = ["overall", "coding", "reasoning", "knowledge", "professional"] as const;
export type LeaderboardBoardKey = (typeof LEADERBOARD_PUBLIC_BOARDS)[number];

export const LEADERBOARD_BOARD_LABELS: Record<LeaderboardBoardKey, string> = {
  overall: "综合",
  coding: "编程",
  reasoning: "推理",
  knowledge: "知识",
  professional: "专业办公",
};

/** Article ids. Also the local-data import validation pattern. */
export const ARTICLE_ID_PATTERN = /^[a-zA-Z0-9_-]{1,80}$/;

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
