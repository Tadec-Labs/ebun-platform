import { ConflictException } from '@nestjs/common';

/**
 * A code that exists but can't be collected right now — already
 * collected, expired, or not yet claimed by the recipient.
 *
 * 409 rather than 400: the request itself was well-formed and the code
 * is real; it's the current state of the world that refuses it, which
 * is exactly what a conflict is. Carries the reason verbatim because
 * every one of them is something the person at the counter needs to
 * read and act on, not an internal detail to hide behind a generic
 * message.
 */
export class RedemptionNotRedeemableException extends ConflictException {
  constructor(reason: string) {
    super(reason);
  }
}
