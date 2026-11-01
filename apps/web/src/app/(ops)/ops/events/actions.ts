"use server";

import { revalidatePath } from "next/cache";
import { OpsApiError, opsFetch } from "@/lib/ops/api";

type Outcome<T = undefined> = { ok: true; data: T } | { ok: false; errors: string[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Only OpsApiError is a user-facing failure; anything else (redirect()) keeps propagating. */
function failure(error: unknown): { ok: false; errors: string[] } {
  if (error instanceof OpsApiError) return { ok: false, errors: error.messages };
  throw error;
}

/** Confirms the host's payout account is theirs. Changing the account later clears this. */
export async function verifyEventHostAction(eventId: string): Promise<Outcome> {
  if (!UUID.test(eventId)) return { ok: false, errors: ["No such event."] };
  try {
    await opsFetch(`/ops/events/${eventId}/verify`, { method: "POST" });
    revalidatePath("/ops/events");
    return { ok: true, data: undefined };
  } catch (error) {
    return failure(error);
  }
}

/** Records the bank transfer already made to the host. The amount is the API's, never typed here. */
export async function recordEventPayoutAction(eventId: string, reference: string): Promise<Outcome<{ amount: number }>> {
  if (!UUID.test(eventId)) return { ok: false, errors: ["No such event."] };
  const ref = reference.trim();
  if (ref.length < 3) return { ok: false, errors: ["Paste the transfer reference from your bank or Paystack."] };
  try {
    const data = await opsFetch<{ amount: number }>(`/ops/events/${eventId}/payout`, {
      method: "POST",
      body: { reference: ref },
    });
    revalidatePath("/ops/events");
    return { ok: true, data };
  } catch (error) {
    return failure(error);
  }
}
