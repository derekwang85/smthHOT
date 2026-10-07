// "今日影响":与精选独立的商品级编辑判断——对每个当日候选逐品种判断「利润/基差/库存」传导，
// 按品种归组展示，影响多品种的信息在多个品种下重复出现；未入选的进折叠的「其余当日观察」。
// 页头(标题+筛选条)由 /impact 路由负责；本组件只渲染分组列表与其余观察。
import { useState } from "react";
import type { TodayImpact as TodayImpactData } from "@aihot/contracts/site";
import { FeedItem } from "./FeedItem";
import { EmptyState } from "../../components/ui/Page";
import { Badge } from "../../components/ui/Badge";

/** 方向徽标：多/空/中性。 */
function DirTag({ dir }: { dir: "bull" | "bear" | "neutral" | null }) {
  if (dir === "bull") return <span className="rounded-full bg-rose-500/10 px-2 py-0.5 text-[11px] font-semibold text-rose-500">利多</span>;
  if (dir === "bear") return <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-500">利空</span>;
  if (dir === "neutral") return <span className="rounded-full bg-ink-4/10 px-2 py-0.5 text-[11px] font-semibold text-ink-4">中性</span>;
  return null;
}

/** 单个落点的强度角标（利润/基差/库存）。 */
function PointChip({ label, value }: { label: string; value: number }) {
  if (!value) return null;
  const strong = value >= 60;
  return (
    <span className={`rounded bg-bg-sunk px-1.5 py-0.5 text-[11px] ${strong ? "font-semibold text-ink" : "text-ink-3"}`}>
      {label} <span className="num">{value}</span>
    </span>
  );
}

export function TodayImpact({
  impact,
  intro,
  filtered = false,
}: {
  impact: TodayImpactData | null;
  intro?: string;
  /** 当前是否正按品种筛选；影响空态措辞。 */
  filtered?: boolean;
}) {
  const [showOmitted, setShowOmitted] = useState(false);
  const hasGroups = !!impact && impact.groups.length > 0;
  const omittedCount = impact?.omitted.length ?? 0;

  if (!hasGroups) {
    return (
      <div className="card">
        <EmptyState title={filtered ? "这个品种今天还没有够分量的大事" : "今天还没有够分量的大事"}>
          {filtered ? "换个品种看看，或到反馈页告诉我们遗漏。" : "觉得有哪些遗漏，欢迎到反馈页告诉我们。"}
        </EmptyState>
      </div>
    );
  }

  return (
    <>
      <p className="mb-3 text-[12.5px] leading-snug text-ink-4">{intro}</p>

      {impact!.groups.map((group) => (
        <section key={group.commodity} className="mb-6" aria-label={`${group.label}今日影响`}>
          <h3 className="mb-2 flex items-center gap-2 text-[15px] font-semibold text-ink">
            <Badge tone="accent">{group.label}</Badge>
            <span className="num text-[12.5px] font-normal text-ink-4">{group.entries.length} 条</span>
          </h3>
          <ol className="divide-y divide-line-soft lg:space-y-4 lg:divide-y-0">
            {group.entries.map(({ item, verdict }) => (
              <li key={`${group.commodity}:${item.id}`} className="py-2.5 lg:py-0">
                <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                  <DirTag dir={verdict.dir} />
                  <PointChip label="利润" value={verdict.profit} />
                  <PointChip label="基差" value={verdict.basis} />
                  <PointChip label="库存" value={verdict.stock} />
                </div>
                {verdict.reason && <p className="mb-1.5 text-[12.5px] leading-snug text-ink-3">判断：{verdict.reason}</p>}
                <FeedItem item={item} filters={{ channel: "all", category: null, tag: null }} />
              </li>
            ))}
          </ol>
        </section>
      ))}

      {omittedCount > 0 && (
        <section className="mt-8 border-t border-line-soft pt-3" aria-label="其余当日观察">
          <button
            type="button"
            onClick={() => setShowOmitted((v) => !v)}
            aria-expanded={showOmitted}
            className="flex w-full items-center justify-between rounded-lg px-1 py-2 text-left text-[13.5px] font-medium text-ink-3 transition-colors hover:text-ink"
          >
            <span>其余当日观察（已判断，未入选 {omittedCount} 条）</span>
            <span className={`text-ink-4 transition-transform ${showOmitted ? "rotate-180" : ""}`} aria-hidden>▾</span>
          </button>
          {showOmitted && (
            <ol className="divide-y divide-line-soft">
              {impact!.omitted.map((o) => (
                <li key={o.item.id} className="py-2.5">
                  {o.reason && <p className="mb-1.5 text-[12.5px] leading-snug text-ink-3">判断：{o.reason}</p>}
                  <FeedItem item={o.item} filters={{ channel: "all", category: null, tag: null }} />
                </li>
              ))}
            </ol>
          )}
        </section>
      )}
    </>
  );
}