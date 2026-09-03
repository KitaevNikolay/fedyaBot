/**
 * Типы Bot API Яндекс Мессенджера.
 * Справочник: https://yandex.ru/dev/messenger/doc/ru/data-types
 */

export interface YandexSender {
  /** GUID пользователя или id канала */
  id?: string;
  /** Логин — основной идентификатор собеседника в приватном чате */
  login?: string;
  display_name?: string;
  robot?: boolean;
}

export interface YandexChat {
  type: 'private' | 'group' | 'channel';
  /** У приватного чата id нет: собеседник определяется по login отправителя */
  id?: string;
  thread_id?: number;
}

export interface YandexFile {
  id: string;
  name: string;
  size: number;
}

export interface YandexImage {
  file_id: string;
  width: number;
  height: number;
  size?: number;
  name?: string;
}

export interface YandexServerAction {
  name: string;
  payload?: unknown;
}

export interface YandexBotRequestError {
  type: 'unsupported_directive' | 'invalid_directive_payload' | 'client_error';
  name?: string;
  message?: string;
}

/** Приходит при нажатии кнопки с директивой server_action */
export interface YandexBotRequest {
  server_action?: YandexServerAction;
  element_id?: string;
  errors?: YandexBotRequestError[];
}

export interface YandexUpdate {
  update_id: number;
  message_id: number;
  timestamp: number;
  from?: YandexSender;
  chat: YandexChat;
  text?: string;
  file?: YandexFile;
  images?: YandexImage[][];
  forwarded_messages?: YandexUpdate[];
  reply_to_message?: YandexUpdate;
  sticker?: { id: string; set_id: string };
  bot_request?: YandexBotRequest;
  /**
   * Устаревший формат callback: данные кнопки из inline_keyboard приходили
   * в этом поле. Поддерживаем на случай старых клиентов.
   */
  callback_data?: unknown;
}

export type YandexDirective =
  | { type: 'open_uri'; uri: string }
  | { type: 'server_action'; name: string; payload: unknown }
  | { type: 'send_message'; text: string; payload?: unknown }
  | {
      type: 'set_elements_state';
      ids: string[];
      state: 'disabled' | 'loading';
      timeout_seconds?: number;
    };

export interface YandexSuggestButton {
  id?: string;
  title?: string;
  directives?: YandexDirective[];
}

export interface YandexSuggestButtons {
  /** "true" — кнопки по строкам (двумерный массив), "false" — в одну строку */
  layout: 'true' | 'false';
  /** Показывать кнопки, даже если сообщение уже не последнее в чате */
  persist?: boolean;
  buttons?: YandexSuggestButton[] | YandexSuggestButton[][];
}

/** Адресат: приватный чат по логину или групповой чат по id */
export interface YandexChatTarget {
  login?: string;
  chat_id?: string;
  thread_id?: number;
}

export interface YandexSendTextOptions {
  /** ID существующего сообщения — тогда оно редактируется */
  message_id?: number;
  reply_message_id?: number;
  disable_web_page_preview?: boolean;
  disable_notification?: boolean;
  important?: boolean;
  suggest_buttons?: YandexSuggestButtons;
}

export interface YandexSendFileOptions {
  reply_message_id?: number;
  disable_notification?: boolean;
  important?: boolean;
  suggest_buttons?: YandexSuggestButtons;
}

export interface YandexSendResult {
  ok: boolean;
  message_id: number;
  file_id?: string;
}

export interface YandexBotInfo {
  ok: boolean;
  id: string;
  login: string;
  display_name?: string;
  webhook_url?: string | null;
  organizations?: number[];
  settings?: Record<string, boolean>;
}

export interface YandexUpdatesResponse {
  ok: boolean;
  updates: YandexUpdate[];
  description?: string;
}

/** Ошибка Bot API с описанием из поля description */
export class YandexMessengerApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly description?: string,
  ) {
    super(message);
    this.name = 'YandexMessengerApiError';
  }
}
