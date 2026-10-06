// "今日影响":当日精选里被编辑判断为最可能影响市场走向的几件大事。
// 首页/独立页把它作为「今日影响」板块;无论当天有没有够分量的大事,
// 板块框架(含品种罗盘入口)始终渲染——没有大事时显示空态,而非整块消失。
import type { TodayImpact as TodayImpactData } from "@aihot/contracts/site";
import { FeedItem } from "./FeedItem";
import { CategoryCompass } from "./CategoryCompass";
import { MoreLink, EmptyState } from "../../components/ui/Page";

export function TodayImpact({
  impact,
  heading: Heading = "h2",
  title = "今日影响",
  intro,
  showLink = true,
  className = "",
  showCompass = false,
}: {
  impact: TodayImpactData | null;
  heading?: "h1" | "h2" | "h3";
  title?: string;
  intro?: string;
  showLink?: boolean;
  className?: string;
  /** 在区块内是否渲染品种罗盘入口(首页/今日影响页置顶用);精选 feed 上不重复放。 */
  showCompass?: boolean;
}) {
  const hasEntries = !!impact && impact.entries.length > 0;
  const basisHint =
    impact && impact.basis.threshold > 0 ? ` · 编辑关注度 ≥ ${impact.basis.threshold}` : "";
  return (
    <section aria-labelledby="today-impact" className={`mb-6 ${className}`}>
      <div className="mb-1.5 flex items-center justify-between">
        <Heading id="today-impact" className="flex items-center gap-2 text-[14px] font-semibold text-ink">
          <span className="relative flex size-2" aria-hidden="true">
            <span className="relative inline-flex size-2 rounded-full bg-accent" />
          </span>
          {title}
        </Heading>
        {showLink && <MoreLink to="/impact">完整列表</MoreLink>}
      </div>
      {hasEntries ? (
        <>
          <p className="mb-3 text-[12.5px] leading-snug text-ink-4">{intro ?? `当日精选里，最可能影响市场走向的几件事${basisHint}`}</p>
          <ol className="divide-y divide-line-soft lg:space-y-4 lg:divide-y-0">
            {impact.entries.map((entry) => (
              <li key={entry.id} className="py-2.5 lg:py-0">
                <FeedItem item={entry} />
              </li>
            ))}
          </ol>
        </>
      ) : (
        <div className="card">
          <EmptyState title="今天还没有够分量的大事">
            觉得有哪些遗漏，欢迎到反馈页告诉我们。
          </EmptyState>
        </div>
      )}
      {/* 品种罗盘移入「今日影响」板块：当天没有大事时，罗盘仍是进入各品种页的入口。 */}
      {showCompass && <CategoryCompass current={null} />}
    </section>
  );
}