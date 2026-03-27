export interface DashboardStats {
  articlesCount: number;
  usersCount: number;
}

export interface AdminUser {
  id: string;
  telegramId: string;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  isActive: boolean;
  role: string;
  createdAt: string;
  status: 'approved' | 'blocked';
}

export interface AnalyticsSummary {
  eventsCount: number;
  totalTokens: number;
  lastEventAt: string | null;
  sessionsCount: number;
}

export interface HistorySummary extends AnalyticsSummary {
  activeDaysCount: number;
}

export interface AnalyticsUser extends AdminUser {
  analytics: AnalyticsSummary;
}

export interface HistoryUser extends AdminUser {
  analytics: HistorySummary;
}

export interface AnalyticsSession {
  id: string;
  scenarioId: string | null;
  articleId: string | null;
  articleTitle: string | null;
  createdAt: string;
  updatedAt: string;
  eventsCount: number;
  totalTokens: number;
  lastEventAt: string | null;
}

export interface AnalyticsUserOverview {
  user: AdminUser;
  analytics: AnalyticsSummary;
  sessions: AnalyticsSession[];
}

export interface AnalyticsEvent {
  id: string;
  occurredAt: string;
  type: string;
  action: string | null;
  stage: string | null;
  integration: string | null;
  method: string | null;
  status: number | null;
  state: string | null;
  error: string | null;
  text: string | null;
  callbackData: string | null;
  tokens: number | null;
  articleId: string | null;
  articleTitle: string | null;
  requestBody?: unknown;
  responseBody?: unknown;
  metadata?: unknown;
}

export interface AnalyticsSessionDetails {
  session: {
    id: string;
    userId: string;
    scenarioId: string | null;
    articleId: string | null;
    articleTitle: string | null;
    createdAt: string;
    updatedAt: string;
  };
  events: AnalyticsEvent[];
}

export interface TokenAnalyticsPeriod {
  period: string;
  totalTokens: number;
  byStage: Record<string, number>;
}

export interface TokenAnalyticsUserTotal {
  userId: string;
  label: string;
  totalTokens: number;
}

export interface TokenAnalyticsResponse {
  granularity: 'day' | 'week' | 'month';
  range: {
    from: string;
    to: string;
  };
  stages: string[];
  stageLabels: Record<string, string>;
  periods: TokenAnalyticsPeriod[];
  users: TokenAnalyticsUserTotal[];
}

export interface UserHistoryDay {
  date: string;
  eventsCount: number;
  sessionsCount: number;
  totalTokens: number;
  firstEventAt: string;
  lastEventAt: string;
}

export interface UserHistoryDaysResponse {
  user: AdminUser;
  days: UserHistoryDay[];
}

export interface UserHistoryTimelineEvent {
  id: string;
  occurredAt: string;
  type: string;
  action: string | null;
  stage: string | null;
  integration: string | null;
  method: string | null;
  status: number | null;
  state: string | null;
  error: string | null;
  text: string | null;
  callbackData: string | null;
  tokens: number | null;
  articleId: string | null;
  articleTitle: string | null;
  sessionId: string | null;
  requestBody?: unknown;
  responseBody?: unknown;
  metadata?: unknown;
  session: {
    id: string;
    scenarioId: string | null;
    articleId: string | null;
  } | null;
}

export interface UserHistoryTimelineResponse {
  user: AdminUser;
  date: string;
  range: {
    from: string;
    to: string;
  };
  summary: {
    eventsCount: number;
    sessionsCount: number;
    totalTokens: number;
  };
  stageLabels: Record<string, string>;
  events: UserHistoryTimelineEvent[];
}

export interface PromptDocumentSummary {
  id: string;
  title: string;
  url: string | null;
}

export interface GenerationPromptPlaceholder {
  key: string;
  token: string;
  label: string;
}

export interface GenerationSetting {
  type: string;
  typeName: string | null;
  model: string;
  temperature: number;
  maxTokens: number;
  files: string[];
  systemPromptId: string | null;
  userPromptId: string | null;
  additionalPayload: Record<string, unknown> | null;
  systemPrompt: PromptDocumentSummary | null;
  userPrompt: PromptDocumentSummary | null;
  placeholders: GenerationPromptPlaceholder[];
}

export interface GenerationSettingsResponse {
  settings: GenerationSetting[];
  promptOptions: PromptDocumentSummary[];
}

export interface AvailableModelOption {
  id: string;
  label: string;
  provider: string | null;
}

export interface GenerationSettingsUpdatePayload {
  typeName: string | null;
  model: string;
  temperature: number;
  maxTokens: number;
  files: string[];
  systemPromptId: string | null;
  userPromptId: string | null;
  additionalPayload: Record<string, unknown> | null;
}

export interface TelegramAuthPayload {
  id: string | number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: string | number;
  hash: string;
}

export interface TelegramAuthResponse {
  status: 'approved' | 'pending' | 'forbidden';
  user: AdminUser | null;
  accessToken: string | null;
}
