import Link from "next/link";
import { OpsApiError, opsFetch } from "@/lib/ops/api";
import type { BankOption, GiftTemplate, VendorSummary } from "@/lib/ops/types";
import { VendorForm } from "../vendor-form";

export default async function NewVendorPage() {
  const [vendors, catalog, banks] = await Promise.all([
    opsFetch<VendorSummary[]>("/ops/vendors"),
    // The ops catalogue, so gifts not yet on sale can be linked too —
    // see the same note on the vendor detail page.
    opsFetch<GiftTemplate[]>("/ops/gifts"),
    opsFetch<BankOption[]>("/ops/banks").catch((error: unknown) => {
      if (error instanceof OpsApiError) return [] as BankOption[];
      throw error;
    }),
  ]);

  return (
    <>
      <Link href="/ops/vendors" className="mb-3 inline-block text-zinc-600 hover:text-zinc-900">
        ← Vendors
      </Link>
      <h1 className="mb-1 text-lg font-semibold">Add vendor</h1>
      <p className="mb-6 text-zinc-600">
        Everything needed to start taking gifts is on this screen. Bank details and the rest can wait under
        &ldquo;More details&rdquo;.
      </p>
      <VendorForm
        banks={banks}
        backupOptions={vendors.map((v) => ({ id: v.id, name: v.businessName }))}
        catalog={catalog
          .filter((g) => g.deliveryType === "digital_voucher")
          .map((g) => ({ id: g.id, name: g.name, basePrice: g.basePrice }))}
      />
    </>
  );
}
