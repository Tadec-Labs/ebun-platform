"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { BrandLogo } from "@/components/brand-logo";
import { CheckGlyph } from "@/components/icons";
import { EVENT_COPY, formatEventDate } from "@/lib/events/copy";
import type { EventHostView, ThankYouEntry } from "@/lib/events/types";
import { formatNaira } from "@/lib/format-money";
import { whatsappChatUrl } from "@/lib/whatsapp-share";
import {
  addItemAction,
  cancelEventAction,
  deliveryAddressAction,
  payoutAccountAction,
  removeItemAction,
  thankAction,
  updateSettingsAction,
} from "./actions";

/**
 * Paystack / NIP bank codes for the banks most hosts use. Ops checks the
 * account name against the host before any money moves, so a wrong pick
 * is caught before it costs anyone.
 */
const BANKS: { code: string; name: string }[] = [
  { code: "044", name: "Access Bank" },
  { code: "050", name: "Ecobank" },
  { code: "070", name: "Fidelity Bank" },
  { code: "011", name: "First Bank" },
  { code: "214", name: "FCMB" },
  { code: "058", name: "GTBank" },
  { code: "082", name: "Keystone Bank" },
  { code: "50211", name: "Kuda" },
  { code: "50515", name: "Moniepoint" },
  { code: "999992", name: "OPay" },
  { code: "999991", name: "PalmPay" },
  { code: "076", name: "Polaris Bank" },
  { code: "221", name: "Stanbic IBTC" },
  { code: "232", name: "Sterling Bank" },
  { code: "032", name: "Union Bank" },
  { code: "033", name: "UBA" },
  { code: "035", name: "Wema Bank" },
  { code: "057", name: "Zenith Bank" },
];

type CatalogueGift = { id: string; name: string; price: number; delivered: boolean };

/**
 * E4 · The host's page: how the giving is going, sharing the link and
 * the venue screen, the gift list, where the cash goes, and thanking
 * everyone afterwards.
 */
export function HostExperience({
  shortId,
  view,
  catalogue,
  hostLinkPath,
}: {
  shortId: string;
  view: EventHostView;
  catalogue: CatalogueGift[];
  hostLinkPath: string | null;
}) {
  const event = view.public;
  const copy = EVENT_COPY[event.eventType];
  const active = event.status === "active";
  const given = view.items.filter((i) => i.status === "given").length;
  const listed = view.items.filter((i) => i.status !== "closed").length;
  const showPayout = event.status !== "cancelled" && (view.cashRaised > 0 || view.payout.accountName !== null);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[440px] flex-col gap-8 px-7 pb-12">
      <header className="flex items-center justify-between pt-5">
        <BrandLogo size="sm" />
        <p className="text-[11px]" style={{ color: active ? "var(--success)" : "var(--cream-dim)" }}>
          {active ? "Live" : event.status === "closed" ? "Giving closed" : "Cancelled"}
        </p>
      </header>

      <div className="flex flex-col gap-1">
        <p className="text-[11px] tracking-[0.16em] uppercase" style={{ color: "var(--gold)" }}>
          {copy.label} · {formatEventDate(event.eventDate)} · {event.city}
        </p>
        <h1 className="font-display text-3xl leading-tight font-normal" style={{ color: "var(--cream)" }}>
          {event.title}
        </h1>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <Stat label={copy.cash} value={formatNaira(view.cashRaised)} hint={`${view.cashCount} guests`} />
        <Stat label="Gift list" value={listed === 0 ? "—" : `${given}/${listed}`} hint="given" />
      </div>

      {active && <Share view={view} />}

      {event.status === "cancelled" && (
        <p className="border px-4 py-3 text-sm leading-relaxed" style={{ borderColor: "var(--border-strong)", color: "var(--cream-dim)" }}>
          Cancelled. Everyone is refunded automatically.
        </p>
      )}

      {showPayout && <Payout shortId={shortId} view={view} />}

      {event.giftListEnabled && <GiftListManager shortId={shortId} view={view} catalogue={catalogue} />}

      {event.status !== "cancelled" && (view.delivery || view.items.some((i) => i.deliveryType === "physical")) && (
        <Delivery shortId={shortId} view={view} />
      )}

      {view.thankYous.length > 0 && <ThankYous shortId={shortId} title={event.title} entries={view.thankYous} />}

      {active && <Settings shortId={shortId} view={view} />}

      {view.canCancel && event.status !== "cancelled" && <Cancel shortId={shortId} />}

      {hostLinkPath && <KeepThisLink hostLinkPath={hostLinkPath} />}
    </div>
  );
}

// ---------------------------------------------------------------------------

function Share({ view }: { view: EventHostView }) {
  const [copied, setCopied] = useState(false);
  const event = view.public;
  const copy = EVENT_COPY[event.eventType];
  const url = () => `${window.location.origin}${view.sharePath}`;
  const text = () =>
    `${copy.eyebrow} ${event.title} — ${formatEventDate(event.eventDate)}.\n\nIf you'd like to give a gift${
      event.cashOpen ? ` or ${copy.cash.toLowerCase()}` : ""
    }, it's all here, from anywhere:\n${url()}`;

  return (
    <section className="flex flex-col gap-3 border p-4" style={{ borderColor: "var(--border-strong)", background: "var(--panel)" }}>
      <a
        href="#"
        onClick={(e) => {
          e.preventDefault();
          window.location.href = whatsappChatUrl(null, text());
        }}
        className="w-full py-3.5 text-center text-sm font-medium tracking-wide"
        style={{ background: "var(--action)", color: "var(--ink)" }}
      >
        Share on WhatsApp
      </a>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(url()).catch(() => undefined);
            setCopied(true);
            setTimeout(() => setCopied(false), 2_000);
          }}
          className="flex-1 border py-2.5 text-xs"
          style={{ borderColor: "var(--border)", color: "var(--cream-dim)" }}
        >
          {copied ? "Copied" : "Copy link"}
        </button>
        <Link href={view.sharePath} className="flex-1 border py-2.5 text-center text-xs" style={{ borderColor: "var(--border)", color: "var(--gold-light)" }}>
          Guest page
        </Link>
      </div>
      {event.wallEnabled && (
        <a
          href={view.wallPath}
          target="_blank"
          rel="noopener noreferrer"
          className="border py-2.5 text-center text-xs"
          style={{ borderColor: "var(--gold)", color: "var(--gold-light)" }}
        >
          Open {copy.wall.toLowerCase()} ↗
        </a>
      )}
    </section>
  );
}

function Payout({ shortId, view }: { shortId: string; view: EventHostView }) {
  const router = useRouter();
  const [editing, setEditing] = useState(view.payout.accountName === null);
  const [bankCode, setBankCode] = useState(view.payout.bankCode ?? "");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountName, setAccountName] = useState(view.payout.accountName ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const p = view.payout;

  if (p.status === "paid") {
    return (
      <Section title="Cash gifts">
        <p className="text-sm" style={{ color: "var(--success)" }}>
          {formatNaira(p.amount ?? 0)} paid to {p.accountName} {p.accountNumberMasked}
          {p.paidAt ? ` on ${new Date(p.paidAt).toLocaleDateString("en-NG", { day: "numeric", month: "short" })}` : ""}.
        </p>
      </Section>
    );
  }

  const save = () =>
    startTransition(async () => {
      setError(null);
      const result = await payoutAccountAction(shortId, { bankCode, accountNumber, accountName });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setEditing(false);
      setAccountNumber("");
      router.refresh();
    });

  return (
    <Section title="Payout">
      <p className="text-xs" style={{ color: "var(--cream-dim)" }}>
        From{" "}
        {new Date(view.public.givingClosesAt).toLocaleDateString("en-NG", { weekday: "short", day: "numeric", month: "short" })}
      </p>
      {!editing && p.accountName ? (
        <div className="flex items-center justify-between gap-3 border p-3" style={{ borderColor: "var(--border)" }}>
          <div className="flex flex-col gap-0.5">
            <span className="text-sm" style={{ color: "var(--cream)" }}>
              {p.accountName} {p.accountNumberMasked}
            </span>
            <span className="text-[11px]" style={{ color: p.verified ? "var(--success)" : "var(--gold-light)" }}>
              {p.verified ? "Verified" : "Being verified"}
            </span>
          </div>
          <button type="button" onClick={() => setEditing(true)} className="text-xs underline underline-offset-2" style={{ color: "var(--gold-light)" }}>
            Change
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs" style={{ color: "var(--cream-dim)" }}>
              Bank
            </span>
            <select
              value={bankCode}
              onChange={(e) => setBankCode(e.target.value)}
              className="border bg-transparent px-2 py-2.5 text-sm"
              style={{ borderColor: "var(--border-strong)", color: "var(--cream)", colorScheme: "dark" }}
            >
              <option value="">Bank</option>
              {BANKS.map((b) => (
                <option key={b.code} value={b.code}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs" style={{ color: "var(--cream-dim)" }}>
              Account number
            </span>
            <input
              inputMode="numeric"
              value={accountNumber}
              onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, "").slice(0, 10))}
              placeholder="10 digits"
              className="w-full border-0 border-b bg-transparent py-2 text-sm outline-none"
              style={{ borderColor: "var(--border-strong)", color: "var(--cream)" }}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs" style={{ color: "var(--cream-dim)" }}>
              Name on the account
            </span>
            <input
              value={accountName}
              onChange={(e) => setAccountName(e.target.value)}
              maxLength={120}
              className="w-full border-0 border-b bg-transparent py-2 text-sm outline-none"
              style={{ borderColor: "var(--border-strong)", color: "var(--cream)" }}
            />
          </label>
          {error && (
            <p role="alert" className="text-xs" style={{ color: "var(--error)" }}>
              {error}
            </p>
          )}
          <button
            type="button"
            onClick={save}
            disabled={pending || !bankCode || accountNumber.length !== 10 || !accountName.trim()}
            className="py-3 text-sm font-medium disabled:opacity-40"
            style={{ background: "var(--gold)", color: "var(--ink)" }}
          >
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      )}
    </Section>
  );
}

function GiftListManager({ shortId, view, catalogue }: { shortId: string; view: EventHostView; catalogue: CatalogueGift[] }) {
  const router = useRouter();
  const [pick, setPick] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const active = view.public.status === "active";
  const listed = view.items.filter((i) => i.status !== "closed");

  const add = () =>
    startTransition(async () => {
      setError(null);
      const result = await addItemAction(shortId, pick);
      if (!result.ok) return setError(result.error);
      setPick("");
      router.refresh();
    });

  const remove = (id: string, raised: number) =>
    startTransition(async () => {
      if (raised > 0 && !window.confirm("Remove it? Everyone who chipped in is refunded.")) return;
      setError(null);
      const result = await removeItemAction(shortId, id);
      if (!result.ok) return setError(result.error);
      router.refresh();
    });

  return (
    <Section title="Gift list">
      <ul className="flex flex-col gap-2">
        {listed.map((item) => (
          <li key={item.token} className="flex items-center gap-3 border p-3" style={{ borderColor: "var(--border)" }}>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate text-sm" style={{ color: "var(--cream)" }}>
                {item.name}
              </span>
              <span className="text-[11px]" style={{ color: item.status === "given" ? "var(--success)" : "var(--cream-dim)" }}>
                {item.status === "given"
                  ? item.givenBy.length > 0
                    ? `Given · ${item.givenBy.join(", ")}`
                    : "Given"
                  : `${formatNaira(item.raised)} / ${formatNaira(item.price)}`}
              </span>
            </div>
            {item.awaitingAddress && (
              <span className="text-[11px]" style={{ color: "var(--gold-light)" }}>
                Needs address
              </span>
            )}
            {item.revealPath ? (
              <a href={item.revealPath} className="text-[11px] underline underline-offset-2" style={{ color: "var(--gold-light)" }}>
                Open
              </a>
            ) : (
              item.managePath && (
                <a href={item.managePath} className="text-[11px] underline underline-offset-2" style={{ color: "var(--gold-light)" }}>
                  Manage
                </a>
              )
            )}
            {active && item.status === "open" && (
              <button
                type="button"
                disabled={pending}
                onClick={() => remove(item.id, item.raised)}
                className="text-[11px] underline underline-offset-2 disabled:opacity-40"
                style={{ color: "var(--cream-dim)" }}
              >
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>
      {active && catalogue.length > 0 && (
        <div className="flex gap-2">
          <select
            value={pick}
            onChange={(e) => setPick(e.target.value)}
            aria-label="Gift to add"
            className="min-w-0 flex-1 border bg-transparent px-2 py-2.5 text-sm"
            style={{ borderColor: "var(--border-strong)", color: "var(--cream)", colorScheme: "dark" }}
          >
            <option value="">Add a gift</option>
            {catalogue.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name} · {formatNaira(g.price)}
                {g.delivered ? " · delivered" : ""}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={add}
            disabled={!pick || pending}
            className="px-4 text-sm font-medium disabled:opacity-40"
            style={{ background: "var(--gold)", color: "var(--ink)" }}
          >
            Add
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs" style={{ color: "var(--error)" }}>
          {error}
        </p>
      )}
    </Section>
  );
}

function Delivery({ shortId, view }: { shortId: string; view: EventHostView }) {
  const router = useRouter();
  const [editing, setEditing] = useState(view.delivery === null);
  const [address, setAddress] = useState(view.delivery?.address ?? "");
  const [area, setArea] = useState(view.delivery?.area ?? "");
  const [note, setNote] = useState(view.delivery?.note ?? "");
  const [message, setMessage] = useState<{ text: string; good: boolean } | null>(null);
  const [pending, startTransition] = useTransition();

  const save = () =>
    startTransition(async () => {
      setMessage(null);
      const result = await deliveryAddressAction(shortId, { address, area, note });
      if (!result.ok) return setMessage({ text: result.error, good: false });
      const { applied, waiting } = result.data;
      setMessage(
        waiting > 0
          ? { text: `Saved. ${waiting} ${waiting === 1 ? "gift needs" : "gifts need"} an address on its own page.`, good: false }
          : { text: applied > 0 ? `Saved · ${applied} on the way` : "Saved", good: true },
      );
      setEditing(false);
      router.refresh();
    });

  return (
    <Section title="Delivery">
      {!editing && view.delivery ? (
        <div className="flex items-center justify-between gap-3 border p-3" style={{ borderColor: "var(--border)" }}>
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-sm" style={{ color: "var(--cream)" }}>
              {view.delivery.address}
            </span>
            <span className="text-[11px]" style={{ color: "var(--cream-dim)" }}>
              {view.delivery.area} · after {formatEventDate(view.public.eventDate)}
            </span>
          </div>
          <button type="button" onClick={() => setEditing(true)} className="text-xs underline underline-offset-2" style={{ color: "var(--gold-light)" }}>
            Change
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            maxLength={300}
            placeholder="Address"
            autoComplete="street-address"
            aria-label="Delivery address"
            className="w-full border-0 border-b bg-transparent py-2 text-sm outline-none"
            style={{ borderColor: "var(--border-strong)", color: "var(--cream)" }}
          />
          <input
            value={area}
            onChange={(e) => setArea(e.target.value)}
            maxLength={80}
            placeholder="Area"
            list="event-delivery-areas"
            aria-label="Area"
            className="w-full border-0 border-b bg-transparent py-2 text-sm outline-none"
            style={{ borderColor: "var(--border-strong)", color: "var(--cream)" }}
          />
          <datalist id="event-delivery-areas">
            {view.deliveryAreas.map((a) => (
              <option key={a} value={a} />
            ))}
          </datalist>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={200}
            placeholder="Note for the rider (optional)"
            aria-label="Note for the rider"
            className="w-full border-0 border-b bg-transparent py-2 text-sm outline-none"
            style={{ borderColor: "var(--border-strong)", color: "var(--cream)" }}
          />
          <button
            type="button"
            onClick={save}
            disabled={pending || address.trim().length < 5 || area.trim().length < 2}
            className="py-3 text-sm font-medium disabled:opacity-40"
            style={{ background: "var(--gold)", color: "var(--ink)" }}
          >
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      )}
      {message && (
        <p role="status" className="text-xs" style={{ color: message.good ? "var(--success)" : "var(--gold-light)" }}>
          {message.text}
        </p>
      )}
    </Section>
  );
}

function ThankYous({ shortId, title, entries }: { shortId: string; title: string; entries: ThankYouEntry[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const left = entries.filter((e) => !e.thanked).length;

  const thank = (entry: ThankYouEntry, viaWhatsApp: boolean) => {
    if (viaWhatsApp && entry.phone) {
      const first = entry.name.trim().split(/\s+/)[0] || entry.name;
      const what = entry.giftName ? `the ${entry.giftName}` : "your gift";
      // Opened first, from the tap itself, so the browser doesn't block it.
      window.open(whatsappChatUrl(entry.phone, `Thank you so much, ${first}, for ${what}. It meant a lot. — ${title}`), "_blank");
    }
    startTransition(async () => {
      await thankAction(shortId, entry.kind, entry.id);
      router.refresh();
    });
  };

  return (
    <Section title={left > 0 ? `Thank-yous · ${left}` : "All thanked"}>
      <ul className="flex flex-col gap-2">
        {entries.map((e) => (
          <li key={`${e.kind}-${e.id}`} className="flex items-center gap-3 border p-3" style={{ borderColor: "var(--border)" }}>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-sm" style={{ color: "var(--cream)" }}>
                {e.name} · {e.giftName ?? formatNaira(e.amount)}
              </span>
              {e.message && (
                <span className="truncate text-[11px] italic" style={{ color: "var(--cream-dim)" }}>
                  &ldquo;{e.message}&rdquo;
                </span>
              )}
            </div>
            {e.thanked ? (
              <span className="text-[11px]" style={{ color: "var(--success)" }}>
                Thanked
              </span>
            ) : (
              <button
                type="button"
                disabled={pending}
                onClick={() => thank(e, true)}
                className="px-3 py-2 text-[11px] disabled:opacity-40"
                style={{ background: "var(--panel-raised)", color: "var(--gold-light)" }}
              >
                {e.phone ? "Thank" : "Done"}
              </button>
            )}
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Settings({ shortId, view }: { shortId: string; view: EventHostView }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const event = view.public;
  const copy = EVENT_COPY[event.eventType];

  const set = (changes: Parameters<typeof updateSettingsAction>[1]) =>
    startTransition(async () => {
      setError(null);
      const result = await updateSettingsAction(shortId, changes);
      if (!result.ok) return setError(result.error);
      router.refresh();
    });

  const s = view.settings;
  return (
    <Section title="Settings">
      <SettingRow label="Gift list" checked={s.giftListEnabled} disabled={pending} onChange={(v) => set({ giftListEnabled: v })} />
      {view.cashAvailable ? (
        <SettingRow label={copy.cash} checked={s.cashEnabled} disabled={pending} onChange={(v) => set({ cashEnabled: v })} />
      ) : (
        <p className="border-b py-3 text-xs leading-relaxed" style={{ borderColor: "var(--border)", color: "var(--cream-dim)" }}>
          {copy.cash} · soon
        </p>
      )}
      <SettingRow label={copy.wall} checked={s.wallEnabled} disabled={pending} onChange={(v) => set({ wallEnabled: v })} />
      {event.eventType !== "remembrance" && (
        <SettingRow label="Show amounts" checked={s.showAmounts} disabled={pending} onChange={(v) => set({ showAmounts: v })} />
      )}
      {error && (
        <p role="alert" className="text-xs" style={{ color: "var(--error)" }}>
          {error}
        </p>
      )}
    </Section>
  );
}

function Cancel({ shortId }: { shortId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (!window.confirm("Cancel the event? Everyone is refunded.")) return;
          startTransition(async () => {
            const result = await cancelEventAction(shortId);
            if (!result.ok) setError(result.error);
            router.refresh();
          });
        }}
        className="self-start text-xs underline underline-offset-2 disabled:opacity-40"
        style={{ color: "var(--cream-faint)" }}
      >
        Cancel event
      </button>
      {error && (
        <p role="alert" className="text-xs" style={{ color: "var(--error)" }}>
          {error}
        </p>
      )}
    </div>
  );
}

function KeepThisLink({ hostLinkPath }: { hostLinkPath: string }) {
  const [copied, setCopied] = useState(false);
  const url = () => `${window.location.origin}${hostLinkPath}`;
  return (
    <section className="flex items-start gap-3 border-t pt-5" style={{ borderColor: "var(--border)" }}>
      <CheckGlyph className="mt-0.5 h-4 w-4 flex-shrink-0 text-[color:var(--gold-dim)]" />
      <div className="flex flex-col gap-2">
        <p className="text-xs" style={{ color: "var(--cream-dim)" }}>
          Your private link. Keep it, don&rsquo;t share it.
        </p>
        <div className="flex gap-4">
          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard.writeText(url()).catch(() => undefined);
              setCopied(true);
              setTimeout(() => setCopied(false), 2_000);
            }}
            className="text-xs underline underline-offset-2"
            style={{ color: "var(--gold-light)" }}
          >
            {copied ? "Copied" : "Copy"}
          </button>
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              window.location.href = whatsappChatUrl(null, `My SendEbun host link (keep this private):\n${url()}`);
            }}
            className="text-xs underline underline-offset-2"
            style={{ color: "var(--gold-light)" }}
          >
            Save to WhatsApp
          </a>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <p className="text-[11px] tracking-[0.14em] uppercase" style={{ color: "var(--gold)" }}>
        {title}
      </p>
      {children}
    </section>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="flex flex-col gap-1 p-3.5" style={{ background: "var(--panel)" }}>
      <span className="text-[11px]" style={{ color: "var(--cream-dim)" }}>
        {label}
      </span>
      <span className="font-display text-2xl leading-none" style={{ color: "var(--gold-light)" }}>
        {value}
      </span>
      <span className="text-[11px]" style={{ color: "var(--cream-faint)" }}>
        {hint}
      </span>
    </div>
  );
}

function SettingRow({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3 border-b text-sm" style={{ borderColor: "var(--border)", color: "var(--cream)" }}>
      {label}
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="h-5 w-5"
        style={{ accentColor: "var(--gold)" }}
      />
    </label>
  );
}
