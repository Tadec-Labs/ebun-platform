import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** One Nigerian bank as Paystack lists it, for the bank picker. */
export interface PaystackBank {
  name: string;
  /** NIBSS code Paystack needs to pay into this bank, e.g. "058". */
  code: string;
}

/** What Paystack said about a transfer: still going, done, or not. */
export type PaystackTransferState =
  'success' | 'pending' | 'failed' | 'reversed' | 'otp' | 'not_found';

/** Paystack answered and said no. Its message is safe to show staff ("Your balance is not enough…"). */
export class PaystackTransferRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaystackTransferRejectedError';
  }
}

interface PaystackEnvelope<T> {
  status?: boolean;
  message?: string;
  data?: T;
}

/**
 * Outbound calls for paying partners: the bank list, transfer
 * recipients, transfers, and checking on a transfer.
 *
 * Kept apart from PaystackClientService (which takes money IN) so the
 * code that moves money OUT of SendEbun is in one small, separate place.
 *
 * Errors come in two kinds, and callers must treat them differently:
 *   - PaystackTransferRejectedError: Paystack answered and refused.
 *     Nothing happened; it is safe to give up or try again later.
 *   - anything else (network, timeout): we DON'T KNOW whether Paystack
 *     acted. A transfer in that state must be checked (verifyTransfer),
 *     never assumed failed — assuming would risk paying twice.
 */
@Injectable()
export class PaystackTransfersService {
  private static readonly BASE_URL = 'https://api.paystack.co';

  constructor(private readonly config: ConfigService) {}

  /** Active Nigerian banks that can receive transfers (NUBAN). */
  async listBanks(): Promise<PaystackBank[]> {
    const rows = await this.call<
      { name: string; code: string; active: boolean; type?: string }[]
    >('GET', '/bank?country=nigeria&currency=NGN&perPage=200');
    const seen = new Set<string>();
    const banks: PaystackBank[] = [];
    for (const row of rows) {
      if (!row.active || (row.type && row.type !== 'nuban')) continue;
      // Paystack lists a few banks twice under old and new names.
      const key = `${row.code}|${row.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      banks.push({ name: row.name, code: row.code });
    }
    return banks.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Registers a partner's bank account with Paystack. Paystack checks the
   * account exists at that bank; a wrong number or bank is refused here,
   * before any money is involved.
   */
  async createRecipient(params: {
    name: string;
    accountNumber: string;
    bankCode: string;
  }): Promise<{ recipientCode: string; accountName: string | null }> {
    const data = await this.call<{
      recipient_code: string;
      details?: { account_name?: string | null };
    }>('POST', '/transferrecipient', {
      type: 'nuban',
      name: params.name,
      account_number: params.accountNumber,
      bank_code: params.bankCode,
      currency: 'NGN',
    });
    return {
      recipientCode: data.recipient_code,
      accountName: data.details?.account_name ?? null,
    };
  }

  /**
   * Sends money from the SendEbun Paystack balance. `reference` is ours
   * and unique; Paystack refuses a second transfer with the same one, so
   * retrying a request can't pay twice.
   */
  async initiateTransfer(params: {
    amountKobo: number;
    recipientCode: string;
    reference: string;
    reason: string;
  }): Promise<{ state: PaystackTransferState; transferCode: string | null }> {
    const data = await this.call<{ status?: string; transfer_code?: string }>(
      'POST',
      '/transfer',
      {
        source: 'balance',
        amount: params.amountKobo,
        recipient: params.recipientCode,
        reference: params.reference,
        reason: params.reason,
        currency: 'NGN',
      },
    );
    return {
      state: toState(data.status),
      transferCode: data.transfer_code ?? null,
    };
  }

  /** Where a transfer stands, by our reference. */
  async verifyTransfer(
    reference: string,
  ): Promise<{ state: PaystackTransferState; transferCode: string | null }> {
    try {
      const data = await this.call<{ status?: string; transfer_code?: string }>(
        'GET',
        `/transfer/verify/${encodeURIComponent(reference)}`,
      );
      return {
        state: toState(data.status),
        transferCode: data.transfer_code ?? null,
      };
    } catch (err) {
      // Paystack answers "not found" for a reference it never received.
      if (
        err instanceof PaystackTransferRejectedError &&
        /not found/i.test(err.message)
      ) {
        return { state: 'not_found', transferCode: null };
      }
      throw err;
    }
  }

  private async call<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<T> {
    const secretKey = this.config.getOrThrow<string>('PAYSTACK_SECRET_KEY');
    const response = await fetch(
      `${PaystackTransfersService.BASE_URL}${path}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${secretKey}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(20_000),
      },
    );
    const parsed = (await response
      .json()
      .catch(() => ({}))) as PaystackEnvelope<T>;
    if (!response.ok || !parsed.status || parsed.data === undefined) {
      // 5xx is "we don't know" — not a refusal.
      if (response.status >= 500) {
        throw new Error(`Paystack ${response.status}: ${parsed.message ?? ''}`);
      }
      throw new PaystackTransferRejectedError(
        parsed.message?.trim() || `Paystack answered ${response.status}`,
      );
    }
    return parsed.data;
  }
}

function toState(status: string | undefined): PaystackTransferState {
  switch (status) {
    case 'success':
      return 'success';
    case 'failed':
    case 'abandoned':
    case 'blocked':
    case 'rejected':
      return 'failed';
    case 'reversed':
      return 'reversed';
    case 'otp':
      return 'otp';
    default:
      // pending, received, queued, processing
      return 'pending';
  }
}
