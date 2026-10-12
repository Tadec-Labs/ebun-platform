import type { Metadata } from "next";
import Link from "next/link";
import { VendorApiError, vendorFetch, type VendorProfile } from "@/lib/vendor/api";
import { ShopForm } from "./shop-form";

export const metadata: Metadata = {
  title: "Your shop",
  robots: { index: false, follow: false },
};

/**
 * The vendor fills in their own details: where recipients collect, when
 * they're open, and where SendEbun pays them. Ops only needs a name and a
 * WhatsApp number to send the link; the vendor does the rest from here.
 */
export default async function VendorShopPage() {
  let profile: VendorProfile;
  try {
    profile = await vendorFetch<VendorProfile>("/vendor/profile");
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
          <p className="text-sm text-zinc-500">{profile.businessName}</p>
          <nav className="flex gap-4">
            <Link href="/vendor" className="text-base font-medium text-zinc-900 underline underline-offset-4">
              Collect
            </Link>
            <Link href="/vendor/gifts" className="text-base font-medium text-zinc-900 underline underline-offset-4">
              Items
            </Link>
          </nav>
        </div>
        <h1 className="mt-1 text-3xl font-semibold">Your shop</h1>
      </header>
      <ShopForm initial={profile} />
    </div>
  );
}
