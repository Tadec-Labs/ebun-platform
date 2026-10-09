"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { API_BASE_URL } from "@/lib/api-config";
import { parseNairaToKobo } from "@/lib/format-money";
import { OpsApiError, opsFetch } from "@/lib/ops/api";
import { clearOpsToken, setOpsToken } from "@/lib/ops/session";
import type { ActionResult, Offering, RedemptionLookup, Vendor } from "@/lib/ops/types";

/**
 * Narrower than ActionResult on purpose: both helpers below only ever
 * produce a failure, and typing them as the full union would force
 * every caller returning a richer success shape (lookupRedemptionAction,
 * say) to cast its way out.
 */
type ActionFailure = { ok: false; errors: string[] };

const fail = (errors: string[]): ActionFailure => ({ ok: false, errors });

/** Only OpsApiError is a user-facing failure. Anything else — notably Next's redirect() — must keep propagating. */
function asFailure(error: unknown): ActionFailure {
  if (error instanceof OpsApiError) return fail(error.messages);
  throw error;
}

const text = (form: FormData, key: string) => {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
};

const list = (raw: string) =>
  raw
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);

// ---------------------------------------------------------------- auth

export async function loginAction(formData: FormData): Promise<ActionResult> {
  const email = text(formData, "email");
  const rawPassword = formData.get("password");
  const password = typeof rawPassword === "string" ? rawPassword : "";

  if (!email || !password) return fail(["Enter your email and password."]);

  // Server-only env (not NEXT_PUBLIC_): the anon key is safe to expose,
  // but there's no reason for the browser to ever see it or talk to
  // Supabase Auth directly — login happens entirely here.
  const supabaseUrl = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    return fail(["Ops login isn't configured: SUPABASE_URL and SUPABASE_ANON_KEY must be set on the web app."]);
  }

  let accessToken: string;
  let expiresIn: number;
  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: anonKey, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
      cache: "no-store",
    });
    if (!res.ok) {
      // One message for wrong password, unknown email and unconfirmed
      // account alike — never confirm which emails exist.
      return fail(["Email or password is incorrect."]);
    }
    const body = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) return fail(["Email or password is incorrect."]);
    accessToken = body.access_token;
    expiresIn = body.expires_in ?? 3600;
  } catch {
    return fail(["Couldn't reach the sign-in service. Try again."]);
  }

  // A valid Supabase login isn't enough — the API decides whether this
  // account is actually staff. Nothing is stored unless it is.
  try {
    const me = await fetch(`${API_BASE_URL}/ops/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (me.status === 401 || me.status === 403) {
      return fail(["This account doesn't have access to the ops dashboard."]);
    }
    if (!me.ok) return fail([`The API couldn't confirm your access (${me.status}).`]);
  } catch {
    return fail(["Couldn't reach the API. Try again."]);
  }

  await setOpsToken(accessToken, Math.min(expiresIn, 60 * 60 * 12));
  redirect("/ops/vendors");
}

export async function logoutAction(): Promise<void> {
  await clearOpsToken();
  redirect("/ops/login");
}

// ------------------------------------------------------------- vendors

export async function saveVendorAction(formData: FormData): Promise<ActionResult> {
  const id = text(formData, "id");
  const isUpdate = id !== "";

  const sharePct = Number(text(formData, "vendorSharePct"));
  if (!Number.isInteger(sharePct) || sharePct < 1 || sharePct > 100) {
    return fail(["Vendor share must be a whole number between 1 and 100."]);
  }
  const timeout = Number(text(formData, "responseTimeoutMinutes"));
  if (!Number.isInteger(timeout) || timeout < 15 || timeout > 1440) {
    return fail(["Response window must be a whole number of minutes between 15 and 1440."]);
  }

  // Blank optional field: on create it's simply omitted; on update it
  // means "clear it" (null) — the API distinguishes the two.
  const optional = (key: string) => {
    const value = text(formData, key);
    if (value !== "") return value;
    return isUpdate ? null : undefined;
  };

  const body = {
    businessName: text(formData, "businessName"),
    ownerName: text(formData, "ownerName"),
    whatsappNumber: text(formData, "whatsappNumber"),
    category: text(formData, "category"),
    commissionRate: sharePct / 100,
    responseTimeoutMinutes: timeout,
    active: formData.get("active") === "on",
    verified: formData.get("verified") === "on",
    subcategories: list(text(formData, "subcategories")),
    serviceAreas: list(text(formData, "serviceAreas")),
    deliveryZones: list(text(formData, "deliveryZones")),
    email: optional("email"),
    bankName: optional("bankName"),
    accountNumber: optional("accountNumber"),
    accountName: optional("accountName"),
    notes: optional("notes"),
    backupVendorId: optional("backupVendorId"),
  };

  let createdId: string | null = null;
  try {
    if (isUpdate) {
      await opsFetch<Vendor>(`/ops/vendors/${id}`, { method: "PATCH", body });
    } else {
      const created = await opsFetch<Vendor>("/ops/vendors", { method: "POST", body });
      createdId = created.id;
    }
  } catch (error) {
    return asFailure(error);
  }

  revalidatePath("/ops/vendors");
  if (createdId) redirect(`/ops/vendors/${createdId}?created=1`);
  revalidatePath(`/ops/vendors/${id}`);
  return { ok: true, message: "Saved." };
}

// ----------------------------------------------------------- offerings

export interface SaveOfferingInput {
  vendorId: string;
  giftTemplateId: string;
  priceNaira: string;
  zones: string;
  available: boolean;
  approved: boolean;
}

export async function saveOfferingAction(input: SaveOfferingInput): Promise<ActionResult> {
  if (!input.giftTemplateId) return fail(["Choose a gift."]);

  const vendorPrice = parseNairaToKobo(input.priceNaira);
  if (vendorPrice === null || vendorPrice < 1) {
    return fail(["Enter the vendor price in naira, e.g. 5600 or 5600.50."]);
  }

  try {
    await opsFetch<Offering>(`/ops/vendors/${input.vendorId}/offerings/${input.giftTemplateId}`, {
      method: "PUT",
      body: {
        vendorPrice,
        availableZones: list(input.zones),
        available: input.available,
        approved: input.approved,
      },
    });
  } catch (error) {
    return asFailure(error);
  }

  revalidatePath(`/ops/vendors/${input.vendorId}`);
  revalidatePath("/ops/vendors");
  return { ok: true, message: "Offering saved." };
}

export async function removeOfferingAction(vendorId: string, giftTemplateId: string): Promise<ActionResult> {
  try {
    await opsFetch<{ removed: boolean }>(`/ops/vendors/${vendorId}/offerings/${giftTemplateId}`, {
      method: "DELETE",
    });
  } catch (error) {
    return asFailure(error);
  }

  revalidatePath(`/ops/vendors/${vendorId}`);
  revalidatePath("/ops/vendors");
  return { ok: true };
}

// ---------------------------------------------------------- redemption

export type LookupResult =
  | { ok: true; redemption: RedemptionLookup }
  | { ok: false; errors: string[] };

/**
 * Reads a code back without changing anything, so whoever is at the
 * counter can see WHAT they're handing over and to WHOM before
 * confirming. Deliberately a separate step from completing: collection
 * is irreversible and single-use, and a one-tap "redeem" on a typo is
 * a gift destroyed.
 */
export async function lookupRedemptionAction(rawCode: string): Promise<LookupResult> {
  const code = rawCode.trim();
  if (!code) return fail(["Enter the code from the recipient's screen."]);

  try {
    const redemption = await opsFetch<RedemptionLookup>(
      `/ops/redemptions/${encodeURIComponent(code)}`,
    );
    return { ok: true, redemption };
  } catch (error) {
    return asFailure(error);
  }
}

/**
 * The irreversible half. The API re-reads the redemption token from
 * this same code server-side — it is never sent to the browser — and
 * re-checks that the gift can still be collected before the atomic
 * attempt_redemption() runs, so two people confirming the same code at
 * once cannot both succeed.
 */
export async function completeRedemptionAction(input: {
  code: string;
  vendorId: string;
}): Promise<ActionResult> {
  if (!input.vendorId) {
    return fail(["Choose which vendor is handing this over."]);
  }

  try {
    await opsFetch<{ redemptionNumber: string; status: string }>(
      `/ops/redemptions/${encodeURIComponent(input.code)}/complete`,
      { method: "POST", body: { vendorId: input.vendorId } },
    );
  } catch (error) {
    return asFailure(error);
  }

  return { ok: true, message: "Collected. The recipient's page now shows it as handed over." };
}
