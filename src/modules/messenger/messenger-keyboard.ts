import {
  YandexDirective,
  YandexSuggestButton,
  YandexSuggestButtons,
} from './yandex-messenger.types';

/** Имя серверного действия, под которым уезжают callback-данные кнопок */
export const CALLBACK_ACTION_NAME = 'callback';

/** Ограничение Bot API на длину title/id кнопки */
const BUTTON_TEXT_MAX_LENGTH = 255;

/**
 * Сколько секунд кнопка крутится после нажатия. Снять состояние с сервера
 * Bot API не позволяет — клиент держит его ровно этот таймаут, поэтому он
 * короткий: подтверждение нажатия, а не ожидание ответа. Долгие шаги
 * показывают прогресс индикатором обработки в чате.
 */
const BUTTON_LOADING_SECONDS = 2;

/**
 * Построитель клавиатуры под сообщением. Интерфейс повторяет привычный
 * InlineKeyboard: text()/url()/row(), а на выходе — suggest_buttons Яндекса.
 * Кнопки с callback-данными используют директиву server_action: нажатие не
 * отправляет сообщение в чат, бот получает только bot_request.
 */
export class InlineKeyboard {
  private readonly rows: YandexSuggestButton[][] = [[]];

  text(label: string, callbackData: string): this {
    const id = InlineKeyboard.truncate(callbackData);
    this.currentRow().push({
      id,
      title: InlineKeyboard.truncate(label),
      directives: [
        // Сначала визуальный отклик на клиенте, затем запрос к боту
        {
          type: 'set_elements_state',
          ids: [id],
          state: 'loading',
          timeout_seconds: BUTTON_LOADING_SECONDS,
        },
        {
          type: 'server_action',
          name: CALLBACK_ACTION_NAME,
          payload: { data: callbackData },
        },
      ],
    });
    return this;
  }

  url(label: string, uri: string): this {
    this.currentRow().push({
      id: InlineKeyboard.truncate(`url:${uri}`),
      title: InlineKeyboard.truncate(label),
      directives: [{ type: 'open_uri', uri } satisfies YandexDirective],
    });
    return this;
  }

  row(): this {
    if (this.currentRow().length > 0) {
      this.rows.push([]);
    }
    return this;
  }

  isEmpty() {
    return this.rows.every((row) => row.length === 0);
  }

  /**
   * persist: true — кнопки остаются кликабельными, даже когда сообщение
   * перестало быть последним. Так вели себя inline-клавиатуры Telegram,
   * и сценарии бота на это рассчитывают (например, «Повторить шаг»).
   */
  toSuggestButtons(): YandexSuggestButtons | undefined {
    const buttons = this.rows.filter((row) => row.length > 0);
    if (buttons.length === 0) {
      return undefined;
    }
    return { layout: 'true', persist: true, buttons };
  }

  private currentRow() {
    return this.rows[this.rows.length - 1];
  }

  private static truncate(value: string) {
    return value.length > BUTTON_TEXT_MAX_LENGTH
      ? value.slice(0, BUTTON_TEXT_MAX_LENGTH)
      : value;
  }
}

/** Файл для отправки пользователю */
export class InputFile {
  constructor(
    readonly data: Buffer,
    readonly filename: string,
    readonly mimeType = InputFile.guessMimeType(filename),
  ) {}

  private static guessMimeType(filename: string) {
    const lower = filename.toLowerCase();
    if (lower.endsWith('.docx')) {
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    }
    if (lower.endsWith('.txt') || lower.endsWith('.md')) {
      return 'text/plain';
    }
    if (lower.endsWith('.pdf')) {
      return 'application/pdf';
    }
    return 'application/octet-stream';
  }
}
