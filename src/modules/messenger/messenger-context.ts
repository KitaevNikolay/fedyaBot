import { InlineKeyboard, InputFile } from './messenger-keyboard';
import {
  YANDEX_MESSAGE_MAX_LENGTH,
  YandexMessengerApiService,
} from './yandex-messenger-api.service';
import { YandexChatTarget, YandexUpdate } from './yandex-messenger.types';

export interface MessengerUser {
  /** Идентификатор собеседника для БД и Redis: логин (для каналов — id) */
  id: string;
  login?: string;
  guid?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
  display_name?: string;
}

export interface MessengerDocument {
  file_id: string;
  file_name?: string;
  file_size?: number;
  mime_type?: string;
}

export interface MessengerMessage {
  message_id: number;
  text?: string;
  caption?: string;
  document?: MessengerDocument;
}

export interface MessengerCallbackQuery {
  data: string;
  /**
   * Bot API не сообщает, к какому сообщению относилась кнопка, поэтому
   * редактировать исходное сообщение нельзя — поле всегда undefined.
   */
  message?: { message_id: number };
}

export interface ReplyOptions {
  reply_markup?: InlineKeyboard;
  disable_web_page_preview?: boolean;
}

export interface AnswerCallbackOptions {
  text?: string;
  show_alert?: boolean;
}

/**
 * Контекст одного обновления. Повторяет поверхность grammY-контекста в том
 * объёме, который использует BotService: reply, replyWithDocument,
 * answerCallbackQuery, editMessageText, from/chat/message/callbackQuery.
 */
export class MessengerContext {
  readonly from?: MessengerUser;
  readonly chat: { id: string; type: YandexUpdate['chat']['type'] };
  readonly message?: MessengerMessage;
  readonly callbackQuery?: MessengerCallbackQuery;

  constructor(
    readonly update: YandexUpdate,
    private readonly api: YandexMessengerApiService,
  ) {
    this.from = MessengerContext.buildUser(update);
    this.chat = {
      type: update.chat.type,
      id: update.chat.id ?? this.from?.id ?? '',
    };

    const callbackData = MessengerContext.extractCallbackData(update);
    if (callbackData !== null) {
      this.callbackQuery = { data: callbackData };
    } else if (update.text !== undefined || update.file) {
      this.message = {
        message_id: update.message_id,
        ...(update.file
          ? {
              document: {
                file_id: update.file.id,
                file_name: update.file.name,
                file_size: update.file.size,
              },
              caption: update.text,
            }
          : { text: update.text }),
      };
    }
  }

  /** Адресат ответов: приватный чат по логину, групповой — по chat_id */
  get target(): YandexChatTarget {
    if (this.update.chat.type !== 'private' && this.update.chat.id) {
      return {
        chat_id: this.update.chat.id,
        ...(this.update.chat.thread_id !== undefined
          ? { thread_id: this.update.chat.thread_id }
          : {}),
      };
    }
    return { login: this.from?.login ?? this.from?.id };
  }

  async reply(text: string, options: ReplyOptions = {}) {
    const chunks = MessengerContext.splitText(text);
    let lastMessageId = 0;
    for (let index = 0; index < chunks.length; index++) {
      const isLast = index === chunks.length - 1;
      const result = await this.api.sendText(this.target, chunks[index], {
        ...(options.disable_web_page_preview !== undefined
          ? { disable_web_page_preview: options.disable_web_page_preview }
          : {}),
        // Клавиатуру вешаем только на последний фрагмент
        ...(isLast && options.reply_markup
          ? { suggest_buttons: options.reply_markup.toSuggestButtons() }
          : {}),
      });
      lastMessageId = result.message_id;
    }
    return { message_id: lastMessageId };
  }

  async replyWithDocument(file: InputFile, options: ReplyOptions = {}) {
    return this.api.sendFile(
      this.target,
      file.data,
      file.filename,
      options.reply_markup
        ? { suggest_buttons: options.reply_markup.toSuggestButtons() }
        : {},
      file.mimeType,
    );
  }

  /**
   * Исходное сообщение с кнопками неизвестно (см. MessengerCallbackQuery),
   * поэтому «редактирование» — это новое сообщение с тем же содержимым.
   */
  async editMessageText(text: string, options: ReplyOptions = {}) {
    return this.reply(text, options);
  }

  /**
   * Показывает в чате индикатор обработки («Генерирую статью…») и продлевает
   * его, пока не вызван возвращённый stop(). В групповых чатах processing
   * недоступен — там показывается обычное «печатает…».
   */
  startProcessing(text: string, refreshMs = 50_000): () => void {
    const isPrivate = this.update.chat.type === 'private';
    const send = () =>
      this.api
        .sendTyping(
          this.target,
          isPrivate
            ? {
                type: 'processing',
                timeout: 60,
                processing_content: {
                  display: 'text',
                  text: text.slice(0, 100),
                },
              }
            : { type: 'text', timeout: 60 },
        )
        .catch(() => undefined);

    void send();
    const timer = setInterval(() => void send(), refreshMs);
    return () => {
      clearInterval(timer);
      // Отменить индикатор нельзя, но можно сократить остаток до секунды
      void this.api
        .sendTyping(this.target, { type: 'text', timeout: 1 })
        .catch(() => undefined);
    };
  }

  /**
   * В Яндексе нажатие server_action-кнопки не требует подтверждения.
   * Текст (в Telegram — всплывающее уведомление) отправляем сообщением.
   */
  async answerCallbackQuery(options: AnswerCallbackOptions = {}) {
    if (options.text) {
      await this.reply(options.text);
    }
  }

  /** Режет длинные тексты по лимиту API, стараясь рвать по переносам строк */
  static splitText(text: string, limit = YANDEX_MESSAGE_MAX_LENGTH) {
    if (text.length <= limit) {
      return [text];
    }

    const chunks: string[] = [];
    let rest = text;
    while (rest.length > limit) {
      let cut = rest.lastIndexOf('\n', limit);
      if (cut < limit / 2) {
        cut = rest.lastIndexOf(' ', limit);
      }
      if (cut < limit / 2) {
        cut = limit;
      }
      chunks.push(rest.slice(0, cut));
      rest = rest.slice(cut).replace(/^\s+/, '');
    }
    if (rest.length > 0) {
      chunks.push(rest);
    }
    return chunks;
  }

  private static buildUser(update: YandexUpdate): MessengerUser | undefined {
    const sender = update.from;
    if (!sender) {
      return undefined;
    }

    const login = sender.login?.trim().toLowerCase();
    const id = login || sender.id;
    if (!id) {
      return undefined;
    }

    // display_name — «Имя Фамилия»; раскладываем, чтобы профиль в БД был как раньше
    const [firstName, ...rest] = (sender.display_name ?? '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    return {
      id,
      login,
      guid: sender.id,
      username: login,
      first_name: firstName,
      last_name: rest.length > 0 ? rest.join(' ') : undefined,
      display_name: sender.display_name,
    };
  }

  private static extractCallbackData(update: YandexUpdate): string | null {
    const payload = update.bot_request?.server_action?.payload;
    if (payload !== undefined && payload !== null) {
      return MessengerContext.payloadToString(payload);
    }

    if (update.callback_data !== undefined && update.callback_data !== null) {
      return MessengerContext.payloadToString(update.callback_data);
    }

    return null;
  }

  private static payloadToString(payload: unknown): string {
    if (typeof payload === 'string') {
      return payload;
    }
    if (
      payload &&
      typeof payload === 'object' &&
      typeof (payload as { data?: unknown }).data === 'string'
    ) {
      return (payload as { data: string }).data;
    }
    return JSON.stringify(payload);
  }
}
