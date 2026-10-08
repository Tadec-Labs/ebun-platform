"use client";

import { useState, useTransition } from "react";
import { formatNaira, parseNairaToKobo } from "@/lib/format-money";
import type { Offering } from "@/lib/ops/types";
import { removeOfferingAction, saveOfferingAction } from "../../actions";

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
  const [approved, setApproved] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

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

  function resetForm() {
    setGiftTemplateId("");
    setPriceNaira("");
    setZones("");
    setAvailable(true);
    setApproved(false);
  }

  function edit(offering: Offering) {
    setGiftTemplateId(offering.giftTemplateId);
    setPriceNaira(String(offering.vendorPrice / 100));
    setZones(offering.availableZones.join(", "));
    setAvailable(offering.available);
    setApproved(offering.approved);
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
                    {o.available ? "Available" : "Unavailable"} · {o.approved ? "Approved" : "Not approved"}
                  </td>
                  <td className="space-x-3 whitespace-nowrap px-4 py-3 text-right">
                    <button type="button" onClick={() => edit(o)} className="text-zinc-700 underline">
                      Edit
                    </button>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => {
                        if (!window.confirm(`Remove "${o.giftName}" from this vendor?`)) return;
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
              approved,
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
          <select value={giftTemplateId} onChange={(e) => setGiftTemplateId(e.target.value)} required className={input}>
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
            <span>Available</span>
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={approved} onChange={(e) => setApproved(e.target.checked)} />
            <span>Approved — Ebun has checked this vendor delivers it to spec</span>
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
    </section>
  );
}
