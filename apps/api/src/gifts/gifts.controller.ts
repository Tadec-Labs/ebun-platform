import { Controller, Get } from '@nestjs/common';
import { GiftCatalogItem, GiftsService } from './gifts.service';

/**
 * Public — no auth. Senders don't register before choosing a gift (see
 * the Product Brief's sender flow: email/phone are only collected at
 * order creation), so this can't require a JWT.
 */
@Controller('gifts')
export class GiftsController {
  constructor(private readonly giftsService: GiftsService) {}

  @Get()
  async list(): Promise<GiftCatalogItem[]> {
    return this.giftsService.listAvailable();
  }
}
