import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { json, Request, Response } from 'express';
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

  // Вебхук Яндекс Мессенджера. Сервер Яндекса ждёт ответ не дольше секунды,
  // поэтому отвечаем сразу, а обновления обрабатываем в фоне; повторные
  // доставки одного update_id отсекает дедупликация в BotService.
  const webhookUrl = configService.get<string>('YANDEX_WEBHOOK_URL');
  if (webhookUrl) {
    const webhookPath = new URL(webhookUrl).pathname;
    app.use(
      webhookPath,
      json({ limit: '2mb' }),
      (req: Request, res: Response) => {
        if (req.method !== 'POST') {
          res.status(405).json({ ok: false, description: 'POST expected' });
          return;
        }
        const botService = app.get(BotService);
        const accepted = botService.getBot().handleWebhookBody(req.body);
        res.status(200).json({ ok: true, accepted });
      },
    );
  }
  await app.init();
  await app.listen(process.env.BOT_PORT ?? process.env.PORT ?? 3000);
}
void bootstrap();
