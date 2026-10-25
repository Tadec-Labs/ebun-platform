import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { NoStoreInterceptor } from '../common/no-store.interceptor';
import {
  ContributeDto,
  CreateGroupGiftDto,
  ExtendGroupGiftDto,
  SwitchGroupGiftDto,
} from './dto/group-gift.dto';
import {
  GroupGiftOrganiserGuard,
  groupGiftOf,
} from './group-gift-organiser.guard';
import type { OrganiserRequest } from './group-gift-organiser.guard';
import { GroupGiftsService } from './group-gifts.service';

/**
 * The public side: start a pot, look at one, chip in. No accounts — the
 * share token is the whole credential for looking and paying, and grants
 * nothing else. Creating and contributing are off unless GROUP_GIFTING=true.
 */
@Controller('group-gifts')
@UseInterceptors(NoStoreInterceptor)
export class GroupGiftsController {
  constructor(private readonly groupGifts: GroupGiftsService) {}

  /** 10 an hour per IP: each pot is a row and a guest user. */
  @Post()
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  create(@Body() dto: CreateGroupGiftDto) {
    this.requireEnabled();
    return this.groupGifts.create(dto);
  }

  @Get(':token')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  view(@Param('token', new ParseUUIDPipe()) token: string) {
    return this.groupGifts.publicView(token);
  }

  /** Each call opens a Paystack checkout. 20 per 10 minutes per IP. */
  @Post(':token/contributions')
  @Throttle({ default: { limit: 20, ttl: 600_000 } })
  contribute(
    @Param('token', new ParseUUIDPipe()) token: string,
    @Body() dto: ContributeDto,
  ) {
    this.requireEnabled();
    return this.groupGifts.contribute(token, dto);
  }

  private requireEnabled(): void {
    if (!this.groupGifts.isEnabled()) throw new NotFoundException();
  }
}

/**
 * The organiser's page, behind their own token. Not feature-flagged: a
 * pot already collecting must stay manageable — and refundable — even
 * if group gifting is switched off for new pots.
 */
@Controller('organiser/group-gift')
@UseGuards(GroupGiftOrganiserGuard)
@UseInterceptors(NoStoreInterceptor)
@Throttle({ default: { limit: 30, ttl: 60_000 } })
export class GroupGiftOrganiserController {
  constructor(private readonly groupGifts: GroupGiftsService) {}

  @Get()
  view(@Req() request: OrganiserRequest) {
    return this.groupGifts.organiserView(groupGiftOf(request));
  }

  @Post('extend')
  @HttpCode(204)
  async extend(
    @Req() request: OrganiserRequest,
    @Body() dto: ExtendGroupGiftDto,
  ): Promise<void> {
    await this.groupGifts.extend(groupGiftOf(request), dto);
  }

  @Post('switch')
  switchGift(
    @Req() request: OrganiserRequest,
    @Body() dto: SwitchGroupGiftDto,
  ) {
    return this.groupGifts.switchGift(groupGiftOf(request), dto);
  }

  @Post('cancel')
  cancel(@Req() request: OrganiserRequest) {
    return this.groupGifts.cancel(groupGiftOf(request));
  }
}
