import {
  BarChartOutlined,
  FundOutlined,
  HistoryOutlined,
  SettingOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import { Layout, Menu, Typography } from 'antd';
import { NavLink, Outlet, useLocation } from 'react-router-dom';

const { Content, Sider } = Layout;

const menuItems = [
  {
    key: '/',
    icon: <BarChartOutlined />,
    label: <NavLink to="/">Дашборд</NavLink>,
  },
  {
    key: '/analytics',
    icon: <FundOutlined />,
    label: <NavLink to="/analytics">Аналитика</NavLink>,
  },
  {
    key: '/generation-settings',
    icon: <SettingOutlined />,
    label: <NavLink to="/generation-settings">Настройки генерации</NavLink>,
  },
  {
    key: '/history',
    icon: <HistoryOutlined />,
    label: <NavLink to="/history">История пользователей</NavLink>,
  },
  {
    key: '/users',
    icon: <TeamOutlined />,
    label: <NavLink to="/users">Пользователи</NavLink>,
  },
];

const titles: Record<string, string> = {
  '/': 'Дашборд контент-фабрики',
  '/analytics': 'Аналитика токенов и действий',
  '/generation-settings': 'Настройки генерации',
  '/history': 'История пользователей',
  '/users': 'Управление пользователями',
};

function resolveSelectedKey(pathname: string) {
  if (pathname.startsWith('/generation-settings')) {
    return '/generation-settings';
  }

  if (pathname.startsWith('/users')) {
    return '/users';
  }

  if (pathname.startsWith('/history')) {
    return '/history';
  }

  if (pathname.startsWith('/analytics')) {
    return '/analytics';
  }

  return '/';
}

export function AppLayout() {
  const location = useLocation();
  const selectedKey = resolveSelectedKey(location.pathname);
  const pageTitle = titles[selectedKey] ?? 'Личный кабинет';

  return (
    <Layout className="shell-layout">
      <Sider width={280} theme="light" className="shell-sider">
        <div className="brand-block">
          <span className="brand-kicker">Fedya Bot</span>
          <Typography.Title level={3} className="brand-title">
            Контент-фабрика
          </Typography.Title>
          <Typography.Paragraph className="brand-description">
            Кабинет для отслеживания выпуска статей, аналитики генерации и
            модерации пользователей.
          </Typography.Paragraph>
        </div>
        <Menu
          mode="inline"
          selectedKeys={[selectedKey]}
          className="shell-menu"
          items={menuItems}
        />
      </Sider>
      <Layout className="shell-main">
        <Content className="shell-content">
          <div className="page-head">
            <Typography.Title level={2} className="page-title">
              {pageTitle}
            </Typography.Title>
            <Typography.Paragraph className="page-subtitle">
              Доступ к кабинету открыт только после авторизации через Telegram
              для пользователей с ролью <code>admin</code>. Настройки
              генерации, история действий и аналитика доступны из бокового
              меню после проверки серверной сессии.
            </Typography.Paragraph>
          </div>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
