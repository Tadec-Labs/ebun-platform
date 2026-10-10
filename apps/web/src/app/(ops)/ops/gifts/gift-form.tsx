"use client";

import { useState, useTransition } from "react";
import { saveGiftAction } from "../actions";
import {
  DELIVERY_TYPE_LABEL,
  GIFT_DELIVERY_TYPES,
  VENDOR_CATEGORIES,
  type GiftTemplate,
} from "@/lib/ops/types";

const input = "w-full rounded border border-zinc-300 bg-white px-3 py-2";

/**
 * One form for adding and editing a gift. Manual onSubmit rather than a
 * <form action>, for the same reason as the vendor form: React 19
 * resets uncontrolled fields once an action settles, which would wipe
 * everything typed the moment a validation error came back.
 */
export function GiftForm({ gift }: { gift?: GiftTemplate }) {
  const [errors, setErrors] = useState<string[]>([]);
  const [saved, setSaved] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const isEdit = Boolean(gift);

  return (
    <form
      className="flex max-w-2xl flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        setErrors([]);
        setSaved(null);
        startTransition(async () => {
          // Creating redirects to the new gift, so only a failure or an
          // in-place update ever returns here.
          const result = await saveGiftAction(formData);
          if (!result) return;
          if (result.ok) setSaved(result.message ?? "Saved.");
          else setErrors(result.errors);
        });
      }}
    >
      {gift && <input type="hidden" name="id" value={gift.id} />}

      <fieldset className="grid gap-4 rounded border border-zinc-200 bg-white p-5 sm:grid-cols-2">
        <legend className="px-1 text-xs font-semibold tracking-wide text-zinc-500 uppercase">
          What it is
        </legend>
        <Field
          label="Name"
          hint="What the sender scans. Plain beats clever — “Burger meal” reads faster than “A Burger, On Him”."
        >
          <input
            name="name"
            required
            maxLength={200}
            defaultValue={gift?.name}
            placeholder="Burger meal"
            className={input}
          />
        </Field>
        <Field
          label="Price (₦)"
          hint="What the sender pays. Set what you pay the vendor on their own page."
        >
          <input
            name="basePrice"
            required
            inputMode="decimal"
            defaultValue={gift ? String(gift.basePrice / 100) : ""}
            placeholder="6000"
            className={input}
          />
        </Field>
        <Field
          label="Description"
          hint="One or two lines. Shown under the name."
        >
          <textarea
            name="description"
            rows={3}
            maxLength={2000}
            defaultValue={gift?.description ?? ""}
            placeholder="Flame-grilled beef burger with fries and a drink."
            className={input}
          />
        </Field>
        <Field label="Category">
          <select
            name="category"
            defaultValue={gift?.category ?? "food"}
            className={input}
          >
            {VENDOR_CATEGORIES.map((category) => (
              <option key={category.value} value={category.value}>
                {category.label}
              </option>
            ))}
          </select>
        </Field>
      </fieldset>

      <fieldset className="grid gap-4 rounded border border-zinc-200 bg-white p-5 sm:grid-cols-2">
        <legend className="px-1 text-xs font-semibold tracking-wide text-zinc-500 uppercase">
          How they get it
        </legend>
        <Field label="Delivery">
          {gift ? (
            // Read-only once the gift exists, and NOT submitted — the API
            // rejects deliveryType on update. The select used to render
            // here could only represent digital_voucher and vtu, so
            // editing a `physical` gift for any reason at all silently
            // converted it to a voucher. Plain text, no hidden input:
            // the value must not travel with the form.
            <>
              <p className="py-1.5 font-medium">
                {DELIVERY_TYPE_LABEL[gift.deliveryType]}
              </p>
              <span className="text-xs text-zinc-500">
                Can&rsquo;t be changed — orders already reference this gift, and
                changing how it&rsquo;s fulfilled would change what they bought.
                Add a new gift instead.
              </span>
            </>
          ) : (
            <>
              <select
                name="deliveryType"
                defaultValue="digital_voucher"
                className={input}
              >
                {GIFT_DELIVERY_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
              <span className="text-xs text-zinc-500">
                Delivered-to-an-address gifts aren&rsquo;t offered: nothing
                fulfils them yet, so an order would take the money and stop.
              </span>
            </>
          )}
        </Field>
        <Field
          label="Timing note"
          hint="Shown to the sender, e.g. “Redeemable anytime this week”."
        >
          <input
            name="deliveryWindow"
            maxLength={120}
            defaultValue={gift?.deliveryWindow ?? ""}
            className={input}
          />
        </Field>
        <Field
          label="Photo URL"
          hint="A real photo of the real item beats stock. Leave blank and the card shows the name alone, which looks fine."
        >
          <input
            name="imageUrl"
            type="url"
            maxLength={2048}
            defaultValue={gift?.imageUrl ?? ""}
            placeholder="https://…"
            className={input}
          />
        </Field>
        <Field label="Position" hint="Lower numbers come first in the list.">
          <input
            name="sortOrder"
            type="number"
            min={0}
            max={10000}
            step={1}
            defaultValue={gift?.sortOrder ?? 0}
            className={input}
          />
        </Field>
      </fieldset>

      <fieldset className="flex flex-col gap-3 rounded border border-zinc-200 bg-white p-5">
        <legend className="px-1 text-xs font-semibold tracking-wide text-zinc-500 uppercase">
          Visibility
        </legend>
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            name="available"
            defaultChecked={gift?.available ?? false}
            className="mt-0.5"
          />
          <span>
            On sale
            <span className="block text-xs text-zinc-500">
              New gifts start off sale, so nothing goes live before you&rsquo;ve
              checked the price.
            </span>
          </span>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="featured"
            defaultChecked={gift?.featured ?? false}
          />
          <span>Featured</span>
        </label>
      </fieldset>

      {errors.length > 0 && (
        <ul
          role="alert"
          className="list-disc rounded border border-red-300 bg-red-50 py-2 pr-3 pl-8 text-red-800"
        >
          {errors.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      )}
      {saved && (
        <p
          role="status"
          className="rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-emerald-900"
        >
          {saved}
        </p>
      )}

      <div>
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-zinc-900 px-5 py-2 font-medium text-white disabled:opacity-50"
        >
          {pending ? "Saving…" : isEdit ? "Save changes" : "Add gift"}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-medium">{label}</span>
      {children}
      {hint && <span className="text-xs text-zinc-500">{hint}</span>}
    </label>
  );
}
