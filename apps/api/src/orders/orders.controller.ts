import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { CreateOrderService } from './create-order.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrdersService } from './orders.service';

@Controller('orders')
export class OrdersController {
  constructor(
    private readonly createOrderService: CreateOrderService,
    private readonly ordersService: OrdersService,
  ) {}

  @Post()
  async create(@Body() dto: CreateOrderDto, @Req() request: Request) {
    // request.ip, not any client-supplied field — see CreateOrderDto's
    // comment on why senderIp isn't part of the request body.
    return this.createOrderService.execute(dto, request.ip);
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
    return this.ordersService.getConfirmation(reference);
  }
}
