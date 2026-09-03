import { Injectable, NotFoundException } from '@nestjs/common';
import {
  GiftTemplateRow,
  GiftTemplatesRepository,
} from './gift-templates.repository';

@Injectable()
export class GiftsService {
  constructor(private readonly repository: GiftTemplatesRepository) {}

  /** Throws if the template doesn't exist OR exists but isn't currently available — CreateOrderService should never have to check `.available` itself. */
  async findAvailableById(id: string): Promise<GiftTemplateRow> {
    const template = await this.repository.findById(id);

    if (!template || !template.available) {
      throw new NotFoundException(
        `Gift template ${id} not found or not currently available`,
      );
    }

    return template;
  }
}
