/**
 * Port for outbound VTU (airtime/data/electricity) provider calls —
 * Nellobytes/Shago for airtime & data, BuyPower for electricity, per
 * gift_fulfillments.vtu_provider's documented values. Deliberately an
 * interface + DI token, not a concrete class, the same way
 * PaystackClientService is concrete but lives in its OWN module
 * separate from the domain logic that calls it — except here there
 * isn't yet a concrete implementation to point to.
 *
 * NOT IMPLEMENTED YET. Nellobytes/Shago/BuyPower each have their own
 * request/response shapes, auth schemes, and error semantics that
 * would need to be confirmed against their real API docs (or a sandbox)
 * before writing a client against them — the same care that went into
 * confirming Postgres's unique-violation code and Paystack's actual
 * webhook-event-ID behaviour via real sources rather than assumption
 * (see PaystackWebhookService / IdempotencyService). Guessing at a
 * third-party contract here would risk building against the wrong
 * shape entirely.
 *
 * FulfillmentOrchestratorService is written against this interface so
 * that dropping in a real NellobytesVtuProviderService later is a
 * one-line change in FulfillmentModule's providers array — nothing
 * about the orchestration logic itself should need to change.
 */
export interface VtuTopUpParams {
  /** Persisted on gift_fulfillments.vtu_request_id BEFORE this is called — see FulfillmentOrchestratorService for why the ordering matters. */
  requestId: string;
  phoneNumber: string;
  amountKobo: number;
}

export interface VtuTopUpResult {
  providerTransactionId: string;
}

export interface VtuProviderService {
  topUp(params: VtuTopUpParams): Promise<VtuTopUpResult>;
}

export const VTU_PROVIDER = Symbol('VTU_PROVIDER');
