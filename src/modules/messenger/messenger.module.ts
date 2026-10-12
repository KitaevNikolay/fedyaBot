import { Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MessengerTransport } from './messenger-transport';
import { TelegramBotApiService } from './telegram-bot-api.service';
import { YandexMessengerApiService } from './yandex-messenger-api.service';

/**
 * MESSENGER_PLATFORM=telegram временно возвращает бота в Telegram
 * (TELEGRAM_BOT_TOKEN), по умолчанию — Яндекс Мессенджер (YANDEX_BOT_TOKEN).
 */
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: MessengerTransport,
      inject: [ConfigService],
      useFactory: (configService: ConfigService): MessengerTransport => {
        const platform = (
          configService.get<string>('MESSENGER_PLATFORM') ?? 'yandex'
        )
          .trim()
          .toLowerCase();
        if (platform === 'telegram') {
          new Logger('MessengerModule').log('Messenger platform: Telegram');
          return new TelegramBotApiService(configService);
        }
        if (platform !== 'yandex') {
          throw new Error(
            `Unknown MESSENGER_PLATFORM "${platform}": expected yandex or telegram`,
          );
        }
        return new YandexMessengerApiService(configService);
      },
    },
  ],
  exports: [MessengerTransport],
})
export class MessengerModule {}
