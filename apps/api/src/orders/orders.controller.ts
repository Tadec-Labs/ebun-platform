import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { MAX_MEDIA_BYTES } from '../media/message-media.service';
import type { UploadedMedia } from '../media/message-media.service';
import { CreateOrderService } from './create-order.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrdersService } from './orders.service';

@Controller('orders')
export class OrdersController {
  constructor(
    private readonly createOrderService: CreateOrderService,
    private readonly ordersService: OrdersService,
    private readonly config: ConfigService,
  ) {}

  /**
   * JSON for a written message; multipart (same fields, plus the
   * recording as `media`) for voice or video. Multer caps the file at the
   * video limit before any of it reaches a handler; the per-kind limit
   * and the real file type are checked in MessageMediaService.
   *
   * Tighter than the global throttle: each request may carry a 15 MB
   * upload, and this is a public route.
   */
  @Post()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseInterceptors(
    FileInterceptor('media', {
      limits: { fileSize: MAX_MEDIA_BYTES.video, files: 1 },
    }),
  )
  async create(
    @Body() dto: CreateOrderDto,
    @Req() request: Request,
    @UploadedFile() media?: UploadedMedia,
  ) {
    // request.ip, not any client-supplied field — see CreateOrderDto's
    // comment on why senderIp isn't part of the request body.
    return this.createOrderService.execute(dto, request.ip, media);
  }

  /**
   * Public, no auth — a sender returning from Paystack's checkout has no
   * session. The unguessable Paystack reference is the only credential,
   * same trust model as the reveal token. Returns a coarse status only
   * (see order-confirmation.ts). no-store because the frontend polls this
   * while the webhook that actually confirms payment is still in flight.
   */
  @Get('confirmation/:reference')
  @Header('Cache-Control', 'no-store')
  async confirmation(@Param('reference') reference: string) {
    const webAppBaseUrl = this.config.getOrThrow<string>('WEB_APP_BASE_URL');
    return this.ordersService.getConfirmation(reference, webAppBaseUrl);
  }
}
