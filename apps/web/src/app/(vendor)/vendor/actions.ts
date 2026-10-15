"use server";

import { revalidatePath } from "next/cache";
import { parseNairaToKobo } from "@/lib/format-money";
import {
  VendorApiError,
  vendorFetch,
  type VendorOffering,
  type VendorDelivery,
  type VendorPickup,
  type VendorProfile,
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

/**
 * Ask SendEbun to sell something new, optionally with a photo. The
 * photo was already shrunk on the phone; it is forwarded to the API as
 * a file, where its real type and size are checked before it is stored.
 */
export async function requestItemAction(form: FormData): Promise<VendorItemResult> {
  const name = String(form.get("name") ?? "").trim();
  if (name.length < 2) {
    return { ok: false, message: "Give the item a name." };
  }
  const inStorePrice = parseNairaToKobo(String(form.get("priceNaira") ?? ""));
  if (inStorePrice === null || inStorePrice < 1) {
    return { ok: false, message: "Enter the price you charge in your shop, in naira." };
  }

  const body = new FormData();
  body.set("name", name);
  const description = String(form.get("description") ?? "").trim();
  if (description) body.set("description", description);
  body.set("inStorePrice", String(inStorePrice));
  body.set("bookingStyle", form.get("bookingStyle") === "appointment" ? "appointment" : "pickup");
  const photo = form.get("photo");
  if (photo instanceof Blob && photo.size > 0) body.set("photo", photo, "photo");

  try {
    const offering = await vendorFetch<VendorOffering>("/vendor/offerings", {
      method: "POST",
      body,
    });
    revalidatePath("/vendor/gifts");
    return { ok: true, offering };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}

/** A photo for an item still waiting for approval, or one without a photo yet. */
export async function addItemPhotoAction(
  giftTemplateId: string,
  form: FormData,
): Promise<VendorItemResult> {
  const photo = form.get("photo");
  if (!(photo instanceof Blob) || photo.size === 0) {
    return { ok: false, message: "Choose a photo." };
  }
  const body = new FormData();
  body.set("photo", photo, "photo");
  try {
    const offering = await vendorFetch<VendorOffering>(
      `/vendor/offerings/${encodeURIComponent(giftTemplateId)}/photo`,
      { method: "POST", body },
    );
    revalidatePath("/vendor/gifts");
    return { ok: true, offering };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}

/**
 * A new shop price. For a live item SendEbun approves it first and the
 * current price keeps selling until then; for one still waiting for
 * approval it's simply corrected. Sending the current price cancels a
 * pending request.
 */
export async function requestPriceChangeAction(
  giftTemplateId: string,
  priceNaira: string,
): Promise<VendorItemResult> {
  const inStorePrice = parseNairaToKobo(priceNaira);
  if (inStorePrice === null || inStorePrice < 1) {
    return { ok: false, message: "Enter the price you charge in your shop, in naira." };
  }
  try {
    const offering = await vendorFetch<VendorOffering>(
      `/vendor/offerings/${encodeURIComponent(giftTemplateId)}/price`,
      { method: "PATCH", body: { inStorePrice } },
    );
    revalidatePath("/vendor/gifts");
    return { ok: true, offering };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}

/** Stop selling an item. The API refuses while a paid gift still needs this shop. */
export async function removeItemAction(
  giftTemplateId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await vendorFetch<{ removed: true }>(`/vendor/offerings/${encodeURIComponent(giftTemplateId)}`, {
      method: "DELETE",
    });
    revalidatePath("/vendor/gifts");
    return { ok: true };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}

export type VendorProfileInput = {
  ownerName: string;
  pickupAddress: string;
  pickupHours: string;
  email: string;
  backupPhone: string;
  bankName?: string;
  /** Paystack bank code, when picked from the list. */
  bankCode?: string;
  accountNumber?: string;
  accountName?: string;
};

/** The vendor's own details. Bank details are only sent when they're being set for the first time. */
export async function saveProfileAction(
  input: VendorProfileInput,
): Promise<{ ok: true; profile: VendorProfile } | { ok: false; message: string }> {
  const body: Record<string, string> = {
    ownerName: input.ownerName.trim(),
    pickupAddress: input.pickupAddress.trim(),
    pickupHours: input.pickupHours.trim(),
    // Sent blank to clear: the API reads "" as "remove it".
    email: input.email.trim(),
    backupPhone: input.backupPhone.trim(),
  };
  if (input.accountNumber !== undefined) {
    body.bankName = (input.bankName ?? "").trim();
    if (input.bankCode) body.bankCode = input.bankCode;
    body.accountNumber = input.accountNumber.replace(/\s/g, "");
    body.accountName = (input.accountName ?? "").trim();
  }
  try {
    const profile = await vendorFetch<VendorProfile>("/vendor/profile", {
      method: "PATCH",
      body,
    });
    revalidatePath("/vendor/shop");
    return { ok: true, profile };
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

export async function listDeliveriesAction(): Promise<
  { ok: true; deliveries: VendorDelivery[] } | { ok: false; message: string }
> {
  try {
    return { ok: true, deliveries: await vendorFetch<VendorDelivery[]>("/vendor/deliveries") };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}

/**
 * The three things a shop does with a delivery: "Got it", "Out for
 * delivery" (optionally naming the rider, which the recipient sees with
 * a call button), and "Delivered" — which credits them.
 */
export async function deliveryStepAction(
  orderId: string,
  step: "ack" | "dispatch" | "delivered",
  extra?: { riderName?: string; riderPhone?: string; code?: string },
): Promise<{ ok: true } | { ok: false; message: string }> {
  const body =
    step === "dispatch"
      ? { riderName: extra?.riderName, riderPhone: extra?.riderPhone }
      : step === "delivered"
        ? // The recipient's 4-digit handover code: the proof that pays the shop.
          { code: (extra?.code ?? "").replace(/\s/g, "") }
        : undefined;
  try {
    await vendorFetch<{ ok: true }>(
      `/vendor/deliveries/${encodeURIComponent(orderId)}/${step}`,
      { method: "POST", body },
    );
    if (step === "delivered") revalidatePath("/vendor/earnings");
    return { ok: true };
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
