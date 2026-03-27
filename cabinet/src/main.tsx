import React from 'react';
import ReactDOM from 'react-dom/client';
import { App as AntdApp, ConfigProvider } from 'antd';
import ruRU from 'antd/locale/ru_RU';
import 'antd/dist/reset.css';
import App from './app/App';
import './styles/global.css';

const theme = {
  token: {
    colorPrimary: '#0f8f7f',
    colorInfo: '#0f8f7f',
    colorSuccess: '#1f9d55',
    colorWarning: '#d97706',
    colorError: '#c2410c',
    borderRadius: 20,
    fontFamily: '"Aptos", "Segoe UI", sans-serif',
  },
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider locale={ruRU} theme={theme}>
      <AntdApp>
        <App />
      </AntdApp>
    </ConfigProvider>
  </React.StrictMode>,
);
