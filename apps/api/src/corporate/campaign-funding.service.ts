import { OrderStatus } from '@ebun/types';
import { Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { FulfillmentOrchestratorService } from '../fulfillment/fulfillment-orchestrator.service';
import { CampaignsRepository } from './campaigns.repository';
import { CampaignSendingService } from './campaign-sending.service';

/** Reference prefix for a company's campaign checkout (a sender's is ebun_). */
export const CAMPAIGN_REFERENCE_PREFIX = 'ebcmp_';

/**
 * Turns a confirmed company payment into gifts.
 *
 *   charge.success (signature already verified by PaystackWebhookService)
 *     └─ fund_campaign()  one transaction: amount checked against the
 *                         checkout snapshot, one paid order per person
 *     └─ fulfil           every order whose gift is already settled
 *                         (single-gift campaigns), in the background
 *     └─ send             if the send time has come
 *
 * Choice campaigns stop at "paid": each person's order is fulfilled when
 * they pick their gift (CampaignGiftsService).
 *
 * Every failure here is recorded, never thrown back at Paystack: the
 * money has moved either way, and a redelivery can't fix a mismatch.
 */
@Injectable()
export class CampaignFundingService {
  private readonly logger = new Logger(CampaignFundingService.name);
  private readonly fulfilling = new Set<string>();

  constructor(
    private readonly repository: CampaignsRepository,
    private readonly fulfillment: FulfillmentOrchestratorService,
    private readonly sending: CampaignSendingService,
    private readonly audit: AuditService,
  ) {}

  isCampaignReference(reference: string | undefined): boolean {
    return Boolean(reference?.startsWith(CAMPAIGN_REFERENCE_PREFIX));
  }

  async applyPayment(
    reference: string,
    amountKobo: number,
    transactionId: string,
  ): Promise<void> {
    const campaign = await this.repository.findByPaystackReference(reference);
    if (!campaign) {
      // The company reopened the campaign after paying an old checkout,
      // or it was cancelled. Money arrived with nothing to apply it to:
      // a person must refund it from the Paystack dashboard.
      await this.unmatched(
        reference,
        amountKobo,
        transactionId,
        null,
        'No campaign has this checkout reference any more.',
      );
      return;
    }

    let result: 'funded' | 'already_funded';
    try {
      result = await this.repository.fund(
        campaign.id,
        reference,
        amountKobo,
        transactionId,
      );
    } catch (err) {
      const message =
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message: unknown }).message)
          : String(err);
      await this.unmatched(
        reference,
        amountKobo,
        transactionId,
        campaign.id,
        message,
      );
      return;
    }

    if (result === 'already_funded') {
      this.logger.debug(
        `Campaign ${campaign.id}: payment ${reference} already applied.`,
      );
      return;
    }
    this.logger.log(
      `Campaign ${campaign.id} (${campaign.company_name}) paid: ${amountKobo} kobo.`,
    );

    // Never delays the webhook's answer to Paystack. The sweep job
    // finishes anything this run doesn't.
    setImmediate(() => {
      this.fulfilCampaign(campaign.id)
        .then(() => this.sending.sendIfDue(campaign.id))
        .catch((err: unknown) =>
          this.logger.error(
            `Campaign ${campaign.id}: post-payment work failed: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
    });
  }

  /** Starts fulfilment for every order of this campaign whose gift is settled. */
  async fulfilCampaign(campaignId: string): Promise<number> {
    if (this.fulfilling.has(campaignId)) return 0;
    this.fulfilling.add(campaignId);
    try {
      const orders = await this.repository.orders(campaignId);
      let started = 0;
      for (const order of orders) {
        if (order.status !== OrderStatus.Paid || !order.gift_chosen_at)
          continue;
        if (await this.fulfilOrder(order.id)) started += 1;
      }
      return started;
    } finally {
      this.fulfilling.delete(campaignId);
    }
  }

  /**
   * One order. The orchestrator's compare-and-swap makes a second,
   * concurrent attempt fail harmlessly, so this is safe to call from the
   * webhook follow-up, the recipient's choice and the sweep alike.
   */
  async fulfilOrder(orderId: string): Promise<boolean> {
    try {
      await this.fulfillment.start(orderId);
      return true;
    } catch (err) {
      this.logger.warn(
        `Campaign order ${orderId}: fulfilment didn't start: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }

  /** Safety net, every few minutes: settled campaign orders that never started. */
  async sweep(): Promise<number> {
    const ids = await this.repository.ordersReadyToFulfil(
      new Date(Date.now() - 2 * 60_000),
      100,
    );
    let started = 0;
    for (const id of ids) {
      if (await this.fulfilOrder(id)) started += 1;
    }
    return started;
  }

  private async unmatched(
    reference: string,
    amount: number,
    transactionId: string,
    campaignId: string | null,
    reason: string,
  ): Promise<void> {
    this.logger.error(
      `CAMPAIGN PAYMENT NOT APPLIED: ${reference} (${amount} kobo, transaction ${transactionId}): ${reason} Refund it from the Paystack dashboard or contact the company.`,
    );
    await this.audit.record({
      eventType: 'campaign.payment_unmatched',
      actorId: null,
      actorType: 'webhook',
      resourceType: 'campaign',
      resourceId: campaignId ?? '00000000-0000-0000-0000-000000000000',
      metadata: {
        reference,
        amount,
        transactionId,
        reason: reason.slice(0, 300),
      },
    });
  }
}
