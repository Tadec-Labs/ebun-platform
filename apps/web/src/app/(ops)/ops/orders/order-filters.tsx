import Link from "next/link";
import { ORDER_STATUS_GROUPS, ORDER_STATUS_LABEL } from "@/lib/ops/types";
import type { OrderStatusValue } from "@/lib/ops/types";

/**
 * A plain GET form, not a client component.
 *
 * Submitting puts the filters in the URL, which means a filtered view
 * is a link: it can be bookmarked, pasted into a message, and survives
 * a refresh. A client component holding filter state in `useState`
 * would give up all three and buy nothing — there is no interaction
 * here that needs JavaScript. `offset` is deliberately not carried
 * over; changing a filter should go back to page one.
 */
export function OrderFilters({
  search,
  from,
  to,
  statuses,
  stuck,
  stuckAfterMinutes,
}: {
  search: string;
  from: string;
  to: string;
  statuses: OrderStatusValue[];
  stuck: boolean;
  stuckAfterMinutes: number;
}) {
  const selected = new Set(statuses);
  const anyFilter = search || from || to || statuses.length > 0 || stuck;

  return (
    <form
      method="get"
      action="/ops/orders"
      className="mb-5 rounded border border-zinc-200 bg-white p-4"
    >
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex-1 basis-56">
          <span className="mb-1 block text-xs font-medium text-zinc-600">
            Order number, recipient name or phone
          </span>
          <input
            type="search"
            name="search"
            defaultValue={search}
            placeholder="EBN-0042, Ada, +23480…"
            className="w-full rounded border border-zinc-300 px-2.5 py-1.5"
          />
        </label>
        <label>
          <span className="mb-1 block text-xs font-medium text-zinc-600">
            From
          </span>
          <input
            type="date"
            name="from"
            defaultValue={from}
            className="rounded border border-zinc-300 px-2.5 py-1.5"
          />
        </label>
        <label>
          <span className="mb-1 block text-xs font-medium text-zinc-600">
            To
          </span>
          <input
            type="date"
            name="to"
            defaultValue={to}
            className="rounded border border-zinc-300 px-2.5 py-1.5"
          />
        </label>
        <button
          type="submit"
          className="rounded bg-zinc-900 px-4 py-2 font-medium text-white"
        >
          Apply
        </button>
        {anyFilter && (
          <Link
            href="/ops/orders"
            className="px-1 py-2 text-zinc-600 underline-offset-2 hover:underline"
          >
            Clear
          </Link>
        )}
      </div>

      <label className="mt-3 flex items-center gap-2">
        <input
          type="checkbox"
          name="stuck"
          value="true"
          defaultChecked={stuck}
        />
        <span>
          Only orders stuck in fulfilment for over {stuckAfterMinutes} minutes
        </span>
      </label>

      <details open={selected.size > 0} className="mt-3">
        <summary className="cursor-pointer text-zinc-600 select-none">
          Status{selected.size > 0 ? ` · ${selected.size} selected` : ""}
        </summary>
        <div className="mt-2 space-y-2.5">
          {ORDER_STATUS_GROUPS.map((group) => (
            <div key={group.label}>
              <div className="mb-1 text-xs tracking-wide text-zinc-500 uppercase">
                {group.label}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {group.statuses.map((status) => (
                  <label key={status} className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      name="status"
                      value={status}
                      defaultChecked={selected.has(status)}
                    />
                    <span>{ORDER_STATUS_LABEL[status]}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      </details>
    </form>
  );
}
