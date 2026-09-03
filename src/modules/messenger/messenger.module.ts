import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { YandexMessengerApiService } from './yandex-messenger-api.service';

@Module({
  imports: [ConfigModule],
  providers: [YandexMessengerApiService],
  exports: [YandexMessengerApiService],
})
export class MessengerModule {}
