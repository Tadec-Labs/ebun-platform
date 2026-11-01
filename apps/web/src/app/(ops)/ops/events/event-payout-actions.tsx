"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Spinner, useToast } from "@/components/ui/feedback";
import { formatNaira } from "@/lib/format-money";
import { recordEventPayoutAction, verifyEventHostAction } from "./actions";

export function EventPayoutActions({
  eventId,
  canVerify,
  canPay,
  amount,
}: {
  eventId: string;
  canVerify: boolean;
  canPay: boolean;
  amount: number;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [reference, setReference] = useState("");
  const [paying, setPaying] = useState(false);

  if (!canVerify && !canPay) return null;

  return (
    <div className="flex flex-col items-end gap-2">
      {canVerify && (
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await verifyEventHostAction(eventId);
              if (result.ok) {
                toast.success("Host verified.");
                router.refresh();
              } else toast.error(result.errors.join(" "));
            })
          }
          className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 font-medium text-zinc-800 shadow-sm hover:bg-zinc-50 disabled:opacity-50"
        >
          {pending && <Spinner className="h-3.5 w-3.5" />}
          Verify host
        </button>
      )}
      {canPay && !paying && (
        <button
          type="button"
          onClick={() => setPaying(true)}
          className="rounded-lg bg-zinc-900 px-3 py-1.5 font-medium text-white shadow-sm hover:bg-zinc-800"
        >
          Record payout · {formatNaira(amount)}
        </button>
      )}
      {canPay && paying && (
        <div className="flex items-center gap-2">
          <input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="Transfer reference"
            className="w-44 rounded-lg border border-zinc-300 px-2.5 py-1.5"
          />
          <button
            type="button"
            disabled={pending || reference.trim().length < 3}
            onClick={() =>
              startTransition(async () => {
                const result = await recordEventPayoutAction(eventId, reference);
                if (result.ok) {
                  toast.success(`Recorded ${formatNaira(result.data.amount)} paid.`);
                  setPaying(false);
                  router.refresh();
                } else toast.error(result.errors.join(" "));
              })
            }
            className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-1.5 font-medium text-white disabled:opacity-50"
          >
            {pending && <Spinner className="h-3.5 w-3.5" />}
            Save
          </button>
        </div>
      )}
    </div>
  );
}
