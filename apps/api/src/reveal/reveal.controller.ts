import { Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
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
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async view(@Param('token', new ParseUUIDPipe()) token: string) {
    return this.reveal.view(token);
  }

  @Post(':token/accept')
  // Throttle's decorator type is not resolved by the lint type checker.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async accept(@Param('token', new ParseUUIDPipe()) token: string) {
    return this.reveal.acceptGift(token);
  }
}
