import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  InternalServerErrorException,
  Post,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { PaystackWebhookService } from './paystack-webhook.service';
import { PaystackWebhookDto } from './dto/paystack-webhook.dto';

@Controller('webhooks')
export class PaymentsController {
  constructor(
    private readonly paystackWebhookService: PaystackWebhookService,
  ) {}

  @Post('paystack')
  @HttpCode(HttpStatus.OK) // 200, not the @Post default 201 — we're acknowledging an event, not creating a resource
  async paystack(
    @Req() request: RawBodyRequest<Request>,
    @Headers('x-paystack-signature') signature: string | undefined,
    @Body() body: PaystackWebhookDto,
  ): Promise<{ received: true }> {
    const rawBody = request.rawBody;

    if (!rawBody) {
      // Should be unreachable once main.ts's `rawBody: true` is set — fail loudly rather than letting signature verification run against an empty buffer and simply always return false.
      throw new InternalServerErrorException(
        'Raw request body was not captured — check NestFactory.create({ rawBody: true }) in main.ts',
      );
    }

    await this.paystackWebhookService.handle(rawBody, signature, body);

    return { received: true };
  }
}
