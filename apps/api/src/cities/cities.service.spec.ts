import { BadRequestException } from '@nestjs/common';
import { CitiesRepository, CityRow } from './cities.repository';
import { CitiesService, isCitySlug } from './cities.service';

function city(overrides: Partial<CityRow> = {}): CityRow {
  return {
    slug: 'akure',
    name: 'Akure',
    state: 'Ondo',
    live: true,
    sort_order: 10,
    ...overrides,
  };
}

describe('CitiesService', () => {
  let repository: {
    listAll: jest.Mock;
    findBySlug: jest.Mock;
    recordRequest: jest.Mock;
    forgetContactsBefore: jest.Mock;
  };
  let sut: CitiesService;

  beforeEach(() => {
    repository = {
      listAll: jest
        .fn()
        .mockResolvedValue([
          city(),
          city({ slug: 'ibadan', name: 'Ibadan', live: false }),
        ]),
      findBySlug: jest.fn((slug: string) =>
        Promise.resolve(
          slug === 'akure'
            ? city()
            : slug === 'ibadan'
              ? city({ slug, live: false })
              : null,
        ),
      ),
      recordRequest: jest.fn().mockResolvedValue(undefined),
      forgetContactsBefore: jest.fn().mockResolvedValue(2),
    };
    sut = new CitiesService(repository as unknown as CitiesRepository);
  });

  it('lists only the cities a sender can choose today', async () => {
    expect(await sut.listLive()).toEqual([
      { slug: 'akure', name: 'Akure', state: 'Ondo' },
    ]);
  });

  it('refuses a known-but-closed city and a malformed slug at checkout', async () => {
    await expect(sut.requireLive('akure')).resolves.toMatchObject({
      slug: 'akure',
    });
    await expect(sut.requireLive('ibadan')).rejects.toThrow(
      BadRequestException,
    );
    await expect(sut.requireLive('DROP TABLE')).rejects.toThrow(
      BadRequestException,
    );
    expect(repository.findBySlug).not.toHaveBeenCalledWith('DROP TABLE');
  });

  it('files a shop in the one live city when none is given, or in a known city', async () => {
    await expect(sut.resolveShopCity(undefined)).resolves.toBe('akure');
    await expect(sut.resolveShopCity('ibadan')).resolves.toBe('ibadan');
    await expect(sut.resolveShopCity('lagos')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('accepts a honeypot submission silently without storing it', async () => {
    await expect(
      sut.recordRequest({ city: 'Ibadan', website: 'http://spam' }),
    ).resolves.toEqual({ received: true });
    expect(repository.recordRequest).not.toHaveBeenCalled();
  });

  it('clears contacts older than 12 months', async () => {
    const cleared = await sut.applyContactRetention(
      new Date('2027-11-23T00:00:00Z'),
    );

    expect(cleared).toBe(2);
    expect(repository.forgetContactsBefore).toHaveBeenCalledWith(
      new Date('2026-11-23T00:00:00Z'),
    );
  });

  it('knows a slug when it sees one', () => {
    expect(isCitySlug('port-harcourt')).toBe(true);
    expect(isCitySlug('Port Harcourt')).toBe(false);
    expect(isCitySlug(42)).toBe(false);
  });
});
