import { randomUUID } from 'crypto';
import { appendFile, mkdir, readdir, rm, writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import { promisify } from 'util';
import { gzip } from 'zlib';

const gzipAsync = promisify(gzip);

/** Сколько дней хранить трассы: каждая — сжатый JSON с сырым потоком */
const RETENTION_DAYS = 30;
/** Сколько последних строк потока дублировать в сводку — видно, чем он кончился */
const TAIL_LINES = 30;

/**
 * Полная трасса одного запроса генерации в Bothub: что отправили, что и когда
 * пришло, чем закончился поток. Нужна для разбора обрывов (finish_reason=error)
 * с поддержкой Bothub: раньше в AnalyticsEvents тела резались до 2000 символов,
 * а заголовков, таймингов и текста ошибки из потока не было вовсе.
 *
 * Пишется в BOTHUB_TRACE_DIR (по умолчанию logs/bothub-traces):
 * - <дата>/<время>_<этап>_<id>.json.gz — всё, включая сырой SSE-поток;
 * - index-<дата>.jsonl — сводка по строке на запрос, без тел.
 */
export class BothubTrace {
  private static lastPruneDay = '';

  readonly id = randomUUID();
  private readonly startedAt = Date.now();
  private raw = '';
  private chunks = 0;
  private bytes = 0;
  private lines: string[] = [];
  private readonly errorPayloads: string[] = [];
  private readonly marks: Record<string, number> = {};
  private readonly data: Record<string, unknown> = {};

  constructor(
    private readonly meta: {
      stage?: string;
      attempt?: number;
      user?: Record<string, unknown>;
    },
  ) {}

  request(
    method: string,
    url: string,
    headers: Record<string, string>,
    body: unknown,
  ) {
    this.data.request = {
      method,
      url,
      headers: BothubTrace.redactHeaders(headers),
      body,
    };
  }

  response(status: number | undefined, headers: unknown) {
    this.mark('headers');
    this.data.response = {
      status,
      headers: BothubTrace.plainHeaders(headers),
    };
  }

  /** Сырой фрагмент потока — как пришёл из сокета */
  chunk(text: string) {
    this.mark('firstChunk');
    this.marks.lastChunk = Date.now() - this.startedAt;
    this.chunks += 1;
    this.bytes += Buffer.byteLength(text);
    this.raw += text;
  }

  /** Строка SSE после разбора: ловим первые рассуждения/текст и ошибки */
  line(line: string, parsed?: Record<string, unknown>) {
    this.lines.push(line);
    if (this.lines.length > TAIL_LINES) {
      this.lines.shift();
    }
    if (line.includes('[DONE]')) {
      this.data.doneMarker = true;
    }
    if (!parsed) {
      return;
    }
    const choice = (
      parsed.choices as
        | Array<{
            delta?: { content?: unknown; reasoning?: unknown };
            finish_reason?: unknown;
          }>
        | undefined
    )?.[0];
    if (choice?.delta?.reasoning) {
      this.mark('firstReasoning');
    }
    if (choice?.delta?.content) {
      this.mark('firstContent');
    }
    if (
      parsed.error !== undefined ||
      (choice?.finish_reason && choice.finish_reason !== 'stop')
    ) {
      this.errorPayloads.push(line);
    }
  }

  /** Bothub ответил HTTP-ошибкой: тело уже дочитано из потока */
  httpError(status: number | undefined, headers: unknown, body: unknown) {
    this.response(status, headers);
    (this.data.response as Record<string, unknown>).body = body;
  }

  /** Как закончился поток: штатно, ошибкой сокета или исключением */
  end(
    endedBy: 'stream_end' | 'stream_error' | 'request_error',
    details: Record<string, unknown> = {},
  ) {
    this.marks.ended = Date.now() - this.startedAt;
    this.data.endedBy = endedBy;
    Object.assign(this.data, details);
  }

  /** Записывает трассу; ошибки записи не должны ломать генерацию */
  async save(): Promise<string> {
    try {
      const started = new Date(this.startedAt);
      const day = started.toISOString().slice(0, 10);
      const time = started.toISOString().slice(11, 19).replace(/:/g, '');
      const dir = join(BothubTrace.baseDir(), day);
      const file = join(
        dir,
        `${time}_${this.meta.stage ?? 'unknown'}_${this.id}.json.gz`,
      );

      const summary = {
        traceId: this.id,
        startedAt: started.toISOString(),
        stage: this.meta.stage,
        attempt: this.meta.attempt,
        user: this.meta.user,
        model: (
          (this.data.request as { body?: { model?: unknown } } | undefined)
            ?.body ?? {}
        ).model,
        status: (this.data.response as { status?: unknown } | undefined)
          ?.status,
        bothubRequestId: BothubTrace.pickHeader(this.data.response, [
          'x-request-id',
          'x-bothub-request-id',
          'cf-ray',
        ]),
        timingMs: this.marks,
        chunks: this.chunks,
        bytes: this.bytes,
        doneMarker: Boolean(this.data.doneMarker),
        endedBy: this.data.endedBy,
        finishReason: this.data.finishReason,
        contentLength: this.data.contentLength,
        reasoningLength: this.data.reasoningLength,
        caps: this.data.caps,
        socketError: this.data.socketError,
        error: this.data.error,
        errorPayloads: this.errorPayloads,
        file,
      };

      await mkdir(dir, { recursive: true });
      await writeFile(
        file,
        await gzipAsync(
          JSON.stringify(
            {
              ...summary,
              ...this.data,
              tailLines: this.lines,
              rawStream: this.raw,
            },
            null,
            1,
          ),
        ),
      );
      await appendFile(
        join(BothubTrace.baseDir(), `index-${day}.jsonl`),
        `${JSON.stringify(summary)}\n`,
      );
      void BothubTrace.prune(day);
    } catch {
      // трасса — диагностика, генерацию из-за неё не роняем
    }
    return this.id;
  }

  private mark(name: string) {
    if (this.marks[name] === undefined) {
      this.marks[name] = Date.now() - this.startedAt;
    }
  }

  private static baseDir() {
    return resolve(process.env.BOTHUB_TRACE_DIR ?? 'logs/bothub-traces');
  }

  private static async prune(today: string) {
    if (BothubTrace.lastPruneDay === today) {
      return;
    }
    BothubTrace.lastPruneDay = today;
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000)
      .toISOString()
      .slice(0, 10);
    try {
      for (const entry of await readdir(BothubTrace.baseDir())) {
        const day = entry.match(/(\d{4}-\d{2}-\d{2})/)?.[1];
        if (day && day < cutoff) {
          await rm(join(BothubTrace.baseDir(), entry), {
            recursive: true,
            force: true,
          });
        }
      }
    } catch {
      // нет каталога — нечего чистить
    }
  }

  /** Ключ API не пишем: только схему и последние 4 символа, чтобы различать ключи */
  private static redactHeaders(headers: Record<string, string>) {
    return Object.fromEntries(
      Object.entries(headers).map(([key, value]) =>
        key.toLowerCase() === 'authorization'
          ? [
              key,
              `${String(value).split(' ')[0]} ***${String(value).slice(-4)}`,
            ]
          : [key, value],
      ),
    );
  }

  private static plainHeaders(headers: unknown) {
    if (!headers || typeof headers !== 'object') {
      return headers;
    }
    const source =
      typeof (headers as { toJSON?: unknown }).toJSON === 'function'
        ? (headers as { toJSON: () => unknown }).toJSON()
        : headers;
    return JSON.parse(JSON.stringify(source)) as Record<string, unknown>;
  }

  private static pickHeader(response: unknown, names: string[]) {
    const headers = (response as { headers?: Record<string, unknown> })
      ?.headers;
    if (!headers) {
      return undefined;
    }
    for (const name of names) {
      if (headers[name] !== undefined) {
        return headers[name];
      }
    }
    return undefined;
  }
}
