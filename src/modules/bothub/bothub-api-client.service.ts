import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { lastValueFrom } from 'rxjs';
import { AppLoggerService } from '../../common/logger/app-logger.service';
import { BothubRuntimeConfigService } from './bothub-runtime-config.service';
import {
  BothubBalanceResponse,
  BothubModelListResponse,
  BothubModelOption,
  BothubResponse,
  GenerationResult,
  GenerationSettingsPayload,
} from './bothub.types';

@Injectable()
export class BothubApiClientService {
  private readonly logger = new Logger(BothubApiClientService.name);
  private modelsCache:
    | {
        expiresAt: number;
        items: BothubModelOption[];
      }
    | null = null;

  constructor(
    private readonly httpService: HttpService,
    private readonly appLogger: AppLoggerService,
    private readonly runtimeConfig: BothubRuntimeConfigService,
  ) {}

  async sendGenerationRequest(
    userContent: string,
    settings?: GenerationSettingsPayload | null,
    systemContent?: string | null,
    userContext?: Record<string, unknown>,
  ): Promise<GenerationResult> {
    const apiConfig = this.runtimeConfig.getApiConfig();
    const url = apiConfig.url;
    const payload = this.buildGenerationPayload(
      userContent,
      settings,
      systemContent,
    );

    try {
      const response = await this.postWithLogging<BothubResponse>(
        url,
        payload,
        {
          stage: settings?.type,
          ...userContext,
        },
      );

      return this.extractGenerationResult(response.data);
    } catch (error) {
      this.logger.error(`Failed to generate content: ${error}`);
      throw error;
    }
  }

  async getBalance(
    userContext?: Record<string, unknown>,
  ): Promise<{ planType: string; availableBalance: number }> {
    const url = `${this.runtimeConfig.getApiBaseUrl()}/auth/me`;

    try {
      const response = await this.getWithLogging<BothubBalanceResponse>(
        url,
        userContext,
      );
      const data = response.data;

      if (data.error?.message === 'UNAUTHORIZED') {
        this.logger.error('Bothub API unauthorized');
        throw new Error('РћС€РёР±РєР° Р°РІС‚РѕСЂРёР·Р°С†РёРё РІ Bothub');
      }

      return {
        planType: data.subscription?.plan?.type || 'РќРµРёР·РІРµСЃС‚РЅРѕ',
        availableBalance: data.subscription?.availableBalance || 0,
      };
    } catch (error) {
      this.logger.error(`Failed to get balance: ${error}`);
      throw error;
    }
  }

  async getAvailableModels(
    userContext?: Record<string, unknown>,
  ): Promise<BothubModelOption[]> {
    if (this.modelsCache && this.modelsCache.expiresAt > Date.now()) {
      return this.modelsCache.items;
    }

    const apiBaseUrl = this.runtimeConfig.getApiBaseUrl();
    const candidateUrls = [
      `${apiBaseUrl}/model/list`,
      `${apiBaseUrl}/models`,
      `${apiBaseUrl}/model`,
    ];

    for (const url of candidateUrls) {
      try {
        const response = await this.getWithLogging<BothubModelListResponse>(
          url,
          userContext,
        );
        const items = this.normalizeModelList(response.data);

        if (items.length > 0) {
          this.modelsCache = {
            expiresAt: Date.now() + 5 * 60 * 1000,
            items,
          };

          return items;
        }
      } catch {
        continue;
      }
    }

    this.logger.warn('Failed to fetch model list from BotHub API');
    return [];
  }

  private buildGenerationPayload(
    userContent: string,
    settings?: GenerationSettingsPayload | null,
    systemContent?: string | null,
  ) {
    const apiConfig = this.runtimeConfig.getApiConfig();
    const model = settings?.model ?? apiConfig.model;
    const temperature = settings?.temperature ?? apiConfig.temperature;
    const maxTokens = settings?.maxTokens ?? apiConfig.max_tokens;

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
      messages.push({
        role: 'user',
        content: [
          ...fileContents,
          {
            type: 'text',
            text: userContent,
          },
        ],
      });
    } else {
      messages.push({
        role: 'user',
        content: userContent,
      });
    }

    let payload: any = {
      model,
      messages,
      max_completion_tokens: maxTokens,
      temperature,
      bothub: {
        include_usage: true,
      },
      plugins: [
        {
          id: 'web',
          engine: 'native',
          max_results: 5,
        },
      ],
    };

    if (
      settings?.additionalPayload &&
      typeof settings.additionalPayload === 'object' &&
      !Array.isArray(settings.additionalPayload)
    ) {
      payload = {
        ...payload,
        ...settings.additionalPayload,
      };
    }

    return payload;
  }

  private extractGenerationResult(data: BothubResponse): GenerationResult {
    const content = data.choices?.[0]?.message?.content;
    const usage = data.usage?.bothub?.caps;

    if (usage !== undefined) {
      this.logger.log(`Bothub usage: ${usage} caps`);
    }

    if (!content) {
      this.logger.warn('Empty response from BotHub');
      return { content: 'РџСѓСЃС‚Рѕ', usage };
    }

    const cleanContent = content.replace(
      /\s*\(\s*РџРѕС‚СЂР°С‡РµРЅРѕ С‚РѕРєРµРЅРѕРІ:\s*.*\)\s*$/s,
      '',
    );

    return { content: cleanContent, usage };
  }

  private async getWithLogging<T>(
    url: string,
    userContext?: Record<string, unknown>,
  ) {
    try {
      await this.appLogger.log({
        type: 'external_request',
        integration: 'bothub',
        method: 'GET',
        url,
        ...userContext,
      });

      const response = await lastValueFrom(
        this.httpService.get<T>(url, {
          headers: this.getAuthHeaders(),
          timeout: 30000,
        }),
      );

      await this.appLogger.log({
        type: 'external_response',
        integration: 'bothub',
        method: 'GET',
        url,
        status: response.status,
        responseBody: response.data,
        ...userContext,
      });

      return response;
    } catch (error) {
      await this.logExternalError('GET', url, error, userContext);
      throw error;
    }
  }

  private async postWithLogging<T>(
    url: string,
    payload: unknown,
    userContext?: Record<string, unknown>,
  ) {
    try {
      await this.appLogger.log({
        type: 'external_request',
        integration: 'bothub',
        method: 'POST',
        url,
        requestBody: payload,
        ...userContext,
      });

      const response = await lastValueFrom(
        this.httpService.post<T>(url, payload, {
          headers: {
            'Content-Type': 'application/json',
            ...this.getAuthHeaders(),
          },
          timeout: 1800000,
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
        }),
      );

      await this.appLogger.log({
        type: 'external_response',
        integration: 'bothub',
        method: 'POST',
        url,
        status: response.status,
        responseBody: response.data,
        ...userContext,
      });

      return response;
    } catch (error) {
      await this.logExternalError('POST', url, error, userContext, payload);
      throw error;
    }
  }

  private async logExternalError(
    method: 'GET' | 'POST',
    url: string,
    error: unknown,
    userContext?: Record<string, unknown>,
    requestBody?: unknown,
  ) {
    const errorResponse = (
      error as { response?: { status?: number; data?: unknown } }
    ).response;

    await this.appLogger.log({
      type: 'external_error',
      integration: 'bothub',
      method,
      url,
      status: errorResponse?.status,
      requestBody,
      responseBody: errorResponse?.data,
      error: error instanceof Error ? error.message : String(error),
      ...userContext,
    });
  }

  private getAuthHeaders() {
    return {
      Authorization: `Bearer ${this.runtimeConfig.getApiKey()}`,
    };
  }

  private normalizeModelList(payload: BothubModelListResponse): BothubModelOption[] {
    const source = Array.isArray(payload)
      ? payload
      : payload.data ?? payload.items ?? payload.results ?? payload.models ?? [];
    const modelMap = new Map<string, BothubModelOption>();

    const addModelOption = (
      id: string,
      label: string | null | undefined,
      provider: string | null | undefined,
    ) => {
      const normalizedId = id.trim();

      if (!normalizedId) {
        return;
      }

      modelMap.set(normalizedId, {
        id: normalizedId,
        label: label?.trim() || normalizedId,
        provider: provider?.trim() || null,
      });
    };

    for (const item of source) {
      if (typeof item === 'string') {
        addModelOption(item, item, null);
        continue;
      }

      const parentId = (
        item.id ??
        item.model ??
        item.slug ??
        item.name ??
        item.title ??
        item.display_name ??
        item.displayName
      )?.trim();

      const parentLabel = (
        item.display_name ??
        item.displayName ??
        item.title ??
        item.name ??
        item.label ??
        item.model ??
        item.id
      )?.trim();
      const parentProvider = item.provider ?? item.owned_by ?? parentId ?? null;
      const children = Array.isArray(item.children) ? item.children : [];

      if (children.length > 0) {
        for (const child of children) {
          if (typeof child === 'string') {
            addModelOption(child, child, parentLabel ?? parentProvider);
            continue;
          }

          const childId = (
            child.id ??
            child.model ??
            child.slug ??
            child.name ??
            child.title ??
            child.display_name ??
            child.displayName
          )?.trim();

          if (!childId) {
            continue;
          }

          const childLabel = (
            child.display_name ??
            child.displayName ??
            child.title ??
            child.name ??
            child.model ??
            child.id
          )?.trim();

          addModelOption(
            childId,
            childLabel,
            child.provider ?? child.owned_by ?? parentLabel ?? parentProvider,
          );
        }

        continue;
      }

      if (!parentId) {
        continue;
      }

      addModelOption(parentId, parentLabel, parentProvider);
    }

    return Array.from(modelMap.values()).sort((left, right) =>
      left.label.localeCompare(right.label, 'en'),
    );
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
      if (name) {
        return name;
      }
    } catch {
      const name = file.split('/').pop();
      if (name) {
        return name;
      }
    }

    return 'file';
  }
}
