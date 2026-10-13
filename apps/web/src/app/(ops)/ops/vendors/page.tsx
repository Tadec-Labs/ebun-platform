import type { Metadata } from "next";
import Link from "next/link";
import { GIFT_CATEGORY_LABEL } from "@ebun/types";
import { ButtonLink, Card, EmptyState, PageHeader, Pill } from "@/components/ops/ui";
import { formatNaira } from "@/lib/format-money";
import { opsFetch } from "@/lib/ops/api";
import type { PayoutRow, VendorSummary } from "@/lib/ops/types";

export const metadata: Metadata = { title: "Partners" };

const CATEGORY_LABEL: Record<string, string> = GIFT_CATEGORY_LABEL;

/**
 * Every partner, with what matters about them in one row: can they be
 * sent orders (items live, active), is anything waiting on us (items to
 * approve, money owed), and how to reach them. Sorted so partners
 * needing ops come first.
 */
export default async function PartnersPage() {
  const [vendors, payouts] = await Promise.all([
    opsFetch<VendorSummary[]>("/ops/vendors"),
    // Owed is a help on this page, not its job.
    opsFetch<PayoutRow[]>("/ops/payouts").catch(() => [] as PayoutRow[]),
  ]);
  const owedBy = new Map(payouts.map((p) => [p.vendorId, p.owed]));
  const needsUs = (v: VendorSummary) => v.awaitingApprovalCount > 0 || (owedBy.get(v.id) ?? 0) > 0;
  const sorted = [...vendors].sort(
    (a, b) =>
      Number(b.active) - Number(a.active) ||
      Number(needsUs(b)) - Number(needsUs(a)) ||
      a.businessName.localeCompare(b.businessName),
  );
  const active = vendors.filter((v) => v.active).length;

  return (
    <>
      <PageHeader
        title="Partners"
        description={`${active} active · ${vendors.length} total`}
        actions={<ButtonLink href="/ops/vendors/new">Add partner</ButtonLink>}
      />

      {vendors.length === 0 ? (
        <EmptyState
          title="No partners yet"
          body="Add your first partner and send them their link — they add their items, photos and bank details themselves."
          action={<ButtonLink href="/ops/vendors/new">Add partner</ButtonLink>}
        />
      ) : (
        <Card flush>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left">
              <thead className="border-b border-zinc-100 bg-zinc-50/60 text-xs tracking-wide text-zinc-500 uppercase">
                <tr>
                  <th className="px-5 py-3 font-medium">Partner</th>
                  <th className="px-5 py-3 font-medium">Category</th>
                  <th className="px-5 py-3 font-medium">Items</th>
                  <th className="px-5 py-3 font-medium">Owed</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {sorted.map((vendor) => {
                  const owed = owedBy.get(vendor.id) ?? 0;
                  return (
                    <tr key={vendor.id} className={`hover:bg-zinc-50 ${vendor.active ? "" : "opacity-60"}`}>
                      <td className="px-5 py-3.5">
                        <Link href={`/ops/vendors/${vendor.id}`} className="font-medium text-zinc-900 hover:underline">
                          {vendor.businessName}
                        </Link>
                        <p className="text-zinc-500">
                          {vendor.ownerName} · {vendor.whatsappNumber}
                        </p>
                      </td>
                      <td className="px-5 py-3.5 text-zinc-700">
                        {CATEGORY_LABEL[vendor.category] ?? vendor.category}
                        {vendor.serviceAreas.length > 0 && (
                          <p className="text-xs text-zinc-500">{vendor.serviceAreas.join(", ")}</p>
                        )}
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {vendor.offeringsCount === 0 ? (
                            <Pill tone="amber">None yet</Pill>
                          ) : (
                            <span className="tabular-nums">{vendor.offeringsCount}</span>
                          )}
                          {vendor.awaitingApprovalCount > 0 && (
                            <Pill tone="amber">{vendor.awaitingApprovalCount} to approve</Pill>
                          )}
                        </div>
                      </td>
                      <td className="px-5 py-3.5 tabular-nums">
                        {owed > 0 ? (
                          <Link href={`/ops/vendors/${vendor.id}#earnings`} className="font-medium hover:underline">
                            {formatNaira(owed)}
                          </Link>
                        ) : (
                          <span className="text-zinc-400">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex flex-wrap gap-1.5">
                          <Pill tone={vendor.active ? "green" : "grey"}>{vendor.active ? "Active" : "Paused"}</Pill>
                          {!vendor.verified && <Pill tone="amber">Unverified</Pill>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
