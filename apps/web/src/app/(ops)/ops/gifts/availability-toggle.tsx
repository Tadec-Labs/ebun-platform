"use client";

import { useState, useTransition } from "react";
import { setGiftAvailabilityAction } from "../actions";

/**
 * The control ops reaches for most, so it lives in the list rather than
 * behind an edit form: putting a gift on or off sale is the one change
 * that needs to happen in seconds — a vendor runs out of something, or
 * a price turns out to be wrong and it has to come down now.
 */
export function AvailabilityToggle({ id, available }: { id: string; available: boolean }) {
  const [on, setOn] = useState(available);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={`${on ? "Take off sale" : "Put on sale"}: gift ${id}`}
        disabled={pending}
        onClick={() => {
          const next = !on;
          setError(null);
          // Flipped immediately, and put back if the server disagrees —
          // this is a one-tap control and a spinner on every toggle
          // would make the list feel broken.
          setOn(next);
          startTransition(async () => {
            const result = await setGiftAvailabilityAction(id, next);
            if (!result.ok) {
              setOn(!next);
              setError(result.errors[0] ?? "Couldn't change that.");
            }
          });
        }}
        className={`rounded border px-2.5 py-1 text-xs disabled:opacity-60 ${
          on
            ? "border-emerald-300 bg-emerald-50 text-emerald-800"
            : "border-zinc-300 bg-zinc-100 text-zinc-600"
        }`}
      >
        {on ? "On sale" : "Off sale"}
      </button>
      {error && (
        <span role="alert" className="text-xs text-red-700">
          {error}
        </span>
      )}
    </div>
  );
}
