# Временный режим Telegram

Пока Яндекс Мессенджер недоступен, бот может работать через Telegram. Функциональность та же,
что в релизе 2.0: сценарии, авторские стили, кабинет, аналитика. Меняется только транспорт.

## Как устроено

- `MESSENGER_PLATFORM=telegram` заставляет `MessengerModule` подставить `TelegramBotApiService`
  вместо `YandexMessengerApiService` (`src/modules/messenger`). Адаптер переводит обновления
  Telegram в формат Яндекса, а кнопки в inline-клавиатуру, поэтому `BotService` не меняется.
- Пользователь идентифицируется числовым Telegram ID. Перед релизом 2.0 всех пользователей
  перепривязали на логины Яндекса прямо в бывшей колонке `telegramId`, поэтому в
  `User.messengerId` теперь логины Яндекса, а старые Telegram ID лежат в отдельной колонке
  `User.telegramId` (заполнена 12.10.2026 из дампа до 2.0 по `User.id`). В Telegram-режиме
  пользователь ищется сначала по `telegramId`, затем по `messengerId` — так прежние аккаунты
  возвращаются с ролями и историей, а в Яндексе `telegramId` не используется.
- Пользователи, которые появились уже в Яндексе (`telegramId` пуст), в Telegram будут новыми и
  неактивными: их нужно активировать в кабинете. Новые записи Telegram-режима получают Telegram
  ID и в `messengerId`, и в `telegramId`.
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
