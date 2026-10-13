import type { Metadata } from "next";
import { formatNaira } from "@/lib/format-money";
import {
  VendorApiError,
  vendorFetch,
  type VendorEarnings,
  type VendorIdentity,
} from "@/lib/vendor/api";
import { VendorNav } from "../vendor-nav";

export const metadata: Metadata = {
  title: "Earnings",
  robots: { index: false, follow: false },
};

/**
 * The screen that decides whether a vendor trusts SendEbun: what they've
 * handed over, what they're owed, and every payment, with the transfer
 * reference so they can match it to their bank alert.
 *
 * Read-only. Paying is something SendEbun does, and the vendor sees it
 * land here.
 */
export default async function VendorEarningsPage() {
  let identity: VendorIdentity;
  let earnings: VendorEarnings;
  try {
    [identity, earnings] = await Promise.all([
      vendorFetch<VendorIdentity>("/vendor/me"),
      vendorFetch<VendorEarnings>("/vendor/earnings"),
    ]);
  } catch (error) {
    if (error instanceof VendorApiError) {
      return (
        <div className="flex min-h-dvh flex-col justify-center gap-4 py-16">
          <h1 className="text-2xl font-semibold">
            {error.status === 0 ? "No connection" : "This link isn't working"}
          </h1>
          <p className="text-lg leading-relaxed text-zinc-600">
            {error.status === 0
              ? "Check the phone's internet and reload this page."
              : "It may have been replaced. Ask SendEbun for a new link, then open it on this phone."}
          </p>
        </div>
      );
    }
    throw error;
  }

  const unpaid = earnings.collections.filter((c) => !c.paid);

  return (
    <div className="flex flex-col gap-8 py-8">
      <header>
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-zinc-500">{identity.businessName}</p>
          <VendorNav current="/vendor/earnings" />
        </div>
        <h1 className="mt-1 text-3xl font-semibold">Earnings</h1>
      </header>

      <section className="grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-zinc-900 p-4 text-white">
          <p className="text-sm text-zinc-300">Owed to you</p>
          <p className="mt-1 text-3xl font-semibold">{formatNaira(earnings.owedNow)}</p>
          <p className="mt-1 text-sm text-zinc-300">
            {unpaid.length} {unpaid.length === 1 ? "gift" : "gifts"} not yet paid
          </p>
        </div>
        <div className="rounded-lg border-2 border-zinc-200 p-4">
          <p className="text-sm text-zinc-500">Paid to you</p>
          <p className="mt-1 text-3xl font-semibold">{formatNaira(earnings.paidTotal)}</p>
          <p className="mt-1 text-sm text-zinc-500">so far</p>
        </div>
      </section>

      <p className="text-base leading-relaxed text-zinc-600">
        Every gift is paid for by the sender before it reaches you. You&rsquo;re owed your share the moment you hand it
        over, and SendEbun sends it to your bank account.
      </p>

      {earnings.payments.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold">Payments</h2>
          <ul className="flex flex-col gap-2">
            {earnings.payments.map((payment) => (
              <li key={payment.id} className="flex items-center justify-between gap-3 rounded-lg border-2 border-emerald-200 bg-emerald-50 p-4">
                <div className="min-w-0">
                  <p className="text-lg font-semibold">{formatNaira(payment.amount)}</p>
                  <p className="text-sm text-zinc-600">
                    {payment.collections} {payment.collections === 1 ? "gift" : "gifts"}
                    {payment.reference ? ` · Ref ${payment.reference}` : ""}
                  </p>
                </div>
                <p className="shrink-0 text-base text-emerald-800">{payment.paidAt ? formatDay(payment.paidAt) : "Paid"}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">Gifts handed over</h2>
        {earnings.collections.length === 0 ? (
          <p className="rounded-lg border-2 border-dashed border-zinc-300 px-4 py-6 text-center text-lg text-zinc-600">
            Nothing yet. When you hand over a SendEbun gift, it appears here with what you&rsquo;re owed.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {earnings.collections.map((collection) => (
              <li key={collection.orderId} className="flex items-center justify-between gap-3 rounded-lg border-2 border-zinc-200 p-4">
                <div className="min-w-0">
                  <p className="text-lg font-semibold">{collection.giftName}</p>
                  <p className="text-sm text-zinc-600">
                    {formatDay(collection.collectedAt)}
                    {collection.orderNumber ? ` · ${collection.orderNumber}` : ""}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-lg font-semibold">{formatNaira(collection.amount)}</p>
                  <p className={`text-sm font-medium ${collection.paid ? "text-emerald-700" : "text-amber-700"}`}>
                    {collection.paid ? "Paid" : "Owed"}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-NG", {
    timeZone: "Africa/Lagos",
    day: "numeric",
    month: "short",
  });
}
