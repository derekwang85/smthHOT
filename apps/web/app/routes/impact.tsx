// 今日影响：当天精选里被编辑判断为最可能影响市场走向的几件大事。数据来自总览 timeline
// （不筛选时返回 impact）；没有够分量的大事时渲染空态框架（含品种罗盘入口），不影响整页。
import { useLoaderData } from "react-router";
import type { TimelineResponse } from "@aihot/contracts/site";
import { loadOr404 } from "../lib/api.server";
import { pageMeta } from "../lib/seo";
import { monthDayTime } from "../lib/format";
import { TodayImpact } from "../features/feed/TodayImpact";

export async function loader({ request }: { request: Request }) {
  const data = await loadOr404<TimelineResponse>("/api/site/timeline", { signal: request.signal });
  return { impact: data.impact };
}

export function meta() {
  return pageMeta({
    title: "今日影响",
    description: "当日精选里，最可能影响市场走向的几件事。",
    path: "/impact",
  });
}

export function headers() {
  return { "Cache-Control": "public, max-age=0, s-maxage=120, stale-while-revalidate=60" };
}

export default function ImpactPage() {
  const { impact } = useLoaderData<typeof loader>();
  return (
    <div className="pb-10 pt-5 lg:pt-1">
      <TodayImpact
        impact={impact}
        heading="h1"
        title="今日影响"
        showLink={false}
        showCompass
        intro={`当日精选里，最可能影响市场走向的几件事${impact && impact.basis.threshold > 0 ? ` · 编辑关注度 ≥ ${impact.basis.threshold}` : ""}${impact?.generatedAt ? ` · ${monthDayTime(impact.generatedAt)} 更新` : ""}`}
      />
    </div>
  );
}