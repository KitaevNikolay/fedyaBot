import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { AdminAnalyticsService } from './admin-analytics.service';
import {
  AdminGenerationSettingsService,
  UpdateGenerationSettingPayload,
} from './admin-generation-settings.service';
import { AdminService } from './admin.service';
import { TelegramAuthDto } from './dto/telegram-auth.dto';
import { UpdateAdminUserRoleDto } from './dto/update-admin-user-role.dto';
import { UpdateAdminUserStatusDto } from './dto/update-admin-user-status.dto';
import { PublicAdminRoute } from './public-admin-route.decorator';

@Controller('admin')
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly adminAnalyticsService: AdminAnalyticsService,
    private readonly adminGenerationSettingsService: AdminGenerationSettingsService,
  ) {}

  @Get('dashboard')
  getDashboard() {
    return this.adminService.getDashboard();
  }

  @Get('users')
  getUsers() {
    return this.adminService.getUsers();
  }

  @Get('analytics/users')
  getAnalyticsUsers() {
    return this.adminAnalyticsService.getAnalyticsUsers();
  }

  @Get('history/users')
  getHistoryUsers() {
    return this.adminAnalyticsService.getHistoryUsers();
  }

  @Get('history/users/:userId/days')
  getUserHistoryDays(@Param('userId') userId: string) {
    return this.adminAnalyticsService.getUserHistoryDays(userId);
  }

  @Get('history/users/:userId/timeline')
  getUserHistoryTimeline(
    @Param('userId') userId: string,
    @Query('date') date: string,
  ) {
    return this.adminAnalyticsService.getUserHistoryTimeline(userId, date);
  }

  @Get('analytics/users/:userId')
  getAnalyticsUserOverview(@Param('userId') userId: string) {
    return this.adminAnalyticsService.getUserOverview(userId);
  }

  @Get('analytics/sessions/:sessionId')
  getSessionEvents(@Param('sessionId') sessionId: string) {
    return this.adminAnalyticsService.getSessionEvents(sessionId);
  }

  @Get('analytics/tokens')
  getTokenAnalytics(
    @Query('granularity') granularity?: string,
    @Query('userIds') userIds?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.adminAnalyticsService.getTokenAnalytics({
      granularity,
      userIds,
      from,
      to,
    });
  }

  @Get('generation-settings')
  getGenerationSettings() {
    return this.adminGenerationSettingsService.getGenerationSettings();
  }

  @Get('generation-settings/models')
  getGenerationSettingModels() {
    return this.adminGenerationSettingsService.getAvailableModels();
  }

  @Patch('generation-settings/:type')
  updateGenerationSetting(
    @Param('type') type: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.adminGenerationSettingsService.updateGenerationSetting(
      type,
      body as UpdateGenerationSettingPayload,
    );
  }

  @Patch('users/:id/status')
  updateUserStatus(
    @Param('id') id: string,
    @Body() body: UpdateAdminUserStatusDto,
  ) {
    return this.adminService.updateUserStatus(id, body.isActive);
  }

  @Patch('users/:id/role')
  updateUserRole(
    @Param('id') id: string,
    @Body() body: UpdateAdminUserRoleDto,
  ) {
    return this.adminService.updateUserRole(id, body.role);
  }

  @Post('auth/telegram')
  @PublicAdminRoute()
  verifyTelegramAuth(@Body() body: TelegramAuthDto) {
    return this.adminService.verifyTelegramAuth(body);
  }

  @Get('auth/me')
  getCurrentAdmin(@Headers('authorization') authorization?: string) {
    const token = authorization?.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length).trim()
      : '';

    return this.adminService.getCurrentAdminUser(token);
  }
}
