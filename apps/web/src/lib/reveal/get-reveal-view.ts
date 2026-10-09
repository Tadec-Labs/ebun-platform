import { FulfillmentType, OrderStatus, RedemptionStatus } from "@ebun/types";
import { API_BASE_URL } from "@/lib/api-config";
import { renderQrSvg } from "./qr";
import { deriveScreenState } from "./types";
import type { RevealPayload, RevealScreenState } from "./types";

/**
 * Mirrors apps/api/src/reveal/reveal-view.interface.ts. Kept as a
 * separate type from RevealPayload on purpose: the API answers "what
 * is the state of this order", in four coarse buckets it deliberately
 * refuses to over-specify, while the screen needs a finer set that
 * includes claimed/redeemed. The mapping between them lives in this
 * file and nowhere else.
 */
interface ApiRevealView {
  viewState: "not_ready" | "ready" | "expired" | "unavailable";
  orderStatus: OrderStatus;
  fulfillmentType?: FulfillmentType;
  recipientName?: string;
  senderName?: string | null;
  giftName?: string;
  giftDescription?: string | null;
  giftImageUrl?: string | null;
  theme?: string;
  message?: {
    type: "text" | "voice" | "video";
    text?: string | null;
    playbackUrl?: string;
    durationSecs?: number | null;
  };
  redemption?: {
    status: RedemptionStatus;
    fallbackCode: string;
    qrPayload: string;
    expiresAt: string;
  };
}

export type RevealFetchResult =
  | { kind: "ok"; payload: RevealPayload }
  | { kind: "not_found" }
  | { kind: "error" };

const THEMES = ["gold", "red", "white", "green"] as const;
type Theme = (typeof THEMES)[number];

/** The column is free-text in the schema; anything unrecognised falls back rather than rendering an undefined class. */
function toTheme(raw: string | undefined): Theme {
  return THEMES.includes(raw as Theme) ? (raw as Theme) : "gold";
}

/**
 * Fetches a real gift. Previously returned canned scenarios keyed by
 * token; that scaffolding (and its on-screen scenario switcher) is gone
 * now that every screen has a real state behind it.
 *
 * `no-store` is not optional here: this page is the recipient's view of
 * a single-use gift, and a cached copy would show a collected gift as
 * still collectable. GET /reveal/:token is also not a pure read — the
 * first call transitions the order to reveal_opened server-side — so a
 * cached response would quietly swallow that too.
 */
export async function getRevealView(token: string): Promise<RevealFetchResult> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/reveal/${encodeURIComponent(token)}`, {
      cache: "no-store",
    });
  } catch {
    return { kind: "error" };
  }

  // 400 is a token that isn't even a UUID (the API parses it with
  // ParseUUIDPipe), which from a visitor's point of view is the same
  // thing as a link that doesn't exist — a mistyped or truncated URL.
  if (res.status === 404 || res.status === 400) return { kind: "not_found" };
  if (!res.ok) return { kind: "error" };

  let view: ApiRevealView;
  try {
    view = (await res.json()) as ApiRevealView;
  } catch {
    return { kind: "error" };
  }

  return { kind: "ok", payload: await toPayload(view) };
}

/**
 * The API's own view of a gift, in this screen's vocabulary.
 *
 * Exported because POST /reveal/:token/accept returns the identical
 * shape (RevealService.acceptGift ends by re-reading view()), so the
 * claim action maps its response through exactly this function rather
 * than keeping a second, drifting copy of the rules.
 */
export async function toPayload(view: ApiRevealView): Promise<RevealPayload> {
  // The three non-viewable states are deliberately minimal server-side
  // — no gift, no sender, no message for a link that isn't valid to
  // view — so there is nothing here to map beyond the state itself.
  if (view.viewState !== "ready") {
    return {
      screenState: view.viewState as RevealScreenState,
      orderStatus: view.orderStatus,
    };
  }

  const fulfillmentType = view.fulfillmentType ?? FulfillmentType.DigitalVoucher;

  // deriveScreenState handles everything the order's own status can
  // answer. The one thing it cannot see is whether a redemption record
  // exists yet, which is the whole difference between "scratch this"
  // and "here is your code" — both of which are orderStatus
  // reveal_opened.
  let screenState = deriveScreenState(view.orderStatus, fulfillmentType, false);
  if (screenState === "ready" && view.redemption) {
    screenState = "claimed";
  }

  const payload: RevealPayload = {
    screenState,
    orderStatus: view.orderStatus,
    fulfillmentType,
    recipientName: view.recipientName,
    senderName: view.senderName,
    giftName: view.giftName,
    giftDescription: view.giftDescription,
    giftImageUrl: view.giftImageUrl,
    theme: toTheme(view.theme),
    message: view.message,
  };

  if (view.redemption) {
    payload.redemption = {
      fallbackCode: view.redemption.fallbackCode,
      qrPayload: view.redemption.qrPayload,
      validUntil: view.redemption.expiresAt,
      // No vendorHint: nothing assigns a vendor to an order yet, so
      // there is no honest answer to "where do I take this". Inventing
      // one would send someone to a counter that has never heard of
      // Ebun. The ClaimedScreen simply omits the box.
    };
    payload.qrSvg = await renderQrSvg(view.redemption.qrPayload);
  }

  return payload;
}
