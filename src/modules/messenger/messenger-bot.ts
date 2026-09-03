import { Logger } from '@nestjs/common';
import { MessengerContext } from './messenger-context';
import { InlineKeyboard, InputFile } from './messenger-keyboard';
import { YandexMessengerApiService } from './yandex-messenger-api.service';
import { YandexUpdate } from './yandex-messenger.types';

export type MessengerHandler = (ctx: MessengerContext) => Promise<void> | void;
export type MessengerMiddleware = (
  ctx: MessengerContext,
  next: () => Promise<void>,
) => Promise<void> | void;
export type MessengerErrorHandler = (error: {
  error: unknown;
  ctx?: MessengerContext;
}) => Promise<void> | void;

type CallbackTrigger = string | string[] | RegExp;
type MessageEvent = 'message:text' | 'message:document';

export interface MessengerBotOptions {
  /** Пауза между запросами getUpdates, когда обновлений нет */
  pollIntervalMs?: number;
  /** Пауза после ошибки getUpdates */
  pollErrorDelayMs?: number;
  /** Восстановление offset между рестартами (например, из Redis) */
  loadOffset?: () => Promise<number | null>;
  saveOffset?: (offset: number) => Promise<void>;
}

/**
 * Маршрутизатор обновлений Яндекс Мессенджера: команды, callback-кнопки,
 * текст и документы. Обновления одного чата обрабатываются строго по очереди,
 * разные чаты — параллельно, поэтому долгая генерация у одного редактора
 * не блокирует остальных.
 */
export class MessengerBot {
  readonly api: {
    sendMessage: (
      login: string,
      text: string,
      options?: { reply_markup?: InlineKeyboard },
    ) => Promise<{ message_id: number }>;
    sendDocument: (login: string, file: InputFile) => Promise<unknown>;
    getFile: (fileId: string) => Promise<Buffer>;
  };

  private readonly logger = new Logger(MessengerBot.name);
  private readonly middlewares: MessengerMiddleware[] = [];
  private readonly commands = new Map<string, MessengerHandler>();
  private readonly callbacks: Array<{
    trigger: CallbackTrigger;
    handler: MessengerHandler;
  }> = [];
  private readonly events = new Map<MessageEvent, MessengerHandler[]>();
  private readonly chatQueues = new Map<string, Promise<void>>();
  private errorHandler: MessengerErrorHandler | null = null;
  private polling = false;
  private pollingAbort: AbortController | null = null;

  constructor(
    private readonly client: YandexMessengerApiService,
    private readonly options: MessengerBotOptions = {},
  ) {
    this.api = {
      sendMessage: async (login, text, sendOptions = {}) => {
        const chunks = MessengerContext.splitText(text);
        let lastMessageId = 0;
        for (let index = 0; index < chunks.length; index++) {
          const isLast = index === chunks.length - 1;
          const result = await this.client.sendText({ login }, chunks[index], {
            ...(isLast && sendOptions.reply_markup
              ? { suggest_buttons: sendOptions.reply_markup.toSuggestButtons() }
              : {}),
          });
          lastMessageId = result.message_id;
        }
        return { message_id: lastMessageId };
      },
      sendDocument: (login, file) =>
        this.client.sendFile(
          { login },
          file.data,
          file.filename,
          {},
          file.mimeType,
        ),
      getFile: (fileId) => this.client.getFile(fileId),
    };
  }

  use(middleware: MessengerMiddleware) {
    this.middlewares.push(middleware);
    return this;
  }

  command(name: string, handler: MessengerHandler) {
    this.commands.set(name.toLowerCase(), handler);
    return this;
  }

  callbackQuery(trigger: CallbackTrigger, handler: MessengerHandler) {
    this.callbacks.push({ trigger, handler });
    return this;
  }

  on(event: MessageEvent, handler: MessengerHandler) {
    const handlers = this.events.get(event) ?? [];
    handlers.push(handler);
    this.events.set(event, handlers);
    return this;
  }

  catch(handler: MessengerErrorHandler) {
    this.errorHandler = handler;
    return this;
  }

  /** Тело POST-запроса вебхука: как ответ getUpdates либо одно обновление */
  handleWebhookBody(body: unknown) {
    const updates = MessengerBot.extractUpdates(body);
    for (const update of updates) {
      void this.enqueue(update);
    }
    return updates.length;
  }

  /** Ставит обновление в очередь своего чата и не ждёт обработки */
  enqueue(update: YandexUpdate) {
    const key = MessengerBot.queueKey(update);
    const previous = this.chatQueues.get(key) ?? Promise.resolve();
    const current = previous
      .catch(() => undefined)
      .then(() => this.handleUpdate(update));
    this.chatQueues.set(key, current);
    void current.finally(() => {
      if (this.chatQueues.get(key) === current) {
        this.chatQueues.delete(key);
      }
    });
    return current;
  }

  /** Обрабатывает обновление до конца; ошибки уходят в catch-обработчик */
  async handleUpdate(update: YandexUpdate) {
    const ctx = new MessengerContext(update, this.client);

    if (update.bot_request?.errors?.length) {
      this.logger.warn(
        `Client reported button errors: ${JSON.stringify(
          update.bot_request.errors,
        )}`,
      );
    }

    try {
      await this.runMiddlewares(ctx, 0);
    } catch (error) {
      if (this.errorHandler) {
        await this.errorHandler({ error, ctx });
      } else {
        this.logger.error(`Unhandled update error: ${error}`);
      }
    }
  }

  /** Long polling через getUpdates; вызывать после сброса вебхука */
  async start(onStart?: (info: { login: string }) => void) {
    if (this.polling) {
      return;
    }
    this.polling = true;
    this.pollingAbort = new AbortController();

    const info = await this.client.getSelf();
    onStart?.({ login: info.login });

    let offset = (await this.options.loadOffset?.()) ?? 0;
    const pollInterval = this.options.pollIntervalMs ?? 1000;
    const errorDelay = this.options.pollErrorDelayMs ?? 5000;

    while (this.polling) {
      try {
        const updates = await this.client.getUpdates(offset, 100);
        if (updates.length === 0) {
          await this.sleep(pollInterval);
          continue;
        }

        for (const update of updates) {
          void this.enqueue(update);
        }

        offset = Math.max(...updates.map((update) => update.update_id)) + 1;
        await this.options.saveOffset?.(offset);
      } catch (error) {
        if (!this.polling) {
          break;
        }
        this.logger.warn(`getUpdates failed: ${error}`);
        await this.sleep(errorDelay);
      }
    }
  }

  async stop() {
    this.polling = false;
    this.pollingAbort?.abort();
    this.pollingAbort = null;
    // Даём дообработаться тому, что уже в очередях
    await Promise.allSettled([...this.chatQueues.values()]);
  }

  private async runMiddlewares(
    ctx: MessengerContext,
    index: number,
  ): Promise<void> {
    if (index < this.middlewares.length) {
      await this.middlewares[index](ctx, () =>
        this.runMiddlewares(ctx, index + 1),
      );
      return;
    }
    await this.route(ctx);
  }

  private async route(ctx: MessengerContext) {
    if (ctx.callbackQuery) {
      const data = ctx.callbackQuery.data;
      const match = this.callbacks.find(({ trigger }) =>
        MessengerBot.matches(trigger, data),
      );
      if (match) {
        await match.handler(ctx);
      } else {
        this.logger.warn(`No handler for callback data: ${data}`);
      }
      return;
    }

    if (ctx.message?.document) {
      await this.emit('message:document', ctx);
      return;
    }

    const text = ctx.message?.text;
    if (typeof text === 'string') {
      const command = MessengerBot.parseCommand(text);
      const handler = command ? this.commands.get(command) : undefined;
      if (handler) {
        await handler(ctx);
        return;
      }
      await this.emit('message:text', ctx);
    }
    // Картинки, стикеры и служебные события игнорируем
  }

  private async emit(event: MessageEvent, ctx: MessengerContext) {
    for (const handler of this.events.get(event) ?? []) {
      await handler(ctx);
    }
  }

  /** Пауза, которую прерывает stop(); слушатель abort снимается по таймеру */
  private sleep(ms: number) {
    const signal = this.pollingAbort?.signal;
    return new Promise<void>((resolve) => {
      const onAbort = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  private static matches(trigger: CallbackTrigger, data: string) {
    if (trigger instanceof RegExp) {
      return trigger.test(data);
    }
    if (Array.isArray(trigger)) {
      return trigger.includes(data);
    }
    return trigger === data;
  }

  private static parseCommand(text: string): string | null {
    const match = /^\/([a-zA-Z0-9_]+)(?:@[\w_]+)?(?:\s|$)/.exec(text.trim());
    return match ? match[1].toLowerCase() : null;
  }

  private static queueKey(update: YandexUpdate) {
    if (update.chat.type !== 'private' && update.chat.id) {
      return `chat:${update.chat.id}`;
    }
    return `user:${update.from?.login ?? update.from?.id ?? 'unknown'}`;
  }

  private static extractUpdates(body: unknown): YandexUpdate[] {
    if (!body || typeof body !== 'object') {
      return [];
    }
    const maybeList = (body as { updates?: unknown }).updates;
    if (Array.isArray(maybeList)) {
      return maybeList.filter((item) => MessengerBot.isUpdate(item));
    }
    return MessengerBot.isUpdate(body) ? [body] : [];
  }

  private static isUpdate(value: unknown): value is YandexUpdate {
    return (
      !!value &&
      typeof value === 'object' &&
      typeof (value as YandexUpdate).update_id === 'number' &&
      !!(value as YandexUpdate).chat
    );
  }
}
