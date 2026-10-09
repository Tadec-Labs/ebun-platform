"use client";

import { useState, useTransition } from "react";
import type { RedemptionLookup } from "@/lib/ops/types";
import { completeRedemptionAction, lookupRedemptionAction } from "../actions";

const input = "w-full rounded border border-zinc-300 bg-white px-3 py-2";

/**
 * Two deliberate steps: look the code up, then confirm the handover.
 *
 * Collecting a gift is irreversible and single-use — there is no
 * un-redeem — so a single button that reads a code and spends it would
 * mean one typo destroys a stranger's gift. Showing what the code is
 * and who it belongs to first makes the mistake visible while it is
 * still free to make.
 */
export function RedeemConsole({ vendors }: { vendors: { id: string; name: string }[] }) {
  const [code, setCode] = useState("");
  const [found, setFound] = useState<RedemptionLookup | null>(null);
  const [vendorId, setVendorId] = useState(vendors.length === 1 ? vendors[0].id : "");
  const [errors, setErrors] = useState<string[]>([]);
  const [done, setDone] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function reset() {
    setCode("");
    setFound(null);
    setVendorId(vendors.length === 1 ? vendors[0].id : "");
    setErrors([]);
    setDone(null);
  }

  if (done) {
    return (
      <div className="flex flex-col items-start gap-4 rounded border border-emerald-300 bg-emerald-50 px-5 py-6">
        <div>
          <p className="font-semibold text-emerald-900">{done}</p>
          {found && (
            <p className="mt-1 text-emerald-800">
              {found.giftName ?? "Gift"} · {found.recipientName ?? "recipient"} ·{" "}
              {found.code}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={reset}
          className="rounded bg-zinc-900 px-4 py-2 font-medium text-white"
        >
          Collect another
        </button>
      </div>
    );
  }

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <form
        className="flex flex-col gap-3 rounded border border-zinc-200 bg-white p-5"
        onSubmit={(event) => {
          event.preventDefault();
          setErrors([]);
          setFound(null);
          startTransition(async () => {
            const result = await lookupRedemptionAction(code);
            if (result.ok) setFound(result.redemption);
            else setErrors(result.errors);
          });
        }}
      >
        <label className="flex flex-col gap-1">
          <span className="font-medium">Collection code</span>
          <input
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="EBN-4M8K2L"
            // Codes are read off a phone screen and typed in a hurry.
            // Autocorrect and autocapitalise both mangle them.
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            required
            className={`${input} font-mono tracking-widest uppercase`}
          />
          <span className="text-xs text-zinc-500">
            Case and dashes don&rsquo;t matter — EBN-4M8K2L, ebn4m8k2l and 4m8k2l all work.
          </span>
        </label>
        <div>
          <button
            type="submit"
            disabled={pending}
            className="rounded bg-zinc-900 px-5 py-2 font-medium text-white disabled:opacity-50"
          >
            {pending && !found ? "Checking…" : "Check code"}
          </button>
        </div>
      </form>

      {errors.length > 0 && (
        <ul role="alert" className="list-disc rounded border border-red-300 bg-red-50 py-2 pr-3 pl-8 text-red-800">
          {errors.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      )}

      {found && (
        <div className="flex flex-col gap-4 rounded border border-zinc-200 bg-white p-5">
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
            <dt className="text-zinc-500">Gift</dt>
            <dd className="font-medium">{found.giftName ?? "—"}</dd>
            <dt className="text-zinc-500">For</dt>
            <dd className="font-medium">{found.recipientName ?? "—"}</dd>
            <dt className="text-zinc-500">Order</dt>
            <dd>{found.orderNumber ?? "—"}</dd>
            <dt className="text-zinc-500">Code</dt>
            <dd className="font-mono tracking-widest">{found.code}</dd>
          </dl>

          {!found.redeemable ? (
            <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900">
              {found.blockedReason ?? "This gift can't be collected."}
            </p>
          ) : (
            <form
              className="flex flex-col gap-3 border-t border-zinc-100 pt-4"
              onSubmit={(event) => {
                event.preventDefault();
                setErrors([]);
                startTransition(async () => {
                  const result = await completeRedemptionAction({
                    code: found.code,
                    vendorId,
                  });
                  if (result.ok) setDone(result.message ?? "Collected.");
                  else setErrors(result.errors);
                });
              }}
            >
              <label className="flex flex-col gap-1">
                <span className="font-medium">Handed over by</span>
                <select
                  value={vendorId}
                  onChange={(event) => setVendorId(event.target.value)}
                  required
                  className={input}
                >
                  <option value="">Choose the vendor…</option>
                  {vendors.map((vendor) => (
                    <option key={vendor.id} value={vendor.id}>
                      {vendor.name}
                    </option>
                  ))}
                </select>
                <span className="text-xs text-zinc-500">
                  {vendors.length === 0
                    ? "No active vendors yet — add one under Vendors before collecting anything."
                    : "Recorded against this vendor for payout and audit. This can't be undone."}
                </span>
              </label>
              <div>
                <button
                  type="submit"
                  disabled={pending || vendors.length === 0}
                  className="rounded bg-zinc-900 px-5 py-2 font-medium text-white disabled:opacity-50"
                >
                  {pending ? "Confirming…" : "Confirm collection"}
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
