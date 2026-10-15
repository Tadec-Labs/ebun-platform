"use client";

import { useState, useTransition } from "react";
import { useConfirm } from "@/components/ui/feedback";
import { formatNaira } from "@/lib/format-money";
import type { Vendor, VendorEarnings } from "@/lib/ops/types";
import { recordVendorPayoutAction } from "../../actions";

/**
 * Pay a vendor: see exactly what's owed and to which account, make the
 * transfer in your bank app, then record it here with the bank's
 * reference. Recording doesn't move money — it's the receipt the vendor
 * sees on their Earnings screen.
 */
export function EarningsPanel({
  vendor,
  earnings,
}: {
  vendor: Pick<Vendor, "id" | "bankName" | "accountNumber" | "accountName" | "autoPayouts">;
  earnings: VendorEarnings;
}) {
  const [paymentRef, setPaymentRef] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("bank_transfer");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [ask, askDialog] = useConfirm();

  const unpaid = earnings.collections.filter((c) => !c.paid);
  // What can still be paid by hand: not what an automatic transfer is already sending.
  const payable = unpaid.filter((c) => !c.onItsWay);
  const payableTotal = earnings.owedNow - earnings.onItsWay;
  const hasBank = Boolean(vendor.accountNumber);

  return (
    <section id="earnings" className="scroll-mt-6">
      <h2 className="mb-1 font-semibold">Earnings & payouts</h2>
      <p className="mb-4 text-zinc-600">
        Owed now: <span className="font-semibold text-zinc-900">{formatNaira(earnings.owedNow)}</span> across{" "}
        {unpaid.length} {unpaid.length === 1 ? "collection" : "collections"} · Paid so far: {formatNaira(earnings.paidTotal)}
      </p>
      <p className={`mb-4 text-sm ${vendor.autoPayouts.on ? "text-emerald-700" : "text-zinc-500"}`}>
        {vendor.autoPayouts.on
          ? "Paid automatically after each handover."
          : `Paid by hand. ${vendor.autoPayouts.reason ?? ""}`}
        {earnings.onItsWay > 0 && ` ${formatNaira(earnings.onItsWay)} is on its way to them now.`}
      </p>

      {unpaid.length > 0 && (
        <div className="mb-4 overflow-x-auto rounded border border-zinc-200 bg-white">
          <table className="w-full min-w-[520px] text-left">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">Collected</th>
                <th className="px-4 py-2.5 font-medium">Order</th>
                <th className="px-4 py-2.5 font-medium">Gift</th>
                <th className="px-4 py-2.5 text-right font-medium">Owed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {unpaid.map((c) => (
                <tr key={c.orderId}>
                  <td className="px-4 py-2.5">{formatDay(c.collectedAt)}</td>
                  <td className="px-4 py-2.5 font-mono text-xs">{c.orderNumber ?? "—"}</td>
                  <td className="px-4 py-2.5">{c.giftName}</td>
                  <td className="px-4 py-2.5 text-right">
                    {formatNaira(c.amount)}
                    {c.onItsWay && <span className="block text-xs text-emerald-700">on its way</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {payable.length > 0 &&
        (hasBank ? (
          <form
            className="grid gap-4 rounded border border-zinc-200 bg-white p-5 sm:grid-cols-2"
            onSubmit={async (event) => {
              event.preventDefault();
              const ok = await ask({
                title: `Record ${formatNaira(payableTotal)} paid?`,
                body: "Only after the transfer has gone through in your bank app. The partner sees this payment, with your reference, on their Earnings screen.",
                confirmLabel: "Record payment",
              });
              if (!ok) return;
              setErrors([]);
              setNotice(null);
              startTransition(async () => {
                const result = await recordVendorPayoutAction({
                  vendorId: vendor.id,
                  orderIds: earnings.unpaidOrderIds,
                  paymentRef,
                  paymentMethod,
                  notes,
                });
                if (result.ok) {
                  setNotice(result.message ?? "Payment recorded.");
                  setPaymentRef("");
                  setNotes("");
                } else {
                  setErrors(result.errors);
                }
              });
            }}
          >
            <div className="sm:col-span-2 rounded bg-zinc-50 px-3 py-2 text-zinc-700">
              Transfer <span className="font-semibold">{formatNaira(payableTotal)}</span> to{" "}
              {vendor.bankName ?? "their bank"} · {vendor.accountNumber} · {vendor.accountName ?? ""}, then record it here.
            </div>
            <label className="flex flex-col gap-1">
              <span>Transfer reference</span>
              <input
                value={paymentRef}
                onChange={(e) => setPaymentRef(e.target.value)}
                required
                maxLength={120}
                placeholder="From your bank's receipt"
                className="rounded border border-zinc-300 bg-white px-3 py-2"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span>Method</span>
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                className="rounded border border-zinc-300 bg-white px-3 py-2"
              >
                <option value="bank_transfer">Bank transfer</option>
                <option value="cash">Cash</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 sm:col-span-2">
              <span>Notes (optional, not shown to the vendor)</span>
              <input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={500}
                className="rounded border border-zinc-300 bg-white px-3 py-2"
              />
            </label>
            <button
              type="submit"
              disabled={pending}
              className="self-start rounded bg-zinc-900 px-4 py-2 font-medium text-white disabled:opacity-50 sm:col-span-2"
            >
              {pending ? "Recording…" : `Record payment of ${formatNaira(payableTotal)}`}
            </button>
          </form>
        ) : (
          <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900">
            No bank details yet. The vendor adds them under Shop on their link, or you can add them in Details below.
          </p>
        ))}

      {notice && (
        <p role="status" className="mt-3 rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-emerald-900">
          {notice}
        </p>
      )}
      {errors.length > 0 && (
        <ul role="alert" className="mt-3 list-disc rounded border border-red-300 bg-red-50 py-2 pr-3 pl-8 text-red-800">
          {errors.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      )}

      {askDialog}
      {earnings.payments.length > 0 && (
        <div className="mt-6">
          <h3 className="mb-2 text-sm font-medium text-zinc-700">Past payments</h3>
          <ul className="divide-y divide-zinc-100 rounded border border-zinc-200 bg-white">
            {earnings.payments.map((p) => (
              <li key={p.id} className="flex justify-between gap-4 px-4 py-2.5">
                <span>
                  {p.paidAt ? formatDay(p.paidAt) : "—"} · {p.collections} {p.collections === 1 ? "collection" : "collections"}
                  {p.reference ? ` · Ref ${p.reference}` : ""}
                </span>
                <span className="font-medium">{formatNaira(p.amount)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-NG", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric" });
}
