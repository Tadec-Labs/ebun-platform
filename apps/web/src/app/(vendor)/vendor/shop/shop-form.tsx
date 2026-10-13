"use client";

import { useState, useTransition } from "react";
import type { VendorProfile } from "@/lib/vendor/api";
import { saveProfileAction } from "../actions";

const input =
  "w-full rounded-lg border-2 border-zinc-300 bg-white px-4 py-4 text-lg outline-none focus:border-zinc-900";

/**
 * Pickup details can be changed any time. Bank details can be entered
 * once; after that the screen shows them masked and says how to change
 * them — through SendEbun, because a counter phone gets handed around and
 * "change where the money goes" is the first thing someone holding a lost
 * one would try.
 */
export function ShopForm({ initial }: { initial: VendorProfile }) {
  const [profile, setProfile] = useState(initial);
  const [ownerName, setOwnerName] = useState(initial.ownerName);
  const [pickupAddress, setPickupAddress] = useState(initial.pickupAddress ?? "");
  const [pickupHours, setPickupHours] = useState(initial.pickupHours ?? "");
  const [email, setEmail] = useState(initial.email ?? "");
  const [backupPhone, setBackupPhone] = useState(initial.backupPhone ?? "");
  const [bankName, setBankName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountName, setAccountName] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const settingBank = profile.bank === null && accountNumber.trim() !== "";

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        setMessage(null);
        startTransition(async () => {
          const result = await saveProfileAction({
            ownerName,
            pickupAddress,
            pickupHours,
            email,
            backupPhone,
            ...(settingBank ? { bankName, accountNumber, accountName } : {}),
          });
          if (result.ok) {
            setProfile(result.profile);
            setAccountNumber("");
            setMessage({
              ok: true,
              text:
                result.profile.missing.length === 0
                  ? "Saved. Recipients can now be sent to you."
                  : `Saved. Still needed: ${result.profile.missing.join(" and ")}.`,
            });
          } else {
            setMessage({ ok: false, text: result.message });
          }
        });
      }}
    >
      {profile.missing.length > 0 && (
        <p className="rounded-lg bg-amber-50 px-4 py-3 text-base text-amber-900">
          Before SendEbun can send customers to you, add your {profile.missing.join(" and ")}.
        </p>
      )}

      <section className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold">Where customers collect</h2>
        <label className="flex flex-col gap-2">
          <span className="text-base">Your name</span>
          <input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} maxLength={200} required className={input} />
        </label>
        <label className="flex flex-col gap-2">
          <span className="text-base">Shop address</span>
          <textarea
            value={pickupAddress}
            onChange={(e) => setPickupAddress(e.target.value)}
            maxLength={300}
            rows={3}
            placeholder="12 Oba Adesida Road, beside First Bank, Akure"
            className={input}
          />
          <span className="text-sm text-zinc-500">Shown to customers with directions. Add a landmark.</span>
        </label>
        <label className="flex flex-col gap-2">
          <span className="text-base">Opening hours</span>
          <input
            value={pickupHours}
            onChange={(e) => setPickupHours(e.target.value)}
            maxLength={120}
            placeholder="Mon–Sat, 9am–9pm"
            className={input}
          />
        </label>
      </section>

      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-xl font-semibold">If WhatsApp misses it</h2>
          <p className="mt-1 text-base text-zinc-600">
            New orders are emailed to you as well, and if nobody taps &ldquo;Got it&rdquo; within 30 minutes we call the
            second number.
          </p>
        </div>
        <label className="flex flex-col gap-2">
          <span className="text-base">Email for orders</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            maxLength={254}
            autoComplete="email"
            placeholder="orders@yourshop.com"
            className={input}
          />
        </label>
        <label className="flex flex-col gap-2">
          <span className="text-base">Second phone number</span>
          <input
            value={backupPhone}
            onChange={(e) => setBackupPhone(e.target.value)}
            inputMode="tel"
            maxLength={20}
            placeholder="A manager or the shop line, e.g. 0803 123 4567"
            className={input}
          />
        </label>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold">Where SendEbun pays you</h2>
        {profile.bank ? (
          <div className="rounded-lg border-2 border-zinc-200 p-4 text-base">
            <p className="font-semibold">
              {profile.bank.bankName ?? "Bank"} · ****{profile.bank.accountLast4}
            </p>
            {profile.bank.accountName && <p className="text-zinc-600">{profile.bank.accountName}</p>}
            <p className="mt-2 text-sm text-zinc-500">To change your bank details, message SendEbun on WhatsApp.</p>
          </div>
        ) : (
          <>
            <label className="flex flex-col gap-2">
              <span className="text-base">Bank</span>
              <input value={bankName} onChange={(e) => setBankName(e.target.value)} maxLength={120} placeholder="GTBank" className={input} />
            </label>
            <label className="flex flex-col gap-2">
              <span className="text-base">Account number</span>
              <input
                value={accountNumber}
                onChange={(e) => setAccountNumber(e.target.value)}
                inputMode="numeric"
                maxLength={10}
                pattern="\d{10}"
                placeholder="10 digits"
                className={input}
              />
            </label>
            <label className="flex flex-col gap-2">
              <span className="text-base">Account name</span>
              <input value={accountName} onChange={(e) => setAccountName(e.target.value)} maxLength={200} className={input} />
            </label>
            <p className="text-sm text-zinc-500">
              Check these carefully — once saved, only SendEbun can change them.
            </p>
          </>
        )}
      </section>

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
        {pending ? "Saving…" : "Save"}
      </button>
    </form>
  );
}
