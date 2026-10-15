"use client";

import { useState, useTransition } from "react";
import { useConfirm } from "@/components/ui/feedback";
import Link from "next/link";
import { formatNaira, parseNairaToKobo } from "@/lib/format-money";
import type { ActionResult, Offering } from "@/lib/ops/types";
import {
  approveOfferingAction,
  approvePriceChangeAction,
  declinePriceChangeAction,
  removeOfferingAction,
  saveOfferingAction,
} from "../../actions";

const input = "rounded border border-zinc-300 bg-white px-3 py-2 w-full";

interface CatalogOption {
  id: string;
  name: string;
  basePrice: number; // kobo
}

export function OfferingsPanel({
  vendorId,
  offerings,
  catalog,
  vendorSharePct,
}: {
  vendorId: string;
  offerings: Offering[];
  catalog: CatalogOption[];
  vendorSharePct: number;
}) {
  const [giftTemplateId, setGiftTemplateId] = useState("");
  const [priceNaira, setPriceNaira] = useState("");
  const [zones, setZones] = useState("");
  const [available, setAvailable] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [ask, askDialog] = useConfirm();

  const selectedGift = catalog.find((g) => g.id === giftTemplateId);
  const priceKobo = parseNairaToKobo(priceNaira);

  // Live preview of exactly what will be stored, before it is.
  const preview =
    selectedGift && priceKobo !== null && priceKobo > 0
      ? {
          margin: selectedGift.basePrice - priceKobo,
          pct: Math.round(((selectedGift.basePrice - priceKobo) / selectedGift.basePrice) * 1000) / 10,
        }
      : null;

  function run(action: () => Promise<ActionResult>, done: string) {
    setErrors([]);
    setNotice(null);
    startTransition(async () => {
      const result = await action();
      if (result.ok) setNotice(done);
      else setErrors(result.errors);
    });
  }

  function resetForm() {
    setGiftTemplateId("");
    setPriceNaira("");
    setZones("");
    setAvailable(true);
  }

  function edit(offering: Offering) {
    setGiftTemplateId(offering.giftTemplateId);
    setPriceNaira(String(offering.vendorPrice / 100));
    setZones(offering.availableZones.join(", "));
    setAvailable(offering.available);
    setErrors([]);
    setNotice(null);
  }

  return (
    <section>
      <h2 className="mb-1 font-semibold">Gifts this vendor fulfils</h2>
      <p className="mb-4 text-zinc-600">
        The sender pays the gift’s price; Ebun pays the vendor the price you set here. This vendor’s default share is{" "}
        {vendorSharePct}% of the sender price — a quick check when you enter one.
      </p>

      {offerings.length === 0 ? (
        <p className="mb-4 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900">
          No offerings yet — this vendor can’t be matched to any gift until you add one.
        </p>
      ) : (
        <div className="mb-4 overflow-x-auto rounded border border-zinc-200 bg-white">
          <table className="w-full min-w-[620px] text-left">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">Gift</th>
                <th className="px-4 py-2.5 font-medium">Sender pays</th>
                <th className="px-4 py-2.5 font-medium">Vendor gets</th>
                <th className="px-4 py-2.5 font-medium">Ebun margin</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {offerings.map((o) => (
                <tr key={o.giftTemplateId}>
                  <td className="px-4 py-3 font-medium">{o.giftName}</td>
                  <td className="px-4 py-3">{formatNaira(o.senderPrice)}</td>
                  <td className="px-4 py-3">{formatNaira(o.vendorPrice)}</td>
                  <td className="px-4 py-3">
                    {formatNaira(o.ebunMargin)} <span className="text-zinc-500">({o.ebunMarginPct}%)</span>
                  </td>
                  <td className="px-4 py-3 text-xs text-zinc-600">
                    {!o.approved ? (
                      // Asked for from the vendor's counter link. Check the
                      // in-store price against the counter before approving:
                      // senders are promised that price.
                      <span className="font-medium text-amber-800">
                        Asked for by the vendor — check the price
                        {o.giftHasPhoto ? "" : " and add a photo on the gift page"}, then approve
                      </span>
                    ) : o.available ? (
                      "Available"
                    ) : (
                      "Sold out / paused — still honours gifts already bought"
                    )}
                    {o.proposedPrice !== null && (
                      <span className="mt-1 block font-medium text-amber-800">
                        Wants {formatNaira(o.proposedPrice)}
                        {o.proposedVendorPrice !== null ? ` (gets ${formatNaira(o.proposedVendorPrice)})` : ""} — senders
                        pay {formatNaira(o.senderPrice)} until you decide
                      </span>
                    )}
                  </td>
                  <td className="space-x-3 whitespace-nowrap px-4 py-3 text-right">
                    {!o.approved &&
                      (o.giftHasPhoto && !o.giftOnSale ? (
                        <>
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() =>
                              run(
                                () => approveOfferingAction(vendorId, o.giftTemplateId, true),
                                `Approved — "${o.giftName}" is on sale.`,
                              )
                            }
                            className="font-medium text-emerald-700 underline disabled:opacity-50"
                          >
                            Approve &amp; put on sale
                          </button>
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() =>
                              run(
                                () => approveOfferingAction(vendorId, o.giftTemplateId, false),
                                `Approved. "${o.giftName}" is still off sale.`,
                              )
                            }
                            className="text-zinc-700 underline disabled:opacity-50"
                          >
                            Approve only
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() =>
                            run(
                              () => approveOfferingAction(vendorId, o.giftTemplateId, false),
                              o.giftOnSale
                                ? "Approved."
                                : `Approved. Add a photo to "${o.giftName}", then put it on sale from its gift page.`,
                            )
                          }
                          className="font-medium text-emerald-700 underline disabled:opacity-50"
                        >
                          Approve
                        </button>
                      ))}
                    {o.proposedPrice !== null && (
                      <>
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() =>
                            run(
                              () => approvePriceChangeAction(vendorId, o.giftTemplateId, o.proposedPrice as number),
                              `"${o.giftName}" is now ${formatNaira(o.proposedPrice as number)}.`,
                            )
                          }
                          className="font-medium text-emerald-700 underline disabled:opacity-50"
                        >
                          Approve {formatNaira(o.proposedPrice)}
                        </button>
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() =>
                            run(
                              () => declinePriceChangeAction(vendorId, o.giftTemplateId),
                              `Kept "${o.giftName}" at ${formatNaira(o.senderPrice)}. Let the partner know why.`,
                            )
                          }
                          className="text-zinc-700 underline disabled:opacity-50"
                        >
                          Decline
                        </button>
                      </>
                    )}
                    <Link href={`/ops/gifts/${o.giftTemplateId}`} className="text-zinc-700 underline">
                      Gift
                    </Link>
                    <button type="button" onClick={() => edit(o)} className="text-zinc-700 underline">
                      Edit
                    </button>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={async () => {
                        const ok = await ask({
                          title: `Remove “${o.giftName}”?`,
                          body:
                            "This partner stops getting new orders for it. If paid gifts still need them to hand it over, this is refused — untick Available to pause it instead.",
                          confirmLabel: "Remove",
                          tone: "danger",
                        });
                        if (!ok) return;
                        setErrors([]);
                        setNotice(null);
                        startTransition(async () => {
                          const result = await removeOfferingAction(vendorId, o.giftTemplateId);
                          if (!result.ok) setErrors(result.errors);
                        });
                      }}
                      className="text-red-700 underline disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <form
        className="grid gap-4 rounded border border-zinc-200 bg-white p-5 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          setErrors([]);
          setNotice(null);
          startTransition(async () => {
            const result = await saveOfferingAction({
              vendorId,
              giftTemplateId,
              priceNaira,
              zones,
              available,
            });
            if (result.ok) {
              setNotice(result.message ?? "Saved.");
              resetForm();
            } else {
              setErrors(result.errors);
            }
          });
        }}
      >
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 sm:col-span-2">
          Add or update an offering
        </p>
        <label className="flex flex-col gap-1">
          <span className="font-medium">Gift</span>
          <select
            value={giftTemplateId}
            onChange={(e) => {
              const id = e.target.value;
              setGiftTemplateId(id);
              // Start from the vendor's share rather than a blank box;
              // an existing offering (picked via Edit) keeps its price.
              const gift = catalog.find((g) => g.id === id);
              const existing = offerings.find((o) => o.giftTemplateId === id);
              if (existing) setPriceNaira(String(existing.vendorPrice / 100));
              else if (gift) setPriceNaira(String(Math.round((gift.basePrice * vendorSharePct) / 10000)));
            }}
            required
            className={input}
          >
            <option value="">Choose a gift…</option>
            {catalog.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name} — {formatNaira(g.basePrice)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-medium">Vendor price (₦)</span>
          <input
            value={priceNaira}
            onChange={(e) => setPriceNaira(e.target.value)}
            inputMode="decimal"
            placeholder="5600"
            required
            className={input}
          />
          <span className="text-xs text-zinc-500">
            {preview
              ? `Ebun keeps ${formatNaira(preview.margin)} (${preview.pct}%) on each of these.`
              : "In naira — what Ebun pays the vendor for one of these."}
          </span>
        </label>
        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className="font-medium">Zones (optional)</span>
          <input
            value={zones}
            onChange={(e) => setZones(e.target.value)}
            placeholder="Lekki, Victoria Island"
            className={input}
          />
          <span className="text-xs text-zinc-500">Comma-separated. Leave blank to use the vendor’s general coverage.</span>
        </label>
        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={available} onChange={(e) => setAvailable(e.target.checked)} />
            <span>Available — untick to pause new orders; gifts already bought are still honoured</span>
          </label>
        </div>

        {errors.length > 0 && (
          <ul role="alert" className="list-disc rounded border border-red-300 bg-red-50 py-2 pl-8 pr-3 text-red-800 sm:col-span-2">
            {errors.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        )}
        {notice && (
          <p role="status" className="rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-emerald-900 sm:col-span-2">
            {notice}
          </p>
        )}

        <div className="sm:col-span-2">
          <button
            type="submit"
            disabled={pending}
            className="rounded bg-zinc-900 px-5 py-2 font-medium text-white disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save offering"}
          </button>
        </div>
      </form>
      {askDialog}
    </section>
  );
}
