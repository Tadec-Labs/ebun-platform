import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreateVendorDto,
  UpdateVendorDto,
  UpsertOfferingDto,
} from './vendor.dto';

async function errorsFor<T extends object>(
  cls: new () => T,
  plain: Record<string, unknown>,
) {
  const instance = plainToInstance(cls, plain);
  const errors = await validate(instance);
  return { instance, fields: errors.map((e) => e.property) };
}

const VALID_CREATE = {
  businessName: '  Mama Cass Kitchen  ',
  ownerName: 'Cassandra Okoye',
  whatsappNumber: '+2348012345678',
  category: 'food',
};

describe('CreateVendorDto', () => {
  it('accepts the minimal valid vendor, and trims names', async () => {
    const { instance, fields } = await errorsFor(CreateVendorDto, VALID_CREATE);
    expect(fields).toEqual([]);
    expect(instance.businessName).toBe('Mama Cass Kitchen');
  });

  it('treats blank optional fields as "not provided", not as invalid', async () => {
    const { fields } = await errorsFor(CreateVendorDto, {
      ...VALID_CREATE,
      email: '',
      accountNumber: '  ',
      bankName: '',
      notes: '',
    });
    expect(fields).toEqual([]);
  });

  it.each([
    ['whatsappNumber', '08012345678'], // local format — must be E.164
    ['whatsappNumber', '+0123456789'],
    ['category', 'electronics'],
    ['accountNumber', '12345'],
    ['accountNumber', '12345678901'],
    ['commissionRate', 1.5],
    ['commissionRate', 0],
    ['commissionRate', 0.705], // more than 2 decimal places
    ['responseTimeoutMinutes', 5],
    ['email', 'not-an-email'],
    ['backupVendorId', 'not-a-uuid'],
  ])('rejects %s = %p', async (field, value) => {
    const { fields } = await errorsFor(CreateVendorDto, {
      ...VALID_CREATE,
      [field]: value,
    });
    expect(fields).toContain(field);
  });

  it('cleans zone/area lists: trims, drops blanks, de-duplicates case-insensitively', async () => {
    const { instance, fields } = await errorsFor(CreateVendorDto, {
      ...VALID_CREATE,
      serviceAreas: ['  Lekki ', 'lekki', '', 'Yaba'],
    });
    expect(fields).toEqual([]);
    expect(instance.serviceAreas).toEqual(['Lekki', 'Yaba']);
  });
});

describe('UpdateVendorDto — undefined leaves alone, null clears', () => {
  it('accepts an empty body (the service rejects it as "no changes")', async () => {
    const { fields } = await errorsFor(UpdateVendorDto, {});
    expect(fields).toEqual([]);
  });

  it('lets nullable columns be cleared with null', async () => {
    const { fields } = await errorsFor(UpdateVendorDto, {
      email: null,
      bankName: null,
      accountNumber: null,
      notes: null,
      backupVendorId: null,
      serviceAreas: null,
    });
    expect(fields).toEqual([]);
  });

  it('turns a blank string into a clear (null) for nullable text', async () => {
    const { instance } = await errorsFor(UpdateVendorDto, { notes: '   ' });
    expect(instance.notes).toBeNull();
  });

  it.each([
    'businessName',
    'ownerName',
    'whatsappNumber',
    'category',
    'active',
    'verified',
    'commissionRate',
    'responseTimeoutMinutes',
  ])(
    'rejects null for %s — the column is NOT NULL, so a clean 400 beats a Postgres 500',
    async (field) => {
      const { fields } = await errorsFor(UpdateVendorDto, { [field]: null });
      expect(fields).toContain(field);
    },
  );
});

describe('UpsertOfferingDto', () => {
  it('accepts a kobo price and defaults', async () => {
    const { fields } = await errorsFor(UpsertOfferingDto, {
      vendorPrice: 560000,
    });
    expect(fields).toEqual([]);
  });

  it.each([0, -5, 1.5, 'abc'])('rejects vendorPrice %p', async (value) => {
    const { fields } = await errorsFor(UpsertOfferingDto, {
      vendorPrice: value,
    });
    expect(fields).toContain('vendorPrice');
  });
});
