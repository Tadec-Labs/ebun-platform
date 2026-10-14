import { opsFetch } from "@/lib/ops/api";
import type { VendorSummary } from "@/lib/ops/types";
import type { PartnerOption } from "./gift-form";

/** Active partners, as the gift pages offer them. A failure just means an empty picker, never a broken page. */
export async function activePartners(): Promise<PartnerOption[]> {
  try {
    const vendors = await opsFetch<VendorSummary[]>("/ops/vendors");
    return vendors
      .filter((v) => v.active)
      .map((v) => ({
        id: v.id,
        name: v.businessName,
        share: Number.isFinite(v.commissionRate) && v.commissionRate > 0 ? v.commissionRate : 0.9,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}
