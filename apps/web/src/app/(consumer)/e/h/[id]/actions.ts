"use server";

import { revalidatePath } from "next/cache";
import { HostApiError, hostFetch } from "@/lib/events/host-api";
import type { EventItemView } from "@/lib/events/types";

export type Result<T = true> = { ok: true; data: T } | { ok: false; error: string };

const GONE = "This host link no longer works on this device. Open the link you saved when you set up the event.";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function run<T>(shortId: string, call: () => Promise<T | null>): Promise<Result<T>> {
  try {
    const data = await call();
    if (data === null) return { ok: false, error: GONE };
    revalidatePath(`/e/h/${shortId}`);
    return { ok: true, data };
  } catch (error) {
    if (error instanceof HostApiError) return { ok: false, error: error.message };
    throw error;
  }
}

/**
 * Everything the host can do. Each call goes to the API as the host of
 * THIS event only: the token comes from the cookie the short id names,
 * never from anything the browser sends.
 */
export async function updateSettingsAction(
  shortId: string,
  changes: { giftListEnabled?: boolean; cashEnabled?: boolean; wallEnabled?: boolean; showAmounts?: boolean },
): Promise<Result> {
  return run(shortId, () => hostFetch<true>(shortId, "", { method: "PATCH", body: changes }));
}

export async function addItemAction(shortId: string, giftTemplateId: string): Promise<Result<EventItemView>> {
  if (!UUID.test(giftTemplateId)) return { ok: false, error: "Pick a gift first." };
  return run(shortId, () => hostFetch<EventItemView>(shortId, "/items", { method: "POST", body: { giftTemplateId } }));
}

export async function removeItemAction(shortId: string, groupGiftId: string): Promise<Result<{ refunds: number }>> {
  if (!UUID.test(groupGiftId)) return { ok: false, error: "That gift isn't on this list." };
  return run(shortId, () => hostFetch<{ refunds: number }>(shortId, `/items/${groupGiftId}`, { method: "DELETE" }));
}

export async function payoutAccountAction(
  shortId: string,
  account: { bankCode: string; accountNumber: string; accountName: string },
): Promise<Result> {
  const accountNumber = account.accountNumber.replace(/\D/g, "");
  if (accountNumber.length !== 10) return { ok: false, error: "The account number is 10 digits." };
  if (!account.accountName.trim()) return { ok: false, error: "Type the name on the account." };
  return run(shortId, () =>
    hostFetch<true>(shortId, "/payout-account", {
      method: "PUT",
      body: { bankCode: account.bankCode, accountNumber, accountName: account.accountName.trim() },
    }),
  );
}

export async function deliveryAddressAction(
  shortId: string,
  details: { address: string; area: string; note: string },
): Promise<Result<{ applied: number; waiting: number }>> {
  const address = details.address.trim();
  const area = details.area.trim();
  if (address.length < 5) return { ok: false, error: "Add the full address." };
  if (area.length < 2) return { ok: false, error: "Add the area." };
  return run(shortId, () =>
    hostFetch<{ applied: number; waiting: number }>(shortId, "/delivery-address", {
      method: "PUT",
      body: { address, area, note: details.note.trim() || undefined },
    }),
  );
}

export async function thankAction(shortId: string, kind: "cash" | "share", id: string): Promise<Result> {
  if (!UUID.test(id)) return { ok: false, error: "That gift isn't on this event." };
  return run(shortId, () => hostFetch<true>(shortId, "/thanks", { method: "POST", body: { kind, id } }));
}

export async function cancelEventAction(shortId: string): Promise<Result<{ refunds: number }>> {
  return run(shortId, () => hostFetch<{ refunds: number }>(shortId, "/cancel", { method: "POST" }));
}
