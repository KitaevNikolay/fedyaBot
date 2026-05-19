import { FileTextOutlined, TeamOutlined } from '@ant-design/icons';
import { Alert, Card, Col, Row, Skeleton, Statistic, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { adminApi } from '../shared/api/adminApi';
import type { DashboardStats } from '../shared/types/admin';
import { formatNumber } from '../shared/utils/formatters';

export function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const loadDashboard = async () => {
      try {
        const response = await adminApi.getDashboard();
        if (isMounted) {
          setStats(response);
          setError(null);
        }
      } catch (requestError) {
        if (isMounted) {
          setError(
            requestError instanceof Error
              ? requestError.message
              : 'Не удалось загрузить данные дашборда.',
          );
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    void loadDashboard();

    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <div className="page-stack">
      <Typography.Paragraph className="section-lead">
        На первом экране выведены базовые показатели контент-фабрики по реальным
        таблицам пользователей и статей.
      </Typography.Paragraph>

      {error ? (
        <Alert
          type="error"
          showIcon
          message="Ошибка загрузки"
          description={error}
        />
      ) : null}

      <Row gutter={[20, 20]}>
        <Col xs={24} md={12}>
          <Card className="metric-card">
            {loading || !stats ? (
              <Skeleton active paragraph={false} />
            ) : (
              <Statistic
                title="Создано статей"
                value={stats.articlesCount}
                formatter={value => formatNumber(Number(value), { maximumFractionDigits: 0 })}
                prefix={<FileTextOutlined />}
              />
            )}
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card className="metric-card metric-card-accent">
            {loading || !stats ? (
              <Skeleton active paragraph={false} />
            ) : (
              <Statistic
                title="Пользователей"
                value={stats.usersCount}
                formatter={value => formatNumber(Number(value), { maximumFractionDigits: 0 })}
                prefix={<TeamOutlined />}
              />
            )}
          </Card>
        </Col>
      </Row>
    </div>
  );
}
