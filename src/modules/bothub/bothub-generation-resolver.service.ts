import { Injectable } from '@nestjs/common';
import { GenerationSettingsService } from '../generation-settings/generation-settings.service';
import { OutlineService } from '../outline/outline.service';
import { BothubRuntimeConfigService } from './bothub-runtime-config.service';
import {
  ArticleSettings,
  GenerationSettingsPayload,
  ResolvedBothubPrompts,
} from './bothub.types';

@Injectable()
export class BothubGenerationResolverService {
  constructor(
    private readonly runtimeConfig: BothubRuntimeConfigService,
    private readonly outlineService: OutlineService,
    private readonly generationSettingsService: GenerationSettingsService,
  ) {}

  async getGenerationSettings(
    type: string,
  ): Promise<GenerationSettingsPayload | null> {
    const settings = await this.generationSettingsService.getByType(type);
    if (settings) {
      return settings;
    }

    return this.getFallbackSettings(type);
  }

  async getPrompts(
    type: string,
    systemPromptId: string | null,
    userPromptId: string | null,
    userContext?: Record<string, unknown>,
  ): Promise<ResolvedBothubPrompts> {
    const promptTemplates = this.runtimeConfig.getPromptTemplates();
    let userPrompt = promptTemplates[type] ?? '';
    let systemPrompt: string | null = null;

    if (userPromptId) {
      const outlinePrompt = await this.outlineService.getPromptById(
        userPromptId,
        userContext,
      );
      if (outlinePrompt) {
        userPrompt = outlinePrompt;
      }
    }

    if (systemPromptId) {
      const outlinePrompt = await this.outlineService.getPromptById(
        systemPromptId,
        userContext,
      );
      if (outlinePrompt) {
        systemPrompt = outlinePrompt;
      }
    }

    return { system: systemPrompt, user: userPrompt };
  }

  private getFallbackSettings(type: string): GenerationSettingsPayload | null {
    const config = this.runtimeConfig.getConfig();

    if (type === 'generate_article') {
      return this.mapArticleSettings(type, config.article_settings);
    }

    if (type === 'generate_fact_check') {
      return this.mapArticleSettings(type, config.fact_check_settings);
    }

    if (type === 'rewrite_article' || type === 'seo_rewrite_article') {
      return this.mapArticleSettings(
        type,
        config.rewrite_settings ?? config.article_settings,
      );
    }

    if (type === 'generate_questions') {
      return this.getDefaultApiSettings(type);
    }

    if (type === 'generate_rubrics') {
      return this.mapArticleSettings(type, config.rubric_settings);
    }

    if (type === 'generate_products') {
      return this.mapArticleSettings(type, config.product_settings);
    }

    if (type === 'article_uniqueness' || type === 'uniq_prompt') {
      return this.getDefaultApiSettings(type);
    }

    return null;
  }

  private mapArticleSettings(
    type: string,
    settings?: ArticleSettings,
  ): GenerationSettingsPayload | null {
    if (!settings) {
      return null;
    }

    return {
      type,
      model: settings.model,
      temperature: settings.temperature,
      maxTokens: settings.max_tokens,
      files: settings.files ?? [],
      systemPromptId: null,
      userPromptId: null,
      additionalPayload: null,
    };
  }

  private getDefaultApiSettings(type: string): GenerationSettingsPayload {
    const apiConfig = this.runtimeConfig.getApiConfig();

    return {
      type,
      model: apiConfig.model,
      temperature: apiConfig.temperature,
      maxTokens: apiConfig.max_tokens,
      files: [],
      systemPromptId: null,
      userPromptId: null,
      additionalPayload: null,
    };
  }
}
