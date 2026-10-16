"use server";

import { revalidatePath } from "next/cache";
import { CompanyApiError, companyFetch } from "@/lib/company/api";
import type { AddPeopleResult, Campaign } from "@/lib/company/api";

export type Result<T = undefined> = { ok: true; data: T } | { ok: false; errors: string[] };

const GONE = ["This link no longer works. Ask SendEbun for a new one."];

async function run<T>(call: () => Promise<T | null>): Promise<Result<T>> {
  try {
    const data = await call();
    if (data === null) return { ok: false, errors: GONE };
    revalidatePath("/company");
    return { ok: true, data };
  } catch (error) {
    if (error instanceof CompanyApiError) return { ok: false, errors: error.messages };
    throw error;
  }
}

export async function saveDetailsAction(details: {
  title?: string;
  senderDisplayName?: string;
  messageText?: string;
  sendAt?: string | null;
  giftDays?: number;
}): Promise<Result<Campaign>> {
  return run(() => companyFetch<Campaign>("", { method: "PATCH", body: details }));
}

export async function clearMessageAction(): Promise<Result<Campaign>> {
  return run(() => companyFetch<Campaign>("/message", { method: "DELETE" }));
}

export async function setGiftsAction(giftTemplateIds: string[]): Promise<Result<Campaign>> {
  return run(() => companyFetch<Campaign>("/gifts", { method: "PUT", body: { giftTemplateIds } }));
}

export async function addPeopleAction(list: string): Promise<Result<AddPeopleResult>> {
  return run(() => companyFetch<AddPeopleResult>("/people", { method: "POST", body: { list } }));
}

export async function removePersonAction(id: string): Promise<Result<{ ok: boolean }>> {
  return run(() => companyFetch<{ ok: boolean }>(`/people/${encodeURIComponent(id)}`, { method: "DELETE" }));
}

export async function clearPeopleAction(): Promise<Result<{ ok: boolean }>> {
  return run(() => companyFetch<{ ok: boolean }>("/people", { method: "DELETE" }));
}

export async function checkoutAction(): Promise<Result<{ checkoutUrl: string; amountDue: number }>> {
  return run(() => companyFetch<{ checkoutUrl: string; amountDue: number }>("/checkout", { method: "POST" }));
}

export async function reopenAction(): Promise<Result<Campaign>> {
  return run(() => companyFetch<Campaign>("/reopen", { method: "POST" }));
}

export async function resendAction(): Promise<Result<{ emailed: number; failed: number; noEmail: number }>> {
  return run(() =>
    companyFetch<{ emailed: number; failed: number; noEmail: number }>("/resend", { method: "POST" }),
  );
}
