import Link from "next/link";
import { PageHeader, Pill } from "@/components/ops/ui";
import { notFound } from "next/navigation";
import { OpsApiError, opsFetch } from "@/lib/ops/api";
import type { GiftTemplate, Offering, Vendor, VendorEarnings, VendorSummary } from "@/lib/ops/types";
import { EarningsPanel } from "./earnings-panel";
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

  const [offerings, vendors, catalog, earnings] = await Promise.all([
    opsFetch<Offering[]>(`/ops/vendors/${id}/offerings`),
    opsFetch<VendorSummary[]>("/ops/vendors"),
    // The OPS catalogue, not the public one. New gifts are created off
    // sale on purpose, and the public list hides those — so using it
    // here would make a gift impossible to link to a vendor until it
    // had already been published, which is backwards: you link the
    // vendor who fulfils it, then put it on sale.
    opsFetch<GiftTemplate[]>("/ops/gifts"),
    opsFetch<VendorEarnings>(`/ops/vendors/${id}/earnings`),
  ]);

  return (
    <>
      <Link href="/ops/vendors" className="mb-3 inline-block text-zinc-600 hover:text-zinc-900">
        ← Partners
      </Link>
      <PageHeader
        title={vendor.businessName}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Pill tone={vendor.active ? "green" : "grey"}>{vendor.active ? "Active" : "Paused"}</Pill>
            <span>
              WhatsApp{" "}
              <a href={`tel:${vendor.whatsappNumber}`} className="font-medium text-zinc-900 hover:underline">
                {vendor.whatsappNumber}
              </a>
            </span>
            {vendor.backupPhone ? (
              <span>
                Second{" "}
                <a href={`tel:${vendor.backupPhone}`} className="font-medium text-zinc-900 hover:underline">
                  {vendor.backupPhone}
                </a>
              </span>
            ) : (
              <span className="text-amber-700">No second number</span>
            )}
            {vendor.email ? <span>{vendor.email}</span> : <span className="text-amber-700">No alert email</span>}
            <span>
              {vendor.totalOrders} {vendor.totalOrders === 1 ? "order" : "orders"} fulfilled
            </span>
          </span>
        }
      />

      {query.created === "1" && (
        <CreatedNotice gifts={Number(query.gifts ?? 0)} failed={Number(query.failed ?? 0)} />
      )}

      <div className="flex flex-col gap-6 [&>*]:rounded-xl [&>*]:border [&>*]:border-zinc-200 [&>*]:bg-white [&>*]:p-5 [&>*]:shadow-sm">
        <EarningsPanel vendor={vendor} earnings={earnings} />
        <OfferingsPanel
          vendorId={vendor.id}
          offerings={offerings}
          catalog={catalog.map((g) => ({ id: g.id, name: g.name, basePrice: g.basePrice }))}
          vendorSharePct={Math.round(vendor.commissionRate * 100)}
        />
        <PortalLink
          vendorId={vendor.id}
          businessName={vendor.businessName}
          ownerName={vendor.ownerName}
          whatsappNumber={vendor.whatsappNumber}
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

function CreatedNotice({ gifts, failed }: { gifts: number; failed: number }) {
  return (
    <div className="mb-6 flex flex-col gap-1">
      <p className="rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-emerald-900">
        Vendor added
        {gifts > 0 ? ` with ${gifts} ${gifts === 1 ? "gift" : "gifts"}` : ""}. Next: send them their counter link
        below.
      </p>
      {gifts === 0 && failed === 0 && (
        <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900">
          No gifts linked yet — add at least one below, or this vendor can&rsquo;t hand anything over.
        </p>
      )}
      {failed > 0 && (
        <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-red-800">
          {failed} {failed === 1 ? "gift" : "gifts"} couldn&rsquo;t be linked. Add {failed === 1 ? "it" : "them"} below.
        </p>
      )}
    </div>
  );
}
