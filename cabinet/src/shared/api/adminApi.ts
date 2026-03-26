import { clearAdminAccessToken, getAdminAccessToken } from '../auth/adminSession';
import type {
  AdminUser,
  AvailableModelOption,
  AnalyticsSessionDetails,
  AnalyticsUser,
  AnalyticsUserOverview,
  DashboardStats,
  GenerationSetting,
  GenerationSettingsResponse,
  GenerationSettingsUpdatePayload,
  HistoryUser,
  TelegramAuthPayload,
  TelegramAuthResponse,
  TokenAnalyticsResponse,
  UserHistoryDaysResponse,
  UserHistoryTimelineResponse,
} from '../types/admin';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') ?? '';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const accessToken = getAdminAccessToken();
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { message?: string | string[] }
      | null;

    if (response.status === 401) {
      clearAdminAccessToken();
    }

    const message = Array.isArray(payload?.message)
      ? payload.message.join(', ')
      : payload?.message ?? 'Запрос к серверу завершился с ошибкой.';

    throw new Error(message);
  }

  return (await response.json()) as T;
}

export const adminApi = {
  getDashboard() {
    return request<DashboardStats>('/admin/dashboard');
  },
  getUsers() {
    return request<AdminUser[]>('/admin/users');
  },
  getAnalyticsUsers() {
    return request<AnalyticsUser[]>('/admin/analytics/users');
  },
  getHistoryUsers() {
    return request<HistoryUser[]>('/admin/history/users');
  },
  getUserHistoryDays(userId: string) {
    return request<UserHistoryDaysResponse>(`/admin/history/users/${userId}/days`);
  },
  getUserHistoryTimeline(userId: string, date: string) {
    return request<UserHistoryTimelineResponse>(
      `/admin/history/users/${userId}/timeline?date=${encodeURIComponent(date)}`,
    );
  },
  getAnalyticsUserOverview(userId: string) {
    return request<AnalyticsUserOverview>(`/admin/analytics/users/${userId}`);
  },
  getSessionEvents(sessionId: string) {
    return request<AnalyticsSessionDetails>(`/admin/analytics/sessions/${sessionId}`);
  },
  getTokenAnalytics(params: {
    granularity: 'day' | 'week' | 'month';
    userIds?: string[];
    from?: string;
    to?: string;
  }) {
    const search = new URLSearchParams();
    search.set('granularity', params.granularity);
    if (params.userIds && params.userIds.length > 0) {
      search.set('userIds', params.userIds.join(','));
    }
    if (params.from) {
      search.set('from', params.from);
    }
    if (params.to) {
      search.set('to', params.to);
    }

    return request<TokenAnalyticsResponse>(`/admin/analytics/tokens?${search.toString()}`);
  },
  getGenerationSettings() {
    return request<GenerationSettingsResponse>('/admin/generation-settings');
  },
  getGenerationSettingModels() {
    return request<AvailableModelOption[]>('/admin/generation-settings/models');
  },
  updateGenerationSetting(type: string, payload: GenerationSettingsUpdatePayload) {
    return request<GenerationSetting>(`/admin/generation-settings/${type}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },
  updateUserStatus(id: string, isActive: boolean) {
    return request<AdminUser>(`/admin/users/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive }),
    });
  },
  updateUserRole(id: string, role: string) {
    return request<AdminUser>(`/admin/users/${id}/role`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    });
  },
  verifyTelegramAuth(payload: TelegramAuthPayload) {
    return request<TelegramAuthResponse>('/admin/auth/telegram', {
      method: 'POST',
      body: JSON.stringify({
        ...payload,
        id: String(payload.id),
        auth_date: String(payload.auth_date),
      }),
    });
  },
  getCurrentAdmin() {
    return request<AdminUser>('/admin/auth/me');
  },
};
