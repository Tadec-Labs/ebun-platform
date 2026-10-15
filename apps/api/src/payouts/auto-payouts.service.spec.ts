import { ConfigService } from '@nestjs/config';
import { AuditService } from '../audit/audit.service';
import {
  PaystackTransferRejectedError,
  PaystackTransfersService,
} from '../paystack/paystack-transfers.service';
import {
  AutoPayoutsRepository,
  PayableVendorRow,
  TransferRow,
} from './auto-payouts.repository';
import { AutoPayoutsService } from './auto-payouts.service';

const VENDOR: PayableVendorRow = {
  id: 'vendor-1',
  business_name: 'Cake Co',
  active: true,
  bank_code: '058',
  account_number: '0123456789',
  account_name: 'Cake Co Ltd',
  paystack_recipient_code: 'RCP_existing',
};

function transfer(over: Partial<TransferRow> = {}): TransferRow {
  return {
    id: 'tr-1',
    vendor_id: 'vendor-1',
    order_ids: ['o1', 'o2'],
    amount: 1_800_000,
    reference: 'sep_abc',
    status: 'claimed',
    paystack_transfer_code: null,
    failure_reason: null,
    payout_id: null,
    created_at: 't',
    updated_at: 't',
    ...over,
  };
}

describe('AutoPayoutsService', () => {
  let repo: Record<string, jest.Mock>;
  let paystack: Record<string, jest.Mock>;
  let audit: { record: jest.Mock };
  let env: Record<string, string | undefined>;
  let sut: AutoPayoutsService;

  beforeEach(() => {
    repo = {
      findVendor: jest.fn().mockResolvedValue(VENDOR),
      countFailuresSince: jest.fn().mockResolvedValue(0),
      claim: jest.fn().mockResolvedValue(transfer()),
      saveRecipientCode: jest.fn().mockResolvedValue(undefined),
      markProcessing: jest.fn().mockResolvedValue(undefined),
      noteProblem: jest.fn().mockResolvedValue(undefined),
      complete: jest
        .fn()
        .mockResolvedValue(transfer({ status: 'success', payout_id: 'p1' })),
      release: jest.fn().mockResolvedValue(transfer({ status: 'failed' })),
      findByReference: jest.fn().mockResolvedValue(transfer()),
      listUnsettled: jest.fn().mockResolvedValue([]),
      vendorsOwed: jest.fn().mockResolvedValue([]),
    };
    paystack = {
      createRecipient: jest
        .fn()
        .mockResolvedValue({ recipientCode: 'RCP_new', accountName: 'X' }),
      initiateTransfer: jest
        .fn()
        .mockResolvedValue({ state: 'pending', transferCode: 'TRF_1' }),
      verifyTransfer: jest
        .fn()
        .mockResolvedValue({ state: 'pending', transferCode: 'TRF_1' }),
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    env = { AUTO_PAYOUTS: 'true' };
    sut = new AutoPayoutsService(
      repo as unknown as AutoPayoutsRepository,
      paystack as unknown as PaystackTransfersService,
      audit as unknown as AuditService,
      { get: (k: string) => env[k] } as unknown as ConfigService,
    );
  });

  it('does nothing at all unless AUTO_PAYOUTS is on', async () => {
    env.AUTO_PAYOUTS = undefined;
    await expect(sut.payVendor('vendor-1')).resolves.toBe('off');
    expect(repo.claim).not.toHaveBeenCalled();
    expect(paystack.initiateTransfer).not.toHaveBeenCalled();
  });

  it('leaves vendors without a bank picked from the list on the manual queue', async () => {
    repo.findVendor.mockResolvedValue({ ...VENDOR, bank_code: null });
    await expect(sut.payVendor('vendor-1')).resolves.toBe('no_bank');
    expect(repo.claim).not.toHaveBeenCalled();
  });

  it('sends one transfer for exactly what was claimed, with our unique reference', async () => {
    await expect(sut.payVendor('vendor-1')).resolves.toBe('sent');

    expect(paystack.initiateTransfer).toHaveBeenCalledWith({
      amountKobo: 1_800_000,
      recipientCode: 'RCP_existing',
      reference: 'sep_abc',
      reason: 'SendEbun payout — 2 gifts',
    });
    expect(repo.markProcessing).toHaveBeenCalledWith('tr-1', 'TRF_1');
    expect((repo.claim.mock.calls as unknown[][])[0][1]).toMatch(
      /^sep_[0-9a-f]{32}$/,
    );
  });

  it('registers the bank with Paystack once, then reuses it', async () => {
    repo.findVendor.mockResolvedValue({
      ...VENDOR,
      paystack_recipient_code: null,
    });

    await sut.payVendor('vendor-1');

    expect(paystack.createRecipient).toHaveBeenCalledWith({
      name: 'Cake Co Ltd',
      accountNumber: '0123456789',
      bankCode: '058',
    });
    expect(repo.saveRecipientCode).toHaveBeenCalledWith('vendor-1', 'RCP_new', {
      accountNumber: '0123456789',
      bankCode: '058',
    });
    expect(paystack.initiateTransfer).toHaveBeenCalledWith(
      expect.objectContaining({ recipientCode: 'RCP_new' }),
    );
  });

  it('pays nothing when nothing is owed', async () => {
    repo.claim.mockResolvedValue(null);
    await expect(sut.payVendor('vendor-1')).resolves.toBe('nothing_owed');
    expect(paystack.initiateTransfer).not.toHaveBeenCalled();
  });

  it('releases the orders when Paystack refuses (e.g. balance too low), to retry later', async () => {
    paystack.initiateTransfer.mockRejectedValue(
      new PaystackTransferRejectedError(
        'Your balance is not enough to fulfil this request',
      ),
    );

    await expect(sut.payVendor('vendor-1')).resolves.toBe('failed');
    expect(repo.release).toHaveBeenCalledWith(
      'tr-1',
      'failed',
      'Paystack: Your balance is not enough to fulfil this request',
    );
  });

  it('never releases a transfer whose outcome is unknown — it is checked instead', async () => {
    paystack.initiateTransfer.mockRejectedValue(new Error('socket hang up'));

    await expect(sut.payVendor('vendor-1')).resolves.toBe('unknown');
    expect(repo.release).not.toHaveBeenCalled();
    expect(repo.markProcessing).toHaveBeenCalledWith('tr-1', null);
  });

  it('holds (not releases) a transfer Paystack wants an OTP for', async () => {
    paystack.initiateTransfer.mockResolvedValue({
      state: 'otp',
      transferCode: 'TRF_1',
    });

    await sut.payVendor('vendor-1');
    expect(repo.release).not.toHaveBeenCalled();
    expect(repo.noteProblem).toHaveBeenCalledWith(
      'tr-1',
      expect.stringMatching(/OTP/),
    );
  });

  it('stops retrying a vendor after three failures in a day', async () => {
    repo.countFailuresSince.mockResolvedValue(3);
    await expect(sut.payVendor('vendor-1')).resolves.toBe('paused');
    expect(repo.claim).not.toHaveBeenCalled();
  });

  it('records the payout when Paystack confirms it, once', async () => {
    await sut.applyTransferEvent('transfer.success', 'sep_abc', 'TRF_1');

    expect(repo.complete).toHaveBeenCalledWith('tr-1', 'TRF_1');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'vendor.payout_recorded',
        actorType: 'system',
      }),
    );

    audit.record.mockClear();
    repo.findByReference.mockResolvedValue(transfer({ status: 'success' }));
    await sut.applyTransferEvent('transfer.success', 'sep_abc', 'TRF_1');
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('releases on transfer.failed and transfer.reversed', async () => {
    await sut.applyTransferEvent(
      'transfer.reversed',
      'sep_abc',
      'TRF_1',
      'Account closed',
    );
    expect(repo.release).toHaveBeenCalledWith(
      'tr-1',
      'reversed',
      'Account closed',
    );
  });

  it("ignores transfers that aren't ours", async () => {
    repo.findByReference.mockResolvedValue(null);
    await sut.applyTransferEvent('transfer.success', 'manual_1', 'TRF_x');
    expect(repo.complete).not.toHaveBeenCalled();
  });

  it('flags — never re-pays — a transfer Paystack paid after we gave up on it', async () => {
    repo.findByReference.mockResolvedValue(transfer({ status: 'failed' }));
    repo.complete.mockRejectedValue({
      message: 'transfer_not_open',
      code: 'P0001',
    });

    await expect(
      sut.applyTransferEvent('transfer.success', 'sep_abc', 'TRF_1'),
    ).resolves.toBeUndefined();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'vendor.payout_paid_after_release',
      }),
    );
  });

  it('sweep: settles quiet transfers Paystack says succeeded, and pays anyone still owed', async () => {
    repo.listUnsettled.mockResolvedValue([transfer({ status: 'processing' })]);
    paystack.verifyTransfer.mockResolvedValue({
      state: 'success',
      transferCode: 'TRF_1',
    });
    repo.vendorsOwed.mockResolvedValue(['vendor-2']);
    repo.claim.mockResolvedValue(null);

    await expect(sut.sweep()).resolves.toEqual({ checked: 1, attempted: 1 });
    expect(repo.complete).toHaveBeenCalledWith('tr-1', 'TRF_1');
    expect(repo.findVendor).toHaveBeenCalledWith('vendor-2');
  });

  it('sweep: releases a claim that never reached Paystack', async () => {
    repo.listUnsettled.mockResolvedValue([transfer({ status: 'claimed' })]);
    paystack.verifyTransfer.mockResolvedValue({
      state: 'not_found',
      transferCode: null,
    });

    await sut.sweep();
    expect(repo.release).toHaveBeenCalledWith(
      'tr-1',
      'failed',
      expect.stringMatching(/Never reached Paystack/),
    );
  });
});
