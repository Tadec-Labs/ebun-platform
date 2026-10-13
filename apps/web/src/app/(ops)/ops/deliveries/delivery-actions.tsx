"use client";

import { useState, useTransition } from "react";
import type { OpsDelivery } from "@/lib/ops/types";
import { deliveryOpsAction } from "../actions";

/**
 * The buttons for one delivery. Reassigning is offered until it leaves;
 * the API refuses a vendor who doesn't offer the gift, with a message
 * saying so.
 */
export function DeliveryActions({
  delivery,
  vendors,
}: {
  delivery: OpsDelivery;
  vendors: { id: string; name: string }[];
}) {
  const [vendorId, setVendorId] = useState(delivery.vendorId ?? "");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function run(step: "vendor" | "dispatch" | "delivered") {
    if (step === "delivered" && !window.confirm("Mark as delivered? This credits the vendor.")) return;
    setMessage(null);
    startTransition(async () => {
      const result = await deliveryOpsAction(delivery.orderId, step, step === "vendor" ? vendorId : undefined);
      setMessage(result.ok ? { ok: true, text: result.message ?? "Done." } : { ok: false, text: result.errors.join(" ") });
    });
  }

  const canReassign = delivery.stage !== "on_the_way" && delivery.stage !== "awaiting_address";
  const hasVendor = Boolean(delivery.vendorId);

  return (
    <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
      <div className="flex flex-wrap items-center gap-2">
        {canReassign && (
          <>
            <select
              value={vendorId}
              onChange={(e) => setVendorId(e.target.value)}
              className="rounded border border-zinc-300 bg-white px-2 py-1.5"
              aria-label="Vendor"
            >
              <option value="">Choose vendor…</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={pending || !vendorId || vendorId === delivery.vendorId}
              onClick={() => run("vendor")}
              className="rounded border border-zinc-300 px-3 py-1.5 font-medium disabled:opacity-40"
            >
              {hasVendor ? "Reassign" : "Assign"}
            </button>
          </>
        )}
        {hasVendor && delivery.stage !== "on_the_way" && delivery.stage !== "awaiting_address" && (
          <button
            type="button"
            disabled={pending}
            onClick={() => run("dispatch")}
            className="rounded border border-zinc-300 px-3 py-1.5 font-medium disabled:opacity-40"
          >
            On its way
          </button>
        )}
        {hasVendor && delivery.stage !== "awaiting_address" && (
          <button
            type="button"
            disabled={pending}
            onClick={() => run("delivered")}
            className="rounded bg-zinc-900 px-3 py-1.5 font-medium text-white disabled:opacity-40"
          >
            Delivered
          </button>
        )}
      </div>
      {message && (
        <p role={message.ok ? "status" : "alert"} className={message.ok ? "text-emerald-700" : "text-red-700"}>
          {message.text}
        </p>
      )}
    </div>
  );
}
