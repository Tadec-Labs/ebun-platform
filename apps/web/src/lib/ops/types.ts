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
