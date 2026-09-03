# Развёртывание FedyaBot 2.0 (Яндекс Мессенджер)

Руководство по выкатке версии 2.0 на сервер и по локальному запуску для проверки.
Что изменилось по сравнению с 1.x — в [CHANGELOG.md](CHANGELOG.md). Коротко:

- бот общается через Bot API **Яндекс Мессенджера** вместо Telegram;
- пользователи идентифицируются **логином Яндекса** (`User.messengerId`), нужна миграция БД;
- вход в кабинет — по **одноразовому коду**, который бот присылает в личный чат;
- авторские стили включены в работу, интеграция с ГАРАНТ в релиз не вошла.

Порядок: подготовить бота и переменные → привести в порядок Outline → бэкап БД → выкатить →
проверить → активировать пользователей.

---

## 1. Что нужно до выкатки

### 1.1. Бот в Яндекс Мессенджере

1. В организации Яндекс 360 (администратор) создайте бота или используйте уже созданного
   «Писатель Федя». Подробнее: <https://yandex.ru/dev/messenger/doc/ru/>.
2. Получите **OAuth-токен бота** — он идёт в `YANDEX_BOT_TOKEN`.
3. Бот должен быть подключён к той организации, сотрудники которой будут с ним работать:
   Bot API не даёт писать пользователям вне организации и тем, кто закрыл личные сообщения
   настройками приватности.
4. Проверить токен можно с любой машины (в ответе — `login` и `display_name` бота):
   ```bash
   curl -H 'Authorization: OAuth <YANDEX_BOT_TOKEN>' https://botapi.messenger.yandex.net/bot/v1/self/get
   ```

Режим получения обновлений:

- **Polling (по умолчанию, рекомендуется)** — `YANDEX_WEBHOOK_URL` пустой. Приложение само
  опрашивает `getUpdates`, наружу порт публиковать не нужно. При старте приложение сбрасывает
  webhook у бота.
- **Webhook** — `YANDEX_WEBHOOK_URL=https://<домен>/<секретный-путь>`. Путь из URL должен
  проксироваться на порт приложения (3000 в контейнере). Яндекс ждёт ответ не дольше секунды,
  приложение отвечает сразу и обрабатывает обновления в фоне.

Важно: **один токен — один процесс**. Локальный dev-контейнер, опрашивающий того же бота,
будет забирать обновления у прода. Перед выкаткой остановите локальный `app` или заведите
отдельного бота для разработки.

### 1.2. Переменные окружения

Файл окружения на сервере — `.env` (переменная `APP_ENV_FILE` в `docker-compose.prod.yml`;
по умолчанию `.env`). Шаблон — [.env.example](../.env.example).

| Переменная | Обязательно | Описание |
|---|---|---|
| `YANDEX_BOT_TOKEN` | да | OAuth-токен бота Яндекс Мессенджера. Без него `app` падает на старте. |
| `YANDEX_WEBHOOK_URL` | нет | Публичный URL вебхука. Пусто — polling. |
| `CABINET_ADMIN_LOGINS` | да (для первого входа) | Логины Яндекса первых администраторов через запятую, например `ivan.petrov,anna@company.ru`. Эти пользователи получают активный аккаунт с ролью `admin` при первом сообщении боту или входе в кабинет. |
| `CABINET_AUTH_SECRET` | да | Секрет подписи сессий кабинета (любая длинная случайная строка). Если пусто — используется токен бота. |
| `CABINET_HOST` | да | Домен кабинета для Traefik (`docker-compose.prod.yml`). |
| `DATABASE_URL` | да | MySQL, например `mysql://user:pass@host:3306/fedya`. |
| `REDIS_HOST`, `REDIS_PORT` | да | Redis для состояний сценария, дедупликации обновлений и offset polling. |
| `OUTLINE_API_URL`, `OUTLINE_API_KEY` | да | Outline с промптами (см. раздел 2). Без `OUTLINE_API_URL` приложение ходит на `http://localhost:3000/api` и промпты не грузятся. |
| `OUTLINE_MIGRATE_ON_START` | нет | `false`. `true` только при первичном заполнении `config/bothub/outline_map.json`. |
| `BOTHUB_API_KEY` | да | Ключ Bothub. |
| `BOTHUB_MOCK_MODE` | нет | `false` на проде. `true` — генерации не вызывают Bothub, а возвращают собранные промпты. |
| `BOTHUB_WEB_SEARCH_ENABLED` | нет | По умолчанию включён; `false` отключает плагин веб-поиска. |
| `TEXT_RU_API_KEY` | да | Проверка уникальности text.ru. |
| `BITRIX_WEBHOOK` | да | Вебхук Bitrix24 для создания задач. |
| `LOG_FILE_PATH` | нет | `logs/app.log`. Папка `./logs` монтируется в контейнеры. |
| `PORT` / `BOT_PORT` | нет | Порт приложения в контейнере, 3000. |
| `CABINET_PORT` | нет | Порт cabinet-api в контейнере, 3001. |

Больше **не используются** и могут быть удалены: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_URL`,
`TELEGRAM_API_BASE_URL`, `TELEGRAM_PROXY_URL`, `VITE_TELEGRAM_BOT_USERNAME`.

---

## 2. Outline: промпты и стили

Все промпты генерации живут в Outline (коллекция «Fedya Prompts (Astral Journal)»),
привязка «тип генерации → документ» хранится в БД (`GenerationSettings.systemPromptId` /
`userPromptId`) и редактируется в кабинете на странице «Настройки генерации». Настройки
dev и prod для Outline одинаковые.

### 2.1. Проверить доступ по API

На 03.09.2026 ключ `OUTLINE_API_KEY` из `.env.dev` отвечает **401 `authentication_required`**.
Так как prod использует те же реквизиты, до выкатки нужно выпустить новый API-ключ
(Outline → Settings → API) и прописать его в `.env` на сервере и в `.env.dev`. Проверка:

```bash
curl -s -X POST "$OUTLINE_API_URL/auth.info" -H "Authorization: Bearer $OUTLINE_API_KEY" -H 'Content-Type: application/json' -d '{}'
# ожидаем {"ok":true,...}
```

Без рабочего ключа бот на каждой генерации получит ошибку «Ошибка генерации» — промпты не
загрузятся (в mock-режиме есть fallback на `config/bothub/config.json`, на проде его нет).

### 2.2. Коллекция промптов и привязка к типам генерации

Промпты текущей версии лежат в отдельной коллекции Outline. Кабинет показывает в выпадающих
списках «Настроек генерации» документы коллекции из `OUTLINE_PROMPTS_COLLECTION` (имя или id;
пусто — коллекция с именем `prompts`) плюс уже привязанные документы. Массово перепривязать
типы генерации на документы другой коллекции можно скриптом (есть в образе `app`):

```bash
docker compose -f docker-compose.prod.yml run --rm --no-deps app node scripts/outline-bind-prompts.js                     # коллекции
docker compose -f docker-compose.prod.yml run --rm --no-deps app node scripts/outline-bind-prompts.js --collection "<имя>"  # план
docker compose -f docker-compose.prod.yml run --rm --no-deps app node scripts/outline-bind-prompts.js --collection "<имя>" --apply
```

Скрипт сопоставляет документы по типу в скобках в заголовке («… (generate_article)») и слову
«системный». Пошаговый чек-лист выкатки — [RELEASE_2.0_RUNBOOK.md](RELEASE_2.0_RUNBOOK.md).

### 2.3. Перенести доработанные промпты

Новые версии шести документов лежат в [newTask/prompts_new/](../newTask/prompts_new/),
что именно изменено — в [CHANGES.md](../newTask/prompts_new/CHANGES.md). Перенос ручной:
открыть документ в Outline, заменить содержимое целиком содержимым файла. ID документов —
в `newTask/prompts_new/test_outline_ids.json`, откат — `newTask/outline_current/`.

| Файл | Документ Outline |
|---|---|
| `01_generate_article_system.md` | Генерация статьи системный промт (generate_article) |
| `02_generate_article_user.md` | Генерация статьи пользовательский промт (generate_article) |
| `03_rewrite_article_user.md` | Переписать статью с фак-чеком. Пользовательский промпт (rewrite_article) |
| `04_article_uniqueness_user.md` | Уникализация статьи пользовательские промт (article_uniqueness) |
| `05_seo_rewrite_system.md` | Переписать статью под SEO ТЗ системный (seo_rewrite_article) V2 |
| `06_seo_rewrite_user.md` | Переписать статью под SEO ТЗ пользовательский (seo_rewrite_article) |

Если промпты уже правились прямо в Outline после 14.07.2026 — сверьте, что в них есть
плейсхолдеры из таблицы ниже, остальное можно не переносить.

### 2.3. Плейсхолдеры авторского стиля

| Плейсхолдер | Где подставляется | Что содержит |
|---|---|---|
| `{{ author_name }}` | generate_article (system и user), rewrite_article, article_uniqueness, seo_rewrite_article | Имя выбранного автора («Евгения Мемрук» и т. д.) или пусто |
| `{{ author_style }}` | generate_article (system и user) | Текст описания стиля из отдельного документа Outline (см. ниже) или пусто |

Описания стилей лежат в отдельной коллекции Outline, карта «код автора → ID документа» —
[config/bothub/author_styles_map.json](../config/bothub/author_styles_map.json)
(`memruk`, `klimova`, `morozov`, `kaverina`, `ivanov`, `samitov`, `samkova`). Работают оба
варианта: либо блоки авторов внутри системного промпта по `{{ author_name }}` (как в
`01_generate_article_system.md`), либо вынесенные описания через `{{ author_style }}` —
для второго варианта в системном промпте generate_article должен стоять `{{ author_style }}`,
а документы из карты должны быть доступны по API-ключу. Если документа нет, стиль
подставляется пустым, генерация не прерывается (в логах — `Стиль автора … не найден`).

Список авторов и подписи кнопок — `AUTHOR_OPTIONS` в `src/modules/bot/bot.service.ts`.

---

## 3. База данных

### 3.1. Бэкап (обязательно)

Миграция `20260903000000_messenger_id` переименовывает `User.telegramId → messengerId`
(с уникальным индексом) и `AnalyticsEvents.telegramId → messengerId`. Автоматического отката нет.

```bash
mysqldump -h <host> -u <user> -p fedya > fedya_before_2.0_$(date +%F).sql
```

### 3.2. Миграции

Применяются автоматически при старте контейнера `app` (`prisma migrate deploy`), кабинету
отдельных миграций не нужно. Если `app` не стартует с ошибкой `P3018`, смотрите раздел 7.

### 3.3. Старые пользователи

Записи пользователей Telegram остаются: в `messengerId` у них числовой Telegram ID, они
неактивны для нового бота. Чтобы сохранить за сотрудником статьи, сессии и аналитику,
перепривяжите запись к логину Яндекса **до** того, как он впервые напишет боту (иначе
создастся вторая запись):

```sql
UPDATE `User` SET `messengerId` = 'ivan.petrov', `username` = 'ivan.petrov'
WHERE `messengerId` = '123456789';
```

Логины хранятся в нижнем регистре; для аккаунтов на сторонних доменах — полная форма
`login@domain`. Остальные записи можно не трогать.

---

## 4. Выкатка

### 4.1. Через GitHub Actions (штатный путь)

`.github/workflows/deploy.yml` на push в `main` по SSH выполняет на сервере
`git pull origin main` и `docker compose -f docker-compose.prod.yml up --build -d` в
`/srv/apps/fedyabot/current`. Секреты `PROD_SSH_HOST`, `PROD_SSH_USER`, `PROD_SSH_KEY`
заданы в репозитории.

Так как история локальных веток не связана с `origin/main`, релиз лежит в ветке
`release/2.0-yandex` — это `origin/main` плюс один коммит со снимком дерева. Порядок:

1. Выполнить разделы 1–3 (переменные в `.env` на сервере, Outline, бэкап).
2. Остановить локальный dev-контейнер, если он опрашивает того же бота.
3. `git push origin release/2.0-yandex:main` — запустится деплой.
4. Следить за workflow в GitHub и за логами на сервере (раздел 5).

### 4.2. Вручную на сервере

```bash
cd /srv/apps/fedyabot/current
git pull origin main
docker compose -f docker-compose.prod.yml up --build -d
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f app
```

Пересобираются три образа: `app` (бот), `cabinet-api`, `cabinet-frontend` (nginx, проксирует
`/admin` на `cabinet-api`). Redis и MySQL — внешние, в сети `data`.

---

## 5. Проверка после выкатки

1. **Логи `app`**: `All migrations have been successfully applied`, затем
   `Yandex Messenger webhook removed, starting polling` и
   `Yandex Messenger bot started as <логин бота>`. При webhook-режиме —
   `Yandex Messenger webhook set: …`.
2. **Бот**: администратор из `CABINET_ADMIN_LOGINS` пишет боту любое сообщение — в ответ
   приходит меню с кнопками. Обычный сотрудник получает «Ваш аккаунт зарегистрирован.
   Дождитесь подтверждения администратора».
3. **Кабинет**: на `https://<CABINET_HOST>` ввести логин Яндекса → «Получить код» → код
   приходит в чат с ботом → «Войти». В разделе «Пользователи» активировать сотрудников.
4. **Сценарий**: выбрать сценарий, создать статью, загрузить вопросы docx, выбрать стиль
   автора, дождаться генерации — файл приходит в чат. Проверить «Скачать файлы».
5. **Outline**: в логе нет `Outline API request failed … 401`.
6. **Аналитика в кабинете** показывает новые события по логинам.

---

## 6. Откат

1. Остановить приложение: `docker compose -f docker-compose.prod.yml stop app cabinet-api`.
2. Восстановить бэкап БД из раздела 3.1.
3. Вернуть предыдущий коммит в `main` (`git revert` релизного коммита или `git reset` на
   предыдущий `origin/main` с `--force`), запустить деплой.
4. Вернуть в `.env` `TELEGRAM_BOT_TOKEN`.

---

## 7. Типовые проблемы

| Симптом | Причина и действие |
|---|---|
| `app` падает: `YANDEX_BOT_TOKEN is required` | Не задан токен в `.env`. |
| `Failed to start Yandex Messenger bot: … 401` | Токен неверный или отозван. Проверить `self/get` (раздел 1.1). |
| Бот молчит, в логах нет входящих | Обновления забирает другой процесс с тем же токеном (локальный dev) или у бота задан webhook на чужой адрес. Остановить лишний процесс; приложение при старте в polling-режиме сбрасывает webhook. |
| Кнопки не нажимаются / в логах `Client reported button errors` | Клиент Мессенджера не поддерживает директиву `server_action` — обновить клиент; текстовые команды `/start`, `/menu`, `/cancel` работают всегда. |
| «Не удалось отправить код в Яндекс Мессенджер» при входе в кабинет | Пользователь ещё не писал боту, вне организации или закрыл личные сообщения. Сначала написать боту. |
| Ни у кого нет роли admin | Добавить логин в `CABINET_ADMIN_LOGINS`, пересоздать контейнеры (`up -d`), написать боту или войти в кабинет. Либо `UPDATE User SET role='admin', isActive=1 WHERE messengerId='…'`. |
| `Outline API request failed … 401` | Ключ Outline недействителен (раздел 2.1). |
| Миграция `P3018` при старте | Посмотреть ошибку в логе, починить БД, затем `docker compose -f docker-compose.prod.yml run --rm app npx prisma migrate resolve --rolled-back 20260903000000_messenger_id` и перезапустить `app`. Если первая команда миграции уже прошла (колонка `messengerId` есть), вернуть её вручную перед повтором: `ALTER TABLE User RENAME COLUMN messengerId TO telegramId; ALTER TABLE User RENAME INDEX User_messengerId_key TO User_telegramId_key;`. |
| После рестарта пользователи получили «Предыдущий шаг не завершился» | Штатно: генерация была оборвана рестартом, шаг нужно повторить. |

---

## 8. Локальный запуск для проверки

Dev-стек: `docker-compose.dev.yml` (MySQL, Redis, `app`, `cabinet-api`, `cabinet-frontend`),
исходники монтируются в контейнеры. Переменные — `.env.dev`.

```bash
docker compose -p fedyabot -f docker-compose.dev.yml up -d --build
docker compose -p fedyabot logs -f app
```

Порты по умолчанию: приложение 3000, cabinet-api 3001, кабинет <http://localhost:5173>,
MySQL 3306, Redis 6379. Если порты заняты, подключите override с другими портами —
готовый пример [docker-compose.dev.override.example.yml](../docker-compose.dev.override.example.yml)
(приложение 3020, cabinet-api 3011, кабинет <http://localhost:5174>, MySQL 3308, Redis 6380):

```bash
docker compose -p fedyabot -f docker-compose.dev.yml -f docker-compose.dev.override.example.yml up -d --build
```

Особенности:

- `nest --watch` в контейнере не видит правок с Windows-хоста — после изменений в `src/`
  делайте `docker restart fedyabot-app-1`. Изменения `.env.dev` требуют пересоздания
  контейнеров (`up -d`), а не рестарта.
- Локальный `app` опрашивает того же бота, что и прод (один токен) — не запускайте оба.
- Чтобы войти в кабинет локально, впишите свой логин Яндекса в `CABINET_ADMIN_LOGINS`
  в `.env.dev` и пересоздайте `app` и `cabinet-api`.

Автотесты (нужен запущенный dev-стек; при других портах задайте `DATABASE_URL`, `REDIS_HOST`,
`REDIS_PORT`):

```bash
npm run test:messenger      # маршрутизатор Яндекс Мессенджера, без сети
npm run test:e2e:bot        # сквозной сценарий бота на реальных БД и Redis, API подменён
npm run test:e2e:cabinet    # вход в кабинет по коду
```
