"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Modal, Spinner, useToast } from "@/components/ui/feedback";
import { formatNaira } from "@/lib/format-money";
import { formatWhen } from "@/lib/ops/format-time";
import {
  REFUND_REASON_LABEL,
  type OrderRefund,
  type OrderRefunds,
  type RefundReasonCategory,
} from "@/lib/ops/types";
import { refundOrderAction } from "../../actions";

const STATUS_TEXT: Record<OrderRefund["status"], string> = {
  pending: "Starting",
  processing: "With Paystack — money on its way back",
  completed: "Refunded",
  failed: "Didn't go through",
};

const STATUS_TONE: Record<OrderRefund["status"], string> = {
  pending: "bg-amber-50 text-amber-900",
  processing: "bg-amber-50 text-amber-900",
  completed: "bg-emerald-50 text-emerald-900",
  failed: "bg-red-50 text-red-800",
};

/**
 * Refund this order: everything the sender paid, back where it came from.
 *
 * One deliberate step in a dialog — reason first, then the button names
 * the amount — because it moves money and voids the recipient's gift.
 * Not offered once a partner has handed it over (the API refuses too):
 * that would pay twice.
 */
export function RefundPanel({ orderId, initial }: { orderId: string; initial: OrderRefunds }) {
  const router = useRouter();
  const toast = useToast();
  const [state, setState] = useState(initial);
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<RefundReasonCategory>("vendor_failure");
  const [reason, setReason] = useState("");
  const [manual, setManual] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();

  function submit() {
    setErrors([]);
    startTransition(async () => {
      const result = await refundOrderAction({
        orderId,
        reasonCategory: category,
        reason,
        alreadyRefundedInPaystack: manual,
      });
      if (!result.ok) {
        setErrors(result.errors);
        return;
      }
      setState(result.refunds);
      setOpen(false);
      setReason("");
      setManual(false);
      toast.success(manual ? "Refund recorded. The order is closed." : "Refund sent to Paystack.");
      router.refresh();
    });
  }

  return (
    <section className="mb-6 rounded border border-zinc-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-medium">Refund</h2>
          <p className="text-zinc-600">
            {state.cannotRefundBecause ??
              `Returns ${formatNaira(state.refundAmount)} — everything the sender paid — and cancels the gift.`}
          </p>
        </div>
        {state.cannotRefundBecause === null && (
          <button
            type="button"
            onClick={() => {
              setErrors([]);
              setOpen(true);
            }}
            className="rounded-lg border border-red-300 px-4 py-2 font-medium text-red-700 hover:bg-red-50"
          >
            Refund {formatNaira(state.refundAmount)}
          </button>
        )}
      </div>

      {state.refunds.length > 0 && (
        <ul className="mt-4 divide-y divide-zinc-100 rounded border border-zinc-200">
          {state.refunds.map((refund) => (
            <li key={refund.id} className="flex flex-col gap-1 px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{formatNaira(refund.amount)}</span>
                <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_TONE[refund.status]}`}>
                  {refund.recordedManually ? "Refunded in Paystack dashboard" : STATUS_TEXT[refund.status]}
                </span>
                <span className="text-xs text-zinc-500">{formatWhen(refund.createdAt)}</span>
              </div>
              <p className="text-zinc-600">
                {refund.reasonCategory ? `${REFUND_REASON_LABEL[refund.reasonCategory]}: ` : ""}
                {refund.reason}
              </p>
              {refund.problem && <p className="text-sm font-medium text-red-800">{refund.problem}</p>}
            </li>
          ))}
        </ul>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Refund this order?" dismissible={!pending}>
        <div className="flex flex-col gap-4 text-sm">
          <p className="leading-relaxed text-zinc-600">
            {formatNaira(state.refundAmount)} goes back to the card or account that paid. The recipient&rsquo;s gift
            stops working straight away, so it can&rsquo;t be collected or delivered after this. If Paystack refuses,
            nothing changes.
          </p>
          <label className="flex flex-col gap-1">
            <span className="font-medium">Why</span>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as RefundReasonCategory)}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-2"
            >
              {(Object.keys(REFUND_REASON_LABEL) as RefundReasonCategory[]).map((key) => (
                <option key={key} value={key}>
                  {REFUND_REASON_LABEL[key]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-medium">What happened</span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              rows={3}
              placeholder="Partner sold out of the cake and had no replacement."
              className="rounded-lg border border-zinc-300 px-3 py-2"
            />
            <span className="text-xs text-zinc-500">For the order&rsquo;s history. The sender doesn&rsquo;t see it.</span>
          </label>
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={manual} onChange={(e) => setManual(e.target.checked)} className="mt-1" />
            <span>
              Already refunded in the Paystack dashboard — just record it
              <span className="block text-xs text-zinc-500">Paystack won&rsquo;t be asked again.</span>
            </span>
          </label>
          {errors.length > 0 && (
            <ul role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-red-800">
              {errors.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => setOpen(false)}
              className="rounded-lg border border-zinc-300 px-4 py-2 font-medium hover:bg-zinc-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={pending || reason.trim().length < 3}
              onClick={submit}
              className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              {pending && <Spinner className="h-3.5 w-3.5" />}
              {manual ? "Record refund" : `Refund ${formatNaira(state.refundAmount)}`}
            </button>
          </div>
        </div>
      </Modal>
    </section>
  );
}
