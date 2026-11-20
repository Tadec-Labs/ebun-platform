import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CitiesService, CityView } from './cities.service';
import { CityRequestDto } from './dto/city-request.dto';

/**
 * Public, like GET /gifts: senders choose a city before they've told
 * us who they are.
 */
@Controller('cities')
export class CitiesController {
  constructor(private readonly cities: CitiesService) {}

  @Get()
  list(): Promise<CityView[]> {
    return this.cities.listLive();
  }

  /**
   * "They're somewhere you don't cover yet." Throttled (10 an hour per
   * IP): it writes a row and nobody needs to ask twice a minute.
   */
  @Post('requests')
  @HttpCode(202)
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  request(@Body() dto: CityRequestDto): Promise<{ received: true }> {
    return this.cities.recordRequest(dto);
  }
}
