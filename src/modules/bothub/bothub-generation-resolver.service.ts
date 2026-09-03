import { Injectable, Logger } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
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
  private readonly logger = new Logger(BothubGenerationResolverService.name);
  private readonly authorStylesPath = join(
    process.cwd(),
    'config',
    'bothub',
    'author_styles_map.json',
  );

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

  /**
   * Описание авторского стиля из коллекции «Федя бот стилистические промпты».
   * Тексты стилей вынесены из системного промпта статьи, чтобы их правили
   * отдельно от инструкций по генерации.
   */
  async getAuthorStyle(
    authorCode?: string | null,
    userContext?: Record<string, unknown>,
  ): Promise<string> {
    if (!authorCode || authorCode === 'none') {
      return '';
    }

    const documentId = this.readAuthorStyleMap()[authorCode];
    if (!documentId) {
      this.logger.warn(`Стиль автора ${authorCode} не найден в карте стилей`);
      return '';
    }

    const style = await this.outlineService.getPromptById(
      documentId,
      userContext,
    );
    if (!style) {
      this.logger.warn(`Не удалось загрузить стиль автора ${authorCode}`);
      return '';
    }

    return style.trim();
  }

  private readAuthorStyleMap(): Record<string, string> {
    try {
      const raw = readFileSync(this.authorStylesPath, 'utf-8');
      const parsed = JSON.parse(raw) as unknown;
      return parsed && typeof parsed === 'object'
        ? (parsed as Record<string, string>)
        : {};
    } catch (error) {
      this.logger.warn(`Карта стилей авторов недоступна: ${error}`);
      return {};
    }
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
