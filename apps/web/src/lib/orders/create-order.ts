import { API_BASE_URL } from "@/lib/api-config";

export interface CreateOrderPayload {
  giftTemplateId: string;
  recipientName: string;
  recipientPhone: string;
  senderName: string;
  senderEmail: string;
  senderMessage?: string;
  messageType?: "text";
  scheduledSendAt?: string;
}

export interface CreateOrderResult {
  orderId: string;
  orderNumber: string | null;
  checkoutUrl: string;
}

export class CreateOrderError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "CreateOrderError";
  }
}

/**
 * Mirrors apps/api/src/orders/dto/create-order.dto.ts exactly. Nothing
 * here computes a price — total_amount is server-derived from
 * gift_templates.base_price, same "backend never trusts frontend"
 * principle as payment status itself.
 *
 * NestJS's class-validator failures come back as
 * { statusCode, message: string | string[], error }. The array case is
 * one message per failed field — joined here rather than picking just
 * the first, so a sender fixing one typo isn't surprised by a second
 * rejection right after.
 */
export async function createOrder(
  payload: CreateOrderPayload,
): Promise<CreateOrderResult> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new CreateOrderError(
      "Couldn't reach the server. Check your connection and try again.",
    );
  }

  if (!res.ok) {
    let message = `Something went wrong (${res.status}). Please try again.`;
    try {
      const body: unknown = await res.json();
      if (body && typeof body === "object" && "message" in body) {
        const m = (body as { message: unknown }).message;
        if (typeof m === "string") message = m;
        else if (Array.isArray(m)) message = m.filter((x) => typeof x === "string").join(" ");
      }
    } catch {
      // Response wasn't JSON — keep the generic message.
    }
    throw new CreateOrderError(message, res.status);
  }

  return res.json();
}
