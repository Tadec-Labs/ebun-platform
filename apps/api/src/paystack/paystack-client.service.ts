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
}
