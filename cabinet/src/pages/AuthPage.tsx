import { LockOutlined, MessageOutlined } from '@ant-design/icons';
import {
  Alert,
  App,
  Button,
  Card,
  Descriptions,
  Form,
  Input,
  Space,
  Tag,
  Typography,
} from 'antd';
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { adminApi } from '../shared/api/adminApi';
import { getAdminAccessToken, setAdminAccessToken } from '../shared/auth/adminSession';
import type { MessengerAuthResponse } from '../shared/types/admin';

type Step = 'login' | 'code';

export function AuthPage() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const [authResult, setAuthResult] = useState<MessengerAuthResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<Step>('login');
  const [login, setLogin] = useState('');

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

  const handleRequestCode = async (values: { login: string }) => {
    const normalized = values.login.trim().toLowerCase();
    setLoading(true);
    try {
      await adminApi.requestAuthCode(normalized);
      setLogin(normalized);
      setStep('code');
      setAuthResult(null);
      void message.success('Код отправлен в Яндекс Мессенджер.');
    } catch (error) {
      void message.error(
        error instanceof Error ? error.message : 'Не удалось отправить код.',
      );
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyCode = async (values: { code: string }) => {
    setLoading(true);
    try {
      const response = await adminApi.verifyAuthCode(login, values.code.trim());
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
      void message.error(
        error instanceof Error ? error.message : 'Не удалось проверить код.',
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
              Код из Яндекс Мессенджера
            </Tag>
            <Typography.Title level={2} className="auth-title">
              Вход в кабинет
            </Typography.Title>
            <Typography.Paragraph className="auth-description">
              Введите логин Яндекса, под которым вы общаетесь с ботом. Бот пришлёт
              одноразовый код в личный чат — им и подтверждается вход.
            </Typography.Paragraph>
            <Alert
              type="info"
              showIcon
              message="Что важно"
              description="Код придёт только если вы уже писали боту. Доступ к кабинету открыт пользователям с ролью admin."
            />
          </Space>
        </Card>

        <Card className="auth-widget-card">
          <Space direction="vertical" size={24} className="auth-widget-stack">
            <div>
              <Typography.Title level={4}>
                Вход через <MessageOutlined /> Яндекс Мессенджер
              </Typography.Title>
            </div>

            {step === 'login' ? (
              <Form layout="vertical" onFinish={handleRequestCode} disabled={loading}>
                <Form.Item
                  label="Логин Яндекса"
                  name="login"
                  rules={[
                    { required: true, message: 'Укажите логин' },
                    {
                      pattern: /^[a-zA-Z0-9._@-]+$/,
                      message: 'Логин: латиница, цифры, точка, дефис или @домен',
                    },
                  ]}
                >
                  <Input placeholder="ivan.petrov или ivan@company.ru" autoFocus />
                </Form.Item>
                <Button type="primary" htmlType="submit" loading={loading} block>
                  Получить код
                </Button>
              </Form>
            ) : (
              <Form layout="vertical" onFinish={handleVerifyCode} disabled={loading}>
                <Alert
                  type="success"
                  showIcon
                  message={`Код отправлен пользователю ${login}`}
                  description="Проверьте личный чат с ботом. Код действует 5 минут."
                  style={{ marginBottom: 16 }}
                />
                <Form.Item
                  label="Код из сообщения"
                  name="code"
                  rules={[
                    { required: true, message: 'Введите код' },
                    { pattern: /^\d{6}$/, message: 'Код состоит из 6 цифр' },
                  ]}
                >
                  <Input placeholder="123456" maxLength={6} autoFocus inputMode="numeric" />
                </Form.Item>
                <Space direction="vertical" style={{ width: '100%' }}>
                  <Button type="primary" htmlType="submit" loading={loading} block>
                    Войти
                  </Button>
                  <Button type="link" onClick={() => setStep('login')} block>
                    Другой логин или новый код
                  </Button>
                </Space>
              </Form>
            )}

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
                    .join(' ') || authResult.user.username || authResult.user.messengerId}
                </Descriptions.Item>
                <Descriptions.Item label="Логин Яндекса">
                  {authResult.user.messengerId}
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
