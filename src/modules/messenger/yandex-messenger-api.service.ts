import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError, AxiosInstance } from 'axios';
import {
  YandexBotInfo,
  YandexChatTarget,
  YandexMessengerApiError,
  YandexSendFileOptions,
  YandexSendResult,
  YandexSendTextOptions,
  YandexUpdate,
  YandexUpdatesResponse,
} from './yandex-messenger.types';

/** Лимит длины текста одного сообщения в Яндекс Мессенджере */
export const YANDEX_MESSAGE_MAX_LENGTH = 6000;

const DEFAULT_API_URL = 'https://botapi.messenger.yandex.net/bot/v1';
const REQUEST_TIMEOUT_MS = 30_000;
/** Файлы (docx статьи) могут быть заметно тяжелее текста — ждём дольше */
const FILE_TIMEOUT_MS = 120_000;

/**
 * Низкоуровневый клиент Bot API Яндекс Мессенджера.
 * Документация: https://yandex.ru/dev/messenger/doc/ru/
 */
@Injectable()
export class YandexMessengerApiService {
  private readonly logger = new Logger(YandexMessengerApiService.name);
  private readonly http: AxiosInstance;
  private readonly token: string | null;

  constructor(private readonly configService: ConfigService) {
    this.token = this.configService.get<string>('YANDEX_BOT_TOKEN') ?? null;
    const baseURL = (
      this.configService.get<string>('YANDEX_BOT_API_URL') ?? DEFAULT_API_URL
    ).replace(/\/+$/, '');

    this.http = axios.create({
      baseURL,
      timeout: REQUEST_TIMEOUT_MS,
      headers: this.token ? { Authorization: `OAuth ${this.token}` } : {},
    });
  }

  isConfigured() {
    return Boolean(this.token);
  }

  async getSelf(): Promise<YandexBotInfo> {
    return this.request<YandexBotInfo>('GET', '/self/get');
  }

  /** Устанавливает (или сбрасывает, если null) URL вебхука */
  async setWebhook(webhookUrl: string | null): Promise<YandexBotInfo> {
    return this.request<YandexBotInfo>('POST', '/self/update/', {
      webhook_url: webhookUrl,
    });
  }

  async getUpdates(offset: number, limit = 100): Promise<YandexUpdate[]> {
    const response = await this.request<YandexUpdatesResponse>(
      'POST',
      '/messages/getUpdates/',
      { offset, limit },
    );
    return response.updates ?? [];
  }

  async sendText(
    target: YandexChatTarget,
    text: string,
    options: YandexSendTextOptions = {},
  ): Promise<YandexSendResult> {
    return this.request<YandexSendResult>('POST', '/messages/sendText/', {
      ...this.targetFields(target),
      text,
      ...options,
    });
  }

  async sendFile(
    target: YandexChatTarget,
    data: Buffer,
    filename: string,
    options: YandexSendFileOptions = {},
    mimeType = 'application/octet-stream',
  ): Promise<YandexSendResult> {
    const form = new FormData();
    for (const [key, value] of Object.entries(this.targetFields(target))) {
      form.append(key, String(value));
    }
    for (const [key, value] of Object.entries(options)) {
      if (value === undefined) {
        continue;
      }
      form.append(
        key,
        typeof value === 'object' ? JSON.stringify(value) : String(value),
      );
    }
    form.append(
      'document',
      new Blob([new Uint8Array(data)], { type: mimeType }),
      filename,
    );

    return this.request<YandexSendResult>(
      'POST',
      '/messages/sendFile/',
      form,
      FILE_TIMEOUT_MS,
    );
  }

  /** Скачивает файл, присланный пользователем */
  async getFile(fileId: string): Promise<Buffer> {
    try {
      const response = await this.http.post<ArrayBuffer>(
        '/messages/getFile/',
        { file_id: fileId },
        { responseType: 'arraybuffer', timeout: FILE_TIMEOUT_MS },
      );
      return Buffer.from(response.data);
    } catch (error) {
      throw this.toApiError(error, 'POST /messages/getFile/');
    }
  }

  async sendTyping(target: YandexChatTarget): Promise<void> {
    await this.request('POST', '/messages/sendTyping/', {
      ...this.targetFields(target),
    });
  }

  private targetFields(target: YandexChatTarget): Record<string, unknown> {
    if (!target.login && !target.chat_id) {
      throw new YandexMessengerApiError(
        'Не задан адресат: нужен login или chat_id',
      );
    }
    return {
      ...(target.chat_id ? { chat_id: target.chat_id } : {}),
      ...(!target.chat_id && target.login ? { login: target.login } : {}),
      ...(target.thread_id !== undefined
        ? { thread_id: target.thread_id }
        : {}),
    };
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    timeout = REQUEST_TIMEOUT_MS,
  ): Promise<T> {
    if (!this.token) {
      throw new YandexMessengerApiError('YANDEX_BOT_TOKEN is not configured');
    }

    try {
      const response = await this.http.request<T & { ok?: boolean }>({
        method,
        url: path,
        data: body,
        timeout,
      });

      if (response.data && response.data.ok === false) {
        const description = (response.data as { description?: string })
          .description;
        throw new YandexMessengerApiError(
          `Yandex Bot API ${path}: ${description ?? 'unknown error'}`,
          response.status,
          description,
        );
      }

      return response.data;
    } catch (error) {
      throw this.toApiError(error, `${method} ${path}`);
    }
  }

  private toApiError(error: unknown, label: string) {
    if (error instanceof YandexMessengerApiError) {
      return error;
    }

    const axiosError = error as AxiosError<{ description?: string }>;
    if (axiosError?.isAxiosError) {
      let description = axiosError.response?.data?.description;
      // Для arraybuffer-ответов тело ошибки приходит бинарным
      if (!description && axiosError.response?.data instanceof ArrayBuffer) {
        try {
          description = (
            JSON.parse(
              Buffer.from(axiosError.response.data).toString('utf-8'),
            ) as { description?: string }
          ).description;
        } catch {
          description = undefined;
        }
      }
      const status = axiosError.response?.status;
      const message = `Yandex Bot API ${label} failed${
        status ? ` (${status})` : ''
      }: ${description ?? axiosError.message}`;
      this.logger.warn(message);
      return new YandexMessengerApiError(message, status, description);
    }

    return error instanceof Error ? error : new Error(String(error));
  }
}
