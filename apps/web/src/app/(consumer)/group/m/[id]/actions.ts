"use server";

import { revalidatePath } from "next/cache";
import { OrganiserApiError, organiserFetch } from "@/lib/group/organiser-api";

export type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

const GONE = "This organiser link no longer works on this device. Open the link you saved when you started the gift.";

async function run<T>(shortId: string, call: () => Promise<T | null>): Promise<Result<T>> {
  try {
    const data = await call();
    if (data === null) return { ok: false, error: GONE };
    revalidatePath(`/group/m/${shortId}`);
    return { ok: true, data };
  } catch (error) {
    if (error instanceof OrganiserApiError) return { ok: false, error: error.message };
    throw error;
  }
}

/**
 * The organiser's three decisions. Each one goes to the API as the
 * organiser of THIS pot only — the token comes from the cookie the
 * short id names, never from the browser's request body.
 */
export async function extendAction(shortId: string, deadline: string): Promise<Result<true>> {
  return run(shortId, async () =>
    (await organiserFetch<void>(shortId, "/extend", { method: "POST", body: { deadline } })) === null ? null : true,
  );
}

export async function switchAction(
  shortId: string,
  giftTemplateId: string,
): Promise<Result<{ revealPath: string | null }>> {
  return run(shortId, () =>
    organiserFetch<{ revealPath: string | null }>(shortId, "/switch", { method: "POST", body: { giftTemplateId } }),
  );
}

export async function cancelAction(shortId: string): Promise<Result<{ refunds: number }>> {
  return run(shortId, () => organiserFetch<{ refunds: number }>(shortId, "/cancel", { method: "POST" }));
}
