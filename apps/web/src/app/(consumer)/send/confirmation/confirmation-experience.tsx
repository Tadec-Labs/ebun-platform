"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ChatGlyph, CheckGlyph } from "@/components/icons";
import {
  type OrderConfirmation,
  getOrderConfirmation,
} from "@/lib/orders/get-order-confirmation";
import { giftMessage, whatsappChatUrl } from "@/lib/whatsapp-share";

// The webhook that actually confirms payment is asynchronous — usually a
// couple of seconds behind the redirect, occasionally much longer. Poll
// briefly, then stop and say so honestly rather than spin forever.
const POLL_INTERVAL_MS = 3000;
const MAX_ATTEMPTS = 20; // ~60s

type ViewState =
  | { kind: "checking"; data?: OrderConfirmation }
  | { kind: "confirmed"; data: OrderConfirmation }
  | { kind: "unsuccessful"; data: OrderConfirmation }
  | { kind: "timeout"; data?: OrderConfirmation }
  | { kind: "not_found" };

export function ConfirmationExperience({
  reference,
  autoDelivery,
}: {
  reference: string | null;
  /**
   * Whether Ebun delivers the WhatsApp message itself (see
   * lib/feature-flags.ts). Off, the sender sends the link — so sending
   * becomes this screen's main action rather than a fallback.
   */
  autoDelivery: boolean;
}) {
  const [state, setState] = useState<ViewState>(() =>
    reference ? { kind: "checking" } : { kind: "not_found" },
  );
  // Bumped by "Check again" to restart polling without a page reload.
  const [runId, setRunId] = useState(0);

  useEffect(() => {
    if (!reference) return;

    let cancelled = false;
    let attempts = 0;
    let timer: number | undefined;
    let lastData: OrderConfirmation | undefined;

    async function poll() {
      attempts += 1;
      const result = await getOrderConfirmation(reference as string);
      if (cancelled) return;

      if (result.kind === "not_found") {
        setState({ kind: "not_found" });
        return;
      }

      if (result.kind === "ok") {
        lastData = result.data;
        if (result.data.status === "confirmed") {
          setState({ kind: "confirmed", data: result.data });
          return;
        }
        if (result.data.status === "unsuccessful") {
          setState({ kind: "unsuccessful", data: result.data });
          return;
        }
        setState({ kind: "checking", data: result.data });
      }
      // A network "error" falls through and is retried like "awaiting".

      if (attempts >= MAX_ATTEMPTS) {
        setState({ kind: "timeout", data: lastData });
        return;
      }
      timer = window.setTimeout(poll, POLL_INTERVAL_MS);
    }

    void poll();

    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [reference, runId]);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[440px] flex-col px-7 pb-10">
      <div
        className="font-display pt-6 pb-8 text-center text-base tracking-[0.2em]"
        style={{ color: "var(--gold)" }}
      >
        EBUN
      </div>

      <div className="flex flex-1 flex-col justify-center gap-8" aria-live="polite">
        {state.kind === "checking" && (
          <Centered
            mark={<PendingRing />}
            title="Confirming your payment…"
            body="This usually takes just a few seconds. Please keep this page open."
          />
        )}

        {state.kind === "confirmed" &&
          (autoDelivery ? (
            <>
              <Centered
                mark={<ConfirmedRing />}
                title="Payment received."
                body={deliveryPromise(state.data)}
              />
              <Receipt data={state.data} />
              {state.data.revealUrl && (
                <SendItYourself data={state.data} revealUrl={state.data.revealUrl} prominence="fallback" />
              )}
              <PrimaryLink href="/send">Send another gift</PrimaryLink>
            </>
          ) : state.data.revealUrl ? (
            <>
              <Centered
                mark={<ConfirmedRing />}
                title={`Now send it to ${firstName(state.data.recipientName)}.`}
                body="Payment received and the gift is ready. One tap opens WhatsApp with your message already written — just press send."
              />
              <SendItYourself data={state.data} revealUrl={state.data.revealUrl} prominence="primary" />
              <Receipt data={state.data} />
              <SecondaryLink href="/send">Send another gift</SecondaryLink>
            </>
          ) : (
            // Paid, but the link is held back: a gift scheduled before
            // "Send later" was switched off, still before its date.
            <>
              <Centered
                mark={<ConfirmedRing />}
                title="Payment received."
                body={scheduledSelfSendPromise(state.data)}
              />
              <Receipt data={state.data} />
              <SecondaryLink href="/send">Send another gift</SecondaryLink>
            </>
          ))}

        {state.kind === "unsuccessful" && (
          <>
            <Centered
              title="This order wasn’t completed."
              body="The payment didn’t go through, so nothing has been sent. You can try again whenever you’re ready."
            />
            <Receipt data={state.data} />
            <PrimaryLink href="/send">Try again</PrimaryLink>
          </>
        )}

        {state.kind === "timeout" && (
          <>
            <Centered
              title="Still waiting on confirmation."
              body="If you finished paying, there’s nothing more to do — this can take a little longer than usual. Check again in a minute."
            />
            {state.data && <Receipt data={state.data} />}
            <button
              type="button"
              onClick={() => {
                setState({ kind: "checking", data: state.data });
                setRunId((n) => n + 1);
              }}
              className="w-full py-3.5 text-sm font-medium tracking-wide"
              style={{ background: "var(--gold)", color: "var(--ink)" }}
            >
              Check again
            </button>
          </>
        )}

        {state.kind === "not_found" && (
          <>
            <Centered
              title="We couldn’t find that order."
              body="The link may be incomplete. If you’ve just paid, give it a moment and reopen the link from Paystack."
            />
            <PrimaryLink href="/send">Back to start</PrimaryLink>
          </>
        )}
      </div>
    </div>
  );
}

function Centered({
  mark,
  title,
  body,
}: {
  mark?: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="flex flex-col items-center gap-5 text-center">
      {mark}
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-3xl font-normal" style={{ color: "var(--cream)" }}>
          {title}
        </h1>
        <p className="mx-auto max-w-[30ch] text-sm leading-relaxed" style={{ color: "var(--cream-dim)" }}>
          {body}
        </p>
      </div>
    </div>
  );
}

function PendingRing() {
  return (
    <div
      className="flex h-16 w-16 animate-pulse items-center justify-center rounded-full border"
      style={{ borderColor: "var(--gold-dim)" }}
    >
      <span className="h-2 w-2 rounded-full" style={{ background: "var(--gold)" }} />
    </div>
  );
}

function ConfirmedRing() {
  return (
    <div
      className="flex h-16 w-16 items-center justify-center rounded-full border"
      style={{ borderColor: "var(--gold)", background: "var(--gold-glow)" }}
    >
      <CheckGlyph className="h-7 w-7 text-[color:var(--gold)]" />
    </div>
  );
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

/**
 * Sending the gift. Used two ways:
 *
 * "primary" — WhatsApp delivery is the sender's job (automatic delivery
 * off). The whole screen exists to get this tapped, so it leads, with
 * the recipient's name in the button: a named action reads as one step
 * left, not as a feature to evaluate.
 *
 * "fallback" — Ebun sends the WhatsApp message, and this is the safety
 * net for when it doesn't arrive. Same controls, quieter.
 *
 * Opens a chat with the recipient's number directly (wa.me/<number>),
 * because the sender has just typed that number and making them hunt
 * for the contact again is a step that loses people. "A different chat"
 * covers the cases where that's wrong — a family group, a second
 * number, someone saved under a nickname.
 */
function SendItYourself({
  data,
  revealUrl,
  prominence,
}: {
  data: OrderConfirmation;
  revealUrl: string;
  prominence: "primary" | "fallback";
}) {
  const [opened, setOpened] = useState(false);
  const [copied, setCopied] = useState(false);
  const name = firstName(data.recipientName);
  const text = giftMessage(data.recipientName, revealUrl);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(revealUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be refused (permissions, insecure context). The
      // link is still on screen to select by hand.
    }
  }

  const primary = prominence === "primary";

  return (
    <div
      className="flex flex-col gap-3"
      style={primary ? undefined : { borderTop: "1px solid var(--border)", paddingTop: "1.25rem" }}
    >
      {!primary && (
        <p className="text-xs leading-relaxed" style={{ color: "var(--cream-dim)" }}>
          Message not arrived? Send the link yourself.
        </p>
      )}

      <a
        href={whatsappChatUrl(data.recipientPhone, text)}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => setOpened(true)}
        className={`flex w-full items-center justify-center gap-2.5 text-sm font-medium tracking-wide transition-opacity hover:opacity-90 ${
          primary ? "py-4" : "border py-3"
        }`}
        style={
          primary
            ? { background: "var(--gold)", color: "var(--ink)" }
            : { borderColor: "var(--border-strong)", color: "var(--gold-light)" }
        }
      >
        <ChatGlyph className="h-[18px] w-[18px]" />
        {opened ? `Open WhatsApp again` : `Send to ${name} on WhatsApp`}
      </a>

      {opened && primary && (
        <p className="text-center text-xs leading-relaxed" style={{ color: "var(--cream-dim)" }} role="status">
          Once you&rsquo;ve pressed send in WhatsApp, you&rsquo;re done. {name} opens it from there.
        </p>
      )}

      <div className="flex items-center justify-center gap-5 text-xs">
        <a
          href={whatsappChatUrl(null, text)}
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-4 transition-colors hover:text-[color:var(--cream)]"
          style={{ color: "var(--cream-dim)" }}
        >
          Send to a different chat
        </a>
        <span aria-hidden="true" style={{ color: "var(--cream-faint)" }}>
          ·
        </span>
        <button
          type="button"
          onClick={() => void handleCopy()}
          className="underline underline-offset-4 transition-colors hover:text-[color:var(--cream)]"
          style={{ color: "var(--cream-dim)" }}
        >
          {copied ? "Link copied" : "Copy link"}
        </button>
      </div>

      {primary && (
        <p className="text-center text-[11px] leading-relaxed" style={{ color: "var(--cream-faint)" }}>
          Anyone with this link can open the gift, so send it only to {name}.
        </p>
      )}
    </div>
  );
}

/**
 * What the sender is told happens next. A scheduled gift says when,
 * and deliberately offers no link to copy — see OrderConfirmation.
 */
function deliveryPromise(data: OrderConfirmation): string {
  if (!data.scheduledSendAt) {
    return `${data.recipientName} will get a WhatsApp message with a link to open your gift.`;
  }

  const when = new Date(data.scheduledSendAt).toLocaleString("en-NG", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
  });
  return `Saved for ${when}. ${data.recipientName} will get a WhatsApp message then — nothing reaches them before.`;
}

/**
 * Only reachable for a gift scheduled while automatic delivery was
 * expected, now that it isn't: the link stays held back until the date
 * (see OrdersService.getConfirmation), so the honest instruction is to
 * come back to this page then.
 */
function scheduledSelfSendPromise(data: OrderConfirmation): string {
  if (!data.scheduledSendAt) {
    return "Your gift is ready. Refresh this page in a moment to send it.";
  }
  const when = new Date(data.scheduledSendAt).toLocaleString("en-NG", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
  });
  return `Saved for ${when}. Come back to this page then and you'll be able to send it to ${firstName(data.recipientName)} on WhatsApp.`;
}

function Receipt({ data }: { data: OrderConfirmation }) {
  return (
    <div className="flex flex-col gap-3 border p-4 text-sm" style={{ borderColor: "var(--border)" }}>
      <ReceiptRow label="Order" value={data.orderNumber ?? "—"} />
      <ReceiptRow label="For" value={data.recipientName} />
    </div>
  );
}

function ReceiptRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span style={{ color: "var(--cream-dim)" }}>{label}</span>
      <span style={{ color: "var(--cream)" }}>{value}</span>
    </div>
  );
}

function PrimaryLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="block w-full py-3.5 text-center text-sm font-medium tracking-wide"
      style={{ background: "var(--gold)", color: "var(--ink)" }}
    >
      {children}
    </Link>
  );
}

function SecondaryLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="block w-full py-2 text-center text-xs tracking-wide underline underline-offset-4 transition-colors hover:text-[color:var(--cream)]"
      style={{ color: "var(--cream-dim)" }}
    >
      {children}
    </Link>
  );
}
