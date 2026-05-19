import { Alert, Card, Col, Row, Select, Space, Spin, Table, Typography } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { adminApi } from '../shared/api/adminApi';
import type { AnalyticsUser, TokenAnalyticsResponse } from '../shared/types/admin';
import { formatNumber } from '../shared/utils/formatters';

const STAGE_COLORS = [
  '#0f8f7f',
  '#1f9d55',
  '#d97706',
  '#2563eb',
  '#7c3aed',
  '#c2410c',
  '#475569',
];

export function AnalyticsPage() {
  const [users, setUsers] = useState<AnalyticsUser[]>([]);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [granularity, setGranularity] = useState<'day' | 'week' | 'month'>('day');
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [loadingChart, setLoadingChart] = useState(true);
  const [chartData, setChartData] = useState<TokenAnalyticsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const loadUsers = async () => {
      try {
        const response = await adminApi.getAnalyticsUsers();
        if (isMounted) {
          setUsers(response);
        }
      } catch (requestError) {
        if (isMounted) {
          setError(
            requestError instanceof Error
              ? requestError.message
              : 'Не удалось загрузить пользователей для аналитики.',
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

  useEffect(() => {
    let isMounted = true;

    const loadAnalytics = async () => {
      setLoadingChart(true);
      try {
        const response = await adminApi.getTokenAnalytics({
          granularity,
          userIds: selectedUserIds,
        });
        if (isMounted) {
          setChartData(response);
          setError(null);
        }
      } catch (requestError) {
        if (isMounted) {
          setError(
            requestError instanceof Error
              ? requestError.message
              : 'Не удалось загрузить аналитику токенов.',
          );
        }
      } finally {
        if (isMounted) {
          setLoadingChart(false);
        }
      }
    };

    void loadAnalytics();

    return () => {
      isMounted = false;
    };
  }, [granularity, selectedUserIds]);

  const chartRows = useMemo(() => {
    if (!chartData) {
      return [];
    }

    return chartData.periods.map(period => ({
      period: period.period,
      ...period.byStage,
    }));
  }, [chartData]);

  const getStageLabel = (stage: string) => chartData?.stageLabels[stage] ?? stage;

  return (
    <div className="page-stack">
      <Card className="table-card">
        <Space direction="vertical" size={20} className="analytics-stack">
          <div className="table-head">
            <Typography.Title level={4}>Траты токенов</Typography.Title>
            <Typography.Paragraph>
              График строится по событиям генерации и внешним вызовам модели,
              которые теперь сохраняются в базу и доступны для разбивки по
              пользователям, стадиям и периодам.
            </Typography.Paragraph>
            <Typography.Paragraph>
              Стадия для расхода токенов берётся из <strong>GenerationSettings.type</strong>.
            </Typography.Paragraph>
          </div>

          <Space wrap>
            <Select
              value={granularity}
              onChange={value => setGranularity(value)}
              options={[
                { value: 'day', label: 'По дням' },
                { value: 'week', label: 'По неделям' },
                { value: 'month', label: 'По месяцам' },
              ]}
              className="analytics-filter"
            />
            <Select
              mode="multiple"
              allowClear
              placeholder="Все пользователи"
              loading={loadingUsers}
              value={selectedUserIds}
              onChange={value => setSelectedUserIds(value)}
              options={users.map(user => ({
                value: user.id,
                label:
                  [user.firstName, user.lastName].filter(Boolean).join(' ').trim() ||
                  (user.username ? `@${user.username}` : user.telegramId),
              }))}
              className="analytics-filter analytics-filter-users"
            />
          </Space>

          {error ? (
            <Alert type="error" showIcon message="Ошибка аналитики" description={error} />
          ) : null}

          <div className="chart-card">
            {loadingChart || !chartData ? (
              <div className="chart-loading">
                <Spin />
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={360}>
                <BarChart data={chartRows}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(25,33,38,0.08)" />
                  <XAxis dataKey="period" />
                  <YAxis tickFormatter={value => formatNumber(Number(value))} />
                  <Tooltip
                    formatter={(value, name) => [
                      `${formatNumber(Number(value))} токенов`,
                      getStageLabel(String(name)),
                    ]}
                  />
                  <Legend />
                  {chartData.stages.map((stage, index) => (
                    <Bar
                      key={stage}
                      dataKey={stage}
                      name={getStageLabel(stage)}
                      stackId="tokens"
                      fill={STAGE_COLORS[index % STAGE_COLORS.length]}
                      radius={index === chartData.stages.length - 1 ? [8, 8, 0, 0] : 0}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Space>
      </Card>

      <Row gutter={[20, 20]}>
        <Col xs={24} xl={12}>
          <Card className="table-card">
            <Typography.Title level={4}>Пользователи по тратам</Typography.Title>
            <Table
              rowKey="userId"
              pagination={false}
              dataSource={chartData?.users ?? []}
              columns={[
                {
                  title: 'Пользователь',
                  dataIndex: 'label',
                  key: 'label',
                },
                {
                  title: 'Токены',
                  dataIndex: 'totalTokens',
                  key: 'totalTokens',
                  render: value => formatNumber(value),
                },
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} xl={12}>
          <Card className="table-card">
            <Typography.Title level={4}>Статус загрузки</Typography.Title>
            <Typography.Paragraph>
              Диапазон по умолчанию: последние 30 дней. При необходимости можно
              быстро ограничить график конкретными пользователями, чтобы увидеть
              аномальный расход по отдельным сценариям.
            </Typography.Paragraph>
            <Typography.Paragraph>
              Найдено стадий:{' '}
              <strong>
                {formatNumber(chartData?.stages.length ?? 0, {
                  maximumFractionDigits: 0,
                })}
              </strong>
            </Typography.Paragraph>
            <Typography.Paragraph>
              Периодов на графике:{' '}
              <strong>
                {formatNumber(chartData?.periods.length ?? 0, {
                  maximumFractionDigits: 0,
                })}
              </strong>
            </Typography.Paragraph>
          </Card>
        </Col>
      </Row>
    </div>
  );
}
