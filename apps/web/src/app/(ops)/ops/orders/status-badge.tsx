import { ORDER_STATUS_LABEL, ORDER_STATUS_TONE } from "@/lib/ops/types";
import type { OrderStatusValue, StatusTone } from "@/lib/ops/types";

const TONE_CLASS: Record<StatusTone, string> = {
  green: "bg-emerald-50 text-emerald-800 ring-emerald-600/20",
  blue: "bg-sky-50 text-sky-800 ring-sky-600/20",
  amber: "bg-amber-50 text-amber-900 ring-amber-600/25",
  red: "bg-red-50 text-red-800 ring-red-600/20",
  grey: "bg-zinc-100 text-zinc-700 ring-zinc-500/20",
};

export function StatusBadge({ status }: { status: OrderStatusValue }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset ${TONE_CLASS[ORDER_STATUS_TONE[status]] ?? TONE_CLASS.grey}`}
    >
      {ORDER_STATUS_LABEL[status] ?? status}
    </span>
  );
}

export function StuckBadge({ minutes }: { minutes: number }) {
  return (
    <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-red-900 ring-1 ring-red-600/30 ring-inset">
      Stuck &gt;{minutes}m
    </span>
  );
}
