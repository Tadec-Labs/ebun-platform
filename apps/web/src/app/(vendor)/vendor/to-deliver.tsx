"use client";

import { useEffect, useState, useTransition } from "react";
import { formatNaira } from "@/lib/format-money";
import type { VendorDelivery } from "@/lib/vendor/api";
import { deliveryStepAction, listDeliveriesAction } from "./actions";

const REFRESH_MS = 30_000;

/**
 * Doorstep gifts this shop is delivering — above "Coming in" because a
 * hamper that needs packing and a rider is the longer job.
 *
 * Each card is everything a rider needs (name, phone, address,
 * landmark) and one obvious next button: Got it → Out for delivery →
 * Delivered. "Delivered" works from any step, because a busy shop that
 * forgot the middle tap has still delivered it. Same 30-second refresh as
 * the pickups list, so a counter phone left open shows new ones.
 */
export function ToDeliver({ initial }: { initial: VendorDelivery[] }) {
  const [items, setItems] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [riderFor, setRiderFor] = useState<string | null>(null);
  const [riderName, setRiderName] = useState("");
  const [riderPhone, setRiderPhone] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const refresh = async () => {
      if (document.visibilityState !== "visible") return;
      const result = await listDeliveriesAction();
      if (result.ok) setItems(result.deliveries);
    };
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  if (items.length === 0) return null;

  function step(orderId: string, which: "ack" | "dispatch" | "delivered") {
    if (which === "delivered" && !window.confirm("Mark this as delivered to the recipient?")) return;
    setError(null);
    startTransition(async () => {
      const result = await deliveryStepAction(
        orderId,
        which,
        which === "dispatch"
          ? { riderName: riderName.trim() || undefined, riderPhone: riderPhone.trim() || undefined }
          : undefined,
      );
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setRiderFor(null);
      setRiderName("");
      setRiderPhone("");
      setItems((all) =>
        which === "delivered"
          ? all.filter((d) => d.orderId !== orderId)
          : all.map((d) =>
              d.orderId === orderId ? { ...d, stage: which === "ack" ? "acknowledged" : "on_the_way" } : d,
            ),
      );
    });
  }

  const fresh = items.filter((d) => d.stage === "new").length;

  return (
    <section className="flex flex-col gap-3" aria-label="To deliver">
      <h2 className="text-xl font-semibold">
        To deliver{" "}
        {fresh > 0 && <span className="ml-1 rounded-full bg-amber-500 px-2.5 py-0.5 text-base text-white">{fresh} new</span>}
      </h2>
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-base text-red-800">
          {error}
        </p>
      )}
      <ul className="flex flex-col gap-3">
        {items.map((d) => (
          <li
            key={d.orderId}
            className={`flex flex-col gap-3 rounded-lg border-2 p-4 ${
              d.stage === "new" ? "border-amber-500 bg-amber-50" : "border-zinc-200"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-lg font-semibold">{d.giftName}</p>
                <p className="text-sm text-zinc-500">{d.orderNumber}</p>
              </div>
              <span
                className={`shrink-0 rounded-full px-2.5 py-1 text-sm font-medium ${
                  d.stage === "on_the_way"
                    ? "bg-sky-100 text-sky-800"
                    : d.stage === "acknowledged"
                      ? "bg-zinc-100 text-zinc-700"
                      : "bg-amber-500 text-white"
                }`}
              >
                {d.stage === "on_the_way" ? "On its way" : d.stage === "acknowledged" ? "Preparing" : "New"}
              </span>
            </div>

            <div className="flex flex-col gap-1 text-base">
              <p className="font-medium">{d.recipientName}</p>
              <p className="leading-snug text-zinc-700">
                {d.address}
                {d.area ? `, ${d.area}` : ""}
              </p>
              {d.note && <p className="text-zinc-600">“{d.note}”</p>}
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                <a href={`tel:${d.phone.replace(/[^+0-9]/g, "")}`} className="font-medium text-zinc-900 underline">
                  Call {d.phone}
                </a>
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                    [d.address, d.area].filter(Boolean).join(", "),
                  )}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-zinc-900 underline"
                >
                  Map
                </a>
              </div>
              {d.youReceive !== null && (
                <p className="text-sm font-medium text-emerald-700">
                  Paid ✓ · you receive {formatNaira(d.youReceive)} incl. delivery
                </p>
              )}
            </div>

            {riderFor === d.orderId ? (
              <div className="flex flex-col gap-2 rounded-lg bg-zinc-50 p-3">
                <p className="text-sm text-zinc-600">Rider details (optional) — the recipient gets a call button.</p>
                <input
                  value={riderName}
                  onChange={(e) => setRiderName(e.target.value)}
                  placeholder="Rider's name"
                  maxLength={80}
                  className="rounded-lg border-2 border-zinc-300 bg-white px-3 py-3 text-base"
                />
                <input
                  value={riderPhone}
                  onChange={(e) => setRiderPhone(e.target.value)}
                  placeholder="Rider's phone"
                  inputMode="tel"
                  maxLength={20}
                  className="rounded-lg border-2 border-zinc-300 bg-white px-3 py-3 text-base"
                />
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => step(d.orderId, "dispatch")}
                    className="rounded-lg bg-zinc-900 py-3 text-base font-semibold text-white disabled:opacity-50"
                  >
                    Send it out
                  </button>
                  <button
                    type="button"
                    onClick={() => setRiderFor(null)}
                    className="rounded-lg border-2 border-zinc-300 py-3 text-base"
                  >
                    Back
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {d.stage === "new" && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => step(d.orderId, "ack")}
                    className="col-span-2 rounded-lg bg-zinc-900 py-4 text-lg font-semibold text-white disabled:opacity-50"
                  >
                    Got it
                  </button>
                )}
                {d.stage === "acknowledged" && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => setRiderFor(d.orderId)}
                    className="rounded-lg bg-zinc-900 py-3 text-base font-semibold text-white disabled:opacity-50"
                  >
                    Out for delivery
                  </button>
                )}
                {d.stage !== "new" && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => step(d.orderId, "delivered")}
                    className={`rounded-lg py-3 text-base font-semibold disabled:opacity-50 ${
                      d.stage === "on_the_way"
                        ? "col-span-2 bg-emerald-600 text-white"
                        : "border-2 border-zinc-300 text-zinc-800"
                    }`}
                  >
                    Delivered
                  </button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
