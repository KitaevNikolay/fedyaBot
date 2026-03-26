import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFileSync } from 'fs';
import { join } from 'path';
import { BothubConfig } from './bothub.types';

@Injectable()
export class BothubRuntimeConfigService {
  private readonly logger = new Logger(BothubRuntimeConfigService.name);
  private readonly config: BothubConfig;
  private readonly apiKey: string;
  private readonly apiBaseUrl = 'https://bothub.chat/api/v2';

  constructor(private readonly configService: ConfigService) {
    const configPath = join(process.cwd(), 'config', 'bothub', 'config.json');
    const rawConfig = readFileSync(configPath, 'utf-8');
    this.config = JSON.parse(rawConfig) as BothubConfig;

    const apiKey = this.configService.get<string>('BOTHUB_API_KEY');
    if (!apiKey) {
      this.logger.error('BOTHUB_API_KEY is not defined');
      throw new Error('BOTHUB_API_KEY is not defined');
    }

    this.apiKey = apiKey;
  }

  getApiBaseUrl() {
    return this.apiBaseUrl;
  }

  getApiKey() {
    return this.apiKey;
  }

  getApiConfig() {
    return this.config.api;
  }

  getPromptTemplates() {
    return this.config.prompts as Record<string, string>;
  }

  getConfig() {
    return this.config;
  }

  isMockMode() {
    return this.configService.get<string>('BOTHUB_MOCK_MODE') === 'true';
  }
}
