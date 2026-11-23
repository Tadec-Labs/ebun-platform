import { PricingService } from '../pricing/pricing.service';
import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FulfillmentType } from '@ebun/types';
import {
  GiftTemplateRow,
  GiftTemplatesRepository,
  SellableOfferingRow,
} from './gift-templates.repository';
import { GiftsService } from './gifts.service';

function makeTemplate(
  overrides: Partial<GiftTemplateRow> = {},
): GiftTemplateRow {
  return {
    id: 'template-1',
    name: 'A Pizza, On Him',
    description: 'Redeemable at any partner pizza spot.',
    category: 'dine',
    image_url: null,
    base_price: 800000,
    available: true,
    featured: true,
    delivery_window: null,
    requires_address: false,
    delivery_type: FulfillmentType.DigitalVoucher,
    occasions: ['birthday'],
    booking_style: 'pickup',
    ...overrides,
  };
}

function offering(
  giftId: string,
  shop: Partial<NonNullable<SellableOfferingRow['vendors']>> = {},
): SellableOfferingRow {
  return {
    gift_template_id: giftId,
    vendors: {
      business_name: 'Perfect Menu',
      active: true,
      city_slug: 'akure',
      service_areas: ['Alagbaka', 'Ijapo'],
      ...shop,
    },
  };
}

describe('GiftsService', () => {
  let sut: GiftsService;
  let repository: {
    findById: jest.Mock;
    findAllAvailable: jest.Mock;
    findTemplateIdsWithAvailableVendor: jest.Mock;
    findSellableOfferings: jest.Mock;
  };

  beforeEach(async () => {
    repository = {
      findById: jest.fn(),
      findAllAvailable: jest.fn(),
      // By default template-1 has a vendor who can hand it over today.
      findTemplateIdsWithAvailableVendor: jest
        .fn()
        .mockResolvedValue(new Set(['template-1'])),
      // ...and that vendor is Perfect Menu, in Akure.
      findSellableOfferings: jest
        .fn()
        .mockResolvedValue([offering('template-1')]),
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
          category: 'dine',
          imageUrl: null,
          basePrice: 800000,
          serviceFee: 40000,
          deliveryFee: 0,
          totalPrice: 840000,
          deliveryType: FulfillmentType.DigitalVoucher,
          deliveryWindow: '2-4hrs',
          requiresAddress: false,
          featured: true,
          occasions: ['birthday'],
          bookingStyle: 'pickup',
          nationwide: false,
          cities: [
            {
              city: 'akure',
              sellers: ['Perfect Menu'],
              deliveryAreas: ['Alagbaka', 'Ijapo'],
            },
          ],
        },
      ]);
    });

    it('with a city, lists only gifts a shop in that city can hand over', async () => {
      repository.findAllAvailable.mockResolvedValue([
        makeTemplate({ id: 'template-1' }),
        makeTemplate({ id: 'lagos-only', name: 'Lagos brunch' }),
        makeTemplate({ id: 'airtime', delivery_type: FulfillmentType.Vtu }),
      ]);
      repository.findSellableOfferings.mockResolvedValue([
        offering('template-1'),
        offering('lagos-only', {
          business_name: 'Island Cafe',
          city_slug: 'lagos',
        }),
      ]);

      const akure = await sut.listAvailable('akure');

      expect(akure.map((item) => item.id)).toEqual(['template-1', 'airtime']);
      expect(akure[0].cities.map((c) => c.city)).toEqual(['akure']);
      expect(akure[1]).toMatchObject({ nationwide: true, cities: [] });
    });

    it('leaves out a shop with no city yet: it cannot be promised to anyone', async () => {
      repository.findAllAvailable.mockResolvedValue([makeTemplate()]);
      repository.findSellableOfferings.mockResolvedValue([
        offering('template-1', { city_slug: null }),
      ]);

      expect(await sut.listAvailable()).toEqual([]);
    });

    it('merges shops in the same city: names A–Z, areas de-duplicated', async () => {
      repository.findAllAvailable.mockResolvedValue([makeTemplate()]);
      repository.findSellableOfferings.mockResolvedValue([
        offering('template-1', {
          business_name: 'Unique Catering',
          service_areas: ['ijapo ', 'Oba-Ile'],
        }),
        offering('template-1'),
      ]);

      const [item] = await sut.listAvailable('akure');

      expect(item.cities).toEqual([
        {
          city: 'akure',
          sellers: ['Perfect Menu', 'Unique Catering'],
          deliveryAreas: ['Alagbaka', 'ijapo', 'Oba-Ile'],
        },
      ]);
    });

    it('leaves out a voucher gift no vendor can hand over today', async () => {
      repository.findSellableOfferings.mockResolvedValue([
        offering('template-1'),
      ]);
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
      repository.findSellableOfferings.mockResolvedValue([]);

      const result = await sut.listAvailable('akure');

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

    it('with a city, accepts the gift only when a shop there sells it', async () => {
      const template = makeTemplate();
      repository.findById.mockResolvedValue(template);

      await expect(sut.findAvailableById('template-1', 'akure')).resolves.toBe(
        template,
      );
      await expect(
        sut.findAvailableById('template-1', 'lagos'),
      ).rejects.toThrow(NotFoundException);
      // Only this gift's shops are loaded at checkout, not the whole catalogue.
      expect(repository.findSellableOfferings).toHaveBeenCalledWith(
        'template-1',
      );
    });

    it('a nationwide gift needs no shop in the city', async () => {
      const template = makeTemplate({ delivery_type: FulfillmentType.Vtu });
      repository.findById.mockResolvedValue(template);
      repository.findSellableOfferings.mockResolvedValue([]);

      await expect(sut.findAvailableById('template-1', 'lagos')).resolves.toBe(
        template,
      );
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
