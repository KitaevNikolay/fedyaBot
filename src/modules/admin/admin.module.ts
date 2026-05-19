import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { BothubModule } from '../bothub/bothub.module';
import { DatabaseModule } from '../../database/database.module';
import { GenerationSettingsModule } from '../generation-settings/generation-settings.module';
import { OutlineModule } from '../outline/outline.module';
import { UsersModule } from '../users/users.module';
import { AdminAnalyticsService } from './admin-analytics.service';
import { AdminGenerationSettingsService } from './admin-generation-settings.service';
import { AdminSessionService } from './admin-session.service';
import { CabinetAdminGuard } from './cabinet-admin.guard';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [
    DatabaseModule,
    UsersModule,
    GenerationSettingsModule,
    OutlineModule,
    BothubModule,
  ],
  controllers: [AdminController],
  providers: [
    AdminService,
    AdminAnalyticsService,
    AdminGenerationSettingsService,
    AdminSessionService,
    CabinetAdminGuard,
    {
      provide: APP_GUARD,
      useClass: CabinetAdminGuard,
    },
  ],
})
export class AdminModule {}
