import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FulfillmentType } from '@ebun/types';
import { GiftTemplateRow, GiftTemplatesRepository } from './gift-templates.repository';
import { GiftsService } from './gifts.service';

function makeTemplate(overrides: Partial<GiftTemplateRow> = {}): GiftTemplateRow {
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
  let repository: { findById: jest.Mock; findAllAvailable: jest.Mock };

  beforeEach(async () => {
    repository = { findById: jest.fn(), findAllAvailable: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        GiftsService,
        { provide: GiftTemplatesRepository, useValue: repository },
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
          deliveryType: FulfillmentType.DigitalVoucher,
          deliveryWindow: '2-4hrs',
          requiresAddress: false,
          featured: true,
        },
      ]);
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

    it('throws NotFoundException when the template exists but is not available — same as not existing, from a sender\'s perspective', async () => {
      repository.findById.mockResolvedValue(makeTemplate({ available: false }));

      await expect(sut.findAvailableById('template-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
