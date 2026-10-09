import { ORDER_STATUS_LABEL, ORDER_STATUS_TONE } from "@/lib/ops/types";
import type { OrderStatusValue, StatusTone } from "@/lib/ops/types";

const TONE_CLASS: Record<StatusTone, string> = {
  green: "border-emerald-300 bg-emerald-50 text-emerald-800",
  blue: "border-sky-300 bg-sky-50 text-sky-800",
  amber: "border-amber-300 bg-amber-50 text-amber-900",
  red: "border-red-300 bg-red-50 text-red-800",
  grey: "border-zinc-300 bg-zinc-100 text-zinc-600",
};

export function StatusBadge({ status }: { status: OrderStatusValue }) {
  return (
    <span
      className={`inline-block rounded border px-1.5 py-0.5 text-xs whitespace-nowrap ${TONE_CLASS[ORDER_STATUS_TONE[status]]}`}
    >
      {ORDER_STATUS_LABEL[status] ?? status}
    </span>
  );
}

export function StuckBadge({ minutes }: { minutes: number }) {
  return (
    <span className="inline-block rounded border border-red-400 bg-red-100 px-1.5 py-0.5 text-xs font-medium whitespace-nowrap text-red-900">
      Stuck &gt;{minutes}m
    </span>
  );
}
