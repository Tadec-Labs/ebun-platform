"use server";

import {
  VendorApiError,
  vendorFetch,
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
