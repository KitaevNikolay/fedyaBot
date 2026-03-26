import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

type Granularity = 'day' | 'week' | 'month';
type ContextEvent = {
  occurredAt: Date;
  userId: string | null;
  sessionId: string | null;
  type: string;
  callbackData: string | null;
  state: string | null;
  stage: string | null;
};

@Injectable()
export class AdminAnalyticsService {
  private readonly historyTimeZone = 'Europe/Moscow';

  constructor(private readonly prisma: PrismaService) {}

  async getAnalyticsUsers() {
    const [users, eventSummary, tokenSummary, sessionSummary] = await Promise.all([
      this.prisma.user.findMany({
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          telegramId: true,
          firstName: true,
          lastName: true,
          username: true,
          isActive: true,
          role: true,
          createdAt: true,
        },
      }),
      this.prisma.analyticsEvent.groupBy({
        by: ['userId'],
        where: {
          userId: { not: null },
        },
        _count: { _all: true },
        _max: { occurredAt: true },
      }),
      this.prisma.analyticsEvent.groupBy({
        by: ['userId'],
        where: {
          userId: { not: null },
          tokens: { not: null },
          type: 'external_response',
          integration: 'bothub',
        },
        _sum: { tokens: true },
      }),
      this.prisma.session.groupBy({
        by: ['userId'],
        _count: { _all: true },
      }),
    ]);

    const eventSummaryMap = new Map(
      eventSummary
        .filter(item => item.userId)
        .map(item => [item.userId!, item]),
    );
    const tokenSummaryMap = new Map(
      tokenSummary
        .filter(item => item.userId)
        .map(item => [item.userId!, item]),
    );
    const sessionSummaryMap = new Map(
      sessionSummary.map(item => [item.userId, item._count._all]),
    );

    return users.map(user => {
      const analytics = eventSummaryMap.get(user.id);
      const tokens = tokenSummaryMap.get(user.id);

      return {
        ...user,
        status: user.isActive ? 'approved' : 'blocked',
        analytics: {
          eventsCount: analytics?._count._all ?? 0,
          totalTokens: tokens?._sum.tokens ?? 0,
          lastEventAt: analytics?._max.occurredAt ?? null,
          sessionsCount: sessionSummaryMap.get(user.id) ?? 0,
        },
      };
    });
  }

  async getUserOverview(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        telegramId: true,
        firstName: true,
        lastName: true,
        username: true,
        isActive: true,
        role: true,
        createdAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const [eventSummary, tokenSummary, sessions, sessionEventSummary, sessionTokenSummary] =
      await Promise.all([
      this.prisma.analyticsEvent.groupBy({
        by: ['userId'],
        where: { userId },
        _count: { _all: true },
        _max: { occurredAt: true },
      }),
      this.prisma.analyticsEvent.groupBy({
        by: ['userId'],
        where: {
          userId,
          tokens: { not: null },
          type: 'external_response',
          integration: 'bothub',
        },
        _sum: { tokens: true },
      }),
      this.prisma.session.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          scenarioId: true,
          articleId: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.analyticsEvent.groupBy({
        by: ['sessionId'],
        where: {
          userId,
          sessionId: { not: null },
        },
        _count: { _all: true },
        _max: { occurredAt: true },
      }),
      this.prisma.analyticsEvent.groupBy({
        by: ['sessionId'],
        where: {
          userId,
          sessionId: { not: null },
          tokens: { not: null },
          type: 'external_response',
          integration: 'bothub',
        },
        _sum: { tokens: true },
      }),
    ]);

    const articleIds = sessions
      .map(item => item.articleId)
      .filter((value): value is string => Boolean(value));
    const articles = articleIds.length
      ? await this.prisma.article.findMany({
          where: { id: { in: articleIds } },
          select: { id: true, title: true },
        })
      : [];

    const articleTitleMap = new Map(articles.map(article => [article.id, article.title]));
    const sessionSummaryMap = new Map(
      sessionEventSummary
        .filter(item => item.sessionId)
        .map(item => [item.sessionId!, item]),
    );
    const sessionTokenSummaryMap = new Map(
      sessionTokenSummary
        .filter(item => item.sessionId)
        .map(item => [item.sessionId!, item]),
    );

    return {
      user: {
        ...user,
        status: user.isActive ? 'approved' : 'blocked',
      },
      analytics: {
        eventsCount: eventSummary[0]?._count._all ?? 0,
        totalTokens: tokenSummary[0]?._sum.tokens ?? 0,
        lastEventAt: eventSummary[0]?._max.occurredAt ?? null,
        sessionsCount: sessions.length,
      },
      sessions: sessions.map(session => {
        const summary = sessionSummaryMap.get(session.id);
        const tokenSummaryItem = sessionTokenSummaryMap.get(session.id);

        return {
          ...session,
          articleTitle: session.articleId
            ? articleTitleMap.get(session.articleId) ?? null
            : null,
          eventsCount: summary?._count._all ?? 0,
          totalTokens: tokenSummaryItem?._sum.tokens ?? 0,
          lastEventAt: summary?._max.occurredAt ?? null,
        };
      }),
    };
  }

  async getSessionEvents(sessionId: string) {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        userId: true,
        scenarioId: true,
        articleId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!session) {
      throw new NotFoundException('Session not found');
    }

    const [article, events] = await Promise.all([
      session.articleId
        ? this.prisma.article.findUnique({
            where: { id: session.articleId },
            select: { id: true, title: true },
          })
        : null,
      this.prisma.analyticsEvent.findMany({
        where: { sessionId },
        orderBy: { occurredAt: 'asc' },
        select: {
          id: true,
          occurredAt: true,
          type: true,
          action: true,
          stage: true,
          integration: true,
          method: true,
          status: true,
          state: true,
          error: true,
          text: true,
          callbackData: true,
          tokens: true,
          articleId: true,
          articleTitle: true,
          requestBody: true,
          responseBody: true,
          metadata: true,
        },
      }),
    ]);

    return {
      session: {
        ...session,
        articleTitle: article?.title ?? null,
      },
      events,
    };
  }

  async getHistoryUsers() {
    const [users, eventSummary, tokenSummary, sessionSummary, activityEvents] =
      await Promise.all([
        this.prisma.user.findMany({
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            telegramId: true,
            firstName: true,
            lastName: true,
            username: true,
            isActive: true,
            role: true,
            createdAt: true,
          },
        }),
        this.prisma.analyticsEvent.groupBy({
          by: ['userId'],
          where: {
            userId: { not: null },
          },
          _count: { _all: true },
          _max: { occurredAt: true },
        }),
        this.prisma.analyticsEvent.groupBy({
          by: ['userId'],
          where: {
            userId: { not: null },
            tokens: { not: null },
            type: 'external_response',
            integration: 'bothub',
          },
          _sum: { tokens: true },
        }),
        this.prisma.session.groupBy({
          by: ['userId'],
          _count: { _all: true },
        }),
        this.prisma.analyticsEvent.findMany({
          where: {
            userId: { not: null },
          },
          select: {
            userId: true,
            occurredAt: true,
          },
        }),
      ]);

    const eventSummaryMap = new Map(
      eventSummary
        .filter(item => item.userId)
        .map(item => [item.userId!, item]),
    );
    const tokenSummaryMap = new Map(
      tokenSummary
        .filter(item => item.userId)
        .map(item => [item.userId!, item]),
    );
    const sessionSummaryMap = new Map(
      sessionSummary.map(item => [item.userId, item._count._all]),
    );
    const activeDaysMap = new Map<string, Set<string>>();

    for (const event of activityEvents) {
      if (!event.userId) {
        continue;
      }

      const current = activeDaysMap.get(event.userId) ?? new Set<string>();
      current.add(this.formatHistoryDay(event.occurredAt));
      activeDaysMap.set(event.userId, current);
    }

    return users
      .map(user => {
        const analytics = eventSummaryMap.get(user.id);
        const tokens = tokenSummaryMap.get(user.id);
        const activeDays = activeDaysMap.get(user.id);

        return {
          ...user,
          status: user.isActive ? 'approved' : 'blocked',
          analytics: {
            eventsCount: analytics?._count._all ?? 0,
            totalTokens: tokens?._sum.tokens ?? 0,
            lastEventAt: analytics?._max.occurredAt ?? null,
            sessionsCount: sessionSummaryMap.get(user.id) ?? 0,
            activeDaysCount: activeDays?.size ?? 0,
          },
        };
      })
      .sort((left, right) => {
        const leftTime = left.analytics.lastEventAt
          ? new Date(left.analytics.lastEventAt).getTime()
          : 0;
        const rightTime = right.analytics.lastEventAt
          ? new Date(right.analytics.lastEventAt).getTime()
          : 0;

        return rightTime - leftTime;
      });
  }

  async getUserHistoryDays(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        telegramId: true,
        firstName: true,
        lastName: true,
        username: true,
        isActive: true,
        role: true,
        createdAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const events = await this.prisma.analyticsEvent.findMany({
      where: { userId },
      orderBy: { occurredAt: 'asc' },
      select: {
        occurredAt: true,
        type: true,
        integration: true,
        tokens: true,
        sessionId: true,
      },
    });

    const daysMap = new Map<
      string,
      {
        date: string;
        eventsCount: number;
        sessions: Set<string>;
        totalTokens: number;
        firstEventAt: Date;
        lastEventAt: Date;
      }
    >();

    for (const event of events) {
      const date = this.formatHistoryDay(event.occurredAt);
      const current = daysMap.get(date) ?? {
        date,
        eventsCount: 0,
        sessions: new Set<string>(),
        totalTokens: 0,
        firstEventAt: event.occurredAt,
        lastEventAt: event.occurredAt,
      };

      current.eventsCount += 1;
      if (event.sessionId) {
        current.sessions.add(event.sessionId);
      }
      if (this.isTokenUsageEvent(event)) {
        current.totalTokens += event.tokens ?? 0;
      }
      if (event.occurredAt < current.firstEventAt) {
        current.firstEventAt = event.occurredAt;
      }
      if (event.occurredAt > current.lastEventAt) {
        current.lastEventAt = event.occurredAt;
      }

      daysMap.set(date, current);
    }

    return {
      user: {
        ...user,
        status: user.isActive ? 'approved' : 'blocked',
      },
      days: Array.from(daysMap.values())
        .map(day => ({
          date: day.date,
          eventsCount: day.eventsCount,
          sessionsCount: day.sessions.size,
          totalTokens: day.totalTokens,
          firstEventAt: day.firstEventAt,
          lastEventAt: day.lastEventAt,
        }))
        .sort((left, right) => right.date.localeCompare(left.date)),
    };
  }

  async getUserHistoryTimeline(userId: string, date: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        telegramId: true,
        firstName: true,
        lastName: true,
        username: true,
        isActive: true,
        role: true,
        createdAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const range = this.getHistoryDayRange(date);
    const events = await this.prisma.analyticsEvent.findMany({
      where: {
        userId,
        occurredAt: {
          gte: range.from,
          lt: range.to,
        },
      },
      orderBy: { occurredAt: 'asc' },
      select: {
        id: true,
        occurredAt: true,
        type: true,
        action: true,
        stage: true,
        integration: true,
        method: true,
        status: true,
        state: true,
        error: true,
        text: true,
        callbackData: true,
        tokens: true,
        articleId: true,
        articleTitle: true,
        sessionId: true,
        requestBody: true,
        responseBody: true,
        metadata: true,
      },
    });
    const contextMaps = await this.buildContextMapsForEvents(
      events.map(event => ({
        occurredAt: event.occurredAt,
        userId,
        sessionId: event.sessionId,
        type: event.type,
        callbackData: event.callbackData,
        state: event.state,
        stage: event.stage,
      })),
      {
        from: range.from,
        to: range.to,
      },
    );

    const normalizedEvents = events.map(event => ({
      ...event,
      stage: this.resolveGenerationType(
        {
          occurredAt: event.occurredAt,
          userId,
          sessionId: event.sessionId,
          stage: event.stage,
        },
        event.sessionId
          ? contextMaps.sessionContextMap.get(event.sessionId)
          : undefined,
        contextMaps.userContextMap.get(userId),
      ),
    }));
    const stageKeys = Array.from(
      new Set(
        normalizedEvents
          .map(event => event.stage)
          .filter((value): value is string => Boolean(value)),
      ),
    );
    const generationSettings = await this.prisma.generationSettings.findMany({
      where: {
        type: { in: stageKeys },
      },
      select: {
        type: true,
        typeName: true,
      },
    });
    const stageLabelMap = new Map(
      generationSettings.map(setting => [
        setting.type,
        setting.typeName?.trim() || setting.type,
      ]),
    );

    const sessionIds = Array.from(
      new Set(
        normalizedEvents
          .map(event => event.sessionId)
          .filter((value): value is string => Boolean(value)),
      ),
    );
    const sessions = sessionIds.length
      ? await this.prisma.session.findMany({
          where: {
            id: { in: sessionIds },
          },
          select: {
            id: true,
            scenarioId: true,
            articleId: true,
          },
        })
      : [];

    const sessionMap = new Map(
      sessions.map(session => [
        session.id,
        {
          id: session.id,
          scenarioId: session.scenarioId,
          articleId: session.articleId,
        },
      ]),
    );

    return {
      user: {
        ...user,
        status: user.isActive ? 'approved' : 'blocked',
      },
      date,
      range,
      summary: {
        eventsCount: normalizedEvents.length,
        sessionsCount: sessionIds.length,
        totalTokens: normalizedEvents.reduce(
          (total, event) =>
            total + (this.isTokenUsageEvent(event) ? event.tokens ?? 0 : 0),
          0,
        ),
      },
      stageLabels: Object.fromEntries(
        stageKeys.map(stage => [stage, this.getStageLabel(stage, stageLabelMap)]),
      ),
      events: normalizedEvents.map(event => ({
        ...event,
        session: event.sessionId ? sessionMap.get(event.sessionId) ?? null : null,
      })),
    };
  }

  async getTokenAnalytics(params: {
    granularity?: string;
    userIds?: string;
    from?: string;
    to?: string;
  }) {
    const granularity = this.normalizeGranularity(params.granularity);
    const range = this.getRange(params.from, params.to);
    const userIds = params.userIds
      ?.split(',')
      .map(item => item.trim())
      .filter(Boolean);

    const where: Prisma.AnalyticsEventWhereInput = {
      tokens: { not: null },
      type: 'external_response',
      integration: 'bothub',
      occurredAt: {
        gte: range.from,
        lte: range.to,
      },
    };

    if (userIds && userIds.length > 0) {
      where.userId = { in: userIds };
    }

    const events = await this.prisma.analyticsEvent.findMany({
      where,
      orderBy: { occurredAt: 'asc' },
      select: {
        occurredAt: true,
        userId: true,
        sessionId: true,
        type: true,
        callbackData: true,
        state: true,
        stage: true,
        tokens: true,
      },
    });

    const { sessionContextMap, userContextMap } =
      await this.buildContextMapsForEvents(events, range);
    const userIdList = Array.from(
      new Set(
        events.map(item => item.userId).filter((value): value is string => Boolean(value)),
      ),
    );

    const users = userIdList.length
      ? await this.prisma.user.findMany({
          where: { id: { in: userIdList } },
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            telegramId: true,
          },
        })
      : [];
    const generationSettings = await this.prisma.generationSettings.findMany({
      select: {
        type: true,
        typeName: true,
      },
    });

    const userMap = new Map(
      users.map(user => [
        user.id,
        [user.firstName, user.lastName].filter(Boolean).join(' ').trim() ||
          (user.username ? `@${user.username}` : user.telegramId),
      ]),
    );
    const stageLabelMap = new Map(
      generationSettings.map(setting => [
        setting.type,
        setting.typeName?.trim() || setting.type,
      ]),
    );

    const stageSet = new Set<string>();
    const periods = new Map<
      string,
      {
        period: string;
        totalTokens: number;
        byStage: Record<string, number>;
      }
    >();
    const userTotals = new Map<
      string,
      {
        userId: string;
        label: string;
        totalTokens: number;
      }
    >();

    for (const event of events) {
      const tokens = event.tokens ?? 0;
      const stage = this.resolveGenerationType(
        event,
        event.sessionId ? sessionContextMap.get(event.sessionId) : undefined,
        event.userId ? userContextMap.get(event.userId) : undefined,
      );
      const period = this.formatPeriod(event.occurredAt, granularity);
      stageSet.add(stage);

      const periodItem = periods.get(period) ?? {
        period,
        totalTokens: 0,
        byStage: {},
      };
      periodItem.totalTokens += tokens;
      periodItem.byStage[stage] = (periodItem.byStage[stage] ?? 0) + tokens;
      periods.set(period, periodItem);

      if (event.userId) {
        const current = userTotals.get(event.userId) ?? {
          userId: event.userId,
          label: userMap.get(event.userId) ?? event.userId,
          totalTokens: 0,
        };
        current.totalTokens += tokens;
        userTotals.set(event.userId, current);
      }
    }

    return {
      granularity,
      range,
      stages: Array.from(stageSet).sort(),
      stageLabels: Object.fromEntries(
        Array.from(stageSet)
          .sort()
          .map(stage => [stage, this.getStageLabel(stage, stageLabelMap)]),
      ),
      periods: Array.from(periods.values()),
      users: Array.from(userTotals.values()).sort(
        (left, right) => right.totalTokens - left.totalTokens,
      ),
    };
  }

  private normalizeGranularity(granularity?: string): Granularity {
    if (granularity === 'week' || granularity === 'month') {
      return granularity;
    }

    return 'day';
  }

  private getRange(from?: string, to?: string) {
    const parsedTo = to ? new Date(to) : new Date();
    const parsedFrom = from
      ? new Date(from)
      : new Date(parsedTo.getTime() - 1000 * 60 * 60 * 24 * 30);

    return {
      from: Number.isNaN(parsedFrom.getTime())
        ? new Date(Date.now() - 1000 * 60 * 60 * 24 * 30)
        : parsedFrom,
      to: Number.isNaN(parsedTo.getTime()) ? new Date() : parsedTo,
    };
  }

  private formatPeriod(date: Date, granularity: Granularity) {
    const utcDate = new Date(date);

    if (granularity === 'month') {
      return `${utcDate.getUTCFullYear()}-${String(utcDate.getUTCMonth() + 1).padStart(2, '0')}`;
    }

    if (granularity === 'week') {
      const weekDate = new Date(
        Date.UTC(
          utcDate.getUTCFullYear(),
          utcDate.getUTCMonth(),
          utcDate.getUTCDate(),
        ),
      );
      const day = weekDate.getUTCDay() || 7;
      weekDate.setUTCDate(weekDate.getUTCDate() + 4 - day);
      const yearStart = new Date(Date.UTC(weekDate.getUTCFullYear(), 0, 1));
      const weekNo = Math.ceil(
        ((weekDate.getTime() - yearStart.getTime()) / 86400000 + 1) / 7,
      );

      return `${weekDate.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
    }

    return `${utcDate.getUTCFullYear()}-${String(utcDate.getUTCMonth() + 1).padStart(2, '0')}-${String(utcDate.getUTCDate()).padStart(2, '0')}`;
  }

  private resolveGenerationType(
    event: {
      occurredAt: Date;
      userId: string | null;
      sessionId: string | null;
      stage: string | null;
    },
    sessionEvents?: Array<{
      occurredAt: Date;
      type: string;
      callbackData: string | null;
      state: string | null;
      stage: string | null;
    }>,
    userEvents?: Array<{
      occurredAt: Date;
      type: string;
      callbackData: string | null;
      state: string | null;
      stage: string | null;
    }>,
  ) {
    const normalizedStage = this.normalizeGenerationType(event.stage);

    if (normalizedStage) {
      return normalizedStage;
    }

    const inferredFromSession = this.findGenerationTypeFromContext(
      event.occurredAt,
      sessionEvents,
    );

    if (inferredFromSession) {
      return inferredFromSession;
    }

    const inferredFromUser = this.findGenerationTypeFromContext(
      event.occurredAt,
      userEvents,
    );

    if (inferredFromUser) {
      return inferredFromUser;
    }

    return 'unknown';
  }

  private findGenerationTypeFromContext(
    occurredAt: Date,
    contextEvents?: Array<{
      occurredAt: Date;
      type: string;
      callbackData: string | null;
      state: string | null;
      stage: string | null;
    }>,
  ) {
    if (!contextEvents || contextEvents.length === 0) {
      return null;
    }

    for (let index = contextEvents.length - 1; index >= 0; index -= 1) {
      const contextEvent = contextEvents[index];

      if (contextEvent.occurredAt > occurredAt) {
        continue;
      }

      const distanceMs = occurredAt.getTime() - contextEvent.occurredAt.getTime();
      if (distanceMs > 15 * 60 * 1000) {
        break;
      }

      const normalizedStage = this.normalizeGenerationType(contextEvent.stage);
      if (normalizedStage) {
        return normalizedStage;
      }

      const callbackMapped = this.mapCallbackToGenerationType(
        contextEvent.callbackData,
      );
      if (callbackMapped) {
        return callbackMapped;
      }

      const stateMapped = this.mapStateToGenerationType(contextEvent.state);
      if (stateMapped) {
        return stateMapped;
      }
    }

    return null;
  }

  private mapCallbackToGenerationType(callbackData: string | null) {
    if (!callbackData) {
      return null;
    }

    const callbackMap: Record<string, string> = {
      confirm_title: 'generate_questions',
      confirm_questions: 'generate_article',
      fact_check_generation: 'generate_fact_check',
      fact_check_rewrite: 'rewrite_article',
      rubrics: 'generate_rubrics',
      products: 'generate_products',
      article_uniqueness: 'article_uniqueness',
      confirm_user_prompt: 'uniq_prompt',
    };

    return callbackMap[callbackData] ?? null;
  }

  private mapStateToGenerationType(state: string | null) {
    if (!state) {
      return null;
    }

    const stateMap: Record<string, string> = {
      WAITING_FOR_TOPIC_CONFIRMATION: 'generate_questions',
      WAITING_FOR_QUESTIONS_CONFIRMATION: 'generate_article',
      WAITING_FOR_ARTICLE_CONFIRMATION: 'generate_article',
      WAITING_FOR_FACT_CHECK_CONFIRMATION: 'generate_fact_check',
      WAITING_FOR_REWRITE_CONFIRMATION: 'rewrite_article',
      WAITING_FOR_SEO_TZ_FILE: 'seo_rewrite_article',
      WAITING_FOR_UNIQUENESS_CONFIRMATION: 'article_uniqueness',
      WAITING_FOR_USER_PROMPT_CONFIRMATION: 'uniq_prompt',
    };

    return stateMap[state] ?? null;
  }

  private isTokenUsageEvent(event: {
    type: string;
    integration: string | null;
    tokens: number | null;
  }) {
    return (
      event.type === 'external_response' &&
      event.integration === 'bothub' &&
      event.tokens !== null
    );
  }

  private normalizeGenerationType(stage: string | null) {
    if (!stage || stage === 'llm_request') {
      return null;
    }

    const aliasMap: Record<string, string> = {
      create_article: 'generate_questions',
      questions_confirmation: 'generate_article',
      article_confirmation: 'generate_fact_check',
      fact_check: 'generate_fact_check',
      article_rewrite: 'rewrite_article',
      seo_rewrite: 'seo_rewrite_article',
      rubrics: 'generate_rubrics',
      products: 'generate_products',
      user_prompt: 'uniq_prompt',
    };

    return aliasMap[stage] ?? stage;
  }

  private getStageLabel(stage: string, stageLabelMap: Map<string, string>) {
    if (stage === 'unknown') {
      return 'Не определено';
    }

    return stageLabelMap.get(stage) ?? stage;
  }

  private async buildContextMapsForEvents(
    events: Array<{
      occurredAt: Date;
      userId: string | null;
      sessionId: string | null;
      type: string;
      callbackData: string | null;
      state: string | null;
      stage: string | null;
    }>,
    range: { from: Date; to: Date },
  ) {
    const sessionIds = Array.from(
      new Set(
        events
          .map(item => item.sessionId)
          .filter((value): value is string => Boolean(value)),
      ),
    );
    const userIdList = Array.from(
      new Set(
        events.map(item => item.userId).filter((value): value is string => Boolean(value)),
      ),
    );

    const contextEvents =
      sessionIds.length > 0 || userIdList.length > 0
        ? await this.prisma.analyticsEvent.findMany({
            where: {
              occurredAt: {
                gte: range.from,
                lte: range.to,
              },
              OR: [
                sessionIds.length > 0 ? { sessionId: { in: sessionIds } } : undefined,
                userIdList.length > 0 ? { userId: { in: userIdList } } : undefined,
              ].filter(Boolean) as Prisma.AnalyticsEventWhereInput[],
            },
            orderBy: { occurredAt: 'asc' },
            select: {
              occurredAt: true,
              userId: true,
              sessionId: true,
              type: true,
              callbackData: true,
              state: true,
              stage: true,
            },
          })
        : [];

    const sessionContextMap = new Map<string, ContextEvent[]>();
    const userContextMap = new Map<string, ContextEvent[]>();

    for (const contextEvent of contextEvents) {
      if (contextEvent.sessionId) {
        const sessionEvents = sessionContextMap.get(contextEvent.sessionId) ?? [];
        sessionEvents.push(contextEvent);
        sessionContextMap.set(contextEvent.sessionId, sessionEvents);
      }

      if (contextEvent.userId) {
        const userEvents = userContextMap.get(contextEvent.userId) ?? [];
        userEvents.push(contextEvent);
        userContextMap.set(contextEvent.userId, userEvents);
      }
    }

    return {
      sessionContextMap,
      userContextMap,
    };
  }

  private formatHistoryDay(date: Date) {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: this.historyTimeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });

    return formatter.format(date);
  }

  private getHistoryDayRange(date: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new NotFoundException('Invalid date');
    }

    const from = new Date(`${date}T00:00:00+03:00`);
    const to = new Date(from.getTime() + 24 * 60 * 60 * 1000);

    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new NotFoundException('Invalid date');
    }

    return {
      from,
      to,
    };
  }
}
