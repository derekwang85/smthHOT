// 今日影响：与精选**独立**的商品级编辑判断——对每个当日候选（精选信号 + 过了内容理解底分的文章）
// 逐一判断它影响哪些品种的「利润/基差/库存」、方向怎样、传导逻辑，并按品种归组；影响多个品种的
// 信息在多个品种下重复出现；未入选的进「其余当日观察」。数据来自总览 timeline（impact=1）。
// 筛选条只保留「汇总 + 单品品种」，一览与精选首页对齐。
import { useLoaderData } from "react-router";
import type { Route } from "./+types/impact";
import type { TimelineResponse } from "@aihot/contracts/site";
import { isCategoryKey } from "@aihot/contracts/taxonomy";
import { loadOr404, queryString } from "../lib/api.server";
import { pageMeta } from "../lib/seo";
import { monthDayTime } from "../lib/format";
import { ImpactTabs } from "../features/feed/Filters";
import { TodayImpact } from "../features/feed/TodayImpact";

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const categoryParam = url.searchParams.get("category");
  const category = categoryParam && isCategoryKey(categoryParam) ? categoryParam : null;
  const data = await loadOr404<TimelineResponse>(
    `/api/site/timeline${queryString({ impact: "1", category })}`,
    { signal: request.signal },
  );
  return { impact: data.impact, category };
}

export function meta() {
  return pageMeta({
    title: "今日影响",
    description: "按品种归类的商品级判断：每条大事落到影响哪些品种的利润、基差、库存。",
    path: "/impact",
  });
}

export function headers() {
  return { "Cache-Control": "public, max-age=0, s-maxage=120, stale-while-revalidate=60" };
}

export default function ImpactPage() {
  const { impact, category } = useLoaderData<typeof loader>();
  const title = "今日影响";
  const intro = `按品种归类的独立判断：每条大事落到冲击哪些品种的利润、基差、库存${impact && impact.basis.threshold > 0 ? ` · 入选强度 ≥ ${impact.basis.threshold}` : ""}${impact?.generatedAt ? ` · ${monthDayTime(impact.generatedAt)} 更新` : ""}`;
  return (
    <div className="pb-6">
      {/* Desktop: 与精选首页一致的大标题 + 品种筛选条（汇总+5品种）。 */}
      <div className="hidden lg:block">
        <h1 className="text-[24px] font-semibold leading-[1.3] text-ink">{title}</h1>
        <div className="mb-5 mt-4 flex items-center gap-4">
          <ImpactTabs base="/impact" category={category} layoutId="impact-cat-desk" className="min-w-0" />
        </div>
      </div>

      {/* Phones: 标题 + 横向滑动的品种筛选条。 */}
      <h2 className="mt-6 text-[20px] font-bold text-ink lg:hidden">{title}</h2>
      <div className="-mx-4 mt-3 flex items-center gap-2 pl-4 pr-2 lg:hidden">
        <ImpactTabs base="/impact" category={category} layoutId="impact-cat-mobile" size="sm" className="min-w-0 flex-1" />
      </div>

      <TodayImpact impact={impact} intro={intro} filtered={!!category} />
    </div>
  );
}