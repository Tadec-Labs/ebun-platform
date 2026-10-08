import Link from "next/link";
import { opsFetch } from "@/lib/ops/api";
import type { VendorSummary } from "@/lib/ops/types";
import { VendorForm } from "../vendor-form";

export default async function NewVendorPage() {
  const vendors = await opsFetch<VendorSummary[]>("/ops/vendors");

  return (
    <>
      <Link href="/ops/vendors" className="mb-3 inline-block text-zinc-600 hover:text-zinc-900">
        ← Vendors
      </Link>
      <h1 className="mb-1 text-lg font-semibold">Add vendor</h1>
      <p className="mb-6 text-zinc-600">
        After saving you can link this vendor to the gifts they fulfil and set what Ebun pays them.
      </p>
      <VendorForm backupOptions={vendors.map((v) => ({ id: v.id, name: v.businessName }))} />
    </>
  );
}
