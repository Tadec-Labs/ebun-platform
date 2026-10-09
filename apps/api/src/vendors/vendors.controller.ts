import {
  Body,
  Controller,
  Delete,
  Get,
  InternalServerErrorException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { StaffGuard } from '../auth/staff.guard';
import type { StaffContext, StaffRequest } from '../auth/staff.guard';
import { StaffRoles } from '../auth/staff-roles.decorator';
import { NoStoreInterceptor } from '../common/no-store.interceptor';
import {
  CreateVendorDto,
  UpdateVendorDto,
  UpsertOfferingDto,
} from './dto/vendor.dto';
import { VendorsService } from './vendors.service';
import type { RequestMeta } from './vendors.service';

function staffOf(request: StaffRequest): StaffContext {
  // StaffGuard always sets this before a handler runs; reaching here
  // without it means the guard was removed from this controller.
  if (!request.staff) {
    throw new InternalServerErrorException();
  }
  return request.staff;
}

function metaOf(request: StaffRequest): RequestMeta {
  return {
    ipAddress: request.ip ?? null,
    userAgent: request.headers['user-agent'] ?? null,
  };
}

/**
 * Ops-only. Vendor records carry bank details, so this is restricted to
 * ebun_admin / ebun_ops (finance/support can't edit vendors) and every
 * response is uncacheable.
 */
@Controller('ops/vendors')
@UseGuards(StaffGuard)
@StaffRoles('ebun_admin', 'ebun_ops')
@UseInterceptors(NoStoreInterceptor)
export class VendorsController {
  constructor(private readonly vendors: VendorsService) {}

  @Get()
  list() {
    return this.vendors.list();
  }

  @Post()
  create(@Body() dto: CreateVendorDto, @Req() request: StaffRequest) {
    return this.vendors.create(dto, staffOf(request), metaOf(request));
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.vendors.get(id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateVendorDto,
    @Req() request: StaffRequest,
  ) {
    return this.vendors.update(id, dto, staffOf(request), metaOf(request));
  }

  /**
   * POST, not GET: this replaces a working credential with a new one,
   * which is a change to the world and must never be something a
   * prefetch or a refresh can trigger by accident.
   */
  @Post(':id/portal-token/rotate')
  rotatePortalToken(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: StaffRequest,
  ) {
    return this.vendors.rotatePortalToken(
      id,
      staffOf(request),
      metaOf(request),
    );
  }

  @Get(':id/offerings')
  listOfferings(@Param('id', ParseUUIDPipe) id: string) {
    return this.vendors.listOfferings(id);
  }

  @Put(':id/offerings/:giftTemplateId')
  upsertOffering(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('giftTemplateId', ParseUUIDPipe) giftTemplateId: string,
    @Body() dto: UpsertOfferingDto,
    @Req() request: StaffRequest,
  ) {
    return this.vendors.upsertOffering(
      id,
      giftTemplateId,
      dto,
      staffOf(request),
      metaOf(request),
    );
  }

  @Delete(':id/offerings/:giftTemplateId')
  async removeOffering(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('giftTemplateId', ParseUUIDPipe) giftTemplateId: string,
    @Req() request: StaffRequest,
  ) {
    await this.vendors.removeOffering(
      id,
      giftTemplateId,
      staffOf(request),
      metaOf(request),
    );
    return { removed: true };
  }
}
