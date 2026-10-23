"use client";

import { useState } from "react";
import { API_BASE_URL } from "@/lib/api-config";

const input =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 outline-none focus:border-zinc-900 disabled:bg-zinc-50";
const primary =
  "w-full rounded-lg bg-zinc-900 px-4 py-2.5 font-medium text-white shadow-sm hover:bg-zinc-800 disabled:opacity-50";

type Mode = "start" | "links";

/**
 * Posts straight from the browser to the API — not through a server
 * action — so the API's per-IP limit (5 an hour) counts each company's
 * own address. Through a server action every request would arrive from
 * Vercel's IP and one busy hour would lock everyone out.
 *
 * Never shows the private link: it is emailed to the address given,
 * which is what proves the person controls that inbox.
 */
export function StartForm() {
  const [mode, setMode] = useState<Mode>("start");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) ?? "").trim();
    const email = mode === "start" ? value("contactEmail") : value("email");
    const body =
      mode === "start"
        ? {
            companyName: value("companyName"),
            contactName: value("contactName"),
            contactEmail: email,
            contactPhone: value("contactPhone") || undefined,
            website: value("website") || undefined,
          }
        : { email, website: value("website") || undefined };

    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/companies/${mode === "start" ? "start" : "links"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setSentTo(email);
        return;
      }
      if (res.status === 429) {
        setError("That's a lot of tries from here. Please wait an hour, or email hello@ebun.com.ng.");
        return;
      }
      const payload = (await res.json().catch(() => ({}))) as { message?: string | string[] };
      const message = Array.isArray(payload.message) ? payload.message.join(" ") : payload.message;
      setError(message ?? "Something went wrong. Please try again.");
    } catch {
      setError("Couldn't reach SendEbun. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (sentTo) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm" role="status">
        <p className="text-lg font-semibold text-zinc-900">Check your email</p>
        <p className="mt-2 text-zinc-600">
          We&rsquo;ve sent your private link to <span className="font-medium text-zinc-900">{sentTo}</span>. Open it
          on the computer you&rsquo;ll use to set things up — it takes about ten minutes, with your list to hand.
        </p>
        <p className="mt-3 text-sm text-zinc-500">
          Nothing after a few minutes? Check spam, or{" "}
          <button
            type="button"
            className="font-medium text-zinc-900 underline underline-offset-2"
            onClick={() => {
              setSentTo(null);
              setMode("links");
            }}
          >
            ask for it again
          </button>
          .
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="relative flex flex-col gap-4 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
      <div>
        <p className="text-lg font-semibold text-zinc-900">
          {mode === "start" ? "Start your company's gifts" : "Get your links again"}
        </p>
        <p className="mt-1 text-sm text-zinc-500">
          {mode === "start"
            ? "No account or password. We email you a private link to set everything up."
            : "We'll email the links for every campaign started with this address."}
        </p>
      </div>

      {mode === "start" ? (
        <>
          <Field label="Company name">
            <input name="companyName" required minLength={2} maxLength={120} autoComplete="organization" className={input} />
          </Field>
          <Field label="Your name">
            <input name="contactName" required minLength={2} maxLength={120} autoComplete="name" className={input} />
          </Field>
          <Field label="Work email" hint="Your private link goes here.">
            <input name="contactEmail" type="email" required maxLength={254} autoComplete="email" className={input} />
          </Field>
          <Field label="Phone (optional)" hint="So we can help if you get stuck.">
            <input name="contactPhone" type="tel" maxLength={20} autoComplete="tel" placeholder="0803 123 4567" className={input} />
          </Field>
        </>
      ) : (
        <Field label="Email you used">
          <input name="email" type="email" required maxLength={254} autoComplete="email" className={input} />
        </Field>
      )}

      {/* Honeypot: off-screen for people, irresistible to bots. */}
      <div aria-hidden className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label>
          Website
          <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}

      <button type="submit" className={primary} disabled={busy}>
        {busy ? "Sending…" : mode === "start" ? "Email me my link" : "Email my links"}
      </button>

      <p className="text-center text-sm text-zinc-500">
        {mode === "start" ? "Started one already? " : "New here? "}
        <button
          type="button"
          className="font-medium text-zinc-900 underline underline-offset-2"
          onClick={() => {
            setError(null);
            setMode(mode === "start" ? "links" : "start");
          }}
        >
          {mode === "start" ? "Get your links again" : "Start a campaign"}
        </button>
      </p>
    </form>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-medium text-zinc-800">{label}</span>
      {children}
      {hint && <span className="text-xs text-zinc-500">{hint}</span>}
    </label>
  );
}
