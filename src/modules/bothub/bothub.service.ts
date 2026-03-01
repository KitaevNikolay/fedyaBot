import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFileSync } from 'fs';
import { join } from 'path';
import { lastValueFrom } from 'rxjs';
import { GenerationSettingsService } from '../generation-settings/generation-settings.service';
import { OutlineService } from '../outline/outline.service';
import { AppLoggerService } from '../../common/logger/app-logger.service';

interface ArticleSettings {
  model: string;
  temperature: number;
  max_tokens: number;
  files: string[];
}

interface BothubConfig {
  api: {
    url: string;
    model: string;
    temperature: number;
    max_tokens: number;
  };
  prompts: {
    generate_questions: string;
    generate_article: string;
    generate_fact_check: string;
    rewrite_article: string;
    seo_rewrite_article: string;
    generate_rubrics: string;
    generate_products: string;
  };
  article_settings?: ArticleSettings;
  fact_check_settings?: ArticleSettings;
  rewrite_settings?: ArticleSettings;
  rubric_settings?: ArticleSettings;
  product_settings?: ArticleSettings;
}

export interface GenerationResult {
  content: string;
  usage?: number;
}

interface BothubResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  usage?: {
    bothub?: {
      caps?: number;
    };
  };
}

interface BothubBalanceResponse {
  subscription?: {
    plan?: {
      type?: string;
    };
    available_balance?: number;
  };
  error?: {
    message?: string;
  };
}

type GenerationSettingsPayload = {
  model: string;
  temperature: number;
  maxTokens: number;
  files: string[];
  systemPromptId: string | null;
  userPromptId: string | null;
};

@Injectable()
export class BothubService {
  private readonly logger = new Logger(BothubService.name);
  private readonly config: BothubConfig;
  private readonly apiKey: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
    private readonly outlineService: OutlineService,
    private readonly generationSettingsService: GenerationSettingsService,
    private readonly appLogger: AppLoggerService,
  ) {
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

  async generateQuestions(
    articleSubject: string,
    userContext?: Record<string, unknown>,
  ): Promise<GenerationResult> {
    const today = new Date().toLocaleDateString('ru-RU');
    const settings = await this.getGenerationSettings('generate_questions');
    const prompts = await this.getPrompts(
      'generate_questions',
      settings?.systemPromptId ?? null,
      settings?.userPromptId ?? null,
      userContext,
    );

    const prompt = prompts.user
      .replace(/{{\s*article_subject\s*}}/g, articleSubject)
      .replace(/{{\s*today\s*}}/g, today);

    return this.sendRequest(prompt, settings, prompts.system, userContext);
  }

  async generateArticle(
    articleSubject: string,
    questionsContent: string,
    userContext?: Record<string, unknown>,
  ): Promise<GenerationResult> {
    const today = new Date().toLocaleDateString('ru-RU');
    const settings = await this.getGenerationSettings('generate_article');
    const prompts = await this.getPrompts(
      'generate_article',
      settings?.systemPromptId ?? null,
      settings?.userPromptId ?? null,
      userContext,
    );

    const prompt = prompts.user
      .replace(/{{\s*article_subject\s*}}/g, articleSubject)
      .replace(/{{\s*questions_content\s*}}/g, questionsContent)
      .replace(/{{\s*current_date\s*}}/g, today);

    return this.sendRequest(prompt, settings, prompts.system, userContext);
  }

  async generateFactCheck(
    articleSubject: string,
    articleContent: string,
    userContext?: Record<string, unknown>,
  ): Promise<GenerationResult> {
    const today = new Date().toLocaleDateString('ru-RU');
    const settings = await this.getGenerationSettings('generate_fact_check');
    const prompts = await this.getPrompts(
      'generate_fact_check',
      settings?.systemPromptId ?? null,
      settings?.userPromptId ?? null,
      userContext,
    );

    const prompt = prompts.user
      .replace(/{{\s*ARTICLE\.content\s*}}/g, articleContent)
      .replace(/{{\s*current_date\s*}}/g, today);

    return this.sendRequest(prompt, settings, prompts.system, userContext);
  }

  async rewriteArticle(
    articleSubject: string,
    articleContent: string,
    factCheckContent: string,
    userContext?: Record<string, unknown>,
  ): Promise<GenerationResult> {
    const settings = await this.getGenerationSettings('rewrite_article');
    const prompts = await this.getPrompts(
      'rewrite_article',
      settings?.systemPromptId ?? null,
      settings?.userPromptId ?? null,
      userContext,
    );

    const prompt = prompts.user
      .replace(/{{\s*article_subject\s*}}/g, articleSubject)
      .replace(/{{\s*ARTICLE\.content\s*}}/g, articleContent)
      .replace(/{{\s*FACT_CHECK\.content\s*}}/g, factCheckContent);

    return this.sendRequest(prompt, settings, prompts.system, userContext);
  }

  async seoRewriteArticle(
    articleContent: string,
    seoTzContent: string,
    userContext?: Record<string, unknown>,
  ): Promise<GenerationResult> {
    const settings = await this.getGenerationSettings('seo_rewrite_article');
    const prompts = await this.getPrompts(
      'seo_rewrite_article',
      settings?.systemPromptId ?? null,
      settings?.userPromptId ?? null,
      userContext,
    );

    const prompt = prompts.user
      .replace(/{{\s*SEO_TZ\.content\s*}}/g, seoTzContent)
      .replace(/{{\s*ARTICLE\.content\s*}}/g, articleContent);

    return this.sendRequest(prompt, settings, prompts.system, userContext);
  }

  async generateRubrics(
    articleContent: string,
    userContext?: Record<string, unknown>,
  ): Promise<GenerationResult> {
    const settings = await this.getGenerationSettings('generate_rubrics');
    const prompts = await this.getPrompts(
      'generate_rubrics',
      settings?.systemPromptId ?? null,
      settings?.userPromptId ?? null,
      userContext,
    );

    const prompt = prompts.user.replace(
      /{{\s*ARTICLE\.content\s*}}/g,
      articleContent,
    );

    return this.sendRequest(prompt, settings, prompts.system, userContext);
  }

  async generateProducts(
    articleContent: string,
    userContext?: Record<string, unknown>,
  ): Promise<GenerationResult> {
    const settings = await this.getGenerationSettings('generate_products');
    const prompts = await this.getPrompts(
      'generate_products',
      settings?.systemPromptId ?? null,
      settings?.userPromptId ?? null,
      userContext,
    );

    const prompt = prompts.user.replace(
      /{{\s*ARTICLE\.content\s*}}/g,
      articleContent,
    );

    return this.sendRequest(prompt, settings, prompts.system, userContext);
  }

  async getBalance(
    userContext?: Record<string, unknown>,
  ): Promise<{ planType: string; availableBalance: number }> {
    try {
      await this.appLogger.log({
        type: 'external_request',
        integration: 'bothub',
        method: 'GET',
        url: 'https://bothub.chat/api/v2/auth/me',
        ...userContext,
      });
      const response$ = this.httpService.get(
        'https://bothub.chat/api/v2/auth/me',
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
          },
        },
      );
      const response = await lastValueFrom(response$);
      await this.appLogger.log({
        type: 'external_response',
        integration: 'bothub',
        method: 'GET',
        url: 'https://bothub.chat/api/v2/auth/me',
        status: response.status,
        responseBody: response.data,
        ...userContext,
      });
      const data = response.data as BothubBalanceResponse;

      if (data.error?.message === 'UNAUTHORIZED') {
        this.logger.error('Bothub API unauthorized');
        throw new Error('Ошибка авторизации в Bothub');
      }

      return {
        planType: data.subscription?.plan?.type || 'Неизвестно',
        availableBalance: data.subscription?.available_balance || 0,
      };
    } catch (error) {
      this.logger.error(`Failed to get balance: ${error}`);
      const errorResponse = (
        error as { response?: { status?: number; data?: unknown } }
      ).response;
      await this.appLogger.log({
        type: 'external_error',
        integration: 'bothub',
        method: 'GET',
        url: 'https://bothub.chat/api/v2/auth/me',
        status: errorResponse?.status,
        responseBody: errorResponse?.data,
        error: error instanceof Error ? error.message : String(error),
        ...userContext,
      });
      throw error;
    }
  }

  private async sendRequest(
    userContent: string,
    settings?: GenerationSettingsPayload | null,
    systemContent?: string | null,
    userContext?: Record<string, unknown>,
  ): Promise<GenerationResult> {
    const model = settings?.model ?? this.config.api.model;
    const temperature = settings?.temperature ?? this.config.api.temperature;
    const max_tokens = settings?.maxTokens ?? this.config.api.max_tokens;

    const messages: any[] = [];
    const fileContents =
      settings?.files?.map((file) => ({
        type: 'file',
        file: {
          filename: this.resolveFileName(file),
          file_data: file,
        },
      })) ?? [];

    if (systemContent) {
      messages.push({
        role: 'system',
        content: systemContent,
      });
    }

    if (fileContents.length > 0) {
      const content = [
        ...fileContents,
        {
          type: 'text',
          text: userContent,
        },
      ];
      messages.push({
        role: 'user',
        content,
      });
    } else {
      messages.push({
        role: 'user',
        content: userContent,
      });
    }

    const payload = {
      model,
      messages,
      max_completion_tokens: max_tokens,
      temperature,
      bothub: {
        include_usage: true,
      },
      tools: [
        {
          type: 'web_search',
        },
      ],
    };

    try {
      await this.appLogger.log({
        type: 'external_request',
        integration: 'bothub',
        method: 'POST',
        url: this.config.api.url,
        requestBody: payload,
        ...userContext,
      });
      const response$ = this.httpService.post(this.config.api.url, payload, {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        timeout: 1800000, // 30 minutes
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      });

      const response = await lastValueFrom(response$);
      await this.appLogger.log({
        type: 'external_response',
        integration: 'bothub',
        method: 'POST',
        url: this.config.api.url,
        status: response.status,
        responseBody: response.data,
        ...userContext,
      });
      const data = response.data as BothubResponse;
      const content = data.choices?.[0]?.message?.content;
      const usage = data.usage?.bothub?.caps;

      if (usage !== undefined) {
        this.logger.log(`Bothub usage: ${usage} caps`);
      }

      if (!content) {
        this.logger.warn('Empty response from BotHub');
        return { content: 'Пусто', usage };
      }

      const cleanContent = content.replace(
        /\s*\(\s*Потрачено токенов:\s*.*\)\s*$/s,
        '',
      );

      return { content: cleanContent, usage };
    } catch (error) {
      this.logger.error(`Failed to generate content: ${error}`);
      const errorResponse = (
        error as { response?: { status?: number; data?: unknown } }
      ).response;
      await this.appLogger.log({
        type: 'external_error',
        integration: 'bothub',
        method: 'POST',
        url: this.config.api.url,
        status: errorResponse?.status,
        responseBody: errorResponse?.data,
        error: error instanceof Error ? error.message : String(error),
        ...userContext,
      });
      throw error;
    }
  }

  private resolveFileName(file: string): string {
    if (file.startsWith('data:')) {
      const mime = file.slice(5, file.indexOf(';'));
      const ext = mime.split('/')[1] ?? 'bin';
      return `file.${ext}`;
    }
    try {
      const url = new URL(file);
      const name = url.pathname.split('/').pop();
      if (name) return name;
    } catch {
      const name = file.split('/').pop();
      if (name) return name;
    }
    return 'file';
  }

  private async getGenerationSettings(
    type: string,
  ): Promise<GenerationSettingsPayload | null> {
    const settings = await this.generationSettingsService.getByType(type);
    if (settings) {
      return settings;
    }

    const fallback = this.getFallbackSettings(type);
    if (fallback) {
      return fallback;
    }

    return null;
  }

  private async getPrompts(
    type: string,
    systemPromptId: string | null,
    userPromptId: string | null,
    userContext?: Record<string, unknown>,
  ): Promise<{ system: string | null; user: string }> {
    const prompts = this.config.prompts as Record<string, string>;
    let userPrompt = prompts[type] ?? '';
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
    if (type === 'generate_article') {
      const settings = this.config.article_settings;
      if (!settings) return null;
      return {
        model: settings.model,
        temperature: settings.temperature,
        maxTokens: settings.max_tokens,
        files: settings.files ?? [],
        systemPromptId: null,
        userPromptId: null,
      };
    }

    if (type === 'generate_fact_check') {
      const settings = this.config.fact_check_settings;
      if (!settings) return null;
      return {
        model: settings.model,
        temperature: settings.temperature,
        maxTokens: settings.max_tokens,
        files: settings.files ?? [],
        systemPromptId: null,
        userPromptId: null,
      };
    }

    if (type === 'rewrite_article') {
      const settings =
        this.config.rewrite_settings ?? this.config.article_settings;
      if (!settings) return null;
      return {
        model: settings.model,
        temperature: settings.temperature,
        maxTokens: settings.max_tokens,
        files: settings.files ?? [],
        systemPromptId: null,
        userPromptId: null,
      };
    }

    if (type === 'seo_rewrite_article') {
      const settings =
        this.config.rewrite_settings ?? this.config.article_settings;
      if (!settings) return null;
      return {
        model: settings.model,
        temperature: settings.temperature,
        maxTokens: settings.max_tokens,
        files: settings.files ?? [],
        systemPromptId: null,
        userPromptId: null,
      };
    }

    if (type === 'generate_questions') {
      return {
        model: this.config.api.model,
        temperature: this.config.api.temperature,
        maxTokens: this.config.api.max_tokens,
        files: [],
        systemPromptId: null,
        userPromptId: null,
      };
    }

    if (type === 'generate_rubrics') {
      const settings = this.config.rubric_settings;
      if (settings) {
        return {
          model: settings.model,
          temperature: settings.temperature,
          maxTokens: settings.max_tokens,
          files: settings.files ?? [],
          systemPromptId: null,
          userPromptId: null,
        };
      }
    }

    if (type === 'generate_products') {
      const settings = this.config.product_settings;
      if (settings) {
        return {
          model: settings.model,
          temperature: settings.temperature,
          maxTokens: settings.max_tokens,
          files: settings.files ?? [],
          systemPromptId: null,
          userPromptId: null,
        };
      }
    }

    return null;
  }
}
