import Link from "next/link";
import { notFound } from "next/navigation";
import { OpsApiError, opsFetch } from "@/lib/ops/api";
import type { GiftTemplate, Offering, Vendor, VendorSummary } from "@/lib/ops/types";
import { VendorForm } from "../vendor-form";
import { OfferingsPanel } from "./offerings-panel";
import { PortalLink } from "./portal-link";

export default async function VendorDetailPage({ params, searchParams }: PageProps<"/ops/vendors/[id]">) {
  const { id } = await params;
  const query = await searchParams;

  let vendor: Vendor;
  try {
    vendor = await opsFetch<Vendor>(`/ops/vendors/${id}`);
  } catch (error) {
    // 404 (unknown id) and 400 (malformed id) both mean "no such vendor" here.
    if (error instanceof OpsApiError && (error.status === 404 || error.status === 400)) notFound();
    throw error;
  }

  const [offerings, vendors, catalog] = await Promise.all([
    opsFetch<Offering[]>(`/ops/vendors/${id}/offerings`),
    opsFetch<VendorSummary[]>("/ops/vendors"),
    // The OPS catalogue, not the public one. New gifts are created off
    // sale on purpose, and the public list hides those — so using it
    // here would make a gift impossible to link to a vendor until it
    // had already been published, which is backwards: you link the
    // vendor who fulfils it, then put it on sale.
    opsFetch<GiftTemplate[]>("/ops/gifts"),
  ]);

  return (
    <>
      <Link href="/ops/vendors" className="mb-3 inline-block text-zinc-600 hover:text-zinc-900">
        ← Vendors
      </Link>
      <h1 className="mb-1 text-lg font-semibold">{vendor.businessName}</h1>
      <p className="mb-6 text-zinc-600">
        {vendor.totalOrders} {vendor.totalOrders === 1 ? "order" : "orders"} fulfilled
      </p>

      {query.created === "1" && (
        <p className="mb-6 rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-emerald-900">
          Vendor created. Next: link them to the gifts they can fulfil below.
        </p>
      )}

      <div className="flex flex-col gap-10">
        <OfferingsPanel
          vendorId={vendor.id}
          offerings={offerings}
          catalog={catalog.map((g) => ({ id: g.id, name: g.name, basePrice: g.basePrice }))}
          vendorSharePct={Math.round(vendor.commissionRate * 100)}
        />
        <PortalLink
          vendorId={vendor.id}
          token={vendor.portalToken}
          rotatedAt={vendor.portalTokenRotatedAt}
        />

        <section>
          <h2 className="mb-4 font-semibold">Details</h2>
          <VendorForm
            vendor={vendor}
            backupOptions={vendors.filter((v) => v.id !== vendor.id).map((v) => ({ id: v.id, name: v.businessName }))}
          />
        </section>
      </div>
    </>
  );
}
