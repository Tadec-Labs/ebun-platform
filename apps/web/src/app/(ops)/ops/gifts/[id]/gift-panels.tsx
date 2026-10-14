"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Pill } from "@/components/ops/ui";
import { Spinner, useConfirm, useToast } from "@/components/ui/feedback";
import { formatNaira, parseNairaToKobo } from "@/lib/format-money";
import { shrinkPhoto } from "@/lib/images/shrink-photo";
import { NOT_LIVE_REASON, type GiftSeller, type GiftTemplate } from "@/lib/ops/types";
import {
  deleteGiftAction,
  removeOfferingAction,
  saveOfferingAction,
  setGiftAvailabilityAction,
  uploadGiftPhotoAction,
} from "../../actions";
import type { PartnerOption } from "../gift-form";

const input =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 shadow-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10";

function Card({ title, children, tone = "default" }: { title: string; children: React.ReactNode; tone?: "default" | "danger" }) {
  return (
    <section
      className={`rounded-xl border bg-white p-5 shadow-sm ${tone === "danger" ? "border-red-200" : "border-zinc-200"}`}
    >
      <h2 className={`font-semibold ${tone === "danger" ? "text-red-800" : ""}`}>{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/**
 * Is it on /send, and if not, exactly why — with the switch right there.
 * "On sale" alone used to look like "senders can buy this" when no
 * partner made it and it was hidden.
 */
export function GiftStatusCard({ gift }: { gift: GiftTemplate }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  function toggle() {
    startTransition(async () => {
      const result = await setGiftAvailabilityAction(gift.id, !gift.available);
      if (result.ok) {
        toast.success(gift.available ? "Taken off sale." : "Put on sale.");
        router.refresh();
      } else toast.error(result.errors.join(" "));
    });
  }

  return (
    <Card title="On /send">
      <div className="flex items-center gap-2">
        {gift.live ? (
          <Pill tone="green">Live — senders can buy it</Pill>
        ) : (
          <Pill tone={gift.notLiveBecause === "off_sale" ? "grey" : "amber"}>
            Hidden · {NOT_LIVE_REASON[gift.notLiveBecause ?? "off_sale"]}
          </Pill>
        )}
      </div>
      {!gift.live && gift.notLiveBecause !== "off_sale" && (
        <p className="mt-2 text-xs text-zinc-600">
          {gift.notLiveBecause === "no_partner"
            ? "It's on sale, but no partner makes it yet — add one under “Who makes it”."
            : gift.notLiveBecause === "partner_not_approved"
              ? "Approve the partner below to make it live."
              : "Every partner has marked it sold out today. It comes back when one switches it on."}
        </p>
      )}
      <button
        type="button"
        role="switch"
        aria-checked={gift.available}
        disabled={pending}
        onClick={toggle}
        className="mt-4 flex w-full items-center justify-between rounded-lg border border-zinc-200 px-3 py-2.5 text-left hover:bg-zinc-50 disabled:opacity-60"
      >
        <span>
          <span className="font-medium">On sale</span>
          <span className="block text-xs text-zinc-500">Off hides it from senders immediately.</span>
        </span>
        {pending ? (
          <Spinner />
        ) : (
          <span
            className={`relative h-6 w-11 rounded-full transition-colors ${gift.available ? "bg-emerald-600" : "bg-zinc-300"}`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${gift.available ? "left-[22px]" : "left-0.5"}`}
            />
          </span>
        )}
      </button>
    </Card>
  );
}

/** Upload or replace the photo, with the thumbnail itself showing progress. */
export function GiftPhotoCard({ gift }: { gift: GiftTemplate }) {
  const router = useRouter();
  const toast = useToast();
  const [preview, setPreview] = useState(gift.imageUrl);
  const [pending, startTransition] = useTransition();

  function upload(file: File) {
    startTransition(async () => {
      let photo: Blob;
      try {
        photo = await shrinkPhoto(file);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Couldn't read that photo.");
        return;
      }
      const local = URL.createObjectURL(photo);
      const previous = preview;
      setPreview(local);
      const body = new FormData();
      body.set("photo", photo, "photo");
      const result = await uploadGiftPhotoAction(gift.id, body);
      if (result.ok) {
        toast.success("Photo saved.");
        router.refresh();
      } else {
        setPreview(previous);
        toast.error(result.errors.join(" "));
      }
    });
  }

  return (
    <Card title="Photo">
      <div className="relative aspect-square w-full overflow-hidden rounded-lg bg-zinc-100 ring-1 ring-zinc-200">
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element -- R2 public URL or a local preview blob
          <img src={preview} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-zinc-500">No photo yet</div>
        )}
        {pending && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-white/75 text-sm font-medium backdrop-blur-sm">
            <Spinner className="h-6 w-6" />
            Uploading…
          </div>
        )}
      </div>
      <label
        className={`mt-3 flex w-full cursor-pointer items-center justify-center rounded-lg border border-zinc-300 bg-white px-3 py-2 font-medium shadow-sm hover:bg-zinc-50 ${pending ? "pointer-events-none opacity-50" : ""}`}
      >
        {preview ? "Replace photo" : "Upload photo"}
        <input
          type="file"
          accept="image/*"
          className="sr-only"
          disabled={pending}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) upload(file);
          }}
        />
      </label>
    </Card>
  );
}

/**
 * Who makes this gift and what each is paid — the link that used to live
 * only on the partner's page, so a gift could be "on sale" with nobody
 * behind it and nothing here saying so.
 */
export function GiftSellersPanel({ gift, partners }: { gift: GiftTemplate; partners: PartnerOption[] }) {
  const router = useRouter();
  const toast = useToast();
  const [confirm, confirmDialog] = useConfirm();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<string | null>(null);
  const [editPrice, setEditPrice] = useState("");
  const [addId, setAddId] = useState("");
  const [addPrice, setAddPrice] = useState("");
  const [addTouched, setAddTouched] = useState(false);

  const sellerIds = new Set(gift.sellers.map((s) => s.vendorId));
  const addable = partners.filter((p) => !sellerIds.has(p.id));
  const addPartner = addable.find((p) => p.id === addId) ?? null;
  const suggested = addPartner ? String(Math.round((gift.basePrice * addPartner.share) / 100)) : "";
  const addValue = addTouched ? addPrice : suggested;

  function save(seller: { vendorId: string; availableZones: string[]; available: boolean }, priceNaira: string, done: string) {
    startTransition(async () => {
      const result = await saveOfferingAction({
        vendorId: seller.vendorId,
        giftTemplateId: gift.id,
        priceNaira,
        zones: seller.availableZones.join(", "),
        available: seller.available,
      });
      if (result.ok) {
        toast.success(done);
        setEditing(null);
        setAddId("");
        setAddPrice("");
        setAddTouched(false);
        router.refresh();
      } else toast.error(result.errors.join(" "));
    });
  }

  async function remove(seller: GiftSeller) {
    const ok = await confirm({
      title: `Remove ${seller.vendorName}?`,
      body:
        gift.sellers.length === 1
          ? "They're the only partner, so the gift will be hidden from senders until you add another. Orders already placed are unaffected."
          : "They'll stop getting new orders for this gift. Orders already placed are unaffected.",
      confirmLabel: "Remove",
      tone: "danger",
    });
    if (!ok) return;
    startTransition(async () => {
      const result = await removeOfferingAction(seller.vendorId, gift.id);
      if (result.ok) {
        toast.success(`${seller.vendorName} removed.`);
        router.refresh();
      } else toast.error(result.errors.join(" "));
    });
  }

  return (
    <Card title="Who makes it">
      {gift.sellers.length === 0 ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-900">
          No partner yet — senders can&rsquo;t buy this until one is added.
        </p>
      ) : (
        <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200">
          {gift.sellers.map((seller) => {
            const margin = gift.basePrice - seller.vendorPrice;
            return (
              <li key={seller.vendorId} className="flex flex-col gap-2 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link href={`/ops/vendors/${seller.vendorId}`} className="font-medium hover:underline">
                      {seller.vendorName}
                    </Link>
                    <p className="text-zinc-600">
                      Gets {formatNaira(seller.vendorPrice)} · SendEbun keeps {formatNaira(margin)}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap justify-end gap-1">
                    {!seller.vendorActive ? (
                      <Pill tone="grey">Partner paused</Pill>
                    ) : !seller.approved ? (
                      <Pill tone="amber">Waiting approval</Pill>
                    ) : !seller.available ? (
                      <Pill tone="amber">Sold out today</Pill>
                    ) : (
                      <Pill tone="green">Selling</Pill>
                    )}
                  </div>
                </div>
                {editing === seller.vendorId ? (
                  <div className="flex items-center gap-2">
                    <input
                      autoFocus
                      inputMode="decimal"
                      value={editPrice}
                      onChange={(e) => setEditPrice(e.target.value)}
                      aria-label="Partner gets (₦)"
                      className={input}
                    />
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => save(seller, editPrice, "Price updated.")}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-2 font-medium text-white disabled:opacity-60"
                    >
                      {pending && <Spinner className="h-3.5 w-3.5" />}Save
                    </button>
                    <button type="button" onClick={() => setEditing(null)} className="px-2 text-zinc-600">
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                    {!seller.approved && (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => save(seller, String(seller.vendorPrice / 100), `${seller.vendorName} approved.`)}
                        className="font-medium text-emerald-700 hover:underline"
                      >
                        Approve
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(seller.vendorId);
                        setEditPrice(String(seller.vendorPrice / 100));
                      }}
                      className="text-zinc-700 hover:underline"
                    >
                      Change price
                    </button>
                    <button type="button" disabled={pending} onClick={() => void remove(seller)} className="text-red-700 hover:underline">
                      Remove
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {addable.length > 0 && (
        <div className="mt-4 flex flex-col gap-2 rounded-lg bg-zinc-50 p-3">
          <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Add a partner</p>
          <select
            value={addId}
            onChange={(e) => {
              setAddId(e.target.value);
              setAddTouched(false);
            }}
            className={input}
          >
            <option value="">Choose a partner…</option>
            {addable.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {addPartner && (
            <>
              <label className="flex flex-col gap-1">
                <span className="text-sm">Partner gets (₦)</span>
                <input
                  inputMode="decimal"
                  value={addValue}
                  onChange={(e) => {
                    setAddTouched(true);
                    setAddPrice(e.target.value);
                  }}
                  className={input}
                />
                <span className="text-xs text-zinc-500">
                  {(() => {
                    const k = parseNairaToKobo(addValue);
                    return k && k < gift.basePrice
                      ? `SendEbun keeps ${formatNaira(gift.basePrice - k)} per gift.`
                      : `Suggested from their ${Math.round(addPartner.share * 100)}% share. Must be under ${formatNaira(gift.basePrice)}.`;
                  })()}
                </span>
              </label>
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  save({ vendorId: addPartner.id, availableZones: [], available: true }, addValue, `${addPartner.name} added.`)
                }
                className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-2 font-medium text-white disabled:opacity-60"
              >
                {pending && <Spinner className="h-3.5 w-3.5" />}
                Add {addPartner.name}
              </button>
            </>
          )}
        </div>
      )}
      {confirmDialog}
    </Card>
  );
}

/** Only for a gift nobody has bought — duplicates and mistakes. The API refuses otherwise, and says so. */
export function DeleteGiftCard({ gift }: { gift: GiftTemplate }) {
  const router = useRouter();
  const toast = useToast();
  const [confirm, confirmDialog] = useConfirm();
  const [pending, startTransition] = useTransition();

  async function run() {
    const ok = await confirm({
      title: `Delete “${gift.name}”?`,
      body: "This removes the gift, its photo and its partner links. It only works if nobody has bought it — otherwise take it off sale instead.",
      confirmLabel: "Delete gift",
      tone: "danger",
    });
    if (!ok) return;
    startTransition(async () => {
      const result = await deleteGiftAction(gift.id);
      if (result.ok) {
        toast.success(`“${gift.name}” deleted.`);
        router.push("/ops/gifts");
      } else toast.error(result.errors.join(" "));
    });
  }

  return (
    <Card title="Delete" tone="danger">
      <p className="text-zinc-600">For a duplicate or a mistake. Gifts that have been bought are kept for the record.</p>
      <button
        type="button"
        disabled={pending}
        onClick={() => void run()}
        className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-red-300 px-3 py-2 font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
      >
        {pending && <Spinner className="h-3.5 w-3.5" />}
        Delete this gift
      </button>
      {confirmDialog}
    </Card>
  );
}
