# Временный режим Telegram

Пока Яндекс Мессенджер недоступен, бот может работать через Telegram. Функциональность та же,
что в релизе 2.0: сценарии, авторские стили, кабинет, аналитика. Меняется только транспорт.

## Как устроено

- `MESSENGER_PLATFORM=telegram` заставляет `MessengerModule` подставить `TelegramBotApiService`
  вместо `YandexMessengerApiService` (`src/modules/messenger`). Адаптер переводит обновления
  Telegram в формат Яндекса, а кнопки в inline-клавиатуру, поэтому `BotService` не меняется.
- Пользователь идентифицируется числовым Telegram ID (`User.messengerId`). У пользователей,
  заведённых до переезда в Яндекс, там и так лежат Telegram ID (миграция только переименовала
  колонку), поэтому они вернутся в свои аккаунты с прежними ролями и историей.
- Пользователи, которые появились уже в Яндексе (`messengerId` = логин Яндекса), в Telegram
  будут новыми и неактивными: их нужно активировать в кабинете.
- Только polling: `YANDEX_WEBHOOK_URL` в этом режиме игнорируется. Offset хранится в Redis
  под отдельным ключом `telegram:updates_offset`, поэтому очередь Яндекса не сбивается.
- Вход в кабинет: код приходит в Telegram. В форме входа указывается `@username` (ищется среди
  тех, кто уже писал боту) или числовой Telegram ID.

## Включить

В `.env` на сервере:

```env
MESSENGER_PLATFORM=telegram
TELEGRAM_BOT_TOKEN=<токен старого бота от @BotFather>
# если Telegram с сервера недоступен напрямую — одно из двух:
TELEGRAM_PROXY_URL=socks5://user:pass@host:port   # или http://…
TELEGRAM_API_BASE_URL=https://<зеркало Bot API>
```

Затем пересоздать контейнеры, чтобы подхватить `.env`:
`docker compose -f docker-compose.prod.yml up -d --build app cabinet-api cabinet-frontend`.

В логе `app` должно появиться `Telegram bot started as <username>`.

## Вернуться в Яндекс Мессенджер

`MESSENGER_PLATFORM=yandex` (или удалить переменную), затем `up -d` тех же сервисов. Тексты
страницы входа в кабинете в этой ветке рассчитаны на Telegram, поэтому вернуть их можно
либо деплоем `main`, либо оставить как есть до следующего релиза.

## Проверка

`npm run test:telegram`: адаптер без сети (конвертация обновлений, кнопки, лимит 4096
символов, callback_data > 64 байт).
