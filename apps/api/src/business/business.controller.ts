import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { BusinessGuard, type BusinessRequest } from './business.guard';
import { BusinessService } from './business.service';
import {
  CreateBusinessCampaignDto,
  CreateCompanyDto,
  InviteMemberDto,
  UpdateCompanyDto,
} from './dto/business.dto';

/**
 * Signed-in company accounts. Everything is behind BusinessGuard; the
 * service decides whether the caller is a member or an owner.
 */
@Controller('business')
@UseGuards(BusinessGuard)
export class BusinessController {
  constructor(private readonly business: BusinessService) {}

  @Get('me')
  @Header('Cache-Control', 'no-store')
  me(@Req() req: BusinessRequest) {
    return this.business.me(req.business!);
  }

  @Post('company')
  @Throttle({ default: { limit: 5, ttl: 3_600_000 } })
  createCompany(@Req() req: BusinessRequest, @Body() dto: CreateCompanyDto) {
    return this.business.createCompany(req.business!, dto);
  }

  @Patch('company')
  updateCompany(@Req() req: BusinessRequest, @Body() dto: UpdateCompanyDto) {
    return this.business.updateCompany(req.business!, dto);
  }

  @Get('members')
  @Header('Cache-Control', 'no-store')
  members(@Req() req: BusinessRequest) {
    return this.business.members(req.business!);
  }

  // Each invite sends an email from our domain.
  @Post('members')
  @Throttle({ default: { limit: 20, ttl: 3_600_000 } })
  invite(@Req() req: BusinessRequest, @Body() dto: InviteMemberDto) {
    return this.business.invite(req.business!, dto);
  }

  @Delete('members/:id')
  remove(
    @Req() req: BusinessRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.business.removeMember(req.business!, id);
  }

  @Get('campaigns')
  @Header('Cache-Control', 'no-store')
  campaigns(@Req() req: BusinessRequest) {
    return this.business.listCampaigns(req.business!);
  }

  @Post('campaigns')
  @Header('Cache-Control', 'no-store')
  createCampaign(
    @Req() req: BusinessRequest,
    @Body() dto: CreateBusinessCampaignDto,
  ) {
    return this.business.createCampaign(req.business!, dto);
  }

  @Post('campaigns/:id/open')
  @Header('Cache-Control', 'no-store')
  open(
    @Req() req: BusinessRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.business.openCampaign(req.business!, id);
  }
}
