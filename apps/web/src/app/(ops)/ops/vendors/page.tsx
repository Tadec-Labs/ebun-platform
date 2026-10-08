import Link from "next/link";
import { opsFetch } from "@/lib/ops/api";
import type { VendorSummary } from "@/lib/ops/types";

const CATEGORY_LABEL: Record<string, string> = {
  food: "Food",
  experience: "Experience",
  keepsake: "Keepsake",
  utility: "Utility",
};

function Badge({ tone, children }: { tone: "green" | "grey" | "amber"; children: React.ReactNode }) {
  const styles = {
    green: "border-emerald-300 bg-emerald-50 text-emerald-800",
    grey: "border-zinc-300 bg-zinc-100 text-zinc-600",
    amber: "border-amber-300 bg-amber-50 text-amber-900",
  }[tone];
  return <span className={`inline-block rounded border px-1.5 py-0.5 text-xs ${styles}`}>{children}</span>;
}

export default async function VendorsPage() {
  const vendors = await opsFetch<VendorSummary[]>("/ops/vendors");

  return (
    <>
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Vendors</h1>
          <p className="text-zinc-600">
            {vendors.length} {vendors.length === 1 ? "vendor" : "vendors"}
          </p>
        </div>
        <Link href="/ops/vendors/new" className="rounded bg-zinc-900 px-4 py-2 font-medium text-white">
          Add vendor
        </Link>
      </div>

      {vendors.length === 0 ? (
        <div className="rounded border border-dashed border-zinc-300 bg-white px-6 py-12 text-center">
          <p className="mb-1 font-medium">No vendors yet</p>
          <p className="mb-4 text-zinc-600">Add your first vendor, then link them to the gifts they can fulfil.</p>
          <Link href="/ops/vendors/new" className="rounded bg-zinc-900 px-4 py-2 font-medium text-white">
            Add vendor
          </Link>
        </div>
      ) : (
        <div className="overflow-x-auto rounded border border-zinc-200 bg-white">
          <table className="w-full min-w-[640px] text-left">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">Vendor</th>
                <th className="px-4 py-2.5 font-medium">Category</th>
                <th className="px-4 py-2.5 font-medium">Areas</th>
                <th className="px-4 py-2.5 font-medium">Offerings</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {vendors.map((vendor) => (
                <tr key={vendor.id} className="hover:bg-zinc-50">
                  <td className="px-4 py-3">
                    <Link href={`/ops/vendors/${vendor.id}`} className="font-medium text-zinc-900 underline-offset-2 hover:underline">
                      {vendor.businessName}
                    </Link>
                    <div className="text-zinc-500">
                      {vendor.ownerName} · {vendor.whatsappNumber}
                    </div>
                  </td>
                  <td className="px-4 py-3">{CATEGORY_LABEL[vendor.category] ?? vendor.category}</td>
                  <td className="px-4 py-3 text-zinc-600">
                    {vendor.serviceAreas.length > 0 ? vendor.serviceAreas.join(", ") : "—"}
                  </td>
                  <td className="px-4 py-3">
                    {vendor.offeringsCount === 0 ? (
                      // A vendor with no offerings can't be matched to any gift.
                      <Badge tone="amber">None — can’t fulfil anything</Badge>
                    ) : (
                      vendor.offeringsCount
                    )}
                  </td>
                  <td className="space-x-1.5 px-4 py-3">
                    <Badge tone={vendor.active ? "green" : "grey"}>{vendor.active ? "Active" : "Inactive"}</Badge>
                    <Badge tone={vendor.verified ? "green" : "amber"}>
                      {vendor.verified ? "Verified" : "Unverified"}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
