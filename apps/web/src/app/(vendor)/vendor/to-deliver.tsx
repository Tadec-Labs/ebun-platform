"use client";

import { useEffect, useState, useTransition } from "react";
import { formatNaira } from "@/lib/format-money";
import type { VendorDelivery } from "@/lib/vendor/api";
import { deliveryFailedAction, deliveryStepAction, listDeliveriesAction } from "./actions";

const FAIL_REASONS = ["Not home", "Phone off / no answer", "Wrong address"] as const;

const REFRESH_MS = 30_000;

/**
 * Doorstep gifts this shop is delivering — above "Coming in" because a
 * hamper that needs packing and a rider is the longer job.
 *
 * Each card is everything a rider needs (name, phone, address,
 * landmark) and one obvious next button: Got it → Out for delivery →
 * Delivered. "Delivered" works from any step, because a busy shop that
 * forgot the middle tap has still delivered it — but it needs the
 * recipient's 4-digit code, which the rider asks for at the door. That
 * code is what proves the handover and pays the shop. Same 30-second refresh as
 * the pickups list, so a counter phone left open shows new ones.
 */
export function ToDeliver({ initial }: { initial: VendorDelivery[] }) {
  const [items, setItems] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [riderFor, setRiderFor] = useState<string | null>(null);
  const [riderName, setRiderName] = useState("");
  const [riderPhone, setRiderPhone] = useState("");
  const [codeFor, setCodeFor] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [failFor, setFailFor] = useState<string | null>(null);
  const [failReason, setFailReason] = useState("");
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

  async function step(orderId: string, which: "ack" | "dispatch" | "delivered") {
    setError(null);
    startTransition(async () => {
      const result = await deliveryStepAction(
        orderId,
        which,
        which === "dispatch"
          ? { riderName: riderName.trim() || undefined, riderPhone: riderPhone.trim() || undefined }
          : which === "delivered"
            ? { code }
            : undefined,
      );
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setRiderFor(null);
      setRiderName("");
      setRiderPhone("");
      setCodeFor(null);
      setCode("");
      setItems((all) =>
        which === "delivered"
          ? all.filter((d) => d.orderId !== orderId)
          : all.map((d) =>
              d.orderId === orderId ? { ...d, stage: which === "ack" ? "acknowledged" : "on_the_way" } : d,
            ),
      );
    });
  }

  function markFailed(orderId: string) {
    const reason = failReason.trim();
    if (reason.length < 2) {
      setError("Say briefly what happened.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await deliveryFailedAction(orderId, reason);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setFailFor(null);
      setFailReason("");
      setItems((all) => all.map((d) => (d.orderId === orderId ? { ...d, stage: "missed" } : d)));
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
                  d.stage === "missed"
                    ? "bg-violet-100 text-violet-800"
                    : d.stage === "on_the_way"
                    ? "bg-sky-100 text-sky-800"
                    : d.stage === "acknowledged"
                      ? "bg-zinc-100 text-zinc-700"
                      : "bg-amber-500 text-white"
                }`}
              >
                {d.stage === "missed"
                  ? "Collecting here"
                  : d.stage === "on_the_way"
                    ? "On its way"
                    : d.stage === "acknowledged"
                      ? "Preparing"
                      : "New"}
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

            {d.stage === "missed" && (
              <p className="rounded-lg bg-violet-50 px-3 py-2 text-sm text-violet-900">
                Couldn&rsquo;t be delivered — {d.recipientName.split(" ")[0]} will collect it here. Check their
                4-digit code and tap &ldquo;Collected&rdquo;.
              </p>
            )}

            {failFor === d.orderId ? (
              <div className="flex flex-col gap-2 rounded-lg bg-zinc-50 p-3">
                <p className="text-base font-medium">What happened?</p>
                <div className="flex flex-wrap gap-2">
                  {FAIL_REASONS.map((reason) => (
                    <button
                      key={reason}
                      type="button"
                      onClick={() => setFailReason(reason)}
                      aria-pressed={failReason === reason}
                      className={`rounded-full border-2 px-3 py-1.5 text-sm ${
                        failReason === reason ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300"
                      }`}
                    >
                      {reason}
                    </button>
                  ))}
                </div>
                <input
                  value={failReason}
                  onChange={(e) => setFailReason(e.target.value)}
                  placeholder="Or type it"
                  maxLength={300}
                  className="rounded-lg border-2 border-zinc-300 bg-white px-3 py-3 text-base"
                />
                <p className="text-sm text-zinc-600">
                  {d.recipientName.split(" ")[0]} will be told to collect it from you with the same code.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => markFailed(d.orderId)}
                    className="rounded-lg bg-zinc-900 py-3 text-base font-semibold text-white disabled:opacity-50"
                  >
                    Couldn&rsquo;t deliver
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setFailFor(null);
                      setFailReason("");
                    }}
                    className="rounded-lg border-2 border-zinc-300 py-3 text-base"
                  >
                    Back
                  </button>
                </div>
              </div>
            ) : codeFor === d.orderId ? (
              <form
                className="flex flex-col gap-2 rounded-lg bg-emerald-50 p-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void step(d.orderId, "delivered");
                }}
              >
                <label className="flex flex-col gap-2">
                  <span className="text-base font-medium">
                    {d.stage === "missed" ? "Collection code" : "Delivery code"} from {d.recipientName.split(" ")[0]}
                  </span>
                  <input
                    autoFocus
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, "").slice(0, 4))}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="4 digits"
                    className="rounded-lg border-2 border-zinc-300 bg-white px-4 py-3 text-center text-2xl font-semibold tracking-[0.5em]"
                  />
                  <span className="text-sm text-zinc-600">
                    It&rsquo;s on their gift page. The rider asks for it at the door.
                  </span>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="submit"
                    disabled={pending || code.length !== 4}
                    className="rounded-lg bg-emerald-600 py-3 text-base font-semibold text-white disabled:opacity-50"
                  >
                    Confirm delivered
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCodeFor(null);
                      setCode("");
                    }}
                    className="rounded-lg border-2 border-zinc-300 py-3 text-base"
                  >
                    Back
                  </button>
                </div>
              </form>
            ) : riderFor === d.orderId ? (
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
                    onClick={() => void step(d.orderId, "dispatch")}
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
                    onClick={() => void step(d.orderId, "ack")}
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
                {d.stage !== "new" && d.codeLocked && (
                  <p className="col-span-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    Too many wrong codes. Ask {d.recipientName.split(" ")[0]} to tap &ldquo;I&rsquo;ve received
                    it&rdquo; on their gift page, or call SendEbun.
                  </p>
                )}
                {d.stage !== "new" && !d.codeLocked && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      setError(null);
                      setCode("");
                      setCodeFor(d.orderId);
                    }}
                    className={`rounded-lg py-3 text-base font-semibold disabled:opacity-50 ${
                      d.stage === "on_the_way" || d.stage === "missed"
                        ? "col-span-2 bg-emerald-600 text-white"
                        : "border-2 border-zinc-300 text-zinc-800"
                    }`}
                  >
                    {d.stage === "missed" ? "Collected" : "Delivered"}
                  </button>
                )}
                {(d.stage === "acknowledged" || d.stage === "on_the_way") && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      setError(null);
                      setFailReason("");
                      setFailFor(d.orderId);
                    }}
                    className="col-span-2 py-1 text-sm text-zinc-500 underline underline-offset-2"
                  >
                    Couldn&rsquo;t deliver?
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
