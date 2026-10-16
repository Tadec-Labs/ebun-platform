"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createCampaignAction } from "../actions";

const input = "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2";

/** Submit handled by hand, not <form action>, so a validation error doesn't wipe what was typed. */
export function NewCampaignForm() {
  const router = useRouter();
  const [values, setValues] = useState({
    companyName: "",
    contactName: "",
    contactEmail: "",
    contactPhone: "",
    title: "A thank-you from us",
    feePercent: "10",
  });
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, start] = useTransition();
  const set = (key: keyof typeof values) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setValues((v) => ({ ...v, [key]: e.target.value }));

  return (
    <form
      className="grid max-w-2xl gap-4 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        setErrors([]);
        start(async () => {
          const result = await createCampaignAction(values);
          if (!result.ok) setErrors(result.errors);
          else router.push(`/ops/campaigns/${result.id}`);
        });
      }}
    >
      <Field label="Company">
        <input className={input} value={values.companyName} onChange={set("companyName")} required />
      </Field>
      <Field label="Campaign name" hint="Shown to recipients as the headline; the company can change it.">
        <input className={input} value={values.title} onChange={set("title")} />
      </Field>
      <Field label="Contact name">
        <input className={input} value={values.contactName} onChange={set("contactName")} required />
      </Field>
      <Field label="Contact email" hint="Paystack sends the receipt here.">
        <input type="email" className={input} value={values.contactEmail} onChange={set("contactEmail")} required />
      </Field>
      <Field label="Contact phone (optional)">
        <input className={input} value={values.contactPhone} onChange={set("contactPhone")} />
      </Field>
      <Field label="SendEbun fee (%)" hint="On the gifts. 10% unless you agreed otherwise.">
        <input className={input} inputMode="decimal" value={values.feePercent} onChange={set("feePercent")} />
      </Field>
      {errors.length > 0 && (
        <ul role="alert" className="list-disc rounded-lg border border-red-200 bg-red-50 py-2 pr-3 pl-8 text-red-800 sm:col-span-2">
          {errors.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}
      <div className="sm:col-span-2">
        <button type="submit" disabled={pending} className="rounded-lg bg-zinc-900 px-4 py-2 font-medium text-white disabled:opacity-50">
          {pending ? "Creating…" : "Create and get their link"}
        </button>
      </div>
    </form>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-medium">{label}</span>
      {children}
      {hint && <span className="text-xs text-zinc-500">{hint}</span>}
    </label>
  );
}
