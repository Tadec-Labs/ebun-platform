"use client";

import { useState, useTransition } from "react";
import { GiftMark } from "@/components/icons";
import type { CompanyGift } from "@/lib/reveal/types";
import { chooseGiftAction, sendThanksAction } from "../actions";

/**
 * A company gift with a few options: the recipient picks one.
 *
 * Nothing is chosen on tap — they look, select, then confirm, because the
 * choice is final and a stray thumb on a crowded screen shouldn't decide
 * it. Once chosen, the page reloads into the normal reveal for that gift,
 * so everything after this point is the same journey as any other gift.
 */
export function ChooseScreen({
  token,
  recipientName,
  senderName,
  company,
}: {
  token: string;
  recipientName?: string;
  senderName?: string | null;
  company: CompanyGift;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const choices = company.choices ?? [];
  const picked = choices.find((c) => c.giftTemplateId === selected);

  return (
    <div className="flex flex-1 flex-col gap-7 pt-6">
      <div className="flex flex-col gap-2 text-center">
        <p className="text-xs tracking-wide" style={{ color: "var(--gold-dim)" }}>
          FROM {company.companyName.toUpperCase()}
        </p>
        <h1 className="font-display text-4xl leading-tight font-normal" style={{ color: "var(--cream)" }}>
          {recipientName && (
            <>
              {recipientName},
              <br />
            </>
          )}
          {company.title}
        </h1>
        <p className="mx-auto max-w-[30ch] text-sm leading-relaxed" style={{ color: "var(--cream-dim)" }}>
          {senderName && senderName !== company.companyName ? `${senderName} would like you to ` : "Please "}
          choose one gift. There&rsquo;s a message waiting with it.
        </p>
      </div>

      <ul className="flex flex-col gap-3" aria-label="Your options">
        {choices.map((choice) => {
          const isSelected = choice.giftTemplateId === selected;
          return (
            <li key={choice.giftTemplateId}>
              <button
                type="button"
                onClick={() => setSelected(choice.giftTemplateId)}
                aria-pressed={isSelected}
                className="flex w-full items-stretch gap-4 border p-3 text-left transition-colors"
                style={{
                  borderColor: isSelected ? "var(--gold)" : "var(--border)",
                  background: isSelected ? "var(--panel-raised)" : "transparent",
                }}
              >
                <div
                  className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden"
                  style={{ background: "var(--panel-raised)" }}
                >
                  {choice.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- R2 photo URLs; no image optimisation needed for one thumbnail
                    <img src={choice.imageUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <GiftMark className="h-8 w-8 text-[color:var(--gold-dim)]" />
                  )}
                </div>
                <div className="flex min-w-0 flex-1 flex-col justify-center gap-1">
                  <p className="font-display text-xl leading-tight" style={{ color: "var(--cream)" }}>
                    {choice.name}
                  </p>
                  {choice.description && (
                    <p className="line-clamp-2 text-xs leading-relaxed" style={{ color: "var(--cream-dim)" }}>
                      {choice.description}
                    </p>
                  )}
                  <p className="text-[11px] tracking-wide" style={{ color: "var(--gold-dim)" }}>
                    {choice.deliveryType === "physical" ? "Delivered to your door" : "Collect it near you"}
                  </p>
                </div>
              </button>
            </li>
          );
        })}
      </ul>

      {error && (
        <p role="alert" className="border px-4 py-3 text-xs" style={{ borderColor: "var(--gold-dim)", color: "var(--cream-dim)" }}>
          {error}
        </p>
      )}

      <button
        type="button"
        disabled={!picked || pending}
        onClick={() => {
          if (!picked) return;
          setError(null);
          startTransition(async () => {
            const result = await chooseGiftAction(token, picked.giftTemplateId);
            if (!result.ok) {
              setError(result.message);
              return;
            }
            // Into the normal reveal for the gift they chose.
            window.location.reload();
          });
        }}
        className="w-full py-3.5 text-sm font-medium tracking-wide disabled:opacity-50"
        style={{ background: "var(--action)", color: "var(--ink)" }}
      >
        {pending ? "One moment…" : picked ? `Choose ${picked.name}` : "Pick one above"}
      </button>
      <p className="text-center text-[11px]" style={{ color: "var(--cream-faint)" }}>
        Your choice is final once you confirm.
      </p>
    </div>
  );
}

/**
 * A thank-you note back to the company. HR sees these together on the
 * campaign report — the part of a company gift people remember.
 */
export function ThanksPanel({ token, company }: { token: string; company: CompanyGift }) {
  const [sent, setSent] = useState(company.thanked);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (sent) {
    return (
      <p className="text-center text-xs" style={{ color: "var(--cream-dim)" }}>
        Your thank-you has gone to {company.companyName}.
      </p>
    );
  }

  return (
    <form
      className="flex flex-col gap-3 border px-4 py-4"
      style={{ borderColor: "var(--border)" }}
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
          const result = await sendThanksAction(token, note.trim());
          if (result.ok) setSent(true);
          else setError(result.message);
        });
      }}
    >
      <label htmlFor="thanks" className="text-sm" style={{ color: "var(--cream)" }}>
        Say thank you to {company.companyName}
      </label>
      <textarea
        id="thanks"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={500}
        rows={3}
        placeholder="A few words — they'll see it."
        className="resize-none border bg-transparent px-3 py-2 text-sm outline-none"
        style={{ borderColor: "var(--border)", color: "var(--cream)" }}
      />
      {error && (
        <p role="alert" className="text-xs" style={{ color: "var(--cream-dim)" }}>
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending || note.trim().length === 0}
        className="self-end border px-5 py-2 text-xs tracking-wide disabled:opacity-50"
        style={{ borderColor: "var(--gold-dim)", color: "var(--gold-light)" }}
      >
        {pending ? "Sending…" : "Send thank-you"}
      </button>
    </form>
  );
}
