import { randomBytes } from 'crypto';
import { Injectable } from '@nestjs/common';

/**
 * Generates the voucher_code stored on gift_fulfillments for
 * `digital_voucher` gifts (a brand-location QR code / voucher, per the
 * schema's fulfillment_type comment). Unlike VTU, this needs no
 * external provider — the voucher itself IS Ebun's own artifact, scanned
 * by the vendor's staff — so it's real, working code in this slice
 * rather than a stub behind a provider interface.
 *
 * Deliberately high-entropy, unlike redemptions.fallback_code (schema:
 * a 6-char human-typed fallback for when QR scanning fails). voucher_code
 * is the QR payload itself, scanned rather than typed, so there's no
 * usability reason to keep it short — favour collision-resistance
 * instead. 16 hex chars from 8 random bytes is 64 bits of entropy,
 * comfortably beyond brute-force range for a single-use code redeemed
 * at a single vendor location.
 */
@Injectable()
export class DigitalVoucherService {
  generateCode(): string {
    return `EBN-VCH-${randomBytes(8).toString('hex').toUpperCase()}`;
  }
}
