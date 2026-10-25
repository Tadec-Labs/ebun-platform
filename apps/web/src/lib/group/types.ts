/**
 * Mirrors apps/api/src/group-gifts/group-gifts.service.ts. Amounts are
 * kobo, as everywhere else.
 */

export interface GroupGiftSummary {
  giftTemplateId: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  deliveryType: string;
}

export interface FeePolicy {
  rateBps: number;
  minKobo: number;
  maxKobo: number;
}

/** GET /group-gifts/:token — what anyone with the share link sees. */
export interface GroupGiftPublicView {
  status: "open" | "awaiting_organiser" | "funded" | "closed";
  gift: GroupGiftSummary;
  recipientFirstName: string;
  organiserFirstName: string | null;
  targetAmount: number;
  amountRaised: number;
  remaining: number;
  minContribution: number;
  contributorCount: number;
  deadline: string;
  contributors: { name: string; amount: number | null }[];
  serviceFee: FeePolicy;
}

export type ContributionStatus = "pending" | "confirmed" | "late" | "failed" | "refunded";
export type RefundStatus = "pending" | "submitting" | "processing" | "completed" | "failed";

/** GET /organiser/group-gift — the organiser's own page. */
export interface GroupGiftOrganiserView {
  status: "open" | "funded" | "triggered" | "expired" | "cancelled";
  awaitingDecision: boolean;
  decisionDeadline: string | null;
  gift: GroupGiftSummary;
  recipientName: string;
  message: string | null;
  targetAmount: number;
  amountRaised: number;
  remaining: number;
  deadline: string;
  sendAt: string | null;
  showAmounts: boolean;
  canExtend: boolean;
  canSwitch: boolean;
  canCancel: boolean;
  sharePath: string;
  revealPath: string | null;
  closeReason: string | null;
  contributors: {
    name: string;
    amount: number;
    message: string | null;
    status: ContributionStatus;
    refundAmount: number | null;
    refundStatus: RefundStatus | null;
  }[];
}

export interface CreateGroupGiftPayload {
  giftTemplateId: string;
  organiserName: string;
  organiserEmail: string;
  recipientName: string;
  recipientPhone: string;
  message?: string;
  deadline: string;
  sendAt?: string;
  showAmounts?: boolean;
}

export interface CreateGroupGiftResult {
  groupGiftId: string;
  sharePath: string;
  managePath: string;
  targetAmount: number;
}

export interface ContributePayload {
  name: string;
  email: string;
  amountNaira: number;
  message?: string;
}

export interface ContributeResult {
  checkoutUrl: string;
  amount: number;
  serviceFee: number;
  total: number;
}
