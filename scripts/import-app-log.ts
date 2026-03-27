import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { AppLoggerModule } from '../src/common/logger/app-logger.module';
import { LogAnalyticsService } from '../src/common/logger/log-analytics.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath:
        process.env.NODE_ENV === 'production' ? '.env.prod' : '.env.dev',
    }),
    AppLoggerModule,
  ],
})
class AnalyticsImportModule {}

async function bootstrap() {
  const filePath = process.argv[2];

  if (!filePath) {
    throw new Error('Log file path is required');
  }

  const app = await NestFactory.createApplicationContext(AnalyticsImportModule, {
    logger: ['error', 'warn'],
  });

  try {
    const service = app.get(LogAnalyticsService);
    const result = await service.importFile(filePath);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await app.close();
  }
}

void bootstrap();
