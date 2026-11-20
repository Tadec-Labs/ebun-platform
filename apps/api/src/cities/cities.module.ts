import { Module } from '@nestjs/common';
import { CitiesController } from './cities.controller';
import { CitiesRepository } from './cities.repository';
import { CitiesService } from './cities.service';

@Module({
  controllers: [CitiesController],
  providers: [CitiesRepository, CitiesService],
  exports: [CitiesService],
})
export class CitiesModule {}
