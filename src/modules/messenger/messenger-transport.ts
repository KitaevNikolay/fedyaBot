import {
  YandexBotInfo,
  YandexChatTarget,
  YandexSendFileOptions,
  YandexSendResult,
  YandexSendTextOptions,
  YandexTypingOptions,
  YandexUpdate,
} from './yandex-messenger.types';

export type MessengerPlatform = 'yandex' | 'telegram';

/**
 * Транспорт бота: Bot API конкретного мессенджера. Обновления и адресаты
 * описываются типами Яндекс Мессенджера — это общий формат, в который
 * Telegram-адаптер переводит свои данные. Абстрактный класс служит и
 * DI-токеном: реализацию выбирает MESSENGER_PLATFORM (см. MessengerModule).
 */
export abstract class MessengerTransport {
  abstract readonly platform: MessengerPlatform;
  /** Название для текстов пользователю: «Яндекс Мессенджер», «Telegram» */
  abstract readonly displayName: string;
  /** Лимит длины текста одного сообщения */
  abstract readonly maxMessageLength: number;
  /** Как часто продлевать индикатор «печатает…», пока идёт долгий шаг */
  abstract readonly processingRefreshMs: number;

  abstract isConfigured(): boolean;
  abstract getSelf(): Promise<YandexBotInfo>;
  abstract setWebhook(webhookUrl: string | null): Promise<unknown>;
  abstract getUpdates(offset: number, limit?: number): Promise<YandexUpdate[]>;
  abstract sendText(
    target: YandexChatTarget,
    text: string,
    options?: YandexSendTextOptions,
  ): Promise<YandexSendResult>;
  abstract sendFile(
    target: YandexChatTarget,
    data: Buffer,
    filename: string,
    options?: YandexSendFileOptions,
    mimeType?: string,
  ): Promise<YandexSendResult>;
  abstract getFile(fileId: string): Promise<Buffer>;
  abstract sendTyping(
    target: YandexChatTarget,
    options?: YandexTypingOptions,
  ): Promise<void>;
}
