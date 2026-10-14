"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useToast } from "@/components/ui/feedback";
import { setGiftAvailabilityAction } from "../actions";

/**
 * The control ops reaches for most, so it lives in the list rather than
 * behind an edit form: a partner runs out, or a price is wrong and has to
 * come down now. Flips at once and puts itself back if the server
 * disagrees; the page then refreshes so "On /send" reflects it.
 */
export function AvailabilityToggle({ id, name, available }: { id: string; name: string; available: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [on, setOn] = useState(available);
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={`${on ? "Take off sale" : "Put on sale"}: ${name}`}
      disabled={pending}
      onClick={() => {
        const next = !on;
        setOn(next);
        startTransition(async () => {
          const result = await setGiftAvailabilityAction(id, next);
          if (result.ok) {
            toast.success(next ? `“${name}” is on sale.` : `“${name}” is off sale.`);
            router.refresh();
          } else {
            setOn(!next);
            toast.error(result.errors[0] ?? "Couldn't change that.");
          }
        });
      }}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-60 ${on ? "bg-emerald-600" : "bg-zinc-300"}`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? "left-[22px]" : "left-0.5"}`}
      />
    </button>
  );
}
