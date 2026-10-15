import { BadGatewayException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface InitializeTransactionParams {
  email: string;
  amountKobo: number;
  reference: string;
  metadata?: Record<string, unknown>;
}

interface InitializeTransactionResult {
  authorizationUrl: string;
  accessCode: string;
  reference: string;
}

interface PaystackInitializeResponse {
  status: boolean;
  message: string;
  data?: {
    authorization_url: string;
    access_code: string;
    reference: string;
  };
}

interface CreateRefundParams {
  /** The original transaction's reference (orders.paystack_reference). */
  transactionReference: string;
  amountKobo: number;
  /** Shown to the customer by Paystack/their bank, where supported. */
  customerNote?: string;
  /** Visible only in SendEbun's Paystack dashboard. */
  merchantNote?: string;
}

interface CreateRefundResult {
  /** Paystack's refund id — webhooks don't carry it, so it's stored from here. */
  id: string;
  /** Paystack's own status word, e.g. "pending". */
  status: string;
}

interface PaystackRefundResponse {
  status: boolean;
  message: string;
  data?: { id: number | string; status?: string };
}

/** Paystack said no to a refund. Its message is safe to show staff (e.g. "Transaction has been fully reversed"). */
export class PaystackRefundRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaystackRefundRejectedError';
  }
}

/**
 * Outbound calls TO Paystack's REST API. Deliberately separate from PaymentsModule, which handles the INBOUND webhook Paystack calls us on — PaymentsModule already imports OrdersModule (for OrdersService), so if OrdersModule also needed PaymentsModule (for this), that would be a circular module dependency. This module depends on nothing of ours, so both Orders and Payments can import it independently.
 */
@Injectable()
export class PaystackClientService {
  private static readonly BASE_URL = 'https://api.paystack.co';

  constructor(private readonly config: ConfigService) {}

  async initializeTransaction(
    params: InitializeTransactionParams,
  ): Promise<InitializeTransactionResult> {
    const secretKey = this.config.getOrThrow<string>('PAYSTACK_SECRET_KEY');
    // Trailing slashes stripped so a WEB_APP_BASE_URL set as
    // "https://x.app/" can't produce "https://x.app//send/confirmation".
    const webAppBaseUrl = this.config
      .getOrThrow<string>('WEB_APP_BASE_URL')
      .replace(/\/+$/, '');

    const response = await fetch(
      `${PaystackClientService.BASE_URL}/transaction/initialize`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${secretKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: params.email,
          amount: params.amountKobo,
          reference: params.reference,
          // Hardcoded — orders has no currency column, and multi-currency diaspora payment handling isn't implemented yet. Same known gap already flagged in the webhook handler.
          currency: 'NGN',
          // Explicit, not left to the Paystack dashboard's own Callback URL
          // setting: that field was empty, so a paying sender would have
          // landed on a generic Paystack page with no way back to Ebun.
          // Setting it per-request also keeps this correct across
          // environments (test/prod) without any dashboard configuration.
          // Paystack appends ?trxref=...&reference=... itself. The page at
          // this path must NOT treat those params as proof of payment — it
          // asks the API for real status (webhook-verified only).
          // Every payment today is a sender's order payment; a second flow
          // (e.g. group-gift contributions) is the point to parameterise this.
          callback_url: `${webAppBaseUrl}/send/confirmation`,
          metadata: params.metadata,
        }),
      },
    );

    const body = (await response.json()) as PaystackInitializeResponse;

    if (!response.ok || !body.status || !body.data) {
      throw new BadGatewayException(
        `Paystack transaction initialization failed: ${body.message ?? response.statusText}`,
      );
    }

    return {
      authorizationUrl: body.data.authorization_url,
      accessCode: body.data.access_code,
      reference: body.data.reference,
    };
  }

  /**
   * Asks Paystack to return money to the card or account that paid.
   * Paystack queues it and reports progress by webhook (refund.processed,
   * refund.failed, …), handled in PaystackWebhookService.
   *
   * Throws PaystackRefundRejectedError when Paystack answers and refuses
   * — a known outcome the caller turns into a message — and lets network
   * errors through as they are.
   */
  async createRefund(params: CreateRefundParams): Promise<CreateRefundResult> {
    const secretKey = this.config.getOrThrow<string>('PAYSTACK_SECRET_KEY');
    const response = await fetch(`${PaystackClientService.BASE_URL}/refund`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        transaction: params.transactionReference,
        amount: params.amountKobo,
        currency: 'NGN',
        customer_note: params.customerNote,
        merchant_note: params.merchantNote,
      }),
      signal: AbortSignal.timeout(20_000),
    });

    const body = (await response
      .json()
      .catch(() => ({}))) as Partial<PaystackRefundResponse>;
    if (!response.ok || !body.status || !body.data) {
      throw new PaystackRefundRejectedError(
        body.message?.trim() || `Paystack answered ${response.status}`,
      );
    }
    return { id: String(body.data.id), status: body.data.status ?? 'pending' };
  }
}
