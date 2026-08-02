import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AdminGuard } from './admin.guard.js';
import { CreateInviteDto, CreateProviderDto, UpdateProviderDto } from './admin.dto.js';
import { AdminService } from './admin.service.js';

@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('providers')
  async listProviders() {
    return this.admin.listProviders();
  }

  @Post('providers')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async createProvider(@Body() dto: CreateProviderDto) {
    return this.admin.createProvider(dto);
  }

  @Patch('providers/:slug')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async updateProvider(@Param('slug') slug: string, @Body() dto: UpdateProviderDto) {
    return this.admin.updateProvider(slug, dto);
  }

  @Get('invites')
  listInvites() {
    return this.admin.listInvites();
  }

  @Post('invites')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  createInvite(@Body() dto: CreateInviteDto) {
    return this.admin.createInvite(dto);
  }

  @Get('usage')
  async usage() {
    return this.admin.usageSummary();
  }
}
