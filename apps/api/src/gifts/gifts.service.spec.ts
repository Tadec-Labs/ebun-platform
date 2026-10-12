import { PricingService } from '../pricing/pricing.service';
import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FulfillmentType } from '@ebun/types';
import {
  GiftTemplateRow,
  GiftTemplatesRepository,
} from './gift-templates.repository';
import { GiftsService } from './gifts.service';

function makeTemplate(
  overrides: Partial<GiftTemplateRow> = {},
): GiftTemplateRow {
  return {
    id: 'template-1',
    name: 'A Pizza, On Him',
    description: 'Redeemable at any partner pizza spot.',
    category: 'food',
    image_url: null,
    base_price: 800000,
    available: true,
    featured: true,
    delivery_window: null,
    requires_address: false,
    delivery_type: FulfillmentType.DigitalVoucher,
    ...overrides,
  };
}

describe('GiftsService', () => {
  let sut: GiftsService;
  let repository: {
    findById: jest.Mock;
    findAllAvailable: jest.Mock;
    findTemplateIdsWithAvailableVendor: jest.Mock;
  };

  beforeEach(async () => {
    repository = {
      findById: jest.fn(),
      findAllAvailable: jest.fn(),
      // By default template-1 has a vendor who can hand it over today.
      findTemplateIdsWithAvailableVendor: jest
        .fn()
        .mockResolvedValue(new Set(['template-1'])),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        GiftsService,
        { provide: GiftTemplatesRepository, useValue: repository },
        PricingService,
      ],
    }).compile();

    sut = moduleRef.get(GiftsService);
  });

  describe('listAvailable', () => {
    it('maps repository rows to the public catalog shape', async () => {
      repository.findAllAvailable.mockResolvedValue([
        makeTemplate({
          id: 'template-1',
          delivery_window: '2-4hrs',
        }),
      ]);

      const result = await sut.listAvailable();

      expect(result).toEqual([
        {
          id: 'template-1',
          name: 'A Pizza, On Him',
          description: 'Redeemable at any partner pizza spot.',
          category: 'food',
          imageUrl: null,
          basePrice: 800000,
          serviceFee: 40000,
          totalPrice: 840000,
          deliveryType: FulfillmentType.DigitalVoucher,
          deliveryWindow: '2-4hrs',
          requiresAddress: false,
          featured: true,
        },
      ]);
    });

    it('leaves out a voucher gift no vendor can hand over today', async () => {
      repository.findAllAvailable.mockResolvedValue([
        makeTemplate({ id: 'template-1' }),
        makeTemplate({ id: 'template-2', name: 'Sold out everywhere' }),
      ]);

      const result = await sut.listAvailable();

      expect(result.map((item) => item.id)).toEqual(['template-1']);
    });

    it('keeps airtime/data/power gifts, which need no vendor', async () => {
      repository.findAllAvailable.mockResolvedValue([
        makeTemplate({
          id: 'airtime',
          delivery_type: FulfillmentType.Vtu,
        }),
      ]);
      repository.findTemplateIdsWithAvailableVendor.mockResolvedValue(
        new Set(),
      );

      const result = await sut.listAvailable();

      expect(result.map((item) => item.id)).toEqual(['airtime']);
    });

    it('returns an empty array when nothing is available, rather than throwing', async () => {
      repository.findAllAvailable.mockResolvedValue([]);

      const result = await sut.listAvailable();

      expect(result).toEqual([]);
    });
  });

  describe('findAvailableById', () => {
    it('returns the raw row when the template exists and is available', async () => {
      const template = makeTemplate();
      repository.findById.mockResolvedValue(template);

      const result = await sut.findAvailableById('template-1');

      expect(result).toBe(template);
    });

    it('throws NotFoundException when the template does not exist', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(sut.findAvailableById('missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException when every vendor has marked it sold out since the sender opened the page', async () => {
      repository.findById.mockResolvedValue(makeTemplate());
      repository.findTemplateIdsWithAvailableVendor.mockResolvedValue(
        new Set(),
      );

      await expect(sut.findAvailableById('template-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it("throws NotFoundException when the template exists but is not available — same as not existing, from a sender's perspective", async () => {
      repository.findById.mockResolvedValue(makeTemplate({ available: false }));

      await expect(sut.findAvailableById('template-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
