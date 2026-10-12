import type { Metadata } from "next";
import Link from "next/link";
import {
  VendorApiError,
  vendorFetch,
  type VendorIdentity,
  type VendorOffering,
  type VendorProfile,
} from "@/lib/vendor/api";
import { ItemsManager } from "./items-manager";

export const metadata: Metadata = {
  title: "Your items",
  robots: { index: false, follow: false },
};

/**
 * The vendor's own listing: what senders can buy from them, a switch for
 * "sold out today", and a way to ask to sell something new.
 *
 * Same counter-phone styling as the collect screen. Reached from the
 * same private link, so it needs no login of its own.
 */
export default async function VendorItemsPage() {
  let identity: VendorIdentity;
  let offerings: VendorOffering[];
  let profile: VendorProfile | null;
  try {
    [identity, offerings, profile] = await Promise.all([
      vendorFetch<VendorIdentity>("/vendor/me"),
      vendorFetch<VendorOffering[]>("/vendor/offerings"),
      // Only drives a reminder; the page works without it.
      vendorFetch<VendorProfile>("/vendor/profile").catch(() => null),
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

  return (
    <div className="flex flex-col gap-6 py-8">
      <header>
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-zinc-500">{identity.businessName}</p>
          <nav className="flex gap-4">
            <Link href="/vendor" className="text-base font-medium text-zinc-900 underline underline-offset-4">
              Collect
            </Link>
            <Link href="/vendor/shop" className="text-base font-medium text-zinc-900 underline underline-offset-4">
              Shop
            </Link>
          </nav>
        </div>
        <h1 className="mt-1 text-3xl font-semibold">Your items</h1>
      </header>
      {profile && profile.missing.length > 0 && (
        <Link href="/vendor/shop" className="block rounded-lg bg-amber-50 px-4 py-3 text-base text-amber-900">
          Add your {profile.missing.join(" and ")} so SendEbun can send customers to you →
        </Link>
      )}
      <ItemsManager initial={offerings} />
    </div>
  );
}
