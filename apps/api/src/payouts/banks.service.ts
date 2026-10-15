import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  PaystackBank,
  PaystackTransfersService,
} from '../paystack/paystack-transfers.service';

const CACHE_MS = 12 * 60 * 60_000;

/**
 * The Nigerian bank list for the bank pickers (vendor Shop screen, ops
 * vendor form). Picking from Paystack's list — rather than typing a bank
 * name — is what gives each vendor the bank code automatic payouts need.
 * Cached in memory: it changes a few times a year.
 */
@Injectable()
export class BanksService {
  private readonly logger = new Logger(BanksService.name);
  private cache: { at: number; banks: PaystackBank[] } | null = null;

  constructor(private readonly paystack: PaystackTransfersService) {}

  async list(): Promise<PaystackBank[]> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) {
      return this.cache.banks;
    }
    try {
      const banks = await this.paystack.listBanks();
      this.cache = { at: Date.now(), banks };
      return banks;
    } catch (err) {
      this.logger.warn(
        `Couldn't load the bank list from Paystack: ${err instanceof Error ? err.message : String(err)}`,
      );
      // A stale list beats none.
      if (this.cache) return this.cache.banks;
      throw new ServiceUnavailableException(
        "Couldn't load the list of banks just now. Try again in a minute.",
      );
    }
  }

  /** The bank's name for a code from the list, or null if it isn't one. */
  async nameOf(code: string): Promise<string | null> {
    const banks = await this.list();
    return banks.find((bank) => bank.code === code)?.name ?? null;
  }
}
