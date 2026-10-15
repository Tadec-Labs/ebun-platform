import { API_BASE_URL } from "@/lib/api-config";
import { getVendorToken } from "./session";

export class VendorApiError extends Error {
  constructor(
    public readonly messages: string[],
    public readonly status: number,
  ) {
    super(messages.join(" "));
    this.name = "VendorApiError";
  }
}

export interface VendorIdentity {
  businessName: string;
}

/** One of the vendor's own items, as their counter link shows it. Mirrors the API's PortalOfferingView. */
export interface VendorOffering {
  giftTemplateId: string;
  name: string;
  imageUrl: string | null;
  inStorePrice: number; // kobo
  youReceive: number; // kobo
  /** The vendor's own switch: false = sold out today. */
  available: boolean;
  status: "live" | "awaiting_approval" | "not_on_sale";
  /** kobo — a new shop price they asked for, waiting on SendEbun. Null = none. */
  proposedPrice: number | null;
  /** False when another shop sells the same gift — its price is SendEbun's to change. */
  canChangePrice: boolean;
}

/** Someone who booked a time to collect here. Mirrors the API's PickupView. */
export interface VendorPickup {
  orderId: string;
  giftName: string;
  recipientFirstName: string;
  pickupAt: string; // ISO
  /** This vendor already tapped "Got it". */
  confirmed: boolean;
  /** kobo — already paid by the sender, owed to this vendor on handover. */
  youReceive: number | null;
}

/** Mirrors the API's VendorDeliveryView (deliveries.service.ts). A doorstep gift this shop is delivering. */
export interface VendorDelivery {
  orderId: string;
  orderNumber: string | null;
  giftName: string;
  recipientName: string;
  phone: string;
  address: string;
  area: string | null;
  note: string | null;
  /** new = not seen yet; acknowledged = "Got it"; on_the_way = rider has it. */
  stage: "new" | "acknowledged" | "on_the_way";
  /** kobo — item plus delivery fee, credited when delivered. */
  youReceive: number | null;
  assignedAt: string | null;
}

/** Mirrors the API's EarningsView. Amounts in kobo. */
export interface VendorEarnings {
  owedNow: number;
  paidTotal: number;
  collections: {
    orderId: string;
    orderNumber: string | null;
    giftName: string;
    amount: number;
    collectedAt: string;
    paid: boolean;
    paidAt: string | null;
  }[];
  payments: {
    id: string;
    amount: number;
    collections: number;
    paidAt: string | null;
    method: string | null;
    reference: string | null;
  }[];
}

/** The vendor's own details. Mirrors the API's VendorProfileView. */
export interface VendorProfile {
  businessName: string;
  ownerName: string;
  pickupAddress: string | null;
  pickupHours: string | null;
  /** Where order alerts are emailed. */
  email: string | null;
  /** Second number SendEbun can call. */
  backupPhone: string | null;
  bank: { bankName: string | null; accountName: string | null; accountLast4: string } | null;
  /** What still stops recipients being sent here. Empty = ready. */
  missing: string[];
}

export interface VendorRedemption {
  code: string;
  redemptionNumber: string;
  status: string;
  orderNumber: string | null;
  recipientName: string | null;
  giftName: string | null;
  expiresAt: string;
  completedAt: string | null;
  redeemable: boolean;
  blockedReason: string | null;
}

/**
 * Server-side only: attaches the counter token from the httpOnly
 * cookie. A 401 is thrown rather than redirected, because the only
 * sensible destination for a dead vendor link is a page saying so —
 * there is no login to send them to.
 */
export async function vendorFetch<T>(
  path: string,
  init: { method?: "GET" | "POST" | "PATCH" | "DELETE"; body?: unknown } = {},
): Promise<T> {
  const token = await getVendorToken();
  if (!token) {
    throw new VendorApiError(["This device isn't linked to a vendor yet."], 401);
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method: init.method ?? "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        // FormData sets its own multipart boundary header; anything else is JSON.
        ...(init.body !== undefined && !(init.body instanceof FormData)
          ? { "Content-Type": "application/json" }
          : {}),
      },
      body:
        init.body === undefined
          ? undefined
          : init.body instanceof FormData
            ? init.body
            : JSON.stringify(init.body),
      cache: "no-store",
    });
  } catch {
    throw new VendorApiError(
      ["Couldn't reach SendEbun. Check the connection and try again."],
      0,
    );
  }

  if (!res.ok) {
    let messages = [`Something went wrong (${res.status}).`];
    try {
      const body: unknown = await res.json();
      if (body && typeof body === "object" && "message" in body) {
        const m = (body as { message: unknown }).message;
        if (typeof m === "string") messages = [m];
        else if (Array.isArray(m)) messages = m.filter((x): x is string => typeof x === "string");
      }
    } catch {
      // Not JSON — keep the generic message.
    }
    throw new VendorApiError(messages, res.status);
  }

  return (await res.json()) as T;
}
