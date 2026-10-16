import { API_BASE_URL } from "@/lib/api-config";
import { getCompanyToken } from "./session";

export class CompanyApiError extends Error {
  constructor(
    public readonly messages: string[],
    public readonly status: number,
  ) {
    super(messages.join(" "));
    this.name = "CompanyApiError";
  }
}

/** Mirrors the API's CampaignGiftOptionView. Amounts in kobo. */
export interface CampaignGiftOption {
  giftTemplateId: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  deliveryType: string;
  giftValue: number;
  deliveryFee: number;
  seatPrice: number;
  available: boolean;
}

export interface CampaignQuote {
  recipients: number;
  seatPrice: number;
  giftTotal: number;
  feeBps: number;
  fee: number;
  amountDue: number;
}

/** Mirrors the API's CampaignView. */
export interface Campaign {
  id: string;
  status: "draft" | "awaiting_payment" | "paid" | "cancelled";
  companyName: string;
  contactName: string;
  contactEmail: string;
  title: string;
  senderDisplayName: string | null;
  message: {
    type: "text" | "voice" | "video";
    text: string | null;
    durationSecs: number | null;
    playbackUrl: string | null;
  };
  sendAt: string | null;
  giftDays: number;
  options: CampaignGiftOption[];
  recipientsCount: number;
  quote: CampaignQuote | null;
  missing: string[];
  paidAt: string | null;
  linksSentAt: string | null;
  mediaEnabled: boolean;
}

/** A gift a company can offer. */
export interface CampaignCatalogueItem {
  id: string;
  name: string;
  description: string | null;
  category: string;
  imageUrl: string | null;
  deliveryType: string;
  giftValue: number;
  deliveryFee: number;
  seatPrice: number;
}

export interface CampaignPerson {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  note: string | null;
}

export type RecipientStage =
  | "not_paid"
  | "waiting"
  | "sent"
  | "opened"
  | "on_its_way"
  | "used"
  | "expired"
  | "refunded"
  | "problem";

/** Mirrors the API's CampaignReport. */
export interface CampaignReport {
  totals: Record<RecipientStage, number> & { people: number; thanked: number };
  money: { paid: number; used: number; creditDue: number };
  choices: { giftTemplateId: string; name: string; count: number }[];
  rows: {
    recipientId: string;
    name: string;
    phone: string;
    email: string | null;
    note: string | null;
    stage: RecipientStage;
    giftName: string | null;
    choosing: boolean;
    linkSentAt: string | null;
    linkSendError: string | null;
    thanks: string | null;
  }[];
  thanks: { name: string; note: string; at: string }[];
}

export interface AddPeopleResult {
  added: number;
  alreadyOnList: number;
  problems: { line: number; reason: string }[];
  total: number;
}

/**
 * Server-side only: calls the API as the company whose link is in the
 * cookie. Returns null on 401 — the page then shows "this link no longer
 * works" rather than an error.
 */
export async function companyFetch<T>(
  path: string,
  init: { method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE"; body?: unknown } = {},
): Promise<T | null> {
  const token = await getCompanyToken();
  if (!token) return null;

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/company${path}`, {
      method: init.method ?? "GET",
      headers: {
        Authorization: `Bearer ${token}`,
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
    throw new CompanyApiError(["Couldn't reach SendEbun. Check your connection and try again."], 0);
  }

  if (res.status === 401) return null;
  if (!res.ok) {
    let messages = [`Something went wrong (${res.status}). Please try again.`];
    try {
      const body: unknown = await res.json();
      if (body && typeof body === "object" && "message" in body) {
        const m = (body as { message: unknown }).message;
        if (typeof m === "string") messages = [m];
        else if (Array.isArray(m)) messages = m.filter((x): x is string => typeof x === "string");
      }
    } catch {
      // keep the generic message
    }
    throw new CompanyApiError(messages, res.status);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}
