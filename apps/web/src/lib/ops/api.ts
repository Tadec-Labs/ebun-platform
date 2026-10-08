import { redirect } from "next/navigation";
import { API_BASE_URL } from "@/lib/api-config";
import { getOpsToken } from "./session";

export class OpsApiError extends Error {
  constructor(
    public readonly messages: string[],
    public readonly status: number,
  ) {
    super(messages.join(" "));
    this.name = "OpsApiError";
  }
}

/**
 * Server-side only: attaches the staff token from the httpOnly cookie
 * and calls the API. No token, or a 401/403 back, sends the visitor to
 * the login page — `redirect()` throws, so callers catching errors must
 * rethrow anything that isn't an OpsApiError.
 *
 * NestJS validation failures arrive as { message: string | string[] };
 * every message is kept so a form can show all of them at once instead
 * of making someone fix one field to discover the next.
 */
export async function opsFetch<T>(
  path: string,
  init: { method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE"; body?: unknown } = {},
): Promise<T> {
  const token = await getOpsToken();
  if (!token) redirect("/ops/login");

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method: init.method ?? "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
    });
  } catch {
    throw new OpsApiError(["Couldn't reach the API. Check your connection and try again."], 0);
  }

  if (res.status === 401 || res.status === 403) redirect("/ops/login?reason=session");

  if (!res.ok) {
    let messages = [`Something went wrong (${res.status}).`];
    try {
      const body: unknown = await res.json();
      if (body && typeof body === "object" && "message" in body) {
        const m = (body as { message: unknown }).message;
        if (typeof m === "string") messages = [m];
        else if (Array.isArray(m)) messages = m.filter((x): x is string => typeof x === "string");
      }
    } catch {
      // Not JSON — keep the generic message.
    }
    throw new OpsApiError(messages, res.status);
  }

  return (await res.json()) as T;
}
