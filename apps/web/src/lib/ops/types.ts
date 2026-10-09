/** Mirrors apps/api/src/vendors/vendors.service.ts's views field-for-field. */

export type VendorCategory = "food" | "experience" | "keepsake" | "utility";

export interface VendorSummary {
  id: string;
  businessName: string;
  ownerName: string;
  whatsappNumber: string;
  category: VendorCategory;
  serviceAreas: string[];
  deliveryZones: string[];
  active: boolean;
  verified: boolean;
  totalOrders: number;
  offeringsCount: number;
  createdAt: string;
}

export interface Vendor {
  id: string;
  businessName: string;
  ownerName: string;
  whatsappNumber: string;
  email: string | null;
  category: VendorCategory;
  subcategories: string[];
  serviceAreas: string[];
  deliveryZones: string[];
  /** The vendor's SHARE (0.70 = vendor receives 70%, Ebun keeps 30%) — despite the column name. */
  commissionRate: number;
  bankName: string | null;
  accountNumber: string | null;
  accountName: string | null;
  active: boolean;
  verified: boolean;
  totalOrders: number;
  responseTimeoutMinutes: number;
  backupVendorId: string | null;
  notes: string | null;
  /** The vendor's private counter-screen link. A credential — never log or share beyond the vendor. */
  portalToken: string;
  portalTokenRotatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Offering {
  giftTemplateId: string;
  giftName: string;
  senderPrice: number; // kobo
  vendorPrice: number; // kobo
  ebunMargin: number; // kobo
  ebunMarginPct: number;
  availableZones: string[];
  available: boolean;
  approved: boolean;
}

/** What every ops server action returns instead of throwing — errors are shown inline, not as a crash page. */
export type ActionResult =
  | { ok: true; message?: string }
  | { ok: false; errors: string[] };

export const VENDOR_CATEGORIES: { value: VendorCategory; label: string }[] = [
  { value: "food", label: "Food" },
  { value: "experience", label: "Experience" },
  { value: "keepsake", label: "Keepsake" },
  { value: "utility", label: "Utility" },
];

/** Mirrors apps/api/src/redemptions/redemptions.service.ts's RedemptionLookupView. */
export interface RedemptionLookup {
  code: string;
  redemptionNumber: string;
  status: "pending" | "initiated" | "completed" | "failed" | "expired";
  orderNumber: string | null;
  recipientName: string | null;
  giftName: string | null;
  expiresAt: string;
  completedAt: string | null;
  /** True only when a confirm would actually succeed right now. */
  redeemable: boolean;
  /** Plain-language reason it can't be collected, when redeemable is false. */
  blockedReason: string | null;
}

/** Mirrors apps/api/src/gifts/ops-gifts.service.ts's GiftTemplateView. */
export type GiftDeliveryType = "digital_voucher" | "vtu";

export interface GiftTemplate {
  id: string;
  name: string;
  description: string | null;
  category: VendorCategory;
  basePrice: number; // kobo
  deliveryType: GiftDeliveryType | "physical" | "experience";
  deliveryWindow: string | null;
  imageUrl: string | null;
  requiresAddress: boolean;
  available: boolean;
  featured: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Only the two the fulfilment orchestrator can complete. Physical and
 * experience take the money and then raise — see the API's
 * CREATABLE_DELIVERY_TYPES for why they are not offered.
 */
export const GIFT_DELIVERY_TYPES: { value: GiftDeliveryType; label: string; hint: string }[] = [
  {
    value: "digital_voucher",
    label: "Collected in person",
    hint: "They get a code and pick it up at the vendor.",
  },
  {
    value: "vtu",
    label: "Sent to their phone",
    hint: "Airtime, data or bills — delivered automatically in seconds.",
  },
];
