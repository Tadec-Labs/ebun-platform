"use client";

import { useState, useTransition } from "react";
import { useConfirm } from "@/components/ui/feedback";
import { formatNaira } from "@/lib/format-money";
import type { VendorOffering } from "@/lib/vendor/api";
import { shrinkPhoto } from "@/lib/images/shrink-photo";
import {
  addItemPhotoAction,
  removeItemAction,
  requestItemAction,
  requestPriceChangeAction,
  setItemAvailabilityAction,
} from "../actions";

const STATUS_NOTE: Record<VendorOffering["status"], string> = {
  live: "",
  not_on_sale: "Approved — SendEbun will put it on sale soon",
  awaiting_approval: "Waiting for SendEbun to check",
};

/**
 * One switch per item and one short form. Sized for a thumb on a
 * counter phone, like the collect screen.
 *
 * The switch is optimistic: it flips at once and flips back with a
 * message if the API refuses, so a vendor marking something sold out
 * mid-rush isn't left watching a spinner.
 */
export function ItemsManager({ initial }: { initial: VendorOffering[] }) {
  const [items, setItems] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [priceNaira, setPriceNaira] = useState("");
  const [pending, startTransition] = useTransition();
  const [ask, askDialog] = useConfirm();

  const replace = (offering: VendorOffering) =>
    setItems((all) => all.map((i) => (i.giftTemplateId === offering.giftTemplateId ? offering : i)));

  function sendPrice(item: VendorOffering, naira: string, cancelling = false) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await requestPriceChangeAction(item.giftTemplateId, naira);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      replace(result.offering);
      setEditing(null);
      setNotice(
        cancelling
          ? "Request cancelled."
          : result.offering.proposedPrice !== null
            ? `Sent to SendEbun. Senders keep paying ${formatNaira(result.offering.inStorePrice)} until it's approved.`
            : "Price updated.",
      );
    });
  }

  async function remove(item: VendorOffering) {
    const ok = await ask({
      title: `Remove “${item.name}”?`,
      body:
        item.status === "awaiting_approval"
          ? "This cancels your request to sell it."
          : "Senders won't be able to buy it from you any more. Anyone who already bought it can still collect it — if some are still waiting, we'll ask you to mark it Sold out instead until they're done.",
      confirmLabel: "Remove",
      tone: "danger",
    });
    if (!ok) return;
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await removeItemAction(item.giftTemplateId);
      if (result.ok) {
        setItems((all) => all.filter((i) => i.giftTemplateId !== item.giftTemplateId));
        setNotice(`${item.name} removed.`);
      } else {
        setError(result.message);
      }
    });
  }

  function toggle(item: VendorOffering) {
    const next = !item.available;
    setError(null);
    setItems((all) => all.map((i) => (i.giftTemplateId === item.giftTemplateId ? { ...i, available: next } : i)));
    startTransition(async () => {
      const result = await setItemAvailabilityAction(item.giftTemplateId, next);
      if (!result.ok) {
        setItems((all) =>
          all.map((i) => (i.giftTemplateId === item.giftTemplateId ? { ...i, available: item.available } : i)),
        );
        setError(result.message);
      }
    });
  }

  function addPhoto(item: VendorOffering, file: File) {
    setError(null);
    startTransition(async () => {
      let photo: Blob;
      try {
        photo = await shrinkPhoto(file);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't read that photo.");
        return;
      }
      const form = new FormData();
      form.set("photo", photo, "photo");
      const result = await addItemPhotoAction(item.giftTemplateId, form);
      if (result.ok) {
        setItems((all) => all.map((i) => (i.giftTemplateId === item.giftTemplateId ? result.offering : i)));
      } else {
        setError(result.message);
      }
    });
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <p className="text-base leading-relaxed text-zinc-600">
          Switch an item off when you run out. Senders can&rsquo;t buy it until you switch it back on.
          Anyone who already bought it can still collect it here.
        </p>

        {error && (
          <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-base text-red-800">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="rounded-lg bg-emerald-50 px-4 py-3 text-base text-emerald-900">
            {notice}
          </p>
        )}

        {items.length === 0 ? (
          <p className="rounded-lg border-2 border-dashed border-zinc-300 px-4 py-6 text-center text-lg text-zinc-600">
            No items yet. Add what you sell below.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {items.map((item) => (
              <li key={item.giftTemplateId} className="rounded-lg border-2 border-zinc-200 p-4">
                <div className="flex items-start justify-between gap-4">
                  {item.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- public R2 photos; next/image would need the bucket host in config
                    <img src={item.imageUrl} alt="" className="h-16 w-16 shrink-0 rounded-md object-cover" />
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <p className="text-lg font-semibold">{item.name}</p>
                    <p className="mt-1 text-base text-zinc-600">
                      {formatNaira(item.inStorePrice)} · you receive {formatNaira(item.youReceive)}
                    </p>
                    {item.status !== "live" && (
                      <p className="mt-1 text-sm font-medium text-amber-800">{STATUS_NOTE[item.status]}</p>
                    )}
                    {item.proposedPrice !== null && (
                      <p className="mt-1 text-sm font-medium text-amber-800">
                        You asked for {formatNaira(item.proposedPrice)} — waiting for SendEbun. Senders pay{" "}
                        {formatNaira(item.inStorePrice)} until then.
                      </p>
                    )}
                    {/* The API decides finally; this only hides a button that would be refused. */}
                    {(item.status === "awaiting_approval" || !item.imageUrl) && (
                      <PhotoButton
                        hasPhoto={Boolean(item.imageUrl)}
                        onPick={(file) => addPhoto(item, file)}
                        disabled={pending}
                      />
                    )}
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={item.available}
                    aria-label={`${item.name}: ${item.available ? "available" : "sold out"}`}
                    disabled={pending}
                    onClick={() => toggle(item)}
                    className={`shrink-0 rounded-lg px-4 py-3 text-base font-semibold disabled:opacity-60 ${
                      item.available ? "bg-emerald-700 text-white" : "bg-zinc-200 text-zinc-800"
                    }`}
                  >
                    {item.available ? "Available" : "Sold out"}
                  </button>
                </div>

                {editing === item.giftTemplateId ? (
                  <form
                    className="mt-4 flex flex-col gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      sendPrice(item, priceNaira);
                    }}
                  >
                    <label className="flex flex-col gap-2">
                      <span className="text-base">New shop price (₦)</span>
                      <input
                        autoFocus
                        value={priceNaira}
                        onChange={(e) => setPriceNaira(e.target.value)}
                        inputMode="decimal"
                        required
                        className="w-full rounded-lg border-2 border-zinc-300 bg-white px-4 py-3 text-lg outline-none focus:border-zinc-900"
                      />
                    </label>
                    {item.status !== "awaiting_approval" && (
                      <span className="text-sm text-zinc-500">
                        SendEbun checks it first. Senders keep paying {formatNaira(item.inStorePrice)} until then, and
                        gifts already bought are paid at the price they were bought at.
                      </span>
                    )}
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="submit"
                        disabled={pending}
                        className="rounded-lg bg-zinc-900 py-3 text-base font-semibold text-white disabled:opacity-50"
                      >
                        {pending ? "Sending…" : item.status === "awaiting_approval" ? "Save" : "Send to SendEbun"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditing(null)}
                        className="rounded-lg border-2 border-zinc-300 py-3 text-base"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-base">
                    {item.canChangePrice ? (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => {
                          setEditing(item.giftTemplateId);
                          setPriceNaira(String((item.proposedPrice ?? item.inStorePrice) / 100));
                          setError(null);
                          setNotice(null);
                        }}
                        className="py-1 font-medium underline underline-offset-4 disabled:opacity-50"
                      >
                        Change price
                      </button>
                    ) : (
                      <span className="py-1 text-sm text-zinc-500">Other shops sell this — SendEbun sets its price.</span>
                    )}
                    {item.proposedPrice !== null && (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => sendPrice(item, String(item.inStorePrice / 100), true)}
                        className="py-1 font-medium underline underline-offset-4 disabled:opacity-50"
                      >
                        Cancel request
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => void remove(item)}
                      className="py-1 font-medium text-red-700 underline underline-offset-4 disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <RequestItemForm onAdded={(offering) => setItems((all) => [...all, offering])} />

      <p className="text-sm leading-relaxed text-zinc-500">
        Prices are what senders are promised, so a new price goes to SendEbun to approve first. To change the photo of a
        live item, send it to SendEbun on WhatsApp.
      </p>
      {askDialog}
    </div>
  );
}

function PhotoButton({
  hasPhoto,
  onPick,
  disabled,
}: {
  hasPhoto: boolean;
  onPick: (file: File) => void;
  disabled: boolean;
}) {
  return (
    <label className={`mt-2 inline-block text-base font-medium text-zinc-900 underline underline-offset-4 ${disabled ? "opacity-50" : ""}`}>
      {hasPhoto ? "Change photo" : "Add photo"}
      <input
        type="file"
        accept="image/*"
        className="sr-only"
        disabled={disabled}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) onPick(file);
        }}
      />
    </label>
  );
}

function RequestItemForm({ onAdded }: { onAdded: (offering: VendorOffering) => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [priceNaira, setPriceNaira] = useState("");
  const [needsBooking, setNeedsBooking] = useState(false);
  const [photo, setPhoto] = useState<File | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="flex flex-col gap-4 rounded-lg bg-zinc-50 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        setMessage(null);
        startTransition(async () => {
          const form = new FormData();
          form.set("name", name);
          form.set("description", description);
          form.set("priceNaira", priceNaira);
          form.set("bookingStyle", needsBooking ? "appointment" : "pickup");
          if (photo) {
            try {
              form.set("photo", await shrinkPhoto(photo), "photo");
            } catch (e) {
              setMessage({ ok: false, text: e instanceof Error ? e.message : "Couldn't read that photo." });
              return;
            }
          }
          const result = await requestItemAction(form);
          if (result.ok) {
            onAdded(result.offering);
            setName("");
            setDescription("");
            setPriceNaira("");
            setNeedsBooking(false);
            setPhoto(null);
            setMessage({
              ok: true,
              text: "Sent. SendEbun will check it and put it on sale — you'll see it marked here.",
            });
          } else {
            setMessage({ ok: false, text: result.message });
          }
        });
      }}
    >
      <h2 className="text-xl font-semibold">Add an item</h2>
      <label className="flex flex-col gap-2">
        <span className="text-base">Name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
          required
          placeholder="Jollof rice & chicken"
          className="w-full rounded-lg border-2 border-zinc-300 bg-white px-4 py-4 text-lg outline-none focus:border-zinc-900"
        />
      </label>
      <label className="flex flex-col gap-2">
        <span className="text-base">What&rsquo;s included (optional)</span>
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={300}
          placeholder="One plate, one drumstick, a drink"
          className="w-full rounded-lg border-2 border-zinc-300 bg-white px-4 py-4 text-lg outline-none focus:border-zinc-900"
        />
      </label>
      <label className="flex flex-col gap-2">
        <span className="text-base">Your shop price (₦)</span>
        <input
          value={priceNaira}
          onChange={(e) => setPriceNaira(e.target.value)}
          inputMode="decimal"
          required
          placeholder="4500"
          className="w-full rounded-lg border-2 border-zinc-300 bg-white px-4 py-4 text-lg outline-none focus:border-zinc-900"
        />
        <span className="text-sm text-zinc-500">
          The same price you charge at the counter. Senders pay this; SendEbun&rsquo;s fee is charged to them separately.
        </span>
      </label>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-base">Does the customer need to book a time?</legend>
        <div className="grid grid-cols-2 gap-2">
          {[
            { value: false, label: "No — they just come in" },
            { value: true, label: "Yes — e.g. spa, studio" },
          ].map((option) => (
            <button
              key={String(option.value)}
              type="button"
              aria-pressed={needsBooking === option.value}
              onClick={() => setNeedsBooking(option.value)}
              className={`rounded-lg border-2 px-3 py-3 text-base ${
                needsBooking === option.value ? "border-zinc-900 bg-white font-semibold" : "border-zinc-300 bg-white text-zinc-600"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </fieldset>
      <label className="flex flex-col gap-2">
        <span className="text-base">Photo</span>
        <input
          type="file"
          accept="image/*"
          onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
          className="w-full rounded-lg border-2 border-dashed border-zinc-300 bg-white px-4 py-4 text-base"
        />
        <span className="text-sm text-zinc-500">
          The real item, in your packaging, in daylight. Senders choose with their eyes.
        </span>
      </label>
      {message && (
        <p
          role={message.ok ? "status" : "alert"}
          className={`rounded-lg px-4 py-3 text-base ${message.ok ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-red-800"}`}
        >
          {message.text}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-zinc-900 py-5 text-xl font-semibold text-white disabled:opacity-50"
      >
        {pending ? "Sending…" : "Send to SendEbun"}
      </button>
    </form>
  );
}
