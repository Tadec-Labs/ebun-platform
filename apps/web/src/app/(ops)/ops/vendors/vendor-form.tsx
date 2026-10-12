"use client";

import { useState, useTransition } from "react";
import { formatNaira } from "@/lib/format-money";
import { saveVendorAction } from "../actions";
import { type Vendor, VENDOR_CATEGORIES } from "@/lib/ops/types";

export interface CatalogGift {
  id: string;
  name: string;
  basePrice: number; // kobo
}

const input = "rounded border border-zinc-300 bg-white px-3 py-2 w-full";

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-medium">{label}</span>
      {children}
      {hint && <span className="text-xs text-zinc-500">{hint}</span>}
    </label>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="grid gap-4 rounded border border-zinc-200 bg-white p-5 sm:grid-cols-2">
      <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">{title}</legend>
      {children}
    </fieldset>
  );
}

/**
 * One form for both create and edit, ordered by what a vendor signing
 * actually needs: who they are, where customers go, what they're paid,
 * and (on create) which gifts they'll honour. That is enough to go
 * live. Bank details, zones, backup vendor and notes sit under "More
 * details" — still validated exactly as before, just not in the way of
 * signing someone up at their counter. Nothing is skipped server-side:
 * the API applies the same rules whichever fields arrive.
 *
 * Deliberately NOT a <form action>:
 * React 19 resets uncontrolled fields after an action completes, which
 * would wipe everything typed the moment a validation error came back.
 * Handling submit by hand keeps the inputs exactly as they were so the
 * error can be fixed in place.
 */
export function VendorForm({
  vendor,
  backupOptions,
  catalog = [],
}: {
  vendor?: Vendor;
  backupOptions: { id: string; name: string }[];
  /** Create only: gifts that can be ticked on the same screen. */
  catalog?: CatalogGift[];
}) {
  const [errors, setErrors] = useState<string[]>([]);
  const [saved, setSaved] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const isEdit = Boolean(vendor);
  const [sharePct, setSharePct] = useState(
    // 90% is the standard share (a 10% commission); 88–92% is the
    // negotiating range. The sender's service fee is separate.
    vendor ? Math.round(vendor.commissionRate * 100) : 90,
  );

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        setErrors([]);
        setSaved(null);
        startTransition(async () => {
          // Creating redirects to the new vendor's page, so only a
          // failure or an in-place update ever returns here.
          const result = await saveVendorAction(formData);
          if (!result) return;
          if (result.ok) setSaved(result.message ?? "Saved.");
          else setErrors(result.errors);
        });
      }}
    >
      {vendor && <input type="hidden" name="id" value={vendor.id} />}

      <Section title="Business">
        <Field label="Business name">
          <input name="businessName" required maxLength={200} defaultValue={vendor?.businessName} className={input} />
        </Field>
        <Field label="Owner's name">
          <input name="ownerName" required maxLength={200} defaultValue={vendor?.ownerName} className={input} />
        </Field>
        <Field label="WhatsApp number" hint="With country code, e.g. +2348012345678. Their counter link is sent here.">
          <input
            name="whatsappNumber"
            required
            inputMode="tel"
            placeholder="+2348012345678"
            defaultValue={vendor?.whatsappNumber}
            className={input}
          />
        </Field>
        <Field label="Category">
          <select name="category" defaultValue={vendor?.category ?? "food"} className={input}>
            {VENDOR_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>
      </Section>

      {/* Recipient-facing — the only part of this form a customer ever
          reads. Shown on the gift screen once someone claims a gift this
          vendor offers. */}
      <Section title="Where recipients collect">
        <Field
          label="Pickup address"
          hint="Shown to people collecting a gift here, exactly as written. Add a landmark if it helps. Leave blank and this vendor isn't listed as a place to collect."
        >
          <textarea
            name="pickupAddress"
            rows={2}
            maxLength={300}
            placeholder="12 Admiralty Way, opposite Mega Plaza, Lekki Phase 1"
            defaultValue={vendor?.pickupAddress ?? ""}
            className={input}
          />
        </Field>
        <Field label="Opening hours" hint="When the counter can hand a gift over.">
          <input
            name="pickupHours"
            maxLength={120}
            placeholder="Mon–Sat, 10am–9pm"
            defaultValue={vendor?.pickupHours ?? ""}
            className={input}
          />
        </Field>
      </Section>

      <Section title="Payment">
        <Field
          label="Vendor share (%)"
          hint={`What the vendor receives of each gift's in-store price. Standard is 90%. At ${sharePct}%, SendEbun's commission is ${100 - sharePct}%, before Paystack fees; the sender's service fee is on top.`}
        >
          <input
            name="vendorSharePct"
            type="number"
            min={1}
            max={100}
            step={1}
            required
            value={sharePct}
            onChange={(event) => setSharePct(Number(event.target.value))}
            className={input}
          />
        </Field>
        {isEdit && (
          <label className="flex items-center gap-2 self-end pb-2">
            <input type="checkbox" name="active" defaultChecked={vendor?.active ?? true} />
            <span>Active — can hand over gifts</span>
          </label>
        )}
      </Section>

      {!isEdit && <GiftChooser catalog={catalog} sharePct={sharePct} />}

      {/* Closed, not removed: every field still submits and is still
          validated by the API. Open by default when editing a vendor
          whose bank details are missing, so the gap is visible. */}
      <details
        className="rounded border border-zinc-200 bg-white"
        open={isEdit && !vendor?.accountNumber}
      >
        <summary className="cursor-pointer px-5 py-3 font-medium select-none">
          More details <span className="font-normal text-zinc-500">— bank, coverage, backup, notes (optional now)</span>
        </summary>
        <div className="grid gap-4 border-t border-zinc-100 p-5 sm:grid-cols-2">
          <Field label="Bank name">
            <input name="bankName" defaultValue={vendor?.bankName ?? ""} className={input} />
          </Field>
          <Field label="Account number" hint="10-digit NUBAN. Needed before their first payout.">
            <input
              name="accountNumber"
              inputMode="numeric"
              maxLength={10}
              defaultValue={vendor?.accountNumber ?? ""}
              className={input}
            />
          </Field>
          <Field label="Account name">
            <input name="accountName" defaultValue={vendor?.accountName ?? ""} className={input} />
          </Field>
          <Field label="Email">
            <input name="email" type="email" defaultValue={vendor?.email ?? ""} className={input} />
          </Field>
          <Field label="Subcategories" hint="Comma-separated, e.g. pizza, grills">
            <input name="subcategories" defaultValue={vendor?.subcategories.join(", ")} className={input} />
          </Field>
          <Field label="Service areas" hint="Comma-separated neighbourhoods, e.g. Lekki Phase 1, Yaba">
            <input name="serviceAreas" defaultValue={vendor?.serviceAreas.join(", ")} className={input} />
          </Field>
          <Field label="Delivery zones" hint="Comma-separated zone codes. Not used for routing yet.">
            <input name="deliveryZones" defaultValue={vendor?.deliveryZones.join(", ")} className={input} />
          </Field>
          <Field label="Response window (minutes)" hint="How long to wait for an accept before escalating to the backup.">
            <input
              name="responseTimeoutMinutes"
              type="number"
              min={15}
              max={1440}
              step={1}
              required
              defaultValue={vendor?.responseTimeoutMinutes ?? 120}
              className={input}
            />
          </Field>
          <Field label="Backup vendor" hint="Takes over if this vendor declines or times out.">
            <select name="backupVendorId" defaultValue={vendor?.backupVendorId ?? ""} className={input}>
              <option value="">None</option>
              {backupOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="flex flex-col gap-3">
            {!isEdit && (
              <label className="flex items-center gap-2">
                <input type="checkbox" name="active" defaultChecked />
                <span>Active — can hand over gifts</span>
              </label>
            )}
            <label className="flex items-center gap-2">
              <input type="checkbox" name="verified" defaultChecked={vendor?.verified ?? false} />
              <span>Verified — Ebun has inspected this vendor</span>
            </label>
          </div>
          <div className="sm:col-span-2">
            <Field label="Internal notes">
              <textarea name="notes" rows={3} maxLength={2000} defaultValue={vendor?.notes ?? ""} className={input} />
            </Field>
          </div>
        </div>
      </details>

      {errors.length > 0 && (
        <ul role="alert" className="list-disc rounded border border-red-300 bg-red-50 py-2 pl-8 pr-3 text-red-800">
          {errors.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      )}
      {saved && (
        <p role="status" className="rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-emerald-900">
          {saved}
        </p>
      )}

      <div>
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-zinc-900 px-5 py-2 font-medium text-white disabled:opacity-50"
        >
          {pending ? "Saving…" : isEdit ? "Save changes" : "Add vendor"}
        </button>
      </div>
    </form>
  );
}

/**
 * Which gifts the new vendor will hand over, ticked on the same screen
 * instead of a second form after saving. Each price starts at the
 * vendor's share of the gift's price and can be changed; once edited
 * by hand it stops following the share.
 *
 * Sent as one hidden JSON field and saved as offerings right after the
 * vendor is created — the same API calls the offerings panel makes,
 * with the same validation.
 */
function GiftChooser({ catalog, sharePct }: { catalog: CatalogGift[]; sharePct: number }) {
  const [chosen, setChosen] = useState<Record<string, { price: string; edited: boolean }>>({});

  const suggested = (gift: CatalogGift) =>
    String(Math.round((gift.basePrice * sharePct) / 100 / 100));

  const value = JSON.stringify(
    Object.entries(chosen).map(([giftTemplateId, entry]) => {
      const gift = catalog.find((g) => g.id === giftTemplateId);
      const priceNaira = entry.edited || !gift ? entry.price : suggested(gift);
      return { giftTemplateId, priceNaira };
    }),
  );

  return (
    <fieldset className="flex flex-col gap-3 rounded border border-zinc-200 bg-white p-5">
      <legend className="px-1 text-xs font-semibold tracking-wide text-zinc-500 uppercase">
        Gifts they&rsquo;ll hand over
      </legend>
      <input type="hidden" name="offerings" value={value} />
      {catalog.length === 0 ? (
        <p className="text-zinc-600">No gifts in the catalogue yet — add some under Gifts, then link them here.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-zinc-100">
          {catalog.map((gift) => {
            const entry = chosen[gift.id];
            const price = entry ? (entry.edited ? entry.price : suggested(gift)) : "";
            return (
              <li key={gift.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <label className="flex min-w-0 flex-1 items-center gap-2">
                  <input
                    type="checkbox"
                    checked={Boolean(entry)}
                    onChange={(event) =>
                      setChosen((prev) => {
                        const next = { ...prev };
                        if (event.target.checked) next[gift.id] = { price: suggested(gift), edited: false };
                        else delete next[gift.id];
                        return next;
                      })
                    }
                  />
                  <span className="truncate">{gift.name}</span>
                  <span className="shrink-0 text-xs text-zinc-500">sells at {formatNaira(gift.basePrice)}</span>
                </label>
                {entry && (
                  <label className="flex items-center gap-2 text-sm">
                    <span className="text-zinc-500">They get ₦</span>
                    <input
                      value={price}
                      onChange={(event) =>
                        setChosen((prev) => ({ ...prev, [gift.id]: { price: event.target.value, edited: true } }))
                      }
                      inputMode="decimal"
                      aria-label={`What ${gift.name} pays the vendor, in naira`}
                      className="w-28 rounded border border-zinc-300 px-2 py-1"
                    />
                  </label>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-xs text-zinc-500">
        Ticked gifts can be handed over at this vendor&rsquo;s counter and show recipients where to collect. You can change these later.
      </p>
    </fieldset>
  );
}
