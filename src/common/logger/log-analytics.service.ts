import { Injectable, Logger } from '@nestjs/common';
import { Prisma, Session } from '@prisma/client';
import { createReadStream } from 'fs';
import { createHash } from 'crypto';
import { createInterface } from 'readline';
import { resolve } from 'path';
import { PrismaService } from '../../database/prisma.service';

type LogPayload = Record<string, unknown>;

const MAPPED_KEYS = new Set([
  'timestamp',
  'type',
  'action',
  'stage',
  'integration',
  'method',
  'status',
  'state',
  'error',
  'text',
  'callbackData',
  'usage',
  'tokens',
  'requestBody',
  'responseBody',
  'telegramId',
  'username',
  'firstName',
  'lastName',
  'chatId',
  'userId',
  'sessionId',
  'articleId',
  'articleTitle',
  'scenarioId',
]);

@Injectable()
export class LogAnalyticsService {
  private readonly logger = new Logger(LogAnalyticsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async ingestPayload(payload: LogPayload, source = 'runtime') {
    try {
      const eventData = await this.buildEventData(payload, source);

      await this.prisma.analyticsEvent.upsert({
        where: { dedupeKey: eventData.dedupeKey },
        create: eventData,
        update: {},
      });
    } catch (error) {
      this.logger.warn(
        `Failed to persist analytics event: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async importFile(filePath: string) {
    const absolutePath = resolve(filePath);
    const stream = createReadStream(absolutePath, { encoding: 'utf-8' });
    const reader = createInterface({
      input: stream,
      crlfDelay: Infinity,
    });

    let processed = 0;
    let imported = 0;
    let skipped = 0;
    let failed = 0;

    for await (const line of reader) {
      const trimmed = line.trim();

      if (!trimmed) {
        continue;
      }

      processed += 1;

      try {
        const payload = JSON.parse(trimmed) as unknown;

        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
          skipped += 1;
          continue;
        }

        const eventData = await this.buildEventData(payload as LogPayload, 'import');
        await this.prisma.analyticsEvent.upsert({
          where: { dedupeKey: eventData.dedupeKey },
          create: eventData,
          update: {},
        });
        imported += 1;
      } catch {
        failed += 1;
      }
    }

    return {
      processed,
      imported,
      skipped,
      failed,
      filePath: absolutePath,
    };
  }

  private async buildEventData(
    payload: LogPayload,
    source: string,
  ): Promise<Prisma.AnalyticsEventCreateInput> {
    const occurredAt = this.parseDate(payload.timestamp);
    const telegramId = this.asString(payload.telegramId);
    const userIdFromPayload = this.asString(payload.userId);
    const user =
      userIdFromPayload || !telegramId
        ? userIdFromPayload
          ? await this.prisma.user.findUnique({
              where: { id: userIdFromPayload },
              select: { id: true },
            })
          : null
        : await this.prisma.user.findUnique({
            where: { telegramId },
            select: { id: true },
          });
    const userId = user?.id ?? userIdFromPayload ?? undefined;

    const matchedSession = await this.findSessionForEvent(
      this.asString(payload.sessionId),
      userId,
      occurredAt,
    );

    const articleId =
      this.asString(payload.articleId) ?? matchedSession?.articleId ?? undefined;
    const articleTitle = await this.findArticleTitle(articleId);
    const scenarioId =
      this.asString(payload.scenarioId) ?? matchedSession?.scenarioId ?? undefined;

    const sanitizedRaw = this.sanitizeValue(payload);
    const dedupeKey = this.computeDedupeKey(sanitizedRaw);

    return {
      dedupeKey,
      source,
      occurredAt,
      type: this.asString(payload.type) ?? 'unknown',
      action: this.asString(payload.action),
      stage: this.asString(payload.stage) ?? this.inferStage(payload),
      integration: this.asString(payload.integration),
      method: this.asString(payload.method),
      status: this.asNumber(payload.status),
      state: this.asString(payload.state),
      error: this.asString(payload.error),
      text: this.asString(payload.text),
      callbackData: this.asString(payload.callbackData),
      tokens: this.extractTokens(payload),
      requestBody: this.asInputJsonValue(payload.requestBody, true),
      responseBody: this.asInputJsonValue(payload.responseBody, true),
      metadata: this.getMetadata(payload),
      raw: this.asInputJsonValue(sanitizedRaw, false) as Prisma.InputJsonValue,
      telegramId,
      username: this.asString(payload.username),
      firstName: this.asString(payload.firstName),
      lastName: this.asString(payload.lastName),
      chatId: this.asString(payload.chatId),
      userId,
      sessionId: matchedSession?.id ?? this.asString(payload.sessionId),
      articleId,
      articleTitle,
      scenarioId,
    };
  }

  private async findSessionForEvent(
    sessionId: string | undefined,
    userId: string | undefined,
    occurredAt: Date,
  ) {
    if (sessionId) {
      return this.prisma.session.findUnique({
        where: { id: sessionId },
        select: {
          id: true,
          scenarioId: true,
          articleId: true,
        },
      });
    }

    if (!userId) {
      return null;
    }

    return this.prisma.session.findFirst({
      where: {
        userId,
        createdAt: {
          lte: occurredAt,
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      select: {
        id: true,
        scenarioId: true,
        articleId: true,
      },
    });
  }

  private async findArticleTitle(articleId: string | undefined) {
    if (!articleId) {
      return undefined;
    }

    const article = await this.prisma.article.findUnique({
      where: { id: articleId },
      select: { title: true },
    });

    return article?.title ?? undefined;
  }

  private inferStage(payload: LogPayload) {
    const eventType = this.asString(payload.type);
    const callbackData = this.asString(payload.callbackData);

    if (eventType === 'external_response' && this.asString(payload.integration) === 'bothub') {
      return 'llm_request';
    }

    if (!callbackData) {
      return undefined;
    }

    const callbackStages: Record<string, string> = {
      create_article: 'create_article',
      confirm_questions: 'questions_confirmation',
      confirm_article: 'article_confirmation',
      fact_check_article: 'fact_check',
      rewrite_article: 'article_rewrite',
      seo_rewrite_article: 'seo_rewrite',
      generate_rubrics: 'rubrics',
      generate_products: 'products',
    };

    return callbackStages[callbackData];
  }

  private extractTokens(payload: LogPayload) {
    const directUsage = this.asNumber(payload.usage) ?? this.asNumber(payload.tokens);

    if (directUsage !== undefined) {
      return directUsage;
    }

    const responseBody = this.asRecord(payload.responseBody);
    const usage = this.asRecord(responseBody?.usage);
    const bothub = this.asRecord(usage?.bothub);
    const caps = this.asNumber(bothub?.caps);

    return caps;
  }

  private getMetadata(
    payload: LogPayload,
  ): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | undefined {
    const metadata: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(payload)) {
      if (MAPPED_KEYS.has(key)) {
        continue;
      }

      metadata[key] = value;
    }

    if (Object.keys(metadata).length === 0) {
      return undefined;
    }

    return this.asInputJsonValue(metadata, true);
  }

  private parseDate(value: unknown) {
    if (typeof value === 'string') {
      const date = new Date(value);
      if (!Number.isNaN(date.getTime())) {
        return date;
      }
    }

    return new Date();
  }

  private computeDedupeKey(value: Prisma.JsonValue) {
    return createHash('sha1')
      .update(this.stableStringify(value))
      .digest('hex');
  }

  private stableStringify(value: Prisma.JsonValue): string {
    if (value === null) {
      return 'null';
    }

    if (Array.isArray(value)) {
      return `[${value.map(item => this.stableStringify(item)).join(',')}]`;
    }

    if (typeof value === 'object') {
      return `{${Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(
          ([key, nestedValue]) =>
            `${JSON.stringify(key)}:${this.stableStringify(
              (nestedValue ?? null) as Prisma.JsonValue,
            )}`,
        )
        .join(',')}}`;
    }

    return JSON.stringify(value);
  }

  private sanitizeValue(
    value: unknown,
    depth = 0,
  ): Prisma.JsonValue {
    if (value === null || value === undefined) {
      return null;
    }

    if (typeof value === 'string') {
      if (value.length <= 2000) {
        return value;
      }

      return `${value.slice(0, 2000)}... [truncated ${value.length - 2000} chars]`;
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      return value;
    }

    if (depth >= 6) {
      return '[truncated depth]';
    }

    if (Array.isArray(value)) {
      return value
        .slice(0, 20)
        .map(item => this.sanitizeValue(item, depth + 1));
    }

    if (typeof value === 'object') {
      const result: Record<string, Prisma.JsonValue> = {};

      for (const [key, nestedValue] of Object.entries(value)) {
        result[key] = this.sanitizeValue(nestedValue, depth + 1);
      }

      return result;
    }

    return String(value);
  }

  private asString(value: unknown) {
    if (value === null || value === undefined) {
      return undefined;
    }

    if (typeof value === 'string') {
      return value;
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }

    return undefined;
  }

  private asNumber(value: unknown) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === 'string') {
      const normalized = value.replace(',', '.').trim();
      const parsed = Number(normalized);

      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }

    return undefined;
  }

  private asRecord(value: unknown): Record<string, unknown> | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined;
    }

    return value as Record<string, unknown>;
  }

  private asInputJsonValue(
    value: unknown,
    allowNull: boolean,
  ): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | undefined {
    if (value === undefined) {
      return undefined;
    }

    const sanitized = this.sanitizeValue(value);

    if (sanitized === null) {
      return allowNull ? Prisma.JsonNull : undefined;
    }

    return sanitized as Prisma.InputJsonValue;
  }
}
