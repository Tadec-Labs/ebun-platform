import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

/**
 * redemptionToken in the request BODY, not a URL path/query param —
 * see redemptions.controller.ts's header for why that's a deliberate
 * departure from the originally-sketched `/redeem/[token]` URL shape.
 *
 * vendorId/vendorConfirmedBy are REQUIRED, not optional. This endpoint
 * is specifically "a vendor scanned a QR and confirmed" — the DB's own
 * attempt_redemption() function will happily accept a null vendor and
 * complete the redemption anyway, which would let anyone holding a
 * leaked redemption_token bypass in-person vendor confirmation entirely
 * for a digital_voucher gift. A vendorless completion (VTU, which has
 * no vendor step to wait for) is a deliberately SEPARATE, internal-only
 * code path — see RevealService.acceptGift, which calls
 * RedemptionsService.complete() directly rather than going through this
 * HTTP endpoint. Keeping that path off this public controller entirely
 * means there's no DTO shape here that could accidentally authorize a
 * vendorless completion from the open internet.
 */
export class RedeemDto {
  @IsUUID()
  redemptionToken!: string;

  @IsUUID()
  vendorId!: string;

  @IsString()
  @IsNotEmpty()
  vendorConfirmedBy!: string;
}
