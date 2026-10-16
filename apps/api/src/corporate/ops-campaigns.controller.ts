import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { StaffGuard } from '../auth/staff.guard';
import type { StaffContext, StaffRequest } from '../auth/staff.guard';
import { StaffRoles } from '../auth/staff-roles.decorator';
import { NoStoreInterceptor } from '../common/no-store.interceptor';
import { CampaignsService } from './campaigns.service';
import { CampaignsRepository } from './campaigns.repository';
import { CreateCampaignDto, UpdateCampaignTermsDto } from './dto/campaign.dto';

function staffOf(request: StaffRequest): StaffContext {
  if (!request.staff) throw new UnauthorizedException();
  return request.staff;
}

/**
 * Ops' side of company campaigns: start one for a company that said yes,
 * hand them their link, set the fee, and follow it. The company does the
 * rest on its own link.
 *
 * Finance included: they reconcile what companies paid.
 */
@Controller('ops/campaigns')
@UseGuards(StaffGuard)
@StaffRoles('ebun_admin', 'ebun_ops', 'ebun_finance')
@UseInterceptors(NoStoreInterceptor)
export class OpsCampaignsController {
  constructor(
    private readonly campaigns: CampaignsService,
    private readonly repository: CampaignsRepository,
  ) {}

  @Get()
  list() {
    return this.campaigns.list();
  }

  @Post()
  @StaffRoles('ebun_admin', 'ebun_ops')
  create(@Body() dto: CreateCampaignDto, @Req() request: StaffRequest) {
    return this.campaigns.create(staffOf(request).userId, dto);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.campaigns.getForOps(id);
  }

  @Get(':id/report')
  async report(@Param('id', ParseUUIDPipe) id: string) {
    const campaign = await this.repository.findById(id);
    if (!campaign) return null;
    return this.campaigns.report(campaign);
  }

  @Patch(':id')
  @StaffRoles('ebun_admin', 'ebun_ops')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCampaignTermsDto,
    @Req() request: StaffRequest,
  ) {
    return this.campaigns.updateTerms(staffOf(request).userId, id, dto);
  }

  @Post(':id/cancel')
  @StaffRoles('ebun_admin', 'ebun_ops')
  cancel(@Param('id', ParseUUIDPipe) id: string, @Req() request: StaffRequest) {
    return this.campaigns.cancel(staffOf(request).userId, id);
  }

  @Post(':id/rotate-link')
  @StaffRoles('ebun_admin', 'ebun_ops')
  rotate(@Param('id', ParseUUIDPipe) id: string, @Req() request: StaffRequest) {
    return this.campaigns.rotateLink(staffOf(request).userId, id);
  }
}
