import { API_BASE_URL } from "@/lib/api-config";
import type {
  ContributePayload,
  ContributeResult,
  CreateGroupGiftPayload,
  CreateGroupGiftResult,
  GroupGiftPublicView,
} from "./types";

export class GroupGiftError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "GroupGiftError";
  }
}

/** NestJS errors are { message: string | string[] }; one string for the screen. */
export async function readApiError(res: Response): Promise<string> {
  let message = `Something went wrong (${res.status}). Please try again.`;
  try {
    const body: unknown = await res.json();
    if (body && typeof body === "object" && "message" in body) {
      const m = (body as { message: unknown }).message;
      if (typeof m === "string") message = m;
      else if (Array.isArray(m)) message = m.filter((x) => typeof x === "string").join(" ");
    }
  } catch {
    // keep the generic message
  }
  return message;
}

export type PotFetchResult =
  | { kind: "ok"; pot: GroupGiftPublicView }
  | { kind: "not_found" }
  | { kind: "error" };

/** Server-side: the public pot page. */
export async function getPot(token: string): Promise<PotFetchResult> {
  try {
    const res = await fetch(`${API_BASE_URL}/group-gifts/${encodeURIComponent(token)}`, {
      cache: "no-store",
    });
    if (res.status === 404 || res.status === 400) return { kind: "not_found" };
    if (!res.ok) return { kind: "error" };
    return { kind: "ok", pot: (await res.json()) as GroupGiftPublicView };
  } catch {
    return { kind: "error" };
  }
}

/** Browser: start a pot. The target is priced by the API, never here. */
export async function createGroupGift(payload: CreateGroupGiftPayload): Promise<CreateGroupGiftResult> {
  return post<CreateGroupGiftResult>("/group-gifts", payload);
}

/**
 * Browser: open a Paystack checkout for one share. Nothing is counted
 * until Paystack's signed webhook reaches the API — the page this
 * returns to after paying must never treat ?paid=1 as proof.
 */
export async function contribute(token: string, payload: ContributePayload): Promise<ContributeResult> {
  return post<ContributeResult>(`/group-gifts/${encodeURIComponent(token)}/contributions`, payload);
}

export type ShareStatus = "pending" | "confirmed" | "late" | "failed" | "refunded";

/**
 * Browser: did this one payment land? Polled by the page Paystack returns
 * to, using the reference Paystack puts on that address. Null on any
 * failure — the page then just keeps the honest "being confirmed" line.
 */
export async function shareStatus(token: string, reference: string): Promise<ShareStatus | null> {
  try {
    const res = await fetch(
      `${API_BASE_URL}/group-gifts/${encodeURIComponent(token)}/contributions/${encodeURIComponent(reference)}`,
      { cache: "no-store" },
    );
    if (!res.ok) return null;
    return ((await res.json()) as { status: ShareStatus }).status;
  } catch {
    return null;
  }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new GroupGiftError("Couldn't reach SendEbun. Check your connection and try again.", 0);
  }
  if (res.status === 404) {
    throw new GroupGiftError("Group gifts aren't open just now. Please try again later.", 404);
  }
  if (!res.ok) throw new GroupGiftError(await readApiError(res), res.status);
  return (await res.json()) as T;
}
