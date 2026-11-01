import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  InternalServerErrorException,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { StaffGuard } from '../auth/staff.guard';
import type { StaffContext, StaffRequest } from '../auth/staff.guard';
import { StaffRoles } from '../auth/staff-roles.decorator';
import { NoStoreInterceptor } from '../common/no-store.interceptor';
import {
  AddEventItemDto,
  CashGiftDto,
  CreateEventDto,
  DeliveryAddressDto,
  PayoutAccountDto,
  RecordPayoutDto,
  ThankDto,
  UpdateEventDto,
} from './dto/event.dto';
import { EventHostGuard, eventOf } from './event-host.guard';
import type { HostRequest } from './event-host.guard';
import { EventsService } from './events.service';

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function checkSlug(slug: string): string {
  if (slug.length < 6 || slug.length > 80 || !SLUG_PATTERN.test(slug)) {
    throw new NotFoundException('No event found for this link.');
  }
  return slug;
}

/**
 * The public side: set up an event, view it, give, and the wall. No
 * accounts. Off unless EVENTS=true; cash gifts also need EVENTS_CASH=true.
 */
@Controller('events')
@UseInterceptors(NoStoreInterceptor)
export class EventsController {
  constructor(private readonly events: EventsService) {}

  /** 5 an hour per IP: each event is a row and a guest user. */
  @Post()
  @Throttle({ default: { limit: 5, ttl: 3_600_000 } })
  create(@Body() dto: CreateEventDto) {
    this.requireEnabled();
    return this.events.create(dto);
  }

  @Get(':slug')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  view(@Param('slug') slug: string) {
    this.requireEnabled();
    return this.events.publicView(checkSlug(slug));
  }

  /** Polled every few seconds by the venue screen: generous, but bounded. */
  @Get(':slug/wall')
  @Throttle({ default: { limit: 40, ttl: 60_000 } })
  wall(@Param('slug') slug: string) {
    this.requireEnabled();
    return this.events.wall(checkSlug(slug));
  }

  /** Each call opens a Paystack checkout. 20 per 10 minutes per IP. */
  @Post(':slug/cash-gifts')
  @Throttle({ default: { limit: 20, ttl: 600_000 } })
  giveCash(@Param('slug') slug: string, @Body() dto: CashGiftDto) {
    this.requireEnabled();
    if (!this.events.isCashEnabled()) throw new NotFoundException();
    return this.events.giveCash(checkSlug(slug), dto);
  }

  /** Polled by the page Paystack returns a guest to. */
  @Get(':slug/cash-gifts/:reference')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  cashGiftStatus(
    @Param('slug') slug: string,
    @Param('reference') reference: string,
  ) {
    if (!/^ebevt_[0-9a-f-]{36}$/i.test(reference)) {
      throw new NotFoundException('No such payment for this event.');
    }
    return this.events.cashGiftStatus(checkSlug(slug), reference);
  }

  private requireEnabled(): void {
    if (!this.events.isEnabled()) throw new NotFoundException();
  }
}

/**
 * The host's page, behind their own token. Not feature-flagged: an
 * event that already took gifts must stay manageable, refundable and
 * payable even if events are switched off for new ones.
 */
@Controller('host/event')
@UseGuards(EventHostGuard)
@UseInterceptors(NoStoreInterceptor)
@Throttle({ default: { limit: 60, ttl: 60_000 } })
export class EventHostController {
  constructor(private readonly events: EventsService) {}

  @Get()
  view(@Req() request: HostRequest) {
    return this.events.hostView(eventOf(request));
  }

  @Patch()
  @HttpCode(204)
  async update(
    @Req() request: HostRequest,
    @Body() dto: UpdateEventDto,
  ): Promise<void> {
    await this.events.update(eventOf(request), dto);
  }

  @Post('items')
  @Throttle({ default: { limit: 30, ttl: 600_000 } })
  addItem(@Req() request: HostRequest, @Body() dto: AddEventItemDto) {
    return this.events.addItem(eventOf(request), dto);
  }

  @Delete('items/:groupGiftId')
  removeItem(
    @Req() request: HostRequest,
    @Param('groupGiftId', ParseUUIDPipe) groupGiftId: string,
  ) {
    return this.events.removeItem(eventOf(request), groupGiftId);
  }

  /** Where the cash goes. Throttled hard: changing it re-opens verification. */
  @Put('payout-account')
  @HttpCode(204)
  @Throttle({ default: { limit: 5, ttl: 3_600_000 } })
  async payoutAccount(
    @Req() request: HostRequest,
    @Body() dto: PayoutAccountDto,
  ): Promise<void> {
    await this.events.setPayoutAccount(eventOf(request), dto);
  }

  /** One address for every doorstep gift on the list. */
  @Put('delivery-address')
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  deliveryAddress(
    @Req() request: HostRequest,
    @Body() dto: DeliveryAddressDto,
  ) {
    return this.events.setDeliveryAddress(eventOf(request), dto);
  }

  @Post('thanks')
  @HttpCode(204)
  async thank(
    @Req() request: HostRequest,
    @Body() dto: ThankDto,
  ): Promise<void> {
    await this.events.thank(eventOf(request), dto);
  }

  @Post('cancel')
  @Throttle({ default: { limit: 3, ttl: 3_600_000 } })
  cancel(@Req() request: HostRequest) {
    return this.events.cancel(eventOf(request), 'Cancelled by the host.');
  }
}

/**
 * Ops: who to verify, who to pay. Finance roles only — these screens
 * show bank account numbers in full, because staff pay them by hand.
 */
@Controller('ops/events')
@UseGuards(StaffGuard)
@StaffRoles('ebun_admin', 'ebun_finance')
@UseInterceptors(NoStoreInterceptor)
export class OpsEventsController {
  constructor(private readonly events: EventsService) {}

  @Get()
  list() {
    return this.events.opsList();
  }

  @Post(':id/verify')
  @HttpCode(204)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async verify(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: StaffRequest,
  ): Promise<void> {
    await this.events.verify(id, staffOf(request));
  }

  @Post(':id/payout')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  payout(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecordPayoutDto,
    @Req() request: StaffRequest,
  ) {
    return this.events.recordPayout(id, dto.reference, staffOf(request));
  }
}

function staffOf(request: StaffRequest): StaffContext {
  // StaffGuard always sets this before a handler runs.
  if (!request.staff) throw new InternalServerErrorException();
  return request.staff;
}
