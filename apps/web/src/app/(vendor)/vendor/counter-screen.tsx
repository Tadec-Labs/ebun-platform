"use client";

import { useState, useTransition } from "react";
import type { VendorRedemption } from "@/lib/vendor/api";
import { confirmCollectionAction, lookupCodeAction } from "./actions";

/**
 * The whole vendor product: read a code, see what it is, hand it over.
 *
 * Built for one hand on a counter phone, so everything is a size up
 * from the rest of Ebun and nothing needs precision. Two steps, never
 * one: collection is single-use and cannot be undone, and a single
 * "redeem" button turns one mistyped character into a destroyed gift
 * belonging to someone standing right there.
 *
 * The staff name is optional. Requiring it would produce "staff" typed
 * a thousand times; offering it means the till that confirmed a
 * disputed collection can usually be named.
 */
export function CounterScreen({ businessName }: { businessName: string }) {
  const [code, setCode] = useState("");
  const [found, setFound] = useState<VendorRedemption | null>(null);
  const [confirmedBy, setConfirmedBy] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<VendorRedemption | null>(null);
  const [pending, startTransition] = useTransition();

  function reset() {
    setCode("");
    setFound(null);
    setConfirmedBy("");
    setError(null);
    setDone(null);
  }

  if (done) {
    return (
      <div className="flex min-h-dvh flex-col justify-center gap-8 py-16">
        <div className="flex flex-col gap-3">
          <p className="text-4xl font-semibold text-emerald-700">Collected</p>
          <p className="text-xl leading-relaxed text-zinc-700">
            Hand over <span className="font-semibold">{done.giftName ?? "the gift"}</span> to{" "}
            {done.recipientName ?? "the customer"}.
          </p>
        </div>
        <button
          type="button"
          onClick={reset}
          className="w-full rounded-lg bg-zinc-900 py-5 text-xl font-semibold text-white"
        >
          Next customer
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 py-8">
      <header>
        <p className="text-sm text-zinc-500">{businessName}</p>
        <h1 className="mt-1 text-3xl font-semibold">Collect a gift</h1>
      </header>

      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          setFound(null);
          startTransition(async () => {
            const result = await lookupCodeAction(code);
            if (result.ok) setFound(result.redemption);
            else setError(result.message);
          });
        }}
      >
        <label className="flex flex-col gap-2">
          <span className="text-lg">Code on their screen</span>
          <input
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="EBN-4M8K2L"
            // Read off a phone and typed in a hurry: autocorrect and
            // autocapitalise both mangle these.
            autoCapitalize="characters"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            required
            className="w-full rounded-lg border-2 border-zinc-300 px-4 py-5 font-mono text-3xl tracking-widest uppercase outline-none focus:border-zinc-900"
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-lg bg-zinc-900 py-5 text-xl font-semibold text-white disabled:opacity-50"
        >
          {pending && !found ? "Checking…" : "Check code"}
        </button>
      </form>

      {error && (
        <p role="alert" className="rounded-lg border-2 border-red-300 bg-red-50 px-4 py-4 text-lg text-red-800">
          {error}
        </p>
      )}

      {found && (
        <div className="flex flex-col gap-5 rounded-lg border-2 border-zinc-300 p-5">
          <div>
            <p className="text-3xl font-semibold">{found.giftName ?? "Gift"}</p>
            <p className="mt-1 text-xl text-zinc-600">For {found.recipientName ?? "—"}</p>
          </div>

          {!found.redeemable ? (
            <p className="rounded-lg border-2 border-amber-300 bg-amber-50 px-4 py-4 text-lg text-amber-900">
              {found.blockedReason ?? "This can't be collected."}
            </p>
          ) : (
            <form
              className="flex flex-col gap-4 border-t-2 border-zinc-200 pt-5"
              onSubmit={(event) => {
                event.preventDefault();
                setError(null);
                startTransition(async () => {
                  const result = await confirmCollectionAction({
                    code: found.code,
                    confirmedBy,
                  });
                  if (result.ok) setDone(found);
                  else setError(result.message);
                });
              }}
            >
              <label className="flex flex-col gap-2">
                <span className="text-zinc-600">Your name (optional)</span>
                <input
                  value={confirmedBy}
                  onChange={(event) => setConfirmedBy(event.target.value)}
                  maxLength={80}
                  autoComplete="off"
                  className="w-full rounded-lg border-2 border-zinc-300 px-4 py-3 text-lg outline-none focus:border-zinc-900"
                />
              </label>
              <button
                type="submit"
                disabled={pending}
                className="w-full rounded-lg bg-emerald-700 py-5 text-xl font-semibold text-white disabled:opacity-50"
              >
                {pending ? "Confirming…" : "Hand it over"}
              </button>
              <p className="text-center text-zinc-500">This can&rsquo;t be undone.</p>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
