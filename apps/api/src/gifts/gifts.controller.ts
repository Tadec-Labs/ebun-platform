import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { isCitySlug } from '../cities/cities.service';
import { GiftCatalogItem, GiftsService } from './gifts.service';

/**
 * Public — no auth. Senders don't register before choosing a gift (see
 * the Product Brief's sender flow: email/phone are only collected at
 * order creation), so this can't require a JWT.
 */
@Controller('gifts')
export class GiftsController {
  constructor(private readonly giftsService: GiftsService) {}

  /**
   * `?city=akure` lists only what can reach a recipient there (plus the
   * nationwide gifts). Without it, every gift is listed with the cities
   * it can be sent to.
   */
  @Get()
  async list(@Query('city') city?: string): Promise<GiftCatalogItem[]> {
    if (city !== undefined && !isCitySlug(city)) {
      throw new BadRequestException('Unknown city.');
    }
    return this.giftsService.listAvailable(city);
  }
}
