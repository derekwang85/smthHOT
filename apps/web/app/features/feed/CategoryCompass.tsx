// 品种罗盘：首页热点下方的一排紧凑品种快捷入口。数据复用已有的分类维度
// （@aihot/contracts/taxonomy 的 CATEGORY_KEYS / CATEGORY_LABELS），点击跳到
// /?category=<key>，与筛选栏行为一致。移动端横滑一行，桌面多列。
import { Link } from "react-router";
import { CATEGORY_KEYS, CATEGORY_LABELS } from "@aihot/contracts/taxonomy";

export function CategoryCompass({ base = "/", current }: { base?: string; current?: string | null }) {
  return (
    <nav aria-label="品种罗盘" className="card mb-6 overflow-hidden px-4 py-3 lg:px-5">
      <h2 className="mb-2.5 text-[13px] font-semibold text-ink-3">品种罗盘</h2>
      <ul className="-mb-1 flex gap-2 overflow-x-auto pb-1 lg:flex-wrap lg:overflow-visible lg:pb-0">
        {CATEGORY_KEYS.map((key) => {
          const active = current === key;
          return (
            <li key={key} className="shrink-0">
              <Link
                to={`${base}?category=${key}`}
                aria-current={active ? "page" : undefined}
                className={`inline-flex items-center whitespace-nowrap rounded-tile border px-3 py-1.5 text-[13px] leading-none transition-colors ${
                  active
                    ? "border-accent bg-accent-soft font-medium text-accent"
                    : "border-line-strong bg-surface text-ink-2 hover:border-ink-4 hover:text-ink"
                }`}
              >
                {CATEGORY_LABELS[key]}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}