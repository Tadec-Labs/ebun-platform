import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { BookPickupDto } from './dto/book-pickup.dto';
import { SetDeliveryDetailsDto } from '../deliveries/dto/delivery.dto';
import { RevealService } from './reveal.service';

/**
 * Public, unauthenticated, token-gated — reveal_token is a high-entropy
 * UUID (per the schema), but this is still the one surface in the app
 * that takes arbitrary requests from the open internet against a
 * possibly-enumerable identifier, hence the tighter-than-default
 * throttling on both routes here specifically.
 */
@Controller('reveal')
export class RevealController {
  constructor(private readonly reveal: RevealService) {}

  @Get(':token')
  // Throttle's decorator type is not resolved by the lint type checker.
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async view(@Param('token', new ParseUUIDPipe()) token: string) {
    return this.reveal.view(token);
  }

  @Post(':token/accept')
  // Throttle's decorator type is not resolved by the lint type checker.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async accept(@Param('token', new ParseUUIDPipe()) token: string) {
    return this.reveal.acceptGift(token);
  }

  /**
   * "I'm coming at 12:30" — tells the vendor so the gift is ready. Can
   * be repeated to change the time; each change needs the vendor to
   * confirm again.
   */
  @Post(':token/pickup')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async bookPickup(
    @Param('token', new ParseUUIDPipe()) token: string,
    @Body() body: BookPickupDto,
  ) {
    return this.reveal.bookPickup(token, body.vendorId, body.pickupAt);
  }

  /**
   * Doorstep gifts: "I've received it". The recipient's own word is proof
   * of delivery — for when the rider didn't ask for the code.
   */
  @Post(':token/received')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async received(@Param('token', new ParseUUIDPipe()) token: string) {
    return this.reveal.confirmReceived(token);
  }

  /** Doorstep gifts: where to bring it. Repeatable until it's on its way. */
  @Post(':token/delivery')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async setDelivery(
    @Param('token', new ParseUUIDPipe()) token: string,
    @Body() body: SetDeliveryDetailsDto,
  ) {
    return this.reveal.setDelivery(token, body);
  }
}
