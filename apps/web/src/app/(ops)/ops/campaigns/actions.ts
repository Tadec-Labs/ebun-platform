"use server";

import { revalidatePath } from "next/cache";
import { OpsApiError, opsFetch } from "@/lib/ops/api";
import type { ActionResult, OpsCampaign } from "@/lib/ops/types";

function failure(error: unknown): ActionResult {
  if (error instanceof OpsApiError) return { ok: false, errors: error.messages };
  throw error;
}

export async function createCampaignAction(input: {
  companyName: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  title: string;
  feePercent: string;
}): Promise<ActionResult> {
  const fee = Number(input.feePercent);
  if (!Number.isFinite(fee) || fee < 0 || fee > 30) {
    return { ok: false, errors: ["The fee must be a percentage from 0 to 30."] };
  }
  try {
    const created = await opsFetch<OpsCampaign>("/ops/campaigns", {
      method: "POST",
      body: {
        companyName: input.companyName,
        contactName: input.contactName,
        contactEmail: input.contactEmail,
        contactPhone: input.contactPhone || undefined,
        title: input.title || undefined,
        feeBps: Math.round(fee * 100),
      },
    });
    revalidatePath("/ops/campaigns");
    return { ok: true, id: created.id };
  } catch (error) {
    return failure(error);
  }
}

export async function updateCampaignFeeAction(id: string, feePercent: string): Promise<ActionResult> {
  const fee = Number(feePercent);
  if (!Number.isFinite(fee) || fee < 0 || fee > 30) {
    return { ok: false, errors: ["The fee must be a percentage from 0 to 30."] };
  }
  try {
    await opsFetch(`/ops/campaigns/${id}`, { method: "PATCH", body: { feeBps: Math.round(fee * 100) } });
    revalidatePath(`/ops/campaigns/${id}`);
    return { ok: true, message: "Fee updated." };
  } catch (error) {
    return failure(error);
  }
}

export async function cancelCampaignAction(id: string): Promise<ActionResult> {
  try {
    await opsFetch(`/ops/campaigns/${id}/cancel`, { method: "POST" });
    revalidatePath(`/ops/campaigns/${id}`);
    revalidatePath("/ops/campaigns");
    return { ok: true, message: "Cancelled." };
  } catch (error) {
    return failure(error);
  }
}

export async function rotateCampaignLinkAction(id: string): Promise<ActionResult> {
  try {
    await opsFetch(`/ops/campaigns/${id}/rotate-link`, { method: "POST" });
    revalidatePath(`/ops/campaigns/${id}`);
    return { ok: true, message: "New link issued; the old one has stopped working." };
  } catch (error) {
    return failure(error);
  }
}
