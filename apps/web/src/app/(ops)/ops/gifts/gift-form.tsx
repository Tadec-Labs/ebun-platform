"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ProgressDialog, Spinner, useToast, type ProgressStep } from "@/components/ui/feedback";
import { formatNaira, parseNairaToKobo } from "@/lib/format-money";
import { shrinkPhoto } from "@/lib/images/shrink-photo";
import {
  BOOKING_STYLE_OPTIONS,
  DELIVERY_TYPE_LABEL,
  GIFT_DELIVERY_TYPES,
  OCCASION_OPTIONS,
  VENDOR_CATEGORIES,
  type GiftTemplate,
} from "@/lib/ops/types";
import { saveGiftAction, saveOfferingAction, uploadGiftPhotoAction } from "../actions";

const input =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 shadow-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10";

export interface PartnerOption {
  id: string;
  name: string;
  /** 0.90 = the partner receives 90% of the sender price by default. */
  share: number;
}

/**
 * Adding and editing a gift.
 *
 * Adding is one form and one button for everything a gift needs to go
 * live — what it is, a photo, and the partner who makes it — instead of
 * "save, then upload on the next page, then go to the partner's page and
 * link it". The save is three requests; a progress dialog shows each one
 * so nobody taps twice or leaves mid-way. If the photo or partner step
 * fails, the gift itself is already saved, and the gift page opens with
 * the problem stated.
 *
 * Editing changes only the fields here. The photo, the partners and the
 * on-sale switch each have their own control on the gift page, and this
 * form never sends them — a form re-sending what it showed at page load
 * used to erase a photo uploaded since.
 *
 * Manual onSubmit rather than <form action>: React 19 resets uncontrolled
 * fields when an action settles, which would wipe the form on any error.
 */
export function GiftForm({ gift, partners = [] }: { gift?: GiftTemplate; partners?: PartnerOption[] }) {
  const router = useRouter();
  const toast = useToast();
  const isEdit = Boolean(gift);
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();
  const [steps, setSteps] = useState<ProgressStep[] | null>(null);

  // Create-only extras, held here until the gift exists.
  const [priceNaira, setPriceNaira] = useState(gift ? String(gift.basePrice / 100) : "");
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [partnerId, setPartnerId] = useState(partners.length === 1 ? partners[0].id : "");
  const [partnerPriceNaira, setPartnerPriceNaira] = useState("");
  const [partnerPriceTouched, setPartnerPriceTouched] = useState(false);

  const partner = partners.find((p) => p.id === partnerId) ?? null;
  const priceKobo = parseNairaToKobo(priceNaira);
  // Suggested partner price follows the gift price until someone types
  // their own — the partner's agreed share, rounded to whole naira.
  const suggestedPartnerNaira =
    partner && priceKobo ? String(Math.round((priceKobo * partner.share) / 100)) : "";
  const effectivePartnerNaira = partnerPriceTouched ? partnerPriceNaira : suggestedPartnerNaira;
  const partnerKobo = parseNairaToKobo(effectivePartnerNaira);
  const margin = priceKobo && partnerKobo ? priceKobo - partnerKobo : null;

  function setStep(index: number, state: ProgressStep["state"], detail?: string) {
    setSteps((all) => all?.map((s, i) => (i === index ? { ...s, state, detail } : s)) ?? null);
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setErrors([]);

    if (isEdit) {
      startTransition(async () => {
        const result = await saveGiftAction(formData);
        if (result.ok) {
          toast.success(result.message ?? "Saved.");
          router.refresh();
        } else {
          setErrors(result.errors);
        }
      });
      return;
    }

    if (partner && (partnerKobo === null || partnerKobo < 1)) {
      setErrors(["Enter what the partner gets, in naira — or choose “No partner yet”."]);
      return;
    }

    const plan: ProgressStep[] = [{ label: "Saving the gift", state: "active" }];
    if (photo) plan.push({ label: "Uploading the photo", state: "pending" });
    if (partner) plan.push({ label: `Linking ${partner.name}`, state: "pending" });
    setSteps(plan);

    startTransition(async () => {
      const created = await saveGiftAction(formData);
      if (!created.ok || !created.id) {
        setSteps(null);
        setErrors(created.ok ? ["The gift didn't save. Try again."] : created.errors);
        return;
      }
      const id = created.id;
      setStep(0, "done");
      const problems: string[] = [];
      let index = 1;

      if (photo) {
        setStep(index, "active");
        try {
          const body = new FormData();
          body.set("photo", await shrinkPhoto(photo), "photo");
          const uploaded = await uploadGiftPhotoAction(id, body);
          if (uploaded.ok) setStep(index, "done");
          else {
            setStep(index, "error", uploaded.errors.join(" "));
            problems.push("the photo didn't upload");
          }
        } catch (e) {
          setStep(index, "error", e instanceof Error ? e.message : "Couldn't read that photo.");
          problems.push("the photo didn't upload");
        }
        index += 1;
      }

      if (partner) {
        setStep(index, "active");
        const linked = await saveOfferingAction({
          vendorId: partner.id,
          giftTemplateId: id,
          priceNaira: effectivePartnerNaira,
          zones: "",
          available: true,
        });
        if (linked.ok) setStep(index, "done");
        else {
          setStep(index, "error", linked.errors.join(" "));
          problems.push(`${partner.name} wasn't linked`);
        }
      }

      if (problems.length === 0) toast.success("Gift added.");
      else toast.error(`Gift saved, but ${problems.join(" and ")}. Fix it on this page.`);
      // A beat on the finished checklist, so it reads as done rather than vanishing.
      await new Promise((resolve) => setTimeout(resolve, problems.length ? 1600 : 500));
      router.push(`/ops/gifts/${id}`);
    });
  }

  return (
    <form className="flex flex-col gap-6" onSubmit={submit}>
      {gift && <input type="hidden" name="id" value={gift.id} />}

      <Section title="What it is">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" hint="What the sender scans. Plain beats clever — “Ofada rice & chicken”.">
            <input name="name" required maxLength={200} defaultValue={gift?.name} placeholder="Ofada rice & chicken" className={input} />
          </Field>
          <Field label="Price the sender pays (₦)" hint="The gift's price at the counter. SendEbun's fee is added on top at checkout.">
            <input
              name="basePrice"
              required
              inputMode="decimal"
              value={priceNaira}
              onChange={(e) => setPriceNaira(e.target.value)}
              placeholder="6200"
              className={input}
            />
          </Field>
          <Field label="Description" hint="One or two lines, shown under the name." wide>
            <textarea
              name="description"
              rows={2}
              maxLength={2000}
              defaultValue={gift?.description ?? ""}
              placeholder="Smoky ofada rice with ayamase sauce and a piece of chicken."
              className={input}
            />
          </Field>
          <Field label="Category">
            <select name="category" defaultValue={gift?.category ?? "dine"} className={input}>
              {VENDOR_CATEGORIES.map((category) => (
                <option key={category.value} value={category.value}>
                  {category.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Position in the list" hint="Lower numbers show first.">
            <input name="sortOrder" type="number" min={0} max={10000} step={1} defaultValue={gift?.sortOrder ?? 0} className={input} />
          </Field>
          <div className="flex flex-col gap-2 sm:col-span-2">
            <span className="font-medium">Good for</span>
            <div className="flex flex-wrap gap-2">
              {OCCASION_OPTIONS.map((occasion) => (
                <label
                  key={occasion.value}
                  className="flex cursor-pointer items-center gap-1.5 rounded-full border border-zinc-300 px-3 py-1.5 has-[:checked]:border-zinc-900 has-[:checked]:bg-zinc-900 has-[:checked]:text-white"
                >
                  <input
                    type="checkbox"
                    name="occasions"
                    value={occasion.value}
                    defaultChecked={gift?.occasions.includes(occasion.value) ?? false}
                    className="sr-only"
                  />
                  {occasion.label}
                </label>
              ))}
            </div>
            <span className="text-xs text-zinc-500">Senders filter by occasion on /send.</span>
          </div>
        </div>
      </Section>

      <Section title="How they get it">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Delivery">
            {gift ? (
              <>
                <p className="py-1.5 font-medium">{DELIVERY_TYPE_LABEL[gift.deliveryType]}</p>
                <span className="text-xs text-zinc-500">
                  Fixed once a gift exists — orders depend on it. Add a new gift for a different way of getting it.
                </span>
              </>
            ) : (
              <select name="deliveryType" defaultValue="digital_voucher" className={input}>
                {GIFT_DELIVERY_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Collection" hint="Appointment for spas and studios — the recipient asks for a time, the partner confirms.">
            <select name="bookingStyle" defaultValue={gift?.bookingStyle ?? "pickup"} className={input}>
              {BOOKING_STYLE_OPTIONS.map((style) => (
                <option key={style.value} value={style.value}>
                  {style.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Timing note" hint="Shown to the sender, e.g. “Same day if ordered by 1pm”." wide>
            <input name="deliveryWindow" maxLength={120} defaultValue={gift?.deliveryWindow ?? ""} className={input} />
          </Field>
        </div>
        {!gift && (
          <ul className="mt-4 grid gap-1 rounded-lg bg-zinc-50 p-3 text-xs text-zinc-600">
            {GIFT_DELIVERY_TYPES.map((type) => (
              <li key={type.value}>
                <span className="font-medium text-zinc-800">{type.label}:</span> {type.hint}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {!gift && (
        <>
          <Section title="Photo" note="Optional now — you can add or change it later.">
            <div className="flex items-center gap-4">
              {photoPreview ? (
                // eslint-disable-next-line @next/next/no-img-element -- local preview blob
                <img src={photoPreview} alt="" className="h-24 w-24 rounded-lg object-cover ring-1 ring-zinc-200" />
              ) : (
                <div className="flex h-24 w-24 items-center justify-center rounded-lg bg-zinc-100 text-xs text-zinc-500">
                  No photo
                </div>
              )}
              <div className="flex flex-col gap-1">
                <label className="inline-flex w-fit cursor-pointer rounded-lg border border-zinc-300 bg-white px-3 py-1.5 font-medium shadow-sm hover:bg-zinc-50">
                  {photo ? "Choose another" : "Choose a photo"}
                  <input
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    onChange={(event) => {
                      const file = event.target.files?.[0] ?? null;
                      event.target.value = "";
                      setPhoto(file);
                      setPhotoPreview(file ? URL.createObjectURL(file) : null);
                    }}
                  />
                </label>
                <span className="text-xs text-zinc-500">The real item, in daylight. Senders choose with their eyes.</span>
              </div>
            </div>
          </Section>

          <Section
            title="Who makes it"
            note="A gift shows on /send only when it's on sale AND a partner makes it. You can add more partners later."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Partner">
                <select
                  value={partnerId}
                  onChange={(e) => {
                    setPartnerId(e.target.value);
                    setPartnerPriceTouched(false);
                  }}
                  className={input}
                >
                  <option value="">No partner yet</option>
                  {partners.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </Field>
              {partner && (
                <Field
                  label="Partner gets (₦)"
                  hint={
                    margin !== null && priceKobo
                      ? margin > 0
                        ? `SendEbun keeps ${formatNaira(margin)} (${Math.round((margin / priceKobo) * 1000) / 10}%) before the service fee.`
                        : "Must be less than the sender price, or SendEbun loses money on every order."
                      : `Suggested from their ${Math.round(partner.share * 100)}% share.`
                  }
                >
                  <input
                    inputMode="decimal"
                    value={effectivePartnerNaira}
                    onChange={(e) => {
                      setPartnerPriceTouched(true);
                      setPartnerPriceNaira(e.target.value);
                    }}
                    className={input}
                  />
                </Field>
              )}
            </div>
            {partners.length === 0 && (
              <p className="mt-3 text-xs text-amber-800">
                No active partners yet. Add one under Partners, then link them to this gift from its page.
              </p>
            )}
          </Section>
        </>
      )}

      <Section title="Visibility">
        <div className="flex flex-col gap-3">
          {!gift && (
            <label className="flex items-start gap-2">
              <input type="checkbox" name="available" defaultChecked={false} className="mt-1" />
              <span>
                Put on sale now
                <span className="block text-xs text-zinc-500">
                  Leave off until the price and photo are right. You can switch it on from the gift page.
                </span>
              </span>
            </label>
          )}
          <label className="flex items-start gap-2">
            <input type="checkbox" name="featured" defaultChecked={gift?.featured ?? false} className="mt-1" />
            <span>
              Featured
              <span className="block text-xs text-zinc-500">Shown large at the top of /send when browsing everything.</span>
            </span>
          </label>
        </div>
      </Section>

      {errors.length > 0 && (
        <ul role="alert" className="list-disc rounded-lg border border-red-300 bg-red-50 py-2 pr-3 pl-8 text-red-800">
          {errors.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      )}

      <div className="sticky bottom-0 -mx-1 flex items-center gap-3 border-t border-zinc-200 bg-zinc-50/95 px-1 py-3 backdrop-blur">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-5 py-2.5 font-medium text-white shadow-sm hover:bg-zinc-800 disabled:opacity-60"
        >
          {pending && <Spinner />}
          {pending ? "Saving…" : isEdit ? "Save changes" : "Add gift"}
        </button>
        {isEdit && <span className="text-xs text-zinc-500">Photo, partners and on-sale save on their own.</span>}
      </div>

      <ProgressDialog open={steps !== null} title="Adding the gift" steps={steps ?? []} />
    </form>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
      <h2 className="font-semibold">{title}</h2>
      {note && <p className="mt-0.5 text-xs text-zinc-500">{note}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Field({
  label,
  hint,
  wide = false,
  children,
}: {
  label: string;
  hint?: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className={`flex flex-col gap-1 ${wide ? "sm:col-span-2" : ""}`}>
      <span className="font-medium">{label}</span>
      {children}
      {hint && <span className="text-xs text-zinc-500">{hint}</span>}
    </label>
  );
}
