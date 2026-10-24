"use client";

import { useEffect, useState, useTransition } from "react";
import { formatNaira } from "@/lib/format-money";
import type { VendorPickup } from "@/lib/vendor/api";
import { useConfirm } from "@/components/ui/feedback";
import { confirmPickupAction, listPickupsAction, markNoShowAction } from "./actions";

/** How often the counter re-reads the list. */
const REFRESH_MS = 30_000;

/**
 * Who is coming, for what, and when — so the pizza is in the oven before
 * the customer is at the counter.
 *
 * Re-read every 30 seconds while the screen is visible, so a counter
 * phone left open picks up new bookings without anyone reloading. New,
 * unconfirmed bookings sit on top in bold with one button: "Got it".
 * Confirming tells the recipient it'll be ready.
 *
 * Times are Lagos time — the counter's clock — whatever timezone the
 * server or phone happens to be in.
 */
export function ComingIn({ initial }: { initial: VendorPickup[] }) {
  const [pickups, setPickups] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [ask, askDialog] = useConfirm();

  useEffect(() => {
    const refresh = async () => {
      if (document.visibilityState !== "visible") return;
      const result = await listPickupsAction();
      if (result.ok) setPickups(result.pickups);
    };
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  if (pickups.length === 0) return null;

  function confirm(orderId: string) {
    setError(null);
    startTransition(async () => {
      const result = await confirmPickupAction(orderId);
      if (result.ok) {
        setPickups((all) => all.map((p) => (p.orderId === orderId ? { ...p, confirmed: true } : p)));
      } else {
        setError(result.message);
      }
    });
  }

  async function noShow(pickup: VendorPickup) {
    const ok = await ask({
      title: `${pickup.recipientFirstName} didn't come?`,
      body: "They'll be asked to pick a new time. If they turn up later anyway, just check their code as usual.",
      confirmLabel: "Yes, didn't come",
    });
    if (!ok) return;
    setError(null);
    startTransition(async () => {
      const result = await markNoShowAction(pickup.orderId);
      if (result.ok) setPickups((all) => all.filter((p) => p.orderId !== pickup.orderId));
      else setError(result.message);
    });
  }

  const waiting = pickups.filter((p) => !p.confirmed).length;

  return (
    <section className="flex flex-col gap-3" aria-label="Coming in">
      <h2 className="text-xl font-semibold">
        Coming in{" "}
        {waiting > 0 && (
          <span className="ml-1 rounded-full bg-amber-500 px-2.5 py-0.5 text-base text-white">{waiting} new</span>
        )}
      </h2>
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-base text-red-800">
          {error}
        </p>
      )}
      <ul className="flex flex-col gap-2">
        {pickups.map((pickup) => (
          <li
            key={pickup.orderId}
            className={`flex items-center justify-between gap-3 rounded-lg border-2 p-4 ${
              pickup.confirmed ? "border-zinc-200" : "border-amber-500 bg-amber-50"
            }`}
          >
            <div className="min-w-0">
              <p className="text-lg font-semibold">{pickup.giftName}</p>
              <p className="text-base text-zinc-700">
                {pickup.recipientFirstName} · {formatTime(pickup.pickupAt)}
              </p>
              {/* The money is already paid — say so before anyone starts cooking. */}
              {pickup.youReceive !== null && (
                <p className="text-sm font-medium text-emerald-700">
                  Paid ✓ · you receive {formatNaira(pickup.youReceive)}
                </p>
              )}
            </div>
            {pickup.canMarkNoShow ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => void noShow(pickup)}
                className="shrink-0 rounded-lg border-2 border-zinc-300 px-3 py-2.5 text-sm font-medium text-zinc-700 disabled:opacity-50"
              >
                Didn&rsquo;t come
              </button>
            ) : pickup.confirmed ? (
              <span className="shrink-0 text-base font-medium text-emerald-700">✓ Ready</span>
            ) : (
              <button
                type="button"
                disabled={pending}
                onClick={() => confirm(pickup.orderId)}
                className="shrink-0 rounded-lg bg-zinc-900 px-4 py-3 text-base font-semibold text-white disabled:opacity-50"
              >
                Got it
              </button>
            )}
          </li>
        ))}
      </ul>
      {askDialog}
    </section>
  );
}

function formatTime(iso: string): string {
  const at = new Date(iso);
  const day = (d: Date) => d.toLocaleDateString("en-NG", { timeZone: "Africa/Lagos" });
  const time = at.toLocaleTimeString("en-NG", { timeZone: "Africa/Lagos", hour: "numeric", minute: "2-digit" });
  if (day(at) === day(new Date())) return time;
  return `${at.toLocaleDateString("en-NG", { timeZone: "Africa/Lagos", weekday: "short", day: "numeric", month: "short" })}, ${time}`;
}
