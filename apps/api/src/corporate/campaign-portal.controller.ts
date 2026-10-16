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
  Put,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { NoStoreInterceptor } from '../common/no-store.interceptor';
import { MAX_MEDIA_BYTES } from '../media/message-media.service';
import type { UploadedMedia } from '../media/message-media.service';
import { CampaignPortalGuard, campaignOf } from './campaign-portal.guard';
import type { CampaignRequest } from './campaign-portal.guard';
import { CampaignsService } from './campaigns.service';
import { CampaignSendingService } from './campaign-sending.service';
import {
  AddRecipientsDto,
  CampaignMessageMediaDto,
  SetCampaignGiftsDto,
  UpdateCampaignDetailsDto,
} from './dto/campaign.dto';

/**
 * The company's own link: set up, pay, then follow the campaign.
 *
 * Everything is scoped to the one campaign the token names. Edits are
 * refused once checkout starts (CampaignsService.assertDraft), so what
 * Paystack charges is exactly what was on screen.
 */
@Controller('company')
@UseGuards(CampaignPortalGuard)
@UseInterceptors(NoStoreInterceptor)
@Throttle({ default: { limit: 60, ttl: 60_000 } })
export class CampaignPortalController {
  constructor(
    private readonly campaigns: CampaignsService,
    private readonly sending: CampaignSendingService,
  ) {}

  @Get()
  view(@Req() request: CampaignRequest) {
    return this.campaigns.view(campaignOf(request));
  }

  /** Gifts they can offer. */
  @Get('gifts')
  catalogue() {
    return this.campaigns.catalogue();
  }

  @Patch()
  update(
    @Req() request: CampaignRequest,
    @Body() dto: UpdateCampaignDetailsDto,
  ) {
    return this.campaigns.updateDetails(campaignOf(request), dto);
  }

  /** A voice note or short video from whoever is sending it. */
  @Post('message')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseInterceptors(
    FileInterceptor('media', {
      limits: { fileSize: MAX_MEDIA_BYTES.video, files: 1 },
    }),
  )
  setMessage(
    @Req() request: CampaignRequest,
    @Body() dto: CampaignMessageMediaDto,
    @UploadedFile() media?: UploadedMedia,
  ) {
    return this.campaigns.setMessageMedia(
      campaignOf(request),
      dto.kind,
      media,
      dto.durationSecs,
    );
  }

  @Delete('message')
  clearMessage(@Req() request: CampaignRequest) {
    return this.campaigns.clearMessageMedia(campaignOf(request));
  }

  @Put('gifts')
  setGifts(@Req() request: CampaignRequest, @Body() dto: SetCampaignGiftsDto) {
    return this.campaigns.setGifts(campaignOf(request), dto.giftTemplateIds);
  }

  @Get('people')
  people(@Req() request: CampaignRequest) {
    return this.campaigns.recipients(campaignOf(request)).then((rows) =>
      rows.map((r) => ({
        id: r.id,
        name: r.name,
        phone: r.phone,
        email: r.email,
        note: r.note,
      })),
    );
  }

  @Post('people')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  addPeople(@Req() request: CampaignRequest, @Body() dto: AddRecipientsDto) {
    return this.campaigns.addRecipients(campaignOf(request), dto.list);
  }

  @Delete('people')
  async clearPeople(@Req() request: CampaignRequest) {
    await this.campaigns.clearRecipients(campaignOf(request));
    return { ok: true };
  }

  @Delete('people/:id')
  async removePerson(
    @Req() request: CampaignRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.campaigns.removeRecipient(campaignOf(request), id);
    return { ok: true };
  }

  @Post('checkout')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  checkout(@Req() request: CampaignRequest) {
    return this.campaigns.checkout(campaignOf(request));
  }

  /** "Change something" after starting checkout. */
  @Post('reopen')
  reopen(@Req() request: CampaignRequest) {
    return this.campaigns.reopen(campaignOf(request));
  }

  @Get('report')
  report(@Req() request: CampaignRequest) {
    return this.campaigns.report(campaignOf(request));
  }

  /** Every person's link, for HR to share however they like. */
  @Get('links.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  links(@Req() request: CampaignRequest) {
    const campaign = campaignOf(request);
    if (campaign.status !== 'paid')
      return '\uFEFFPay for the campaign first.\r\n';
    return this.sending.linkSheet(campaign);
  }

  /** Email the people whose email failed (or who had none, after it was added). */
  @Post('resend')
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  resend(@Req() request: CampaignRequest) {
    return this.sending.send(campaignOf(request), 'retry');
  }
}
