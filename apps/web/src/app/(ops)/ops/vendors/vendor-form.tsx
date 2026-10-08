"use client";

import { useState, useTransition } from "react";
import { saveVendorAction } from "../actions";
import { type Vendor, VENDOR_CATEGORIES } from "@/lib/ops/types";

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
 * One form for both create and edit. Deliberately NOT a <form action>:
 * React 19 resets uncontrolled fields after an action completes, which
 * would wipe everything typed the moment a validation error came back.
 * Handling submit by hand keeps the inputs exactly as they were so the
 * error can be fixed in place.
 */
export function VendorForm({
  vendor,
  backupOptions,
}: {
  vendor?: Vendor;
  backupOptions: { id: string; name: string }[];
}) {
  const [errors, setErrors] = useState<string[]>([]);
  const [saved, setSaved] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const isEdit = Boolean(vendor);

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
        <Field label="Category">
          <select name="category" defaultValue={vendor?.category ?? "food"} className={input}>
            {VENDOR_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Subcategories" hint="Comma-separated, e.g. pizza, grills">
          <input name="subcategories" defaultValue={vendor?.subcategories.join(", ")} className={input} />
        </Field>
      </Section>

      <Section title="Contact">
        <Field label="WhatsApp number" hint="With country code, e.g. +2348012345678">
          <input
            name="whatsappNumber"
            required
            inputMode="tel"
            placeholder="+2348012345678"
            defaultValue={vendor?.whatsappNumber}
            className={input}
          />
        </Field>
        <Field label="Email (optional)">
          <input name="email" type="email" defaultValue={vendor?.email ?? ""} className={input} />
        </Field>
      </Section>

      <Section title="Coverage">
        <Field label="Service areas" hint="Comma-separated neighbourhoods, e.g. Lekki Phase 1, Yaba">
          <textarea name="serviceAreas" rows={2} defaultValue={vendor?.serviceAreas.join(", ")} className={input} />
        </Field>
        <Field label="Delivery zones" hint="Comma-separated zone codes. Not used for routing yet — captured for when assignment is built.">
          <textarea name="deliveryZones" rows={2} defaultValue={vendor?.deliveryZones.join(", ")} className={input} />
        </Field>
      </Section>

      <Section title="Payout & terms">
        <Field
          label="Vendor share (%)"
          hint="What the vendor receives. 70 means vendor gets 70%, Ebun keeps 30%."
        >
          <input
            name="vendorSharePct"
            type="number"
            min={1}
            max={100}
            step={1}
            required
            defaultValue={vendor ? Math.round(vendor.commissionRate * 100) : 70}
            className={input}
          />
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
        <Field label="Bank name">
          <input name="bankName" defaultValue={vendor?.bankName ?? ""} className={input} />
        </Field>
        <Field label="Account number" hint="10-digit NUBAN">
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
      </Section>

      <Section title="Status & notes">
        <div className="flex flex-col gap-3">
          <label className="flex items-center gap-2">
            <input type="checkbox" name="active" defaultChecked={vendor?.active ?? true} />
            <span>Active — can receive orders</span>
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="verified" defaultChecked={vendor?.verified ?? false} />
            <span>Verified — Ebun has inspected and approved this vendor</span>
          </label>
        </div>
        <Field label="Internal notes">
          <textarea name="notes" rows={3} maxLength={2000} defaultValue={vendor?.notes ?? ""} className={input} />
        </Field>
      </Section>

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
          {pending ? "Saving…" : isEdit ? "Save changes" : "Create vendor"}
        </button>
      </div>
    </form>
  );
}
