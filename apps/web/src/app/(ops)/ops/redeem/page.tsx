import { opsFetch } from "@/lib/ops/api";
import type { VendorSummary } from "@/lib/ops/types";
import { RedeemConsole } from "./redeem-console";

export default async function RedeemPage() {
  const vendors = await opsFetch<VendorSummary[]>("/ops/vendors");

  // Only an active vendor can be recorded as handing a gift over —
  // an inactive one is one Ebun has stopped sending orders to, and
  // crediting a collection to them would create a payable they
  // shouldn't have.
  const options = vendors
    .filter((vendor) => vendor.active)
    .map((vendor) => ({ id: vendor.id, name: vendor.businessName }));

  return (
    <>
      <h1 className="mb-1 text-lg font-semibold">Collect a gift</h1>
      <p className="mb-6 text-zinc-600">
        Type the code on the recipient&rsquo;s screen, check it matches what they&rsquo;re
        collecting, then confirm.
      </p>
      <RedeemConsole vendors={options} />
    </>
  );
}
