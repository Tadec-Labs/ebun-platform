import { randomUUID } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../audit/audit.service';
import {
  PaystackTransferRejectedError,
  PaystackTransfersService,
} from '../paystack/paystack-transfers.service';
import { AutoPayoutsRepository, TransferRow } from './auto-payouts.repository';

/** After this many failed attempts in a day, stop retrying a vendor until someone looks. */
const MAX_FAILURES_PER_DAY = 3;
/** A transfer this long without word from Paystack gets checked. */
const CHECK_AFTER_MINUTES = 10;

export type PayVendorOutcome =
  | 'off'
  | 'no_bank'
  | 'paused'
  | 'nothing_owed'
  | 'sent'
  | 'paid'
  | 'failed'
  | 'unknown';

/**
 * Pays partners automatically, minutes after they hand a gift over.
 *
 * Money only ever follows a proven handover: the orders paid are those
 * already credited to the vendor (code scanned at the counter, or a
 * doorstep delivery confirmed by code, recipient or ops). Nothing is paid
 * in advance.
 *
 *   handover credited ──► payVendorSoon(vendor)
 *     claim  (SQL, locked)   every owed, unclaimed order → one transfer
 *     recipient              Paystack recipient for their bank, made once
 *     transfer               from the SendEbun Paystack balance
 *   Paystack webhook transfer.success → recorded as a payout, orders paid
 *                    transfer.failed/reversed → orders released, retried
 *   every 5 min (sweep)    checks quiet transfers, pays anyone still owed
 *
 * Off unless AUTO_PAYOUTS=true. Vendors without a bank picked from the
 * list (bank_code) stay on the manual Payouts queue, as before.
 */
@Injectable()
export class AutoPayoutsService {
  private readonly logger = new Logger(AutoPayoutsService.name);
  /** Per-process: avoids two overlapping attempts for one vendor doing duplicate work. The database claim is what makes it safe. */
  private readonly busy = new Set<string>();

  constructor(
    private readonly repository: AutoPayoutsRepository,
    private readonly paystack: PaystackTransfersService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  enabled(): boolean {
    return this.config.get<string>('AUTO_PAYOUTS') === 'true';
  }

  /**
   * Called right after a handover is credited. Never throws and never
   * delays the caller: the recipient's collection or the rider's
   * "Delivered" has already succeeded, and paying the vendor is a
   * follow-on the sweep will retry if this attempt can't finish.
   */
  payVendorSoon(vendorId: string): void {
    if (!this.enabled()) return;
    setImmediate(() => {
      this.payVendor(vendorId).catch((err: unknown) =>
        this.logger.error(
          `Automatic payout for vendor ${vendorId} errored: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    });
  }

  async payVendor(vendorId: string): Promise<PayVendorOutcome> {
    if (!this.enabled()) return 'off';
    if (this.busy.has(vendorId)) return 'unknown';
    this.busy.add(vendorId);
    try {
      return await this.attempt(vendorId);
    } finally {
      this.busy.delete(vendorId);
    }
  }

  /**
   * Paystack's transfer.success / transfer.failed / transfer.reversed.
   * Matched by our reference; anything else (a transfer made in the
   * dashboard) is ignored.
   */
  async applyTransferEvent(
    event: string,
    reference: string | undefined,
    transferCode: string | undefined,
    reason?: string,
  ): Promise<void> {
    if (!reference) return;
    const transfer = await this.repository.findByReference(reference);
    if (!transfer) {
      this.logger.debug(`${event} for ${reference}: not one of ours.`);
      return;
    }
    if (event === 'transfer.success') {
      await this.settle(transfer, transferCode ?? null);
    } else if (event === 'transfer.failed' || event === 'transfer.reversed') {
      await this.fail(
        transfer,
        event === 'transfer.reversed' ? 'reversed' : 'failed',
        reason?.trim() ||
          (event === 'transfer.reversed'
            ? 'Paystack reversed the transfer (the bank sent it back).'
            : 'Paystack could not complete the transfer.'),
      );
    }
  }

  /**
   * The safety net, every few minutes: ask Paystack about transfers
   * that have gone quiet, then pay anyone still owed (an attempt that
   * failed earlier, a handover whose immediate attempt didn't run).
   */
  async sweep(): Promise<{ checked: number; attempted: number }> {
    if (!this.enabled()) return { checked: 0, attempted: 0 };
    const quiet = await this.repository.listUnsettled(
      new Date(Date.now() - CHECK_AFTER_MINUTES * 60_000),
      25,
    );
    for (const transfer of quiet) {
      await this.check(transfer).catch((err: unknown) =>
        this.logger.warn(
          `Couldn't check transfer ${transfer.reference}: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    }
    const owed = await this.repository.vendorsOwed(25);
    for (const vendorId of owed) {
      await this.payVendor(vendorId).catch((err: unknown) =>
        this.logger.error(
          `Automatic payout for vendor ${vendorId} errored: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    }
    return { checked: quiet.length, attempted: owed.length };
  }

  // ---------------------------------------------------------------------

  private async attempt(vendorId: string): Promise<PayVendorOutcome> {
    const vendor = await this.repository.findVendor(vendorId);
    if (
      !vendor?.active ||
      !vendor.bank_code ||
      !vendor.account_number ||
      !vendor.account_name
    ) {
      return 'no_bank';
    }

    const failures = await this.repository.countFailuresSince(
      vendorId,
      new Date(Date.now() - 24 * 60 * 60_000),
    );
    if (failures >= MAX_FAILURES_PER_DAY) return 'paused';

    // Claim first, so every attempt — even one that fails at the
    // recipient step — leaves a record ops can see.
    const transfer = await this.repository.claim(vendorId, newReference());
    if (!transfer) return 'nothing_owed';

    let recipientCode = vendor.paystack_recipient_code;
    if (!recipientCode) {
      try {
        const created = await this.paystack.createRecipient({
          name: vendor.account_name,
          accountNumber: vendor.account_number,
          bankCode: vendor.bank_code,
        });
        recipientCode = created.recipientCode;
        await this.repository.saveRecipientCode(vendorId, recipientCode, {
          accountNumber: vendor.account_number,
          bankCode: vendor.bank_code,
        });
      } catch (err) {
        // No money was sent; safe to release whatever the error.
        await this.fail(
          transfer,
          'failed',
          err instanceof PaystackTransferRejectedError
            ? `Paystack rejected their bank details: ${err.message}`
            : `Couldn't register their bank with Paystack: ${err instanceof Error ? err.message : String(err)}`,
        );
        return 'failed';
      }
    }

    let sent: Awaited<ReturnType<PaystackTransfersService['initiateTransfer']>>;
    try {
      sent = await this.paystack.initiateTransfer({
        amountKobo: transfer.amount,
        recipientCode,
        reference: transfer.reference,
        reason: `SendEbun payout — ${transfer.order_ids.length} ${transfer.order_ids.length === 1 ? 'gift' : 'gifts'}`,
      });
    } catch (err) {
      if (err instanceof PaystackTransferRejectedError) {
        await this.fail(transfer, 'failed', `Paystack: ${err.message}`);
        return 'failed';
      }
      // We don't know whether Paystack acted. Leave it in flight; the
      // sweep asks Paystack by reference rather than guessing.
      await this.repository.markProcessing(transfer.id, null);
      this.logger.warn(
        `Transfer ${transfer.reference} outcome unknown (${err instanceof Error ? err.message : String(err)}); will verify.`,
      );
      return 'unknown';
    }

    switch (sent.state) {
      case 'success':
        await this.settle(transfer, sent.transferCode);
        return 'paid';
      case 'otp':
        // Not released: approving it in the dashboard would then pay twice.
        await this.repository.noteProblem(transfer.id, OTP_PROBLEM);
        this.logger.error(`Transfer ${transfer.reference}: ${OTP_PROBLEM}`);
        return 'unknown';
      case 'failed':
      case 'reversed':
        await this.fail(transfer, sent.state, 'Paystack refused the transfer.');
        return 'failed';
      default:
        await this.repository.markProcessing(transfer.id, sent.transferCode);
        await this.audit.record({
          eventType: 'vendor.payout_sent',
          actorId: null,
          actorType: 'system',
          resourceType: 'vendor',
          resourceId: transfer.vendor_id,
          metadata: {
            transferId: transfer.id,
            reference: transfer.reference,
            amount: transfer.amount,
            collections: transfer.order_ids.length,
          },
          ipAddress: null,
          userAgent: null,
        });
        return 'sent';
    }
  }

  private async check(transfer: TransferRow): Promise<void> {
    const { state, transferCode } = await this.paystack.verifyTransfer(
      transfer.reference,
    );
    if (state === 'success') {
      await this.settle(transfer, transferCode);
    } else if (state === 'failed' || state === 'reversed') {
      await this.fail(transfer, state, 'Paystack reports the transfer failed.');
    } else if (state === 'not_found' && transfer.status === 'claimed') {
      // Claimed but never sent (the process stopped in between).
      await this.fail(
        transfer,
        'failed',
        'Never reached Paystack; will retry.',
      );
    } else if (state === 'otp') {
      await this.repository.noteProblem(transfer.id, OTP_PROBLEM);
    }
    // pending: leave it; Paystack will tell us.
  }

  private async settle(
    transfer: TransferRow,
    transferCode: string | null,
  ): Promise<void> {
    let done: TransferRow;
    try {
      done = await this.repository.complete(transfer.id, transferCode);
    } catch (err) {
      const message = err instanceof Error ? err.message : JSON.stringify(err);
      if (!message.includes('transfer_not_open')) throw err;
      // Paystack says it paid a transfer we had already given up on. Its
      // orders may since have been paid again. Never retried silently:
      // a person must reconcile it.
      this.logger.error(
        `PAID AFTER RELEASE: transfer ${transfer.reference} (vendor ${transfer.vendor_id}, ${transfer.amount} kobo) succeeded after it was marked ${transfer.status}. Check for a double payment.`,
      );
      await this.audit.record({
        eventType: 'vendor.payout_paid_after_release',
        actorId: null,
        actorType: 'system',
        resourceType: 'vendor',
        resourceId: transfer.vendor_id,
        metadata: {
          transferId: transfer.id,
          reference: transfer.reference,
          amount: transfer.amount,
        },
        ipAddress: null,
        userAgent: null,
      });
      return;
    }
    if (transfer.status === 'success') return; // a redelivery
    await this.audit.record({
      eventType: 'vendor.payout_recorded',
      actorId: null,
      actorType: 'system',
      resourceType: 'vendor',
      resourceId: transfer.vendor_id,
      metadata: {
        payoutId: done.payout_id,
        amount: transfer.amount,
        collections: transfer.order_ids.length,
        paymentRef: transfer.reference,
        paymentMethod: 'paystack_transfer',
      },
      ipAddress: null,
      userAgent: null,
    });
  }

  private async fail(
    transfer: TransferRow,
    status: 'failed' | 'reversed',
    reason: string,
  ): Promise<void> {
    await this.repository.release(transfer.id, status, reason);
    this.logger.error(
      `Automatic payout ${transfer.reference} to vendor ${transfer.vendor_id} ${status}: ${reason}`,
    );
    await this.audit.record({
      eventType: `vendor.payout_${status}`,
      actorId: null,
      actorType: 'system',
      resourceType: 'vendor',
      resourceId: transfer.vendor_id,
      metadata: {
        transferId: transfer.id,
        reference: transfer.reference,
        amount: transfer.amount,
        reason,
      },
      ipAddress: null,
      userAgent: null,
    });
  }
}

const OTP_PROBLEM =
  'Paystack is waiting for an OTP to send this. Approve or cancel it in the Paystack dashboard, then turn OTP off for transfers (Settings → Preferences).';

/** Paystack wants 16–50 lowercase letters, digits, - or _. */
function newReference(): string {
  return `sep_${randomUUID().replace(/-/g, '')}`;
}
