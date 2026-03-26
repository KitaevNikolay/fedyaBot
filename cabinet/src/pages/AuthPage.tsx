import { LockOutlined, MessageOutlined } from '@ant-design/icons';
import { Alert, App, Card, Descriptions, Space, Tag, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { adminApi } from '../shared/api/adminApi';
import { getAdminAccessToken, setAdminAccessToken } from '../shared/auth/adminSession';
import type {
  TelegramAuthPayload,
  TelegramAuthResponse,
} from '../shared/types/admin';
import { TelegramLoginWidget } from '../shared/ui/TelegramLoginWidget';

export function AuthPage() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const [authResult, setAuthResult] = useState<TelegramAuthResponse | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let isMounted = true;
    const accessToken = getAdminAccessToken();

    if (!accessToken) {
      return () => {
        isMounted = false;
      };
    }

    const verify = async () => {
      try {
        await adminApi.getCurrentAdmin();
        if (isMounted) {
          navigate('/', { replace: true });
        }
      } catch {
        if (isMounted) {
          setAuthResult(null);
        }
      }
    };

    void verify();

    return () => {
      isMounted = false;
    };
  }, [navigate]);

  const handleTelegramAuth = async (payload: TelegramAuthPayload) => {
    setLoading(true);
    try {
      const response = await adminApi.verifyTelegramAuth(payload);
      setAuthResult(response);

      if (response.status === 'approved' && response.accessToken) {
        setAdminAccessToken(response.accessToken);
        void message.success('Вход в кабинет подтверждён.');
        navigate(
          typeof location.state === 'object' &&
            location.state &&
            'from' in location.state &&
            typeof location.state.from === 'string'
            ? location.state.from
            : '/',
          { replace: true },
        );
        return;
      }

      if (response.status === 'forbidden') {
        void message.error('Доступ в кабинет разрешён только пользователям с ролью admin.');
        return;
      }

      void message.warning('Пользователь найден, но доступ в кабинет ещё не одобрен.');
    } catch (error) {
      setAuthResult(null);
      void message.error(
        error instanceof Error
          ? error.message
          : 'Не удалось подтвердить авторизацию через Telegram.',
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-shell">
      <div className="auth-grid">
        <Card className="auth-intro-card">
          <Space direction="vertical" size={20}>
            <Tag icon={<LockOutlined />} color="processing" className="auth-tag">
              Telegram Login Widget
            </Tag>
            <Typography.Title level={2} className="auth-title">
              Авторизация через Telegram
            </Typography.Title>
            <Typography.Paragraph className="auth-description">
              Доступ к кабинету открыт только пользователям с ролью admin.
            </Typography.Paragraph>
            <Alert
              type="info"
              showIcon
              message="Что важно"
              description="Если у пользователя нет роли admin или доступ ещё не одобрен, кабинет не откроется."
            />
          </Space>
        </Card>

        <Card className="auth-widget-card">
          <Space direction="vertical" size={24} className="auth-widget-stack">
            <div>
              <Typography.Title level={4}>
                Вход через <MessageOutlined /> Telegram
              </Typography.Title>
            </div>

            <TelegramLoginWidget
              botUsername={import.meta.env.VITE_TELEGRAM_BOT_USERNAME}
              onAuth={payload => void handleTelegramAuth(payload)}
            />

            {loading ? (
              <Alert
                type="warning"
                showIcon
                message="Проверяем Telegram payload на сервере"
              />
            ) : null}

            {authResult?.user ? (
              <Descriptions
                bordered
                size="small"
                column={1}
                title="Результат проверки"
              >
                <Descriptions.Item label="Пользователь">
                  {[authResult.user.firstName, authResult.user.lastName]
                    .filter(Boolean)
                    .join(' ') || authResult.user.username || authResult.user.telegramId}
                </Descriptions.Item>
                <Descriptions.Item label="Telegram">
                  {authResult.user.username
                    ? `@${authResult.user.username}`
                    : authResult.user.telegramId}
                </Descriptions.Item>
                <Descriptions.Item label="Статус доступа">
                  {authResult.status === 'approved' ? (
                    <Tag color="success">Admin доступ подтверждён</Tag>
                  ) : authResult.status === 'forbidden' ? (
                    <Tag color="error">Нет роли admin</Tag>
                  ) : (
                    <Tag color="gold">Ожидает одобрения</Tag>
                  )}
                </Descriptions.Item>
              </Descriptions>
            ) : null}
          </Space>
        </Card>
      </div>
    </div>
  );
}
