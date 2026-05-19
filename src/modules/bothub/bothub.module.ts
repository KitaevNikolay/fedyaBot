import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { GenerationSettingsModule } from '../generation-settings/generation-settings.module';
import { OutlineModule } from '../outline/outline.module';
import { BothubApiClientService } from './bothub-api-client.service';
import { BothubGenerationResolverService } from './bothub-generation-resolver.service';
import { BothubRuntimeConfigService } from './bothub-runtime-config.service';
import { BothubService } from './bothub.service';

@Module({
  imports: [ConfigModule, HttpModule, OutlineModule, GenerationSettingsModule],
  providers: [
    BothubRuntimeConfigService,
    BothubGenerationResolverService,
    BothubApiClientService,
    BothubService,
  ],
  exports: [BothubService],
})
export class BothubModule {}
