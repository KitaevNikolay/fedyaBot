import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TextRuService } from './text-ru.service';

@Module({
  imports: [ConfigModule, HttpModule],
  providers: [TextRuService],
  exports: [TextRuService],
})
export class TextRuModule {}
