import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { GenerationSettingsModule } from '../generation-settings/generation-settings.module';
import { OutlineModule } from '../outline/outline.module';
import { BothubService } from './bothub.service';

@Module({
  imports: [ConfigModule, HttpModule, OutlineModule, GenerationSettingsModule],
  providers: [BothubService],
  exports: [BothubService],
})
export class BothubModule {}
