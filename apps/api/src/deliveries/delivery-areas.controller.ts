import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
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

  @Get(':giftTemplateId/delivery-areas')
  async areas(
    @Param('giftTemplateId', ParseUUIDPipe) giftTemplateId: string,
  ): Promise<{ areas: string[] }> {
    return { areas: await this.deliveries.deliveryAreas(giftTemplateId) };
  }
}
