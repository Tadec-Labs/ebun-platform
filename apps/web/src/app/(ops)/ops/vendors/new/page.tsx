import Link from "next/link";
import { opsFetch } from "@/lib/ops/api";
import type { GiftTemplate, VendorSummary } from "@/lib/ops/types";
import { VendorForm } from "../vendor-form";

export default async function NewVendorPage() {
  const [vendors, catalog] = await Promise.all([
    opsFetch<VendorSummary[]>("/ops/vendors"),
    // The ops catalogue, so gifts not yet on sale can be linked too —
    // see the same note on the vendor detail page.
    opsFetch<GiftTemplate[]>("/ops/gifts"),
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
        backupOptions={vendors.map((v) => ({ id: v.id, name: v.businessName }))}
        catalog={catalog
          .filter((g) => g.deliveryType === "digital_voucher")
          .map((g) => ({ id: g.id, name: g.name, basePrice: g.basePrice }))}
      />
    </>
  );
}
