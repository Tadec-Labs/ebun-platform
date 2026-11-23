import { BadRequestException, Injectable } from '@nestjs/common';
import { CitiesRepository, CityRow } from './cities.repository';
import { CityRequestDto } from './dto/city-request.dto';

/** What the sender's city picker shows. */
export interface CityView {
  slug: string;
  name: string;
  state: string | null;
}

/** How long a "tell me when you open" contact is kept (NDPA retention). */
export const CONTACT_RETENTION_MONTHS = 12;

/** Slugs are lower-case words joined by hyphens: 'akure', 'port-harcourt'. */
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function isCitySlug(value: unknown): value is string {
  return (
    typeof value === 'string' && value.length <= 40 && SLUG_PATTERN.test(value)
  );
}

@Injectable()
export class CitiesService {
  constructor(private readonly repository: CitiesRepository) {}

  /** The cities a sender can choose today. */
  async listLive(): Promise<CityView[]> {
    const rows = await this.repository.listAll();
    return rows.filter((row) => row.live).map(toView);
  }

  /**
   * Throws unless this is a city SendEbun is open in. Used before money
   * moves: an order for a city we don't serve is refused at checkout,
   * never discovered after payment.
   */
  async requireLive(slug: string): Promise<CityRow> {
    const city = isCitySlug(slug)
      ? await this.repository.findBySlug(slug)
      : null;
    if (!city?.live) {
      throw new BadRequestException(
        "We don't deliver gifts in that city yet. Choose another city, or tell us where they are and we'll let you know when we arrive.",
      );
    }
    return city;
  }

  /**
   * The city a shop is filed under. Given: it must be a city we know
   * (live or not — a shop can be signed before its city opens). Not
   * given: the one live city, while there is exactly one; otherwise ops
   * must choose.
   */
  async resolveShopCity(slug: string | undefined): Promise<string> {
    if (slug) {
      const city = isCitySlug(slug)
        ? await this.repository.findBySlug(slug)
        : null;
      if (!city) throw new BadRequestException('Choose a city from the list.');
      return city.slug;
    }
    const live = (await this.repository.listAll()).filter((c) => c.live);
    if (live.length !== 1) {
      throw new BadRequestException('Choose the city this shop serves.');
    }
    return live[0].slug;
  }

  /**
   * NDPA retention: a contact left on "tell me when you open" is kept
   * for 12 months, then cleared. Run daily by CityRequestRetentionJob.
   */
  async applyContactRetention(now = new Date()): Promise<number> {
    const cutoff = new Date(now);
    cutoff.setUTCMonth(cutoff.getUTCMonth() - CONTACT_RETENTION_MONTHS);
    return this.repository.forgetContactsBefore(cutoff);
  }

  /**
   * Records demand we can't serve yet. Always the same answer, and a
   * tripped honeypot is accepted silently, so the form teaches a bot
   * nothing.
   */
  async recordRequest(dto: CityRequestDto): Promise<{ received: true }> {
    if (dto.website) return { received: true };
    await this.repository.recordRequest({
      city: dto.city,
      contact: dto.contact ?? null,
      source: dto.source ?? 'send',
    });
    return { received: true };
  }
}

function toView(row: CityRow): CityView {
  return { slug: row.slug, name: row.name, state: row.state };
}
