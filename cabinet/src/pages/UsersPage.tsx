import { CheckOutlined, EyeOutlined, StopOutlined } from '@ant-design/icons';
import {
  App,
  Button,
  Card,
  Col,
  Descriptions,
  Drawer,
  Empty,
  List,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useEffect, useState } from 'react';
import { adminApi } from '../shared/api/adminApi';
import type {
  AnalyticsEvent,
  AnalyticsSessionDetails,
  AnalyticsUser,
  AnalyticsUserOverview,
} from '../shared/types/admin';
import { formatNumber } from '../shared/utils/formatters';

function getDisplayName(user: AnalyticsUser | AnalyticsUserOverview['user']) {
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();

  if (fullName) {
    return fullName;
  }

  if (user.username) {
    return `@${user.username}`;
  }

  return `Telegram ${user.telegramId}`;
}

export function UsersPage() {
  const { message } = App.useApp();
  const [users, setUsers] = useState<AnalyticsUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingStatusId, setUpdatingStatusId] = useState<string | null>(null);
  const [updatingRoleId, setUpdatingRoleId] = useState<string | null>(null);
  const [selectedUser, setSelectedUser] = useState<AnalyticsUser | null>(null);
  const [overview, setOverview] = useState<AnalyticsUserOverview | null>(null);
  const [sessionDetails, setSessionDetails] = useState<AnalyticsSessionDetails | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const loadUsers = async () => {
      try {
        const response = await adminApi.getAnalyticsUsers();
        if (isMounted) {
          setUsers(response);
        }
      } catch (error) {
        void message.error(
          error instanceof Error
            ? error.message
            : 'Не удалось загрузить список пользователей.',
        );
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    void loadUsers();

    return () => {
      isMounted = false;
    };
  }, [message]);

  const handleStatusChange = async (userId: string, isActive: boolean) => {
    setUpdatingStatusId(userId);
    try {
      const updatedUser = await adminApi.updateUserStatus(userId, isActive);
      setUsers(current =>
        current.map(user =>
          user.id === userId
            ? {
                ...user,
                ...updatedUser,
              }
            : user,
        ),
      );
      void message.success(
        isActive
          ? 'Пользователь одобрен.'
          : 'Пользователь заблокирован.',
      );
    } catch (error) {
      void message.error(
        error instanceof Error
          ? error.message
          : 'Не удалось обновить статус пользователя.',
      );
    } finally {
      setUpdatingStatusId(null);
    }
  };

  const handleRoleChange = async (userId: string, role: string) => {
    setUpdatingRoleId(userId);
    try {
      const updatedUser = await adminApi.updateUserRole(userId, role);
      setUsers(current =>
        current.map(user =>
          user.id === userId
            ? {
                ...user,
                ...updatedUser,
              }
            : user,
        ),
      );
      void message.success(
        role === 'admin'
          ? 'Роль пользователя изменена на admin.'
          : 'Роль пользователя изменена на user.',
      );
    } catch (error) {
      void message.error(
        error instanceof Error
          ? error.message
          : 'Не удалось обновить роль пользователя.',
      );
    } finally {
      setUpdatingRoleId(null);
    }
  };

  const loadUserHistory = async (user: AnalyticsUser) => {
    setSelectedUser(user);
    setDrawerLoading(true);

    try {
      const response = await adminApi.getAnalyticsUserOverview(user.id);
      setOverview(response);

      const initialSessionId = response.sessions[0]?.id ?? null;
      setSelectedSessionId(initialSessionId);

      if (initialSessionId) {
        const details = await adminApi.getSessionEvents(initialSessionId);
        setSessionDetails(details);
      } else {
        setSessionDetails(null);
      }
    } catch (error) {
      void message.error(
        error instanceof Error
          ? error.message
          : 'Не удалось загрузить аналитику пользователя.',
      );
    } finally {
      setDrawerLoading(false);
    }
  };

  const handleSessionChange = async (sessionId: string) => {
    setSelectedSessionId(sessionId);
    setDrawerLoading(true);
    try {
      const details = await adminApi.getSessionEvents(sessionId);
      setSessionDetails(details);
    } catch (error) {
      void message.error(
        error instanceof Error
          ? error.message
          : 'Не удалось загрузить события сессии.',
      );
    } finally {
      setDrawerLoading(false);
    }
  };

  const columns: ColumnsType<AnalyticsUser> = [
    {
      title: 'Role',
      dataIndex: 'role',
      key: 'role',
      width: 140,
      render: (_, user) =>
        user.role === 'admin' ? (
          <Tag color="processing" className="status-tag">
            admin
          </Tag>
        ) : (
          <Tag className="status-tag">user</Tag>
        ),
    },
    {
      title: 'Пользователь',
      dataIndex: 'user',
      key: 'user',
      render: (_, user) => (
        <div className="user-cell">
          <Typography.Text strong>{getDisplayName(user)}</Typography.Text>
          <Typography.Text type="secondary">{`Telegram ID: ${user.telegramId}`}</Typography.Text>
        </div>
      ),
    },
    {
      title: 'Управление',
      key: 'actions',
      width: 480,
      render: (_, user) => (
        <Space wrap>
          <Button
            type="primary"
            icon={<CheckOutlined />}
            onClick={() => void handleStatusChange(user.id, true)}
            disabled={user.isActive}
            loading={updatingStatusId === user.id}
          >
            Одобрить
          </Button>
          <Button
            danger
            icon={<StopOutlined />}
            onClick={() => void handleStatusChange(user.id, false)}
            disabled={!user.isActive}
            loading={updatingStatusId === user.id}
          >
            Заблокировать
          </Button>
          <Select
            value={user.role}
            onChange={value => void handleRoleChange(user.id, value)}
            options={[
              { value: 'user', label: 'user' },
              { value: 'admin', label: 'admin' },
            ]}
            loading={updatingRoleId === user.id}
            disabled={updatingRoleId === user.id}
            style={{ width: 120 }}
          />
          <Button
            icon={<EyeOutlined />}
            onClick={() => void loadUserHistory(user)}
          >
            История
          </Button>
        </Space>
      ),
    },
    {
      title: 'Статус пользователя',
      dataIndex: 'status',
      key: 'status',
      width: 180,
      render: (_, user) =>
        user.isActive ? (
          <Tag color="success" className="status-tag">
            Одобрен
          </Tag>
        ) : (
          <Tag color="error" className="status-tag">
            Заблокирован
          </Tag>
        ),
    },
    {
      title: 'Токены',
      key: 'tokens',
      width: 140,
      render: (_, user) => formatNumber(user.analytics.totalTokens),
    },
  ];

  const renderEventItem = (event: AnalyticsEvent) => {
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

    return (
      <List.Item>
        <Card size="small" className="event-card">
          <Space direction="vertical" size={8} className="event-stack">
            <Space wrap>
              <Tag color="processing">{event.type}</Tag>
              {event.stage ? <Tag>{event.stage}</Tag> : null}
              {event.tokens ? (
                <Tag color="gold">{`${formatNumber(event.tokens)} tokens`}</Tag>
              ) : null}
              <Typography.Text type="secondary">
                {new Date(event.occurredAt).toLocaleString('ru-RU')}
              </Typography.Text>
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
      </List.Item>
    );
  };

  return (
    <>
      <Card className="table-card">
        <div className="table-head">
          <div>
            <Typography.Title level={4}>Пользователи</Typography.Title>
            <Typography.Paragraph>
              Таблица показывает статус доступа, суммарные траты токенов и
              позволяет открыть полную историю сессий пользователя.
            </Typography.Paragraph>
          </div>
        </div>
        <Table
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={users}
          pagination={false}
        />
      </Card>

      <Drawer
        width={840}
        open={Boolean(selectedUser)}
        onClose={() => {
          setSelectedUser(null);
          setOverview(null);
          setSessionDetails(null);
          setSelectedSessionId(null);
        }}
        title={selectedUser ? `История: ${getDisplayName(selectedUser)}` : 'История'}
      >
        {drawerLoading && !overview ? (
          <div className="drawer-loading">
            <Typography.Paragraph>Загружаю историю пользователя...</Typography.Paragraph>
          </div>
        ) : overview ? (
          <Space direction="vertical" size={20} className="analytics-stack">
            <Row gutter={[16, 16]}>
              <Col xs={24} md={8}>
                <Card className="metric-card">
                  <Statistic
                    title="Событий"
                    value={overview.analytics.eventsCount}
                    formatter={value =>
                      formatNumber(Number(value), { maximumFractionDigits: 0 })
                    }
                  />
                </Card>
              </Col>
              <Col xs={24} md={8}>
                <Card className="metric-card">
                  <Statistic
                    title="Сессий"
                    value={overview.analytics.sessionsCount}
                    formatter={value =>
                      formatNumber(Number(value), { maximumFractionDigits: 0 })
                    }
                  />
                </Card>
              </Col>
              <Col xs={24} md={8}>
                <Card className="metric-card metric-card-accent">
                  <Statistic
                    title="Токенов"
                    value={overview.analytics.totalTokens}
                    formatter={value => formatNumber(Number(value))}
                  />
                </Card>
              </Col>
            </Row>

            <Descriptions bordered size="small" column={1} title="Профиль">
              <Descriptions.Item label="Пользователь">
                {getDisplayName(overview.user)}
              </Descriptions.Item>
              <Descriptions.Item label="Telegram ID">
                {overview.user.telegramId}
              </Descriptions.Item>
              <Descriptions.Item label="Последняя активность">
                {overview.analytics.lastEventAt
                  ? new Date(overview.analytics.lastEventAt).toLocaleString('ru-RU')
                  : 'Нет данных'}
              </Descriptions.Item>
            </Descriptions>

            {overview.sessions.length > 0 ? (
              <>
                <Select
                  value={selectedSessionId ?? undefined}
                  onChange={value => void handleSessionChange(value)}
                  options={overview.sessions.map(session => ({
                    value: session.id,
                    label: `${new Date(session.createdAt).toLocaleString('ru-RU')} • ${
                      session.articleTitle ?? 'Без статьи'
                    } • ${formatNumber(session.totalTokens)} tokens`,
                  }))}
                  className="session-select"
                />

                {sessionDetails ? (
                  <>
                    <Descriptions bordered size="small" column={1} title="Сессия">
                      <Descriptions.Item label="ID сессии">
                        {sessionDetails.session.id}
                      </Descriptions.Item>
                      <Descriptions.Item label="Статья">
                        {sessionDetails.session.articleTitle ?? 'Не привязана'}
                      </Descriptions.Item>
                      <Descriptions.Item label="Сценарий">
                        {sessionDetails.session.scenarioId ?? 'Не указан'}
                      </Descriptions.Item>
                    </Descriptions>

                    <List
                      dataSource={sessionDetails.events}
                      renderItem={renderEventItem}
                      locale={{ emptyText: 'Для этой сессии пока нет событий.' }}
                    />
                  </>
                ) : (
                  <Empty description="Выберите сессию для просмотра событий" />
                )}
              </>
            ) : (
              <Empty description="У пользователя пока нет зафиксированных сессий." />
            )}
          </Space>
        ) : (
          <Empty description="История пользователя недоступна." />
        )}
      </Drawer>
    </>
  );
}
