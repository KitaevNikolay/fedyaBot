import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { CabinetAppModule } from './cabinet-app.module';
import { AppLoggerService } from './common/logger/app-logger.service';

async function bootstrap() {
  const app = await NestFactory.create(CabinetAppModule);
  const appLogger = app.get(AppLoggerService);

  process.on('unhandledRejection', reason => {
    void appLogger.log({
      type: 'process_error',
      event: 'unhandledRejection',
      reason: reason instanceof Error ? reason.message : String(reason),
    });
  });

  process.on('uncaughtException', error => {
    void appLogger.log({
      type: 'process_error',
      event: 'uncaughtException',
      error: error.message,
      stack: error.stack,
    });
  });

  app.enableCors({
    origin: true,
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
    }),
  );

  await app.init();
  await app.listen(process.env.CABINET_PORT ?? 3001);
}

void bootstrap();
