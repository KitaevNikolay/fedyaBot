import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { OutlineService } from './outline.service';

// Outline отдаёт короткие документы-промпты: если ответа нет за 15 секунд,
// соединение зависло. Без таймаута axios ждёт вечно и генерация встаёт молча.
const OUTLINE_HTTP_TIMEOUT_MS = 15_000;

@Module({
  imports: [
    HttpModule.register({ timeout: OUTLINE_HTTP_TIMEOUT_MS }),
    ConfigModule,
  ],
  providers: [OutlineService],
  exports: [OutlineService],
})
export class OutlineModule {}
