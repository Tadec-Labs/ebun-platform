import { ConflictException } from '@nestjs/common';

/**
 * Thrown when attempt_redemption() returns null — per its own doc
 * comment, that means the redemption_token is unknown, was already
 * completed, or is past its expiry. 409, not 404: the token format
 * itself may be perfectly valid, the redemption just can't proceed.
 * Deliberately doesn't distinguish "already redeemed" from "expired"
 * from "unknown token" in the response — a vendor-facing scanning
 * client learning WHY a stale/reused code exists doesn't need more
 * detail than "this can't be redeemed", and finer-grained reasons here
 * would help someone probing for valid-but-expired tokens.
 */
export class RedemptionConflictException extends ConflictException {
  constructor() {
    super(
      'This gift cannot be redeemed — the code is invalid, already used, or expired.',
    );
  }
}
