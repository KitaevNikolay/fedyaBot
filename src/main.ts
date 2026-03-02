import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { webhookCallback } from 'grammy';
import { json, NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';
import { AppLoggerService } from './common/logger/app-logger.service';
import { BotService } from './modules/bot/bot.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const appLogger = app.get(AppLoggerService);
  const configService = app.get(ConfigService);
  process.on('unhandledRejection', (reason) => {
    void appLogger.log({
      type: 'process_error',
      event: 'unhandledRejection',
      reason: reason instanceof Error ? reason.message : String(reason),
    });
  });
  process.on('uncaughtException', (error) => {
    void appLogger.log({
      type: 'process_error',
      event: 'uncaughtException',
      error: error.message,
      stack: error.stack,
    });
  });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
    }),
  );
  const webhookUrl = configService.get<string>('TELEGRAM_WEBHOOK_URL');
  if (webhookUrl) {
    const webhookPath = new URL(webhookUrl).pathname;
    const jsonParser = json();
    type WebhookHandler = (
      req: Request,
      res: Response,
      next?: NextFunction,
    ) => unknown;
    let handler: WebhookHandler | null = null;
    app.use(
      webhookPath,
      jsonParser,
      (req: Request, res: Response, next: NextFunction) => {
      if (!handler) {
        const botService = app.get(BotService);
        handler = webhookCallback(
          botService.getBot(),
          'express',
        ) as WebhookHandler;
      }
      return handler(req, res, next);
      },
    );
  }
  await app.init();
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
