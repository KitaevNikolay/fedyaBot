import {
  CalendarOutlined,
  ClockCircleOutlined,
  OrderedListOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Input,
  Row,
  Select,
  Space,
  Spin,
  Statistic,
  Table,
  Tag,
  Timeline,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useEffect, useMemo, useState } from 'react';
import { adminApi } from '../shared/api/adminApi';
import type {
  HistoryUser,
  UserHistoryDay,
  UserHistoryDaysResponse,
  UserHistoryTimelineEvent,
  UserHistoryTimelineResponse,
} from '../shared/types/admin';
import { formatDateTime, formatDay, formatNumber } from '../shared/utils/formatters';

function getDisplayName(user: {
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  telegramId: string;
}) {
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();

  if (fullName) {
    return fullName;
  }

  if (user.username) {
    return `@${user.username}`;
  }

  return `Telegram ${user.telegramId}`;
}

function buildSearchableText(event: UserHistoryTimelineEvent, stageLabel: string) {
  return [
    event.type,
    event.action,
    event.stage,
    stageLabel,
    event.integration,
    event.method,
    event.state,
    event.error,
    event.text,
    event.callbackData,
    event.articleTitle,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function getEventCategory(event: UserHistoryTimelineEvent) {
  if (event.type.startsWith('user_')) {
    return {
      key: 'user',
      label: 'Пользователь',
      color: '#2563eb',
      className: 'history-event-user',
    };
  }

  if (event.integration || event.type.startsWith('external_')) {
    return {
      key: 'integration',
      label: 'Интеграция',
      color: '#d97706',
      className: 'history-event-integration',
    };
  }

  return {
    key: 'bot',
    label: 'Бот',
    color: '#0f8f7f',
    className: 'history-event-bot',
  };
}

export function UserHistoryPage() {
  const [users, setUsers] = useState<HistoryUser[]>([]);
  const [selectedUser, setSelectedUser] = useState<HistoryUser | null>(null);
  const [daysResponse, setDaysResponse] = useState<UserHistoryDaysResponse | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [timelineResponse, setTimelineResponse] =
    useState<UserHistoryTimelineResponse | null>(null);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [loadingDays, setLoadingDays] = useState(false);
  const [loadingTimeline, setLoadingTimeline] = useState(false);
  const [timelineQuery, setTimelineQuery] = useState('');
  const [selectedStages, setSelectedStages] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const loadUsers = async () => {
      try {
        const response = await adminApi.getHistoryUsers();
        if (isMounted) {
          setUsers(response);
          setError(null);
        }
      } catch (requestError) {
        if (isMounted) {
          setError(
            requestError instanceof Error
              ? requestError.message
              : 'Не удалось загрузить историю пользователей.',
          );
        }
      } finally {
        if (isMounted) {
          setLoadingUsers(false);
        }
      }
    };

    void loadUsers();

    return () => {
      isMounted = false;
    };
  }, []);

  const loadUserDays = async (user: HistoryUser) => {
    setSelectedUser(user);
    setSelectedDay(null);
    setTimelineResponse(null);
    setTimelineQuery('');
    setSelectedStages([]);
    setLoadingDays(true);

    try {
      const response = await adminApi.getUserHistoryDays(user.id);
      setDaysResponse(response);
      setError(null);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Не удалось загрузить даты активности пользователя.',
      );
    } finally {
      setLoadingDays(false);
    }
  };

  const loadTimeline = async (day: UserHistoryDay) => {
    if (!selectedUser) {
      return;
    }

    setSelectedDay(day.date);
    setTimelineQuery('');
    setSelectedStages([]);
    setLoadingTimeline(true);

    try {
      const response = await adminApi.getUserHistoryTimeline(selectedUser.id, day.date);
      setTimelineResponse(response);
      setError(null);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Не удалось загрузить хронологию за выбранный день.',
      );
    } finally {
      setLoadingTimeline(false);
    }
  };

  const dayColumns: ColumnsType<UserHistoryDay> = [
    {
      title: 'Дата',
      dataIndex: 'date',
      key: 'date',
      render: (_, day) => (
        <Button type="link" className="history-day-link" onClick={() => void loadTimeline(day)}>
          {formatDay(day.date)}
        </Button>
      ),
    },
    {
      title: 'События',
      dataIndex: 'eventsCount',
      key: 'eventsCount',
      render: value => formatNumber(value, { maximumFractionDigits: 0 }),
    },
    {
      title: 'Сессии',
      dataIndex: 'sessionsCount',
      key: 'sessionsCount',
      render: value => formatNumber(value, { maximumFractionDigits: 0 }),
    },
    {
      title: 'Токены',
      dataIndex: 'totalTokens',
      key: 'totalTokens',
      render: value => formatNumber(value),
    },
    {
      title: 'Первое действие',
      dataIndex: 'firstEventAt',
      key: 'firstEventAt',
      render: value => formatDateTime(value),
    },
    {
      title: 'Последнее действие',
      dataIndex: 'lastEventAt',
      key: 'lastEventAt',
      render: value => formatDateTime(value),
    },
  ];

  const stageOptions = useMemo(() => {
    if (!timelineResponse) {
      return [];
    }

    return Array.from(
      new Set(
        timelineResponse.events
          .map(event => event.stage)
          .filter((value): value is string => Boolean(value)),
      ),
    )
      .sort()
      .map(stage => ({
        value: stage,
        label: timelineResponse.stageLabels[stage] ?? stage,
      }));
  }, [timelineResponse]);

  const filteredEvents = useMemo(() => {
    if (!timelineResponse) {
      return [];
    }

    const normalizedQuery = timelineQuery.trim().toLowerCase();

    return timelineResponse.events.filter(event => {
      const stage = event.stage ?? '';
      const stageLabel = stage ? timelineResponse.stageLabels[stage] ?? stage : '';
      const matchesStage =
        selectedStages.length === 0 || (stage && selectedStages.includes(stage));
      const matchesQuery =
        normalizedQuery.length === 0 ||
        buildSearchableText(event, stageLabel).includes(normalizedQuery);

      return matchesStage && matchesQuery;
    });
  }, [selectedStages, timelineQuery, timelineResponse]);

  const timelineItems = useMemo(() => {
    return filteredEvents.map(event => {
      const stageLabel =
        event.stage ? timelineResponse?.stageLabels[event.stage] ?? event.stage : null;
      const category = getEventCategory(event);
      const summary = [
        event.action ? `action: ${event.action}` : null,
        event.integration ? `integration: ${event.integration}` : null,
        event.method ? `method: ${event.method}` : null,
        event.state ? `state: ${event.state}` : null,
        event.callbackData ? `callback: ${event.callbackData}` : null,
        event.articleTitle ? `article: ${event.articleTitle}` : null,
      ]
        .filter(Boolean)
        .join(' • ');

      return {
        color: event.error ? 'red' : category.color,
        children: (
          <Card
            size="small"
            className={`history-timeline-card ${category.className}`}
          >
            <Space direction="vertical" size={10} className="event-stack">
              <Space wrap>
                <Tag color="default">{new Date(event.occurredAt).toLocaleTimeString('ru-RU')}</Tag>
                <Tag color={category.color}>{category.label}</Tag>
                <Tag color="processing">{event.type}</Tag>
                {stageLabel ? <Tag>{stageLabel}</Tag> : null}
                {event.sessionId ? (
                  <Tag color="purple">{`Сессия ${event.sessionId.slice(0, 8)}`}</Tag>
                ) : null}
                {event.tokens ? (
                  <Tag color="gold">{`${formatNumber(event.tokens)} tokens`}</Tag>
                ) : null}
                {event.status ? <Tag color="blue">{`HTTP ${event.status}`}</Tag> : null}
              </Space>
              {summary ? <Typography.Text>{summary}</Typography.Text> : null}
              {event.text ? (
                <Typography.Paragraph className="event-text">
                  {event.text}
                </Typography.Paragraph>
              ) : null}
              {event.error ? (
                <Typography.Paragraph type="danger" className="event-text">
                  {event.error}
                </Typography.Paragraph>
              ) : null}
            </Space>
          </Card>
        ),
      };
    });
  }, [filteredEvents, timelineResponse]);

  return (
    <div className="page-stack">
      {error ? <Alert type="error" showIcon message="Ошибка" description={error} /> : null}

      <Card className="table-card">
        <div className="table-head">
          <Typography.Title level={4}>Пользователи</Typography.Title>
          <Typography.Paragraph>
            Выберите пользователя, затем дату активности, чтобы увидеть полный roadmap
            действий внутри дня.
          </Typography.Paragraph>
        </div>

        {loadingUsers ? (
          <div className="chart-loading">
            <Spin />
          </div>
        ) : users.length > 0 ? (
          <Row gutter={[16, 16]}>
            {users.map(user => (
              <Col xs={24} md={12} xl={8} key={user.id}>
                <Card
                  hoverable
                  className={`history-user-card${
                    selectedUser?.id === user.id ? ' history-user-card-active' : ''
                  }`}
                  onClick={() => void loadUserDays(user)}
                >
                  <Space direction="vertical" size={12} className="history-user-stack">
                    <div>
                      <Typography.Title level={5}>{getDisplayName(user)}</Typography.Title>
                      <Typography.Text type="secondary">
                        {`Telegram ID: ${user.telegramId}`}
                      </Typography.Text>
                    </div>
                    <Space wrap>
                      {user.isActive ? (
                        <Tag color="success">Одобрен</Tag>
                      ) : (
                        <Tag color="error">Заблокирован</Tag>
                      )}
                      <Tag icon={<CalendarOutlined />}>
                        {`${formatNumber(user.analytics.activeDaysCount, {
                          maximumFractionDigits: 0,
                        })} дней`}
                      </Tag>
                    </Space>
                    <Row gutter={[12, 12]}>
                      <Col span={12}>
                        <Statistic
                          title="События"
                          value={user.analytics.eventsCount}
                          formatter={value =>
                            formatNumber(Number(value), { maximumFractionDigits: 0 })
                          }
                        />
                      </Col>
                      <Col span={12}>
                        <Statistic
                          title="Токены"
                          value={user.analytics.totalTokens}
                          formatter={value => formatNumber(Number(value))}
                        />
                      </Col>
                    </Row>
                    <Typography.Text type="secondary">
                      {`Последняя активность: ${formatDateTime(user.analytics.lastEventAt)}`}
                    </Typography.Text>
                  </Space>
                </Card>
              </Col>
            ))}
          </Row>
        ) : (
          <Empty description="История пользователей пока не найдена." />
        )}
      </Card>

      {selectedUser ? (
        <Card className="table-card">
          <div className="table-head">
            <Typography.Title level={4}>
              {`Даты использования: ${getDisplayName(selectedUser)}`}
            </Typography.Title>
            <Typography.Paragraph>
              Нажмите на дату, чтобы открыть хронологию действий за выбранный день.
            </Typography.Paragraph>
          </div>
          <Table
            rowKey="date"
            loading={loadingDays}
            columns={dayColumns}
            dataSource={daysResponse?.days ?? []}
            pagination={false}
            locale={{ emptyText: 'Для выбранного пользователя пока нет активных дней.' }}
          />
        </Card>
      ) : null}

      {selectedUser && selectedDay ? (
        <Card className="table-card">
          <div className="table-head">
            <Typography.Title level={4}>{`Роадмап дня: ${formatDay(selectedDay)}`}</Typography.Title>
            <Typography.Paragraph>
              Хронология показывает все действия пользователя от первого события дня до
              последнего. Роадмап зафиксирован в отдельном scroll-окне и поддерживает
              поиск по тексту и типам генерации.
            </Typography.Paragraph>
          </div>

          {loadingTimeline ? (
            <div className="chart-loading">
              <Spin />
            </div>
          ) : timelineResponse ? (
            <Space direction="vertical" size={20} className="analytics-stack">
              <Row gutter={[16, 16]}>
                <Col xs={24} md={8}>
                  <Card className="metric-card">
                    <Statistic
                      title="События"
                      prefix={<OrderedListOutlined />}
                      value={timelineResponse.summary.eventsCount}
                      formatter={value =>
                        formatNumber(Number(value), { maximumFractionDigits: 0 })
                      }
                    />
                  </Card>
                </Col>
                <Col xs={24} md={8}>
                  <Card className="metric-card">
                    <Statistic
                      title="Сессии"
                      prefix={<ClockCircleOutlined />}
                      value={timelineResponse.summary.sessionsCount}
                      formatter={value =>
                        formatNumber(Number(value), { maximumFractionDigits: 0 })
                      }
                    />
                  </Card>
                </Col>
                <Col xs={24} md={8}>
                  <Card className="metric-card metric-card-accent">
                    <Statistic
                      title="Токены"
                      prefix={<CalendarOutlined />}
                      value={timelineResponse.summary.totalTokens}
                      formatter={value => formatNumber(Number(value))}
                    />
                  </Card>
                </Col>
              </Row>

              <Space wrap className="history-filters">
                <Input
                  allowClear
                  prefix={<SearchOutlined />}
                  placeholder="Поиск по тексту, ошибкам, callback, статье"
                  value={timelineQuery}
                  onChange={event => setTimelineQuery(event.target.value)}
                  className="history-search-input"
                />
                <Select
                  mode="multiple"
                  allowClear
                  value={selectedStages}
                  onChange={value => setSelectedStages(value)}
                  options={stageOptions}
                  placeholder="Типы генерации"
                  className="history-stage-filter"
                />
              </Space>

              <div className="history-timeline-scroll">
                {timelineItems.length > 0 ? (
                  <Timeline className="history-timeline" items={timelineItems} />
                ) : (
                  <Empty description="По текущему фильтру события не найдены." />
                )}
              </div>
            </Space>
          ) : (
            <Empty description="Выберите дату, чтобы увидеть роадмап дня." />
          )}
        </Card>
      ) : null}
    </div>
  );
}
