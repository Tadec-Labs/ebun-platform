import { IsISO8601, IsUUID } from 'class-validator';

/** POST /reveal/:token/pickup — where and when the recipient will collect. */
export class BookPickupDto {
  @IsUUID()
  vendorId!: string;

  /** An absolute time with an offset (the browser sends UTC). Range-checked in RevealService. */
  @IsISO8601({ strict: true })
  pickupAt!: string;
}
