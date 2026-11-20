import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import { isCitySlug } from '../cities/cities.service';
import { DeliveriesService } from './deliveries.service';

/**
 * Public: where a doorstep gift can be delivered, so the sender's
 * optional "I know their address" form offers a short list to tap
 * instead of a box to type into. Only area names shops chose to list —
 * nothing about any order or person.
 */
@Controller('gifts')
export class DeliveryAreasController {
  constructor(private readonly deliveries: DeliveriesService) {}

  /** `?city=akure`: only areas shops in that city deliver to. */
  @Get(':giftTemplateId/delivery-areas')
  async areas(
    @Param('giftTemplateId', ParseUUIDPipe) giftTemplateId: string,
    @Query('city') city?: string,
  ): Promise<{ areas: string[] }> {
    if (city !== undefined && !isCitySlug(city)) {
      throw new BadRequestException('Unknown city.');
    }
    return {
      areas: await this.deliveries.deliveryAreas(giftTemplateId, city),
    };
  }
}
