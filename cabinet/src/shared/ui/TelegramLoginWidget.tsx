import { Alert, Spin } from 'antd';
import { useEffect, useRef, useState } from 'react';
import type { TelegramAuthPayload } from '../types/admin';

declare global {
  interface Window {
    [key: string]: unknown;
  }
}

interface TelegramLoginWidgetProps {
  botUsername?: string;
  onAuth: (payload: TelegramAuthPayload) => void;
}

export function TelegramLoginWidget({
  botUsername,
  onAuth,
}: TelegramLoginWidgetProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const onAuthRef = useRef(onAuth);
  const callbackNameRef = useRef(
    `telegramAuthCallback_${crypto.randomUUID().replace(/-/g, '')}`,
  );
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    onAuthRef.current = onAuth;
  }, [onAuth]);

  useEffect(() => {
    if (!botUsername || !containerRef.current) {
      return undefined;
    }

    const callbackName = callbackNameRef.current;
    const container = containerRef.current;
    setIsLoading(true);
    container.innerHTML = '';

    window[callbackName] = (payload: TelegramAuthPayload) => {
      onAuthRef.current(payload);
    };

    const script = document.createElement('script');
    script.src = 'https://telegram.org/js/telegram-widget.js?22';
    script.async = true;
    script.setAttribute('data-telegram-login', botUsername);
    script.setAttribute('data-size', 'large');
    script.setAttribute('data-radius', '16');
    script.setAttribute('data-userpic', 'false');
    script.setAttribute('data-request-access', 'write');
    script.setAttribute('data-onauth', `${callbackName}(user)`);
    script.onload = () => setIsLoading(false);
    script.onerror = () => setIsLoading(false);

    container.appendChild(script);

    return () => {
      delete window[callbackName];
      container.innerHTML = '';
    };
  }, [botUsername]);

  if (!botUsername) {
    return (
      <Alert
        type="warning"
        showIcon
        message="Не задан VITE_TELEGRAM_BOT_USERNAME"
        description="Добавьте username Telegram-бота во frontend env, чтобы страница смогла отрисовать виджет."
      />
    );
  }

  return (
    <div className="telegram-widget-box">
      {isLoading ? <Spin /> : null}
      <div ref={containerRef} />
    </div>
  );
}
