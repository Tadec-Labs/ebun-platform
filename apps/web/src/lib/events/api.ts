import { API_BASE_URL } from "@/lib/api-config";
import { readApiError } from "@/lib/group/api";
import type {
  CashGiftPayload,
  CashGiftResult,
  CreateEventPayload,
  CreateEventResult,
  EventPublicView,
  WallEntry,
} from "./types";

export class EventError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "EventError";
  }
}

export type EventFetchResult = { kind: "ok"; event: EventPublicView } | { kind: "not_found" } | { kind: "error" };

/** Server-side: the public event page. 404 also when events are switched off. */
export async function getEvent(slug: string): Promise<EventFetchResult> {
  try {
    const res = await fetch(`${API_BASE_URL}/events/${encodeURIComponent(slug)}`, { cache: "no-store" });
    if (res.status === 404 || res.status === 400) return { kind: "not_found" };
    if (!res.ok) return { kind: "error" };
    return { kind: "ok", event: (await res.json()) as EventPublicView };
  } catch {
    return { kind: "error" };
  }
}

/** Browser: the wall feed, newest first. Null on any failure — the screen keeps what it has. */
export async function getWall(slug: string): Promise<WallEntry[] | null> {
  try {
    const res = await fetch(`${API_BASE_URL}/events/${encodeURIComponent(slug)}/wall`, { cache: "no-store" });
    if (!res.ok) return null;
    return ((await res.json()) as { entries: WallEntry[] }).entries;
  } catch {
    return null;
  }
}

/** Browser: set up an event. */
export function createEvent(payload: CreateEventPayload): Promise<CreateEventResult> {
  return post<CreateEventResult>("/events", payload);
}

/**
 * Browser: open a Paystack checkout for a cash gift. Nothing is counted
 * until Paystack's signed webhook reaches the API, so the page this
 * returns to never treats ?paid=1 as proof.
 */
export function giveCash(slug: string, payload: CashGiftPayload): Promise<CashGiftResult> {
  return post<CashGiftResult>(`/events/${encodeURIComponent(slug)}/cash-gifts`, payload);
}

export type CashGiftStatus = "pending" | "confirmed" | "late" | "failed" | "refunded";

export async function cashGiftStatus(slug: string, reference: string): Promise<CashGiftStatus | null> {
  try {
    const res = await fetch(
      `${API_BASE_URL}/events/${encodeURIComponent(slug)}/cash-gifts/${encodeURIComponent(reference)}`,
      { cache: "no-store" },
    );
    if (!res.ok) return null;
    return ((await res.json()) as { status: CashGiftStatus }).status;
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
    throw new EventError("Couldn't reach SendEbun. Check your connection and try again.", 0);
  }
  if (res.status === 404) throw new EventError("This isn't open just now. Please try again later.", 404);
  if (res.status === 429) throw new EventError("That's a lot of tries from here. Please wait a little and try again.", 429);
  if (!res.ok) throw new EventError(await readApiError(res), res.status);
  return (await res.json()) as T;
}
