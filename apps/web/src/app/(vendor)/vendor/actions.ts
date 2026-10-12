"use server";

import { revalidatePath } from "next/cache";
import { parseNairaToKobo } from "@/lib/format-money";
import {
  VendorApiError,
  vendorFetch,
  type VendorOffering,
  type VendorPickup,
  type VendorRedemption,
} from "@/lib/vendor/api";

export type VendorLookupResult =
  | { ok: true; redemption: VendorRedemption }
  | { ok: false; message: string };

export type VendorConfirmResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

function messageOf(error: unknown): string {
  if (error instanceof VendorApiError) {
    return error.messages[0] ?? "Something went wrong.";
  }
  throw error;
}

/**
 * Checks a code without changing anything.
 *
 * A separate step from confirming, for the same reason it is in ops:
 * collection is single-use and irreversible, and a one-tap "redeem"
 * turns a mistyped character into somebody's destroyed gift.
 */
export async function lookupCodeAction(rawCode: string): Promise<VendorLookupResult> {
  const code = rawCode.trim();
  if (!code) {
    return { ok: false, message: "Type the code from the customer's screen." };
  }

  try {
    const redemption = await vendorFetch<VendorRedemption>(
      `/vendor/redemptions/${encodeURIComponent(code)}`,
    );
    return { ok: true, redemption };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}

/**
 * The irreversible half. The API re-checks that this vendor sells the
 * gift and that the code can still be collected, inside the same atomic
 * operation — so two tills confirming the same code at once cannot both
 * succeed.
 */
export async function confirmCollectionAction(input: {
  code: string;
  confirmedBy: string;
}): Promise<VendorConfirmResult> {
  try {
    await vendorFetch<{ redemptionNumber: string; status: string }>(
      `/vendor/redemptions/${encodeURIComponent(input.code)}/complete`,
      { method: "POST", body: { confirmedBy: input.confirmedBy.trim() || undefined } },
    );
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }

  return { ok: true, message: "Collected." };
}

export type VendorItemResult =
  | { ok: true; offering: VendorOffering }
  | { ok: false; message: string };

/**
 * Sold out today, or back on. Only stops NEW sales — anyone who already
 * bought this can still collect it here.
 */
export async function setItemAvailabilityAction(
  giftTemplateId: string,
  available: boolean,
): Promise<VendorItemResult> {
  try {
    const offering = await vendorFetch<VendorOffering>(
      `/vendor/offerings/${encodeURIComponent(giftTemplateId)}`,
      { method: "PATCH", body: { available } },
    );
    revalidatePath("/vendor/gifts");
    return { ok: true, offering };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}

/** Ask SendEbun to sell something new. It waits for a check before going on sale. */
export async function requestItemAction(input: {
  name: string;
  description: string;
  priceNaira: string;
}): Promise<VendorItemResult> {
  const name = input.name.trim();
  if (name.length < 2) {
    return { ok: false, message: "Give the item a name." };
  }
  const inStorePrice = parseNairaToKobo(input.priceNaira);
  if (inStorePrice === null || inStorePrice < 1) {
    return { ok: false, message: "Enter the price you charge in your shop, in naira." };
  }

  try {
    const offering = await vendorFetch<VendorOffering>("/vendor/offerings", {
      method: "POST",
      body: {
        name,
        description: input.description.trim() || undefined,
        inStorePrice,
      },
    });
    revalidatePath("/vendor/gifts");
    return { ok: true, offering };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}

/** Re-read on a timer by the counter screen, so a new booking shows up without a reload. */
export async function listPickupsAction(): Promise<
  { ok: true; pickups: VendorPickup[] } | { ok: false; message: string }
> {
  try {
    return { ok: true, pickups: await vendorFetch<VendorPickup[]>("/vendor/pickups") };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}

/** "Got it, it'll be ready" — the recipient sees this on their gift page. */
export async function confirmPickupAction(
  orderId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await vendorFetch<{ confirmed: true }>(
      `/vendor/pickups/${encodeURIComponent(orderId)}/confirm`,
      { method: "POST" },
    );
    return { ok: true };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}
