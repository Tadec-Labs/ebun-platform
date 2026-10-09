import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { OrderStatus } from '@ebun/types';

/** Hard ceiling on page size — an unbounded ops list is a slow query waiting to happen. */
export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 50;

/**
 * Query string for GET /ops/orders.
 *
 * The global ValidationPipe runs with `transform: true` and
 * `whitelist: true`, so everything arrives as a string and anything not
 * declared here is stripped. The @Transform hooks below exist because
 * query strings have no types: `?status=paid&status=refunded` gives an
 * array, `?status=paid` gives a bare string, and both must end up as an
 * array of validated enum members.
 */
export class ListOrdersQueryDto {
  /** Repeatable: ?status=paid&status=processing */
  @IsOptional()
  @Transform(({ value }): unknown =>
    value === undefined || Array.isArray(value) ? value : [value],
  )
  @IsArray()
  @IsEnum(OrderStatus, { each: true })
  status?: OrderStatus[];

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

  /**
   * Free text, matched against order number, recipient name and
   * recipient phone. Capped short: this feeds an ILIKE with leading and
   * trailing wildcards, which cannot use an index, and a 500-character
   * term is not a search anyone is performing on purpose.
   */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  search?: string;

  /** `?stuck=true` — only orders the stuck-fulfilment sweep would flag. */
  @IsOptional()
  @Transform(({ value }): unknown => value === 'true' || value === true)
  stuck?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
