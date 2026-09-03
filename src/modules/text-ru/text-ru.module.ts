import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TextRuService } from './text-ru.service';

// text.ru проверяет уникальность асинхронно: запросы короткие, ответа ждём
// не дольше минуты, иначе фоновый опрос уникальности встанет намертво.
const TEXT_RU_HTTP_TIMEOUT_MS = 60_000;

@Module({
  imports: [
    ConfigModule,
    HttpModule.register({ timeout: TEXT_RU_HTTP_TIMEOUT_MS }),
  ],
  providers: [TextRuService],
  exports: [TextRuService],
})
export class TextRuModule {}
