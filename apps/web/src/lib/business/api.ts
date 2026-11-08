import { redirect } from "next/navigation";
import { API_BASE_URL } from "@/lib/api-config";
import { getBizToken, hasBizRefresh } from "./session";

export class BizApiError extends Error {
  constructor(
    public readonly messages: string[],
    public readonly status: number,
  ) {
    super(messages.join(" "));
    this.name = "BizApiError";
  }
}

/**
 * Server-side only. Attaches the member's token and calls /business/*.
 * No token: refresh if we can, else sign in. A 401 back means the token
 * died early — sign in again. `redirect()` throws, so callers catching
 * errors must rethrow anything that isn't a BizApiError.
 */
export async function bizFetch<T>(
  path: string,
  init: {
    method?: "GET" | "POST" | "PATCH" | "DELETE";
    body?: unknown;
    from?: string;
  } = {},
): Promise<T> {
  const token = await getBizToken();
  if (!token) {
    if (await hasBizRefresh())
      redirect(
        `/business/refresh?next=${encodeURIComponent(init.from ?? "/business")}`,
      );
    redirect("/business/login");
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method: init.method ?? "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body !== undefined
          ? { "Content-Type": "application/json" }
          : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: "no-store",
    });
  } catch {
    throw new BizApiError(
      ["Couldn't reach SendEbun. Check your connection and try again."],
      0,
    );
  }

  if (res.status === 401) redirect("/business/login?reason=session");

  if (!res.ok) {
    let messages = [`Something went wrong (${res.status}).`];
    try {
      const body = (await res.json()) as { message?: unknown };
      if (typeof body.message === "string") messages = [body.message];
      else if (Array.isArray(body.message))
        messages = body.message.filter(
          (m): m is string => typeof m === "string",
        );
    } catch {
      // Not JSON: keep the generic message.
    }
    throw new BizApiError(messages, res.status);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export interface BizMe {
  email: string;
  emailConfirmed: boolean;
  company: { id: string; displayName: string; status: string } | null;
  role: "owner" | "member" | null;
}

export interface BizCampaign {
  id: string;
  title: string;
  status: "draft" | "awaiting_payment" | "paid" | "cancelled";
  recipients: number | null;
  amountDue: number | null;
  sendAt: string | null;
  paidAt: string | null;
  createdAt: string;
}

export interface BizMember {
  id: string;
  email: string;
  role: "owner" | "member";
  pending: boolean;
  you: boolean;
}
