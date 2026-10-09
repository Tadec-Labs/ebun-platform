import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { StaffContext } from '../auth/staff.guard';
import { GiftsService } from '../gifts/gifts.service';
import {
  CreateVendorDto,
  UpdateVendorDto,
  UpsertOfferingDto,
} from './dto/vendor.dto';
import { VendorRow, VendorsRepository } from './vendors.repository';
import { VendorsService } from './vendors.service';

const STAFF: StaffContext = {
  userId: 'staff-1',
  authId: 'auth-1',
  role: 'ebun_ops',
  email: 'ops@ebun.example',
  name: 'Ops',
};
const META = { ipAddress: '1.2.3.4', userAgent: 'jest' };

function makeVendor(overrides: Partial<VendorRow> = {}): VendorRow {
  return {
    id: 'vendor-1',
    portal_token: '11111111-1111-4111-8111-111111111111',
    portal_token_rotated_at: null,
    business_name: 'Mama Cass Kitchen',
    owner_name: 'Cassandra Okoye',
    whatsapp_number: '+2348012345678',
    email: 'cass@example.com',
    category: 'food',
    subcategories: null,
    service_areas: ['Lekki'],
    delivery_zones: null,
    commission_rate: 0.7,
    bank_name: 'GTBank',
    account_number: '0123456789',
    account_name: 'Mama Cass Ltd',
    active: true,
    verified: false,
    rating: null,
    total_orders: 0,
    response_timeout_minutes: 120,
    backup_vendor_id: null,
    notes: null,
    created_at: '2026-10-05T00:00:00.000Z',
    updated_at: '2026-10-05T00:00:00.000Z',
    ...overrides,
  };
}

const withFields = <T extends object>(cls: new () => T, fields: Partial<T>) =>
  Object.assign(new cls(), fields);

describe('VendorsService', () => {
  let sut: VendorsService;
  let repository: Record<keyof VendorsRepository, jest.Mock>;
  let gifts: { findById: jest.Mock };
  let audit: { record: jest.Mock };

  beforeEach(() => {
    repository = {
      list: jest.fn(),
      countOfferingsByVendor: jest.fn(),
      findByPortalToken: jest.fn(),
      findOffering: jest.fn(),
      rotatePortalToken: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      listOfferings: jest.fn(),
      upsertOffering: jest.fn(),
      deleteOffering: jest.fn(),
    };
    gifts = { findById: jest.fn() };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    sut = new VendorsService(
      repository as unknown as VendorsRepository,
      gifts as unknown as GiftsService,
      audit as unknown as AuditService,
    );
  });

  describe('list', () => {
    it('merges offering counts, defaulting to zero', async () => {
      repository.list.mockResolvedValue([
        {
          id: 'a',
          business_name: 'A',
          service_areas: null,
          delivery_zones: null,
        },
        {
          id: 'b',
          business_name: 'B',
          service_areas: ['Yaba'],
          delivery_zones: null,
        },
      ]);
      repository.countOfferingsByVendor.mockResolvedValue({ b: 3 });

      const result = await sut.list();

      expect(result.map((v) => [v.id, v.offeringsCount])).toEqual([
        ['a', 0],
        ['b', 3],
      ]);
      expect(result[0].serviceAreas).toEqual([]);
    });
  });

  describe('create', () => {
    it('maps to snake_case columns, skipping fields not provided, and audits', async () => {
      repository.create.mockResolvedValue(makeVendor());

      const dto = withFields(CreateVendorDto, {
        businessName: 'Mama Cass Kitchen',
        ownerName: 'Cassandra Okoye',
        whatsappNumber: '+2348012345678',
        category: 'food',
        serviceAreas: ['Lekki'],
      });
      const result = await sut.create(dto, STAFF, META);

      expect(repository.create).toHaveBeenCalledWith({
        business_name: 'Mama Cass Kitchen',
        owner_name: 'Cassandra Okoye',
        whatsapp_number: '+2348012345678',
        category: 'food',
        service_areas: ['Lekki'],
      });
      expect(result.businessName).toBe('Mama Cass Kitchen');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'vendor.created',
          actorId: 'staff-1',
          actorType: 'admin',
          resourceType: 'vendor',
          resourceId: 'vendor-1',
          ipAddress: '1.2.3.4',
        }),
      );
    });

    it('rejects a backup vendor that does not exist, writing nothing', async () => {
      repository.findById.mockResolvedValue(null);
      const dto = withFields(CreateVendorDto, {
        businessName: 'X',
        ownerName: 'Y',
        whatsappNumber: '+2348012345678',
        category: 'food',
        backupVendorId: 'ghost',
      });

      await expect(sut.create(dto, STAFF, META)).rejects.toThrow(
        BadRequestException,
      );
      expect(repository.create).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('404s for an unknown vendor', async () => {
      repository.findById.mockResolvedValue(null);
      await expect(
        sut.update(
          'vendor-1',
          withFields(UpdateVendorDto, { notes: 'x' }),
          STAFF,
          META,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects a vendor being its own backup', async () => {
      repository.findById.mockResolvedValue(makeVendor());
      await expect(
        sut.update(
          'vendor-1',
          withFields(UpdateVendorDto, { backupVendorId: 'vendor-1' }),
          STAFF,
          META,
        ),
      ).rejects.toThrow(/own backup/);
    });

    it('rejects an empty body', async () => {
      repository.findById.mockResolvedValue(makeVendor());
      await expect(
        sut.update('vendor-1', new UpdateVendorDto(), STAFF, META),
      ).rejects.toThrow(/No changes/);
    });

    it('does nothing — no write, no audit — when the submitted values already match', async () => {
      repository.findById.mockResolvedValue(makeVendor());

      const result = await sut.update(
        'vendor-1',
        withFields(UpdateVendorDto, {
          businessName: 'Mama Cass Kitchen',
          serviceAreas: ['Lekki'],
        }),
        STAFF,
        META,
      );

      expect(repository.update).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
      expect(result.id).toBe('vendor-1');
    });

    it('writes only the columns that actually changed', async () => {
      repository.findById.mockResolvedValue(makeVendor());
      repository.update.mockResolvedValue(
        makeVendor({ active: false, notes: 'paused' }),
      );

      await sut.update(
        'vendor-1',
        withFields(UpdateVendorDto, {
          businessName: 'Mama Cass Kitchen',
          active: false,
          notes: 'paused',
        }),
        STAFF,
        META,
      );

      expect(repository.update).toHaveBeenCalledWith('vendor-1', {
        active: false,
        notes: 'paused',
      });
    });

    it('treats null as an explicit clear', async () => {
      repository.findById.mockResolvedValue(makeVendor());
      repository.update.mockResolvedValue(makeVendor({ email: null }));

      await sut.update(
        'vendor-1',
        withFields(UpdateVendorDto, { email: null }),
        STAFF,
        META,
      );

      expect(repository.update).toHaveBeenCalledWith('vendor-1', {
        email: null,
      });
    });

    it('audits changed field NAMES and the active/verified flips — never bank details', async () => {
      repository.findById.mockResolvedValue(makeVendor());
      repository.update.mockResolvedValue(
        makeVendor({ verified: true, account_number: '9999999999' }),
      );

      await sut.update(
        'vendor-1',
        withFields(UpdateVendorDto, {
          verified: true,
          accountNumber: '9999999999',
        }),
        STAFF,
        META,
      );

      const calls = audit.record.mock.calls as unknown[][];
      const event = calls[0][0] as {
        eventType: string;
        metadata: Record<string, unknown>;
      };
      expect(event.eventType).toBe('vendor.updated');
      expect([...(event.metadata.changedFields as string[])].sort()).toEqual([
        'account_number',
        'verified',
      ]);
      expect(event.metadata.verified).toEqual({ from: false, to: true });
      // The whole point: neither the old nor the new account number is in the log.
      const serialised = JSON.stringify(event);
      expect(serialised).not.toContain('9999999999');
      expect(serialised).not.toContain('0123456789');
    });
  });

  describe('offerings', () => {
    const GIFT = { id: 'gift-1', name: 'A Pizza, On Him', base_price: 800000 };

    it('computes Ebun margin from sender price and vendor price', async () => {
      repository.findById.mockResolvedValue(makeVendor());
      repository.listOfferings.mockResolvedValue([
        {
          vendor_id: 'vendor-1',
          gift_template_id: 'gift-1',
          vendor_price: 560000,
          available_zones: null,
          available: true,
          approved: false,
          gift_templates: { name: 'A Pizza, On Him', base_price: 800000 },
        },
      ]);

      const [offering] = await sut.listOfferings('vendor-1');

      expect(offering.ebunMargin).toBe(240000);
      expect(offering.ebunMarginPct).toBe(30);
    });

    it('rejects a vendor price at or above the sender price, writing nothing', async () => {
      repository.findById.mockResolvedValue(makeVendor());
      gifts.findById.mockResolvedValue(GIFT);

      for (const vendorPrice of [800000, 900000]) {
        await expect(
          sut.upsertOffering(
            'vendor-1',
            'gift-1',
            withFields(UpsertOfferingDto, { vendorPrice }),
            STAFF,
            META,
          ),
        ).rejects.toThrow(/lower than the sender price/);
      }
      expect(repository.upsertOffering).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('propagates a 404 for an unknown gift template', async () => {
      repository.findById.mockResolvedValue(makeVendor());
      gifts.findById.mockRejectedValue(
        new NotFoundException('Gift template x not found'),
      );

      await expect(
        sut.upsertOffering(
          'vendor-1',
          'x',
          withFields(UpsertOfferingDto, { vendorPrice: 100 }),
          STAFF,
          META,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('upserts with safe defaults (available, NOT approved) and audits', async () => {
      repository.findById.mockResolvedValue(makeVendor());
      gifts.findById.mockResolvedValue(GIFT);
      repository.upsertOffering.mockResolvedValue({
        vendor_id: 'vendor-1',
        gift_template_id: 'gift-1',
        vendor_price: 560000,
        available_zones: null,
        available: true,
        approved: false,
        gift_templates: { name: GIFT.name, base_price: GIFT.base_price },
      });

      const result = await sut.upsertOffering(
        'vendor-1',
        'gift-1',
        withFields(UpsertOfferingDto, { vendorPrice: 560000 }),
        STAFF,
        META,
      );

      expect(repository.upsertOffering).toHaveBeenCalledWith({
        vendor_id: 'vendor-1',
        gift_template_id: 'gift-1',
        vendor_price: 560000,
        available_zones: null,
        available: true,
        approved: false, // an offering is never approved by omission
      });
      expect(result.approved).toBe(false);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'vendor_offering.upserted',
          resourceId: 'vendor-1',
        }),
      );
    });

    it('404s removing an offering that does not exist, and audits a real removal', async () => {
      repository.findById.mockResolvedValue(makeVendor());

      repository.deleteOffering.mockResolvedValueOnce(false);
      await expect(
        sut.removeOffering('vendor-1', 'gift-1', STAFF, META),
      ).rejects.toThrow(NotFoundException);
      expect(audit.record).not.toHaveBeenCalled();

      repository.deleteOffering.mockResolvedValueOnce(true);
      await sut.removeOffering('vendor-1', 'gift-1', STAFF, META);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'vendor_offering.removed' }),
      );
    });
  });
});
