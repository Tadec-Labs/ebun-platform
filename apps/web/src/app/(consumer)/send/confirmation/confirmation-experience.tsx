"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CheckGlyph } from "@/components/icons";
import {
  type OrderConfirmation,
  getOrderConfirmation,
} from "@/lib/orders/get-order-confirmation";

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

export function ConfirmationExperience({ reference }: { reference: string | null }) {
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

        {state.kind === "confirmed" && (
          <>
            <Centered
              mark={<ConfirmedRing />}
              title="Payment received."
              body={`${state.data.recipientName} will get a WhatsApp message with a link to open your gift.`}
            />
            <Receipt data={state.data} />
            {state.data.revealUrl && <RevealLinkFallback url={state.data.revealUrl} />}
            <PrimaryLink href="/send">Send another gift</PrimaryLink>
          </>
        )}

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

/**
 * Shown whenever a reveal link exists, not just while WhatsApp delivery
 * is unconfigured — a sender whose recipient never gets the WhatsApp
 * message, for any reason, still has a way to forward the gift
 * themselves rather than hitting a dead end.
 */
function RevealLinkFallback({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can fail (permissions, insecure context) —
      // the link is still visible and selectable by hand either way.
    }
  }

  return (
    <div className="flex flex-col gap-2 border p-4" style={{ borderColor: "var(--border)" }}>
      <p className="text-xs leading-relaxed" style={{ color: "var(--cream-dim)" }}>
        You can also send this link yourself, in case the WhatsApp message is delayed.
      </p>
      <div className="flex items-center gap-3">
        <span
          className="flex-1 truncate text-xs"
          style={{ color: "var(--gold-light)" }}
        >
          {url}
        </span>
        <button
          type="button"
          onClick={() => void handleCopy()}
          className="flex-shrink-0 px-3 py-1.5 text-[11px] tracking-wide"
          style={{ background: "var(--gold)", color: "var(--ink)" }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
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
