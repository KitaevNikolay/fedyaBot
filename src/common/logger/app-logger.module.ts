import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { AppLoggerService } from './app-logger.service';
import { LogAnalyticsService } from './log-analytics.service';

@Global()
@Module({
  imports: [DatabaseModule],
  providers: [AppLoggerService, LogAnalyticsService],
  exports: [AppLoggerService, LogAnalyticsService],
})
export class AppLoggerModule {}
