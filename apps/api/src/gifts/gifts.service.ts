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

  /**
   * Deliberately does NOT check `.available` — that flag governs whether
   * a template can be selected for a NEW order, not whether an order
   * already paid for still deserves to be fulfilled. Fulfillment
   * orchestration needs the latter: look up delivery_type for an order
   * that already exists, regardless of whether the template was pulled
   * from the catalogue since. Still throws if the template row is
   * genuinely gone (a real data-integrity problem, not a normal case).
   */
  async findById(id: string): Promise<GiftTemplateRow> {
    const template = await this.repository.findById(id);

    if (!template) {
      throw new NotFoundException(`Gift template ${id} not found`);
    }

    return template;
  }
}
