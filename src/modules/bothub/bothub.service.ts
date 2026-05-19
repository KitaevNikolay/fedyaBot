import { Injectable } from '@nestjs/common';
import {
  applyPromptTemplate,
  PromptPlaceholderKey,
} from './prompt-template.helpers';
import { BothubApiClientService } from './bothub-api-client.service';
import { BothubGenerationResolverService } from './bothub-generation-resolver.service';
import { BothubRuntimeConfigService } from './bothub-runtime-config.service';
import type { BothubModelOption, GenerationResult } from './bothub.types';

export type { GenerationResult } from './bothub.types';

@Injectable()
export class BothubService {
  constructor(
    private readonly apiClient: BothubApiClientService,
    private readonly generationResolver: BothubGenerationResolverService,
    private readonly runtimeConfig: BothubRuntimeConfigService,
  ) {}

  async generateQuestions(
    articleSubject: string,
    userContext?: Record<string, unknown>,
  ): Promise<GenerationResult> {
    return this.runStage(
      'generate_questions',
      {
        article_subject: articleSubject,
        today: this.getToday(),
      },
      userContext,
    );
  }

  async generateArticle(
    articleSubject: string,
    questionsContent: string,
    userContext?: Record<string, unknown>,
  ): Promise<GenerationResult> {
    return this.runStage(
      'generate_article',
      {
        article_subject: articleSubject,
        'QUESTION.content': questionsContent,
        today: this.getToday(),
      },
      userContext,
    );
  }

  async generateFactCheck(
    articleSubject: string,
    articleContent: string,
    userContext?: Record<string, unknown>,
  ): Promise<GenerationResult> {
    void articleSubject;

    return this.runStage(
      'generate_fact_check',
      {
        'ARTICLE.content': articleContent,
        today: this.getToday(),
      },
      userContext,
    );
  }

  async rewriteArticle(
    articleSubject: string,
    articleContent: string,
    factCheckContent: string,
    userContext?: Record<string, unknown>,
  ): Promise<GenerationResult> {
    return this.runStage(
      'rewrite_article',
      {
        article_subject: articleSubject,
        'ARTICLE.content': articleContent,
        'FACT_CHECK.content': factCheckContent,
      },
      userContext,
    );
  }

  async seoRewriteArticle(
    articleContent: string,
    seoTzContent: string,
    userContext?: Record<string, unknown>,
  ): Promise<GenerationResult> {
    return this.runStage(
      'seo_rewrite_article',
      {
        'SEO_TZ.content': seoTzContent,
        'ARTICLE.content': articleContent,
      },
      userContext,
    );
  }

  async generateRubrics(
    articleSubject: string,
    articleContent: string,
    userContext?: Record<string, unknown>,
  ): Promise<GenerationResult> {
    return this.runStage(
      'generate_rubrics',
      {
        article_subject: articleSubject,
        'ARTICLE.content': articleContent,
      },
      userContext,
    );
  }

  async generateProducts(
    articleContent: string,
    userContext?: Record<string, unknown>,
  ): Promise<GenerationResult> {
    return this.runStage(
      'generate_products',
      {
        'ARTICLE.content': articleContent,
      },
      userContext,
    );
  }

  async makeArticleUnique(
    articleContent: string,
    userContext?: Record<string, unknown>,
  ): Promise<GenerationResult> {
    return this.runStage(
      'article_uniqueness',
      {
        'ARTICLE.content': articleContent,
      },
      userContext,
    );
  }

  async processUserPrompt(
    articleContent: string,
    userPrompt: string,
    userContext?: Record<string, unknown>,
  ): Promise<GenerationResult> {
    return this.runStage(
      'uniq_prompt',
      {
        'ARTICLE.content': articleContent,
        'USER_PROMPT.content': userPrompt,
      },
      userContext,
    );
  }

  async getBalance(
    userContext?: Record<string, unknown>,
  ): Promise<{ planType: string; availableBalance: number }> {
    return this.apiClient.getBalance(userContext);
  }

  async getAvailableModels(
    userContext?: Record<string, unknown>,
  ): Promise<BothubModelOption[]> {
    return this.apiClient.getAvailableModels(userContext);
  }

  private async runStage(
    type: string,
    values: Partial<Record<PromptPlaceholderKey, string>>,
    userContext?: Record<string, unknown>,
  ): Promise<GenerationResult> {
    const settings = await this.generationResolver.getGenerationSettings(type);
    const prompts = await this.generationResolver.getPrompts(
      type,
      settings?.systemPromptId ?? null,
      settings?.userPromptId ?? null,
      userContext,
    );
    const prompt = applyPromptTemplate(type, prompts.user, values);

    if (this.runtimeConfig.isMockMode()) {
      return this.createMockResult(type, prompts.system, prompt);
    }

    return this.apiClient.sendGenerationRequest(
      prompt,
      settings,
      prompts.system,
      userContext,
    );
  }

  private createMockResult(
    type: string,
    systemPrompt: string | null,
    userPrompt: string,
  ): GenerationResult {
    return {
      content: `[MOCK Р Р•Р–РРњ: ${type}]\n\nРЎРРЎРўР•РњРќР«Р™ РџР РћРњРџРў:\n${
        systemPrompt || 'РќРµС‚'
      }\n\nРџРћР›Р¬Р—РћР’РђРўР•Р›Р¬РЎРљРР™ РџР РћРњРџРў:\n${userPrompt}`,
      usage: 0,
      mockSystemPrompt: systemPrompt || undefined,
      mockUserPrompt: userPrompt,
    };
  }

  private getToday() {
    return new Date().toLocaleDateString('ru-RU');
  }
}
