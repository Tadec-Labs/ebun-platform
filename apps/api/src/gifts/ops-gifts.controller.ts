import {
  Body,
  Controller,
  Get,
  InternalServerErrorException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { StaffGuard } from '../auth/staff.guard';
import type { StaffContext, StaffRequest } from '../auth/staff.guard';
import { StaffRoles } from '../auth/staff-roles.decorator';
import { NoStoreInterceptor } from '../common/no-store.interceptor';
import {
  CreateGiftTemplateDto,
  UpdateGiftTemplateDto,
} from './dto/gift-template.dto';
import { OpsGiftsService } from './ops-gifts.service';
import type { RequestMeta } from './ops-gifts.service';

/**
 * Ops-only catalogue management. Restricted to the same two roles that
 * can edit vendors: what is on sale and for how much is a commercial
 * decision, and base_price is what every sender is charged.
 *
 * Deliberately no DELETE. Orders reference gift_template_id forever, and
 * fulfilment looks the template up long after the sale — a deleted row
 * would orphan paid orders and break the audit trail. Taking a gift off
 * sale is `available: false`, which is what the public catalogue reads.
 */
@Controller('ops/gifts')
@UseGuards(StaffGuard)
@StaffRoles('ebun_admin', 'ebun_ops')
@UseInterceptors(NoStoreInterceptor)
export class OpsGiftsController {
  constructor(private readonly gifts: OpsGiftsService) {}

  @Get()
  list() {
    return this.gifts.list();
  }

  @Post()
  create(@Body() dto: CreateGiftTemplateDto, @Req() request: StaffRequest) {
    return this.gifts.create(dto, staffOf(request), metaOf(request));
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.gifts.get(id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateGiftTemplateDto,
    @Req() request: StaffRequest,
  ) {
    return this.gifts.update(id, dto, staffOf(request), metaOf(request));
  }
}

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
