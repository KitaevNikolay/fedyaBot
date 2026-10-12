import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError, AxiosInstance } from 'axios';
import { createHash } from 'crypto';
import { Agent } from 'http';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { CALLBACK_ACTION_NAME } from './messenger-keyboard';
import { MessengerTransport } from './messenger-transport';
import {
  YandexBotInfo,
  YandexChat,
  YandexChatTarget,
  YandexMessengerApiError,
  YandexSendFileOptions,
  YandexSendResult,
  YandexSendTextOptions,
  YandexSender,
  YandexSuggestButton,
  YandexSuggestButtons,
  YandexTypingOptions,
  YandexUpdate,
} from './yandex-messenger.types';

/** Лимит длины текста одного сообщения в Telegram */
export const TELEGRAM_MESSAGE_MAX_LENGTH = 4096;

const DEFAULT_API_URL = 'https://api.telegram.org';
const REQUEST_TIMEOUT_MS = 30_000;
const FILE_TIMEOUT_MS = 120_000;
/** Long polling: Telegram держит getUpdates открытым до этого числа секунд */
const POLL_TIMEOUT_SECONDS = 25;
const SEND_FILE_ATTEMPTS = 3;
const SEND_FILE_RETRY_DELAY_MS = 2_000;
/** Дольше ждать по 429 не будем — пусть падает, как любая другая ошибка */
const MAX_RETRY_AFTER_SECONDS = 30;
/** Ограничение Telegram на callback_data кнопки */
const CALLBACK_DATA_MAX_BYTES = 64;

interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
}

interface TelegramChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
}

interface TelegramMessage {
  message_id: number;
  date: number;
  message_thread_id?: number;
  from?: TelegramUser;
  chat: TelegramChat;
  text?: string;
  caption?: string;
  document?: {
    file_id: string;
    file_name?: string;
    file_size?: number;
  };
}

interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

interface TelegramResponse<T> {
  ok: boolean;
  result: T;
  description?: string;
  error_code?: number;
  parameters?: { retry_after?: number };
}

type TelegramInlineButton =
  | { text: string; callback_data: string }
  | { text: string; url: string };

/**
 * Временный транспорт через Telegram Bot API — на время, пока Яндекс
 * Мессенджер недоступен. Переводит обновления Telegram в формат
 * YandexUpdate, а suggest_buttons — в inline-клавиатуру, поэтому
 * MessengerBot и BotService работают без изменений.
 *
 * Пользователь идентифицируется числовым Telegram ID (в поле login): именно
 * такие значения остались в User.messengerId у пользователей, заведённых
 * до переезда в Яндекс, так что они вернутся в свои аккаунты.
 */
@Injectable()
export class TelegramBotApiService extends MessengerTransport {
  readonly platform = 'telegram' as const;
  readonly displayName = 'Telegram';
  readonly maxMessageLength = TELEGRAM_MESSAGE_MAX_LENGTH;
  /** sendChatAction показывает «печатает…» около пяти секунд */
  readonly processingRefreshMs = 4_500;

  private readonly logger = new Logger(TelegramBotApiService.name);
  private readonly http: AxiosInstance;
  private readonly token: string | null;
  private readonly apiUrl: string;
  /** Длинные callback-данные: короткий ключ → исходная строка */
  private readonly longCallbackData = new Map<string, string>();

  constructor(private readonly configService: ConfigService) {
    super();
    this.token = this.configService.get<string>('TELEGRAM_BOT_TOKEN') ?? null;
    this.apiUrl = (
      this.configService.get<string>('TELEGRAM_API_BASE_URL') || DEFAULT_API_URL
    ).replace(/\/+$/, '');

    const proxyUrl = this.configService.get<string>('TELEGRAM_PROXY_URL');
    const agent: Agent | undefined = proxyUrl
      ? proxyUrl.startsWith('socks')
        ? new SocksProxyAgent(proxyUrl)
        : new HttpsProxyAgent(proxyUrl)
      : undefined;

    this.http = axios.create({
      timeout: REQUEST_TIMEOUT_MS,
      ...(agent ? { httpAgent: agent, httpsAgent: agent, proxy: false } : {}),
    });
  }

  isConfigured() {
    return Boolean(this.token);
  }

  async getSelf(): Promise<YandexBotInfo> {
    const me = await this.request<TelegramUser>('getMe');
    return {
      ok: true,
      id: String(me.id),
      login: me.username ?? String(me.id),
      display_name: me.first_name,
    };
  }

  /** null — удалить вебхук, иначе установить */
  async setWebhook(webhookUrl: string | null) {
    return webhookUrl
      ? this.request<boolean>('setWebhook', { url: webhookUrl })
      : this.request<boolean>('deleteWebhook', {});
  }

  async getUpdates(offset: number, limit = 100): Promise<YandexUpdate[]> {
    const updates = await this.request<TelegramUpdate[]>(
      'getUpdates',
      {
        offset,
        limit,
        timeout: POLL_TIMEOUT_SECONDS,
        allowed_updates: ['message', 'callback_query'],
      },
      (POLL_TIMEOUT_SECONDS + 10) * 1000,
    );
    // Ни одно обновление не отбрасываем: по ним MessengerBot двигает offset
    return updates.map((update) => this.toUpdate(update));
  }

  async sendText(
    target: YandexChatTarget,
    text: string,
    options: YandexSendTextOptions = {},
  ): Promise<YandexSendResult> {
    const replyMarkup = this.toReplyMarkup(options.suggest_buttons);
    const message = await this.request<TelegramMessage>('sendMessage', {
      ...this.targetFields(target),
      text,
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      ...(options.disable_web_page_preview
        ? { link_preview_options: { is_disabled: true } }
        : {}),
      ...(options.disable_notification ? { disable_notification: true } : {}),
    });
    return { ok: true, message_id: message.message_id };
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
    const replyMarkup = this.toReplyMarkup(options.suggest_buttons);
    if (replyMarkup) {
      form.append('reply_markup', JSON.stringify(replyMarkup));
    }
    if (options.disable_notification) {
      form.append('disable_notification', 'true');
    }
    form.append(
      'document',
      new Blob([new Uint8Array(data)], { type: mimeType }),
      filename,
    );

    for (let attempt = 1; ; attempt++) {
      try {
        const message = await this.request<
          TelegramMessage & { document?: { file_id: string } }
        >('sendDocument', form, FILE_TIMEOUT_MS);
        return {
          ok: true,
          message_id: message.message_id,
          file_id: message.document?.file_id,
        };
      } catch (error) {
        if (attempt >= SEND_FILE_ATTEMPTS || !this.isRetryable(error)) {
          throw error;
        }
        this.logger.warn(
          `sendDocument attempt ${attempt}/${SEND_FILE_ATTEMPTS} failed, retrying`,
        );
        await this.sleep(SEND_FILE_RETRY_DELAY_MS * attempt);
      }
    }
  }

  async getFile(fileId: string): Promise<Buffer> {
    const file = await this.request<{ file_path?: string }>('getFile', {
      file_id: fileId,
    });
    if (!file.file_path) {
      throw new YandexMessengerApiError(
        'Telegram Bot API getFile: file_path is empty (файл больше 20 МБ?)',
      );
    }
    try {
      const response = await this.http.get<ArrayBuffer>(
        `${this.apiUrl}/file/bot${this.token}/${file.file_path}`,
        { responseType: 'arraybuffer', timeout: FILE_TIMEOUT_MS },
      );
      return Buffer.from(response.data);
    } catch (error) {
      throw this.toApiError(error, 'download file');
    }
  }

  async sendTyping(
    target: YandexChatTarget,
    options: YandexTypingOptions = {},
  ): Promise<void> {
    // Так MessengerContext «гасит» индикатор — в Telegram он гаснет сам
    if (options.timeout !== undefined && options.timeout <= 1) {
      return;
    }
    await this.request('sendChatAction', {
      ...this.targetFields(target),
      action: 'typing',
    });
  }

  private toUpdate(update: TelegramUpdate): YandexUpdate {
    const callback = update.callback_query;
    if (callback) {
      // Без ответа кнопка в Telegram крутится часами
      void this.request('answerCallbackQuery', {
        callback_query_id: callback.id,
      }).catch(() => undefined);

      const message = callback.message;
      return {
        update_id: update.update_id,
        message_id: message?.message_id ?? 0,
        timestamp: message?.date ?? Math.floor(Date.now() / 1000),
        from: this.toSender(callback.from),
        chat: this.toChat(message),
        ...(callback.data !== undefined
          ? {
              bot_request: {
                server_action: {
                  name: CALLBACK_ACTION_NAME,
                  payload: { data: this.unpackCallbackData(callback.data) },
                },
              },
            }
          : {}),
      };
    }

    const message = update.message;
    if (!message) {
      return {
        update_id: update.update_id,
        message_id: 0,
        timestamp: Math.floor(Date.now() / 1000),
        chat: { type: 'private' },
      };
    }

    return {
      update_id: update.update_id,
      message_id: message.message_id,
      timestamp: message.date,
      from: message.from ? this.toSender(message.from) : undefined,
      chat: this.toChat(message),
      ...(message.document
        ? {
            file: {
              id: message.document.file_id,
              name: message.document.file_name ?? 'document',
              size: message.document.file_size ?? 0,
            },
            text: message.caption,
          }
        : { text: message.text }),
    };
  }

  private toSender(user: TelegramUser): YandexSender {
    return {
      id: String(user.id),
      login: String(user.id),
      display_name: [user.first_name, user.last_name].filter(Boolean).join(' '),
      robot: user.is_bot,
      // Ключ есть всегда, даже без значения: так MessengerContext не подставит
      // числовой id вместо отсутствующего @username
      username: user.username,
    };
  }

  /** Личный чат адресуется id пользователя (login), остальные — chat_id */
  private toChat(message?: TelegramMessage): YandexChat {
    if (!message || message.chat.type === 'private') {
      return { type: 'private' };
    }
    return {
      type: message.chat.type === 'channel' ? 'channel' : 'group',
      id: String(message.chat.id),
      ...(message.message_thread_id !== undefined
        ? { thread_id: message.message_thread_id }
        : {}),
    };
  }

  private targetFields(target: YandexChatTarget): Record<string, unknown> {
    const chatId = target.chat_id ?? target.login;
    if (!chatId) {
      throw new YandexMessengerApiError(
        'Не задан адресат: нужен login или chat_id',
      );
    }
    if (!/^-?\d+$/.test(chatId)) {
      // Логин Яндекса Telegram не поймёт — в чат по нему не написать
      throw new YandexMessengerApiError(
        `Telegram chat_id должен быть числом, получено: ${chatId}`,
      );
    }
    return {
      chat_id: chatId,
      ...(target.thread_id !== undefined
        ? { message_thread_id: target.thread_id }
        : {}),
    };
  }

  private toReplyMarkup(suggest?: YandexSuggestButtons) {
    const buttons = suggest?.buttons;
    if (!buttons || buttons.length === 0) {
      return undefined;
    }
    const rows = (
      Array.isArray(buttons[0]) ? buttons : [buttons]
    ) as YandexSuggestButton[][];

    const keyboard = rows
      .map((row) =>
        row
          .map((button) => this.toInlineButton(button))
          .filter((button): button is TelegramInlineButton => !!button),
      )
      .filter((row) => row.length > 0);

    return keyboard.length > 0 ? { inline_keyboard: keyboard } : undefined;
  }

  private toInlineButton(
    button: YandexSuggestButton,
  ): TelegramInlineButton | null {
    const text = button.title ?? '';
    for (const directive of button.directives ?? []) {
      if (directive.type === 'open_uri') {
        return { text, url: directive.uri };
      }
      if (directive.type === 'server_action') {
        const payload = directive.payload as { data?: unknown } | undefined;
        const data =
          typeof payload?.data === 'string'
            ? payload.data
            : JSON.stringify(directive.payload);
        return { text, callback_data: this.packCallbackData(data) };
      }
    }
    return null;
  }

  /**
   * Telegram ограничивает callback_data 64 байтами. Длинные данные заменяем
   * хешем и держим соответствие в памяти; после рестарта такие старые кнопки
   * перестанут срабатывать — это лучше, чем ошибка отправки всего сообщения.
   */
  private packCallbackData(data: string) {
    if (Buffer.byteLength(data, 'utf8') <= CALLBACK_DATA_MAX_BYTES) {
      return data;
    }
    const key = `#${createHash('sha1').update(data).digest('hex').slice(0, 32)}`;
    if (!this.longCallbackData.has(key)) {
      this.logger.warn(`callback_data longer than 64 bytes, hashed: ${data}`);
      this.longCallbackData.set(key, data);
    }
    return key;
  }

  private unpackCallbackData(data: string) {
    return this.longCallbackData.get(data) ?? data;
  }

  private isRetryable(error: unknown) {
    if (!(error instanceof YandexMessengerApiError)) {
      return false;
    }
    if (error.status === undefined) {
      return error.code !== 'ECONNABORTED' && error.code !== 'ETIMEDOUT';
    }
    return error.status >= 500;
  }

  private async request<T>(
    method: string,
    body?: unknown,
    timeout = REQUEST_TIMEOUT_MS,
    retriedAfterFlood = false,
  ): Promise<T> {
    if (!this.token) {
      throw new YandexMessengerApiError('TELEGRAM_BOT_TOKEN is not configured');
    }

    try {
      const response = await this.http.post<TelegramResponse<T>>(
        `${this.apiUrl}/bot${this.token}/${method}`,
        body,
        { timeout },
      );
      return response.data.result;
    } catch (error) {
      const retryAfter = (error as AxiosError<TelegramResponse<T>>)?.response
        ?.data?.parameters?.retry_after;
      if (
        !retriedAfterFlood &&
        retryAfter !== undefined &&
        retryAfter <= MAX_RETRY_AFTER_SECONDS
      ) {
        this.logger.warn(
          `Telegram ${method}: flood limit, waiting ${retryAfter}s`,
        );
        await this.sleep(retryAfter * 1000);
        return this.request<T>(method, body, timeout, true);
      }
      throw this.toApiError(error, method);
    }
  }

  private toApiError(error: unknown, label: string) {
    if (error instanceof YandexMessengerApiError) {
      return error;
    }

    const axiosError = error as AxiosError<{ description?: string }>;
    if (axiosError?.isAxiosError) {
      const description = axiosError.response?.data?.description;
      const status = axiosError.response?.status;
      const code = status ? undefined : axiosError.code;
      const reason =
        description ||
        axiosError.message ||
        axiosError.cause?.message ||
        'no response';
      // Токен входит в URL — в лог его не пускаем
      const message = `Telegram Bot API ${label} failed${
        status ? ` (${status})` : ''
      }${code ? ` [${code}]` : ''}: ${reason}`.replaceAll(
        this.token ?? '\u0000',
        '***',
      );
      this.logger.warn(message);
      return new YandexMessengerApiError(message, status, description, code);
    }

    return error instanceof Error ? error : new Error(String(error));
  }

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
