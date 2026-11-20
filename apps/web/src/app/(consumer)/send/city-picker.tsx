"use client";

import { useState } from "react";
import { track } from "@/lib/analytics";
import { requestCity, type City } from "@/lib/cities/cities";

/**
 * "Where's the person you're gifting?" — asked before any gift is shown.
 *
 * One tap, and it earns its place: every gift on the next screen can
 * actually reach that city, so nobody pays for an Akure spa day for
 * someone in Lagos. It is the one gate in front of the gift list, so it
 * is as small as a gate can be — a row of cities and a way out.
 */
export function CityPicker({
  cities,
  onChoose,
  onElsewhere,
}: {
  cities: City[];
  onChoose: (city: City) => void;
  onElsewhere: () => void;
}) {
  return (
    <section aria-labelledby="city-heading" className="pb-10">
      <h1
        id="city-heading"
        className="font-display pb-2 text-3xl leading-tight font-normal md:text-4xl"
        style={{ color: "var(--cream)" }}
      >
        Where are they?
      </h1>
      <p className="pb-6 text-sm leading-relaxed" style={{ color: "var(--cream-dim)" }}>
        Pick the city of the person you&rsquo;re gifting. We&rsquo;ll only show gifts that can reach them there.
      </p>
      <ul className="flex flex-col gap-2.5">
        {cities.map((city) => (
          <li key={city.slug}>
            <button
              type="button"
              onClick={() => onChoose(city)}
              className="flex w-full items-center justify-between border px-5 py-4 text-left transition-colors hover:border-[color:var(--gold)] active:scale-[0.99]"
              style={{ borderColor: "var(--border-strong)", background: "var(--panel)" }}
            >
              <span>
                <span className="font-display block text-xl" style={{ color: "var(--cream)" }}>
                  {city.name}
                </span>
                {city.state && (
                  <span className="text-xs" style={{ color: "var(--cream-faint)" }}>
                    {city.state} State
                  </span>
                )}
              </span>
              <span aria-hidden="true" style={{ color: "var(--gold)" }}>
                &rarr;
              </span>
            </button>
          </li>
        ))}
        <li>
          <button
            type="button"
            onClick={onElsewhere}
            className="w-full border border-dashed px-5 py-4 text-left text-sm transition-colors hover:border-[color:var(--gold)]"
            style={{ borderColor: "var(--border)", color: "var(--cream-dim)" }}
          >
            Somewhere else
          </button>
        </li>
      </ul>
    </section>
  );
}

/** The chosen city, small, with a way back. Sits above the gift list. */
export function CityBar({ label, onChange }: { label: string; onChange: () => void }) {
  return (
    <p className="flex items-center gap-2 pb-4 text-xs" style={{ color: "var(--cream-dim)" }}>
      <span>
        Gifts for someone in <strong style={{ color: "var(--cream)", fontWeight: 500 }}>{label}</strong>
      </span>
      <span aria-hidden="true">&middot;</span>
      <button
        type="button"
        onClick={onChange}
        className="underline underline-offset-4"
        style={{ color: "var(--gold-light)" }}
      >
        Change
      </button>
    </p>
  );
}

/**
 * Their city isn't open yet. Honest about it, asks where (that list
 * decides which city opens next), and offers what does work anywhere.
 */
export function ElsewhereNote({ hasNationwide }: { hasNationwide: boolean }) {
  const [city, setCity] = useState("");
  const [contact, setContact] = useState("");
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);

  if (sent) {
    return (
      <div className="mb-8 border p-5 text-sm leading-relaxed" style={{ borderColor: "var(--border)", color: "var(--cream-dim)" }}>
        Thank you. {contact.trim() ? "We'll let you know when we arrive in " : "We've noted "}
        <strong style={{ color: "var(--cream)", fontWeight: 500 }}>{city.trim()}</strong>
        {contact.trim() ? "." : " — it helps us decide where to open next."}
        {hasNationwide && " Meanwhile, the gifts below reach anyone, anywhere in Nigeria."}
      </div>
    );
  }

  return (
    <form
      className="mb-8 flex flex-col gap-3 border p-5"
      style={{ borderColor: "var(--border)" }}
      onSubmit={async (e) => {
        e.preventDefault();
        if (city.trim().length < 2 || sending) return;
        setSending(true);
        await requestCity({ city: city.trim(), contact: contact.trim() || undefined });
        track("city_requested", {});
        setSent(true);
      }}
    >
      <p className="text-sm leading-relaxed" style={{ color: "var(--cream-dim)" }}>
        We&rsquo;re not delivering gifts there yet.
        {hasNationwide ? " The gifts below reach anyone in Nigeria. " : " "}
        Tell us where they are and we&rsquo;ll let you know when we arrive.
      </p>
      <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--cream-faint)" }}>
        Their city
        <input
          value={city}
          onChange={(e) => setCity(e.target.value)}
          maxLength={80}
          required
          autoComplete="address-level2"
          placeholder="e.g. Ibadan"
          className="border bg-transparent px-3 py-2.5 text-sm"
          style={{ borderColor: "var(--border-strong)", color: "var(--cream)" }}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--cream-faint)" }}>
        Your WhatsApp or email (optional)
        <input
          value={contact}
          onChange={(e) => setContact(e.target.value)}
          maxLength={254}
          className="border bg-transparent px-3 py-2.5 text-sm"
          style={{ borderColor: "var(--border-strong)", color: "var(--cream)" }}
        />
      </label>
      <button
        type="submit"
        disabled={city.trim().length < 2 || sending}
        className="self-start px-4 py-2 text-xs font-medium tracking-wide disabled:opacity-50"
        style={{ background: "var(--gold)", color: "var(--ink)" }}
      >
        {sending ? "Sending…" : "Let me know"}
      </button>
    </form>
  );
}
