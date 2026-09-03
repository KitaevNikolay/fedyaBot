import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { GenerationSettingsModule } from '../generation-settings/generation-settings.module';
import { OutlineModule } from '../outline/outline.module';
import { BothubApiClientService } from './bothub-api-client.service';
import { BothubGenerationResolverService } from './bothub-generation-resolver.service';
import { BothubRuntimeConfigService } from './bothub-runtime-config.service';
import { BothubService } from './bothub.service';

// Страховка на случай запроса без явного timeout: генерация статьи в
// BothubApiClientService и так ограничена 30 минутами на вызов.
const BOTHUB_HTTP_TIMEOUT_MS = 1_800_000;

@Module({
  imports: [
    ConfigModule,
    HttpModule.register({ timeout: BOTHUB_HTTP_TIMEOUT_MS }),
    OutlineModule,
    GenerationSettingsModule,
  ],
  providers: [
    BothubRuntimeConfigService,
    BothubGenerationResolverService,
    BothubApiClientService,
    BothubService,
  ],
  exports: [BothubService],
})
export class BothubModule {}
