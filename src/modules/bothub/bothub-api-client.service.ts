import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { lastValueFrom } from 'rxjs';
import { AppLoggerService } from '../../common/logger/app-logger.service';
import { BothubRuntimeConfigService } from './bothub-runtime-config.service';
import {
  BothubBalanceResponse,
  BothubGenerationError,
  BothubModelListResponse,
  BothubModelOption,
  BothubResponse,
  BothubStreamAbortedError,
  GenerationResult,
  GenerationSettingsPayload,
} from './bothub.types';

@Injectable()
export class BothubApiClientService {
  /** Паузы перед повторами транзиентного сбоя генерации */
  private static readonly RETRY_DELAYS_MS = [2000, 6000];

  private readonly logger = new Logger(BothubApiClientService.name);
  private modelsCache: {
    expiresAt: number;
    items: BothubModelOption[];
  } | null = null;

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

    const retries = BothubApiClientService.RETRY_DELAYS_MS.length;
    let lastError: unknown;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const assembled = await this.postStreamWithLogging(url, payload, {
          stage: settings?.type,
          ...userContext,
        });

        return this.extractGenerationResult(assembled);
      } catch (error) {
        lastError = error;

        if (attempt >= retries || !this.isRetriableError(error)) {
          break;
        }

        const delay = BothubApiClientService.RETRY_DELAYS_MS[attempt];
        this.logger.warn(
          `Bothub generation failed (${settings?.type ?? 'unknown'}): ${error}. ` +
            `Retry ${attempt + 1}/${retries} in ${delay}ms`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    this.logger.error(`Failed to generate content: ${lastError}`);
    throw this.toGenerationError(lastError);
  }

  /**
   * Повторяем только то, что заведомо не дошло до модели: отказ соединения,
   * сбой DNS и ошибки шлюза. ECONNRESET и таймаут ответа сознательно не
   * повторяем — генерация могла отработать и списаться, а повтор оплатит её
   * второй раз.
   */
  private isRetriableError(error: unknown) {
    // Оборванный поток ничего не доставил — повтор не оплачивает результат дважды
    if (error instanceof BothubStreamAbortedError) {
      return true;
    }

    const status = (error as { response?: { status?: number } }).response
      ?.status;
    if (typeof status === 'number') {
      return status >= 500;
    }

    const code = (error as { code?: string }).code;
    return code === 'ECONNREFUSED' || code === 'EAI_AGAIN' || code === 'ENOTFOUND';
  }

  /** Достаёт из ответа Bothub код ошибки, чтобы бот показал внятную причину */
  private toGenerationError(error: unknown) {
    if (!(error as { isAxiosError?: boolean })?.isAxiosError) {
      return error;
    }

    const response = (
      error as {
        response?: {
          status?: number;
          data?: { error?: { message?: string; code?: string } };
        };
      }
    ).response;
    const apiError = response?.data?.error;

    return new BothubGenerationError(
      apiError?.message ??
        (error instanceof Error ? error.message : String(error)),
      response?.status,
      apiError?.code,
    );
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

      const availableBalance =
        data.subscription?.availableBalance ??
        data.subscription?.available_balance;

      // Раньше отсутствующее поле схлопывалось в 0 через `|| 0`: кабинет
      // показывал нулевой баланс, пока счёт реально уходил в минус.
      // Лучше явная ошибка, чем правдоподобный ноль.
      if (typeof availableBalance !== 'number') {
        this.logger.error(
          'Bothub /auth/me did not return a balance field (availableBalance/available_balance)',
        );
        throw new Error('Bothub не вернул баланс');
      }

      return {
        planType: data.subscription?.plan?.type || 'РќРµРёР·РІРµСЃС‚РЅРѕ',
        availableBalance,
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
      // Плагин веб-поиска подключаем только когда он включён в конфигурации
      ...(this.runtimeConfig.isWebSearchEnabled()
        ? {
            plugins: [
              {
                id: 'web',
                engine: 'native',
                max_results: 5,
              },
            ],
          }
        : {}),
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
      const choice = data.choices?.[0];
      const finishReason = choice?.finish_reason;
      const reasoningLength = choice?.message?.reasoning?.length ?? 0;

      // Reasoning-модели тратят лимит токенов на рассуждения: при слишком
      // маленьком maxTokens ответ обрывается ещё до текста. Молча сохранять
      // такой результат нельзя — это выглядит как «сгенерировалась пустота».
      if (finishReason === 'length') {
        throw new Error(
          `Модель не успела выдать ответ: лимит токенов исчерпан (finish_reason=length, ` +
            `рассуждений ${reasoningLength} символов). Увеличьте «Максимум токенов» для этого шага в админке.`,
        );
      }

      this.logger.warn(
        `Empty response from BotHub (finish_reason=${finishReason ?? 'unknown'})`,
      );
      throw new Error('Модель вернула пустой ответ');
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

  /**
   * Генерацию запрашиваем потоком. При обычном запросе соединение простаивает,
   * пока модель думает, и промежуточный узел рвёт его: за всю историю логов ни
   * один запрос длиннее ~400 секунд не дожил до ответа. В потоке чанки идут
   * непрерывно, поэтому простоя нет.
   */
  private async postStreamWithLogging(
    url: string,
    payload: Record<string, unknown>,
    userContext?: Record<string, unknown>,
  ): Promise<BothubResponse> {
    const streamPayload = {
      ...payload,
      stream: true,
      // Без этого при стриминге не приходит расход и стоимость шага теряется
      stream_options: { include_usage: true },
    };

    try {
      await this.appLogger.log({
        type: 'external_request',
        integration: 'bothub',
        method: 'POST',
        url,
        requestBody: streamPayload,
        ...userContext,
      });

      const response = await lastValueFrom(
        this.httpService.post(url, streamPayload, {
          headers: {
            'Content-Type': 'application/json',
            ...this.getAuthHeaders(),
          },
          timeout: 1800000,
          responseType: 'stream',
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
        }),
      );

      const assembled = await this.consumeGenerationStream(
        response.data as NodeJS.ReadableStream,
      );

      await this.appLogger.log({
        type: 'external_response',
        integration: 'bothub',
        method: 'POST',
        url,
        status: response.status,
        responseBody: assembled,
        ...userContext,
      });

      return assembled;
    } catch (error) {
      // При responseType: 'stream' тело ошибки — тоже поток; дочитываем его,
      // иначе код ошибки (например NOT_ENOUGH_TOKENS) остался бы недоступен
      const normalized = await this.materializeStreamError(error);
      await this.logExternalError(
        'POST',
        url,
        normalized,
        userContext,
        streamPayload,
      );
      throw normalized;
    }
  }

  /** Склеивает SSE-чанки Bothub в привычный вид ответа */
  private async consumeGenerationStream(
    stream: NodeJS.ReadableStream,
  ): Promise<BothubResponse> {
    let buffer = '';
    let content = '';
    let reasoning = '';
    let finishReason: string | undefined;
    let caps: number | undefined;

    const handleLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) {
        return;
      }

      const data = trimmed.slice(5).trim();
      if (!data || data === '[DONE]') {
        return;
      }

      let parsed: {
        choices?: Array<{
          delta?: { content?: string | null; reasoning?: string | null };
          finish_reason?: string | null;
        }>;
        usage?: { bothub?: { caps?: number } };
      };
      try {
        parsed = JSON.parse(data);
      } catch {
        // Битый чанк пропускаем: обрыв ответа поймаем по отсутствию finish_reason
        return;
      }

      const choice = parsed.choices?.[0];
      if (choice?.delta?.content) {
        content += choice.delta.content;
      }
      if (choice?.delta?.reasoning) {
        reasoning += choice.delta.reasoning;
      }
      if (choice?.finish_reason) {
        finishReason = choice.finish_reason;
      }
      if (typeof parsed.usage?.bothub?.caps === 'number') {
        caps = parsed.usage.bothub.caps;
      }
    };

    for await (const chunk of stream as AsyncIterable<Buffer | string>) {
      buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf-8');

      let newline: number;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        handleLine(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
      }
    }
    handleLine(buffer);

    // Поток, закончившийся без finish_reason, — это оборванный ответ. Отдать
    // такой текст молча нельзя: получилась бы обрезанная статья без признаков
    // проблемы.
    if (!finishReason) {
      throw new BothubStreamAbortedError(content.length, reasoning.length);
    }

    return {
      choices: [
        {
          finish_reason: finishReason,
          message: { content, reasoning },
        },
      ],
      ...(caps !== undefined ? { usage: { bothub: { caps } } } : {}),
    };
  }

  /** Заменяет поток в теле ошибки на разобранный объект */
  private async materializeStreamError(error: unknown) {
    const response = (error as { response?: { data?: unknown } }).response;
    const data = response?.data as
      | (AsyncIterable<Buffer | string> & { on?: unknown })
      | undefined;

    if (!data || typeof data.on !== 'function') {
      return error;
    }

    let raw = '';
    try {
      for await (const chunk of data) {
        raw += typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
      }
    } catch {
      return error;
    }

    try {
      response!.data = JSON.parse(raw);
    } catch {
      response!.data = raw;
    }

    return error;
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

  private normalizeModelList(
    payload: BothubModelListResponse,
  ): BothubModelOption[] {
    const source = Array.isArray(payload)
      ? payload
      : (payload.data ??
        payload.items ??
        payload.results ??
        payload.models ??
        []);
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
