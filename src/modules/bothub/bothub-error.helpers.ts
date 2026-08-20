/**
 * Классификация ошибок Bothub.
 *
 * Задача — отличить сбой на той стороне (сервис недоступен, лимит, сеть),
 * который лечится повтором, от ошибки запроса (неверная модель, плагины,
 * авторизация), где повтор бесполезен и нужен администратор.
 */

export type BothubFailureKind =
  | 'unavailable'
  | 'rate_limited'
  | 'network'
  | 'auth'
  | 'config'
  | 'unknown';

export interface BothubFailure {
  kind: BothubFailureKind;
  /** Ключ в config/locales/ru.json для ответа пользователю. */
  messageKey: string;
  /** Имеет ли смысл повторять запрос. */
  retryable: boolean;
  /** HTTP-статус, если ответ вообще был получен. */
  status: number | null;
  /** Код ошибки в теле ответа Bothub, например PLUGINS_ARE_NOT_SUPPORTED. */
  code: string | null;
  /** Значение заголовка Retry-After в миллисекундах, если он пришёл. */
  retryAfterMs: number | null;
}

const RETRYABLE_NETWORK_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'EPIPE',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'ERR_NETWORK',
  'ERR_BAD_RESPONSE',
]);

interface ErrorShape {
  response?: {
    status?: number;
    data?: unknown;
    headers?: Record<string, unknown>;
  };
  code?: string;
  message?: string;
  /** BothubGenerationError: статус и код ответа лежат прямо на ошибке. */
  status?: number;
}

/** Достаёт код ошибки из тела ответа Bothub. Тело может быть и HTML — тогда null. */
export function getBothubErrorCode(error: unknown): string | null {
  const data = (error as ErrorShape)?.response?.data;

  if (!data || typeof data !== 'object') {
    const own = (error as { name?: string; code?: unknown })?.code;
    return (error as { name?: string })?.name === 'BothubGenerationError' &&
      typeof own === 'string' &&
      own
      ? own
      : null;
  }

  const inner = (data as { error?: unknown }).error;

  if (!inner || typeof inner !== 'object') {
    return null;
  }

  const code = (inner as { code?: unknown }).code;

  return typeof code === 'string' && code ? code : null;
}

function parseRetryAfter(headers?: Record<string, unknown>): number | null {
  const raw = headers?.['retry-after'] ?? headers?.['Retry-After'];

  if (raw === undefined || raw === null) {
    return null;
  }

  const seconds = Number(raw);

  if (!Number.isFinite(seconds) || seconds < 0) {
    return null;
  }

  // Заголовку не доверяем безоговорочно: пользователь ждёт ответа в чате.
  return Math.min(seconds, 30) * 1000;
}

export function classifyBothubError(error: unknown): BothubFailure {
  const shape = (error ?? {}) as ErrorShape;
  const status =
    shape.response?.status ??
    (typeof shape.status === 'number' ? shape.status : null);
  const code = getBothubErrorCode(error);
  const retryAfterMs = parseRetryAfter(shape.response?.headers);

  const base = { status, code, retryAfterMs };

  // Ответа не было вовсе — DNS, обрыв соединения, таймаут.
  if (status === null) {
    const transportCode = shape.code ?? '';

    // Клиентский таймаут axios (сейчас 30 минут) повторять бессмысленно:
    // пользователь давно ушёл из диалога, а повтор лишь умножит ожидание.
    if (transportCode === 'ECONNABORTED') {
      return {
        ...base,
        kind: 'network',
        messageKey: 'errors.generation_network',
        retryable: false,
      };
    }
    const isNetwork =
      RETRYABLE_NETWORK_CODES.has(transportCode) ||
      /getaddrinfo|socket hang up|timeout/i.test(shape.message ?? '');

    return isNetwork
      ? {
          ...base,
          kind: 'network',
          messageKey: 'errors.generation_network',
          retryable: true,
        }
      : {
          ...base,
          kind: 'unknown',
          messageKey: 'errors.generation_failed',
          retryable: false,
        };
  }

  if (status === 429) {
    return {
      ...base,
      kind: 'rate_limited',
      messageKey: 'errors.generation_rate_limited',
      retryable: true,
    };
  }

  if (status >= 500) {
    return {
      ...base,
      kind: 'unavailable',
      messageKey: 'errors.generation_unavailable',
      retryable: true,
    };
  }

  if (status === 401 || status === 403) {
    return {
      ...base,
      kind: 'auth',
      messageKey: 'errors.generation_auth',
      retryable: false,
    };
  }

  if (status >= 400) {
    return {
      ...base,
      kind: 'config',
      messageKey: 'errors.generation_config',
      retryable: false,
    };
  }

  return {
    ...base,
    kind: 'unknown',
    messageKey: 'errors.generation_failed',
    retryable: false,
  };
}
