import { Body, Controller, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { CreateOrderService } from './create-order.service';
import { CreateOrderDto } from './dto/create-order.dto';

@Controller('orders')
export class OrdersController {
  constructor(private readonly createOrderService: CreateOrderService) {}

  @Post()
  async create(@Body() dto: CreateOrderDto, @Req() request: Request) {
    // request.ip, not any client-supplied field — see CreateOrderDto's
    // comment on why senderIp isn't part of the request body.
    return this.createOrderService.execute(dto, request.ip);
  }
}
