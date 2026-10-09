import { IsUUID } from 'class-validator';

/**
 * vendorId is required, exactly as it is on the public RedeemDto: a
 * redemption that records no vendor is a payout with nobody to pay and
 * an audit trail that can't answer "who handed this over". Ops picks
 * the vendor from the real vendor list; there is deliberately no
 * "unknown vendor" option.
 *
 * The code itself is a URL path param rather than a body field — it is
 * low-entropy (six characters, one per recipient) and useless on its
 * own without a staff session, unlike redemption_token, which the
 * schema forbids putting in a URL and which never reaches this layer
 * from outside.
 */
export class OpsCompleteRedemptionDto {
  @IsUUID()
  vendorId!: string;
}
