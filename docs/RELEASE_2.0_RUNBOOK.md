# Инструкция по деплою релиза 2.0 на сервер

Пошаговый чек-лист для оператора. Подробности по каждому пункту — в [DEPLOY.md](DEPLOY.md),
что изменилось — в [CHANGELOG.md](CHANGELOG.md). Все команды выполняются на сервере в каталоге
приложения (`/srv/apps/fedyabot/current`), если не сказано иное.

Ориентир по времени: подготовка 30–40 минут, сама выкатка 5–10 минут, простой бота — на время
пересборки образов.

---

## Шаг 0. Что понадобится

- [ ] Доступ на сервер по SSH и права на `docker compose`.
- [ ] OAuth-токен бота Яндекс Мессенджера («Писатель Федя»).
- [ ] Логины Яндекса администраторов кабинета (например, `ivan.petrov` или `anna@company.ru`).
- [ ] Рабочий API-ключ Outline (см. шаг 2).
- [ ] Название новой коллекции Outline, в которой лежат промпты для этой версии.

Пока идёт подготовка, прод продолжает работать на старой версии.

---

## Шаг 1. Переменные окружения

Файл на сервере: `.env` в каталоге приложения (`docker-compose.prod.yml`, `env_file`).

1. Добавить:
   ```
   YANDEX_BOT_TOKEN=<OAuth-токен бота>
   YANDEX_WEBHOOK_URL=
   CABINET_ADMIN_LOGINS=<логин1>,<логин2>
   CABINET_AUTH_SECRET=<длинная случайная строка>
   OUTLINE_PROMPTS_COLLECTION=<название новой коллекции Outline>
   ```
   `YANDEX_WEBHOOK_URL` оставить пустым — бот работает через polling, порт наружу не нужен.
2. Проверить, что заданы `OUTLINE_API_URL` (полный URL с `/api`), `OUTLINE_API_KEY`,
   `BOTHUB_API_KEY`, `TEXT_RU_API_KEY`, `BITRIX_WEBHOOK`, `DATABASE_URL`, `REDIS_HOST`,
   `REDIS_PORT`, `CABINET_HOST`. Без `OUTLINE_API_URL` промпты не загрузятся.
3. Удалить (или оставить, они игнорируются): `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_URL`,
   `TELEGRAM_API_BASE_URL`, `TELEGRAM_PROXY_URL`, `VITE_TELEGRAM_BOT_USERNAME`.
4. Проверить токен бота:
   ```bash
   curl -s -H "Authorization: OAuth $YANDEX_BOT_TOKEN" https://botapi.messenger.yandex.net/bot/v1/self/get
   ```
   Ожидается `{"ok":true,"login":"yndx-mssngr-…-bot","display_name":"Писатель Федя",…}`.

---

## Шаг 2. Outline: ключ и коллекция промптов

### 2.1. Ключ API

На 03.09.2026 ключ, общий для dev и prod, отвечает `401 authentication_required`. Выпустить
новый (Outline → Settings → API tokens), прописать в `.env`, проверить:

```bash
curl -s -X POST "$OUTLINE_API_URL/auth.info" -H "Authorization: Bearer $OUTLINE_API_KEY" -H 'Content-Type: application/json' -d '{}'
```

Ожидается `{"ok":true,…}`. С неверным ключом каждая генерация в боте закончится
«Ошибка генерации».

### 2.2. Подменить коллекцию промптов

Промпты этой версии лежат в другой коллекции Outline, а типы генерации в БД
(`GenerationSettings.systemPromptId` / `userPromptId`) всё ещё указывают на документы старой
коллекции. Привязку меняет скрипт `scripts/outline-bind-prompts.js`, он есть в образе `app`.

Выполнять **после** шага 4 (в новом образе), но до проверки бота:

```bash
# 1) увидеть коллекции и их id
docker compose -f docker-compose.prod.yml run --rm --no-deps app node scripts/outline-bind-prompts.js

# 2) предпросмотр: какой документ к какому типу подберётся
docker compose -f docker-compose.prod.yml run --rm --no-deps app \
  node scripts/outline-bind-prompts.js --collection "<название коллекции>"

# 3) записать привязки в БД
docker compose -f docker-compose.prod.yml run --rm --no-deps app \
  node scripts/outline-bind-prompts.js --collection "<название коллекции>" --apply
```

Скрипт узнаёт документы по типу в скобках в заголовке, например
«Генерация статьи системный промт (generate_article)»; слово «системный» в заголовке —
системный промпт, иначе пользовательский. Если для типа в коллекции нет документа, старая
привязка сохраняется. В предпросмотре проверьте, что все 9 типов нашли свои документы:
`generate_questions`, `generate_article`, `generate_fact_check`, `rewrite_article`,
`seo_rewrite_article`, `article_uniqueness`, `generate_rubrics`, `generate_products`,
`uniq_prompt`.

Альтернатива без скрипта: кабинет → «Настройки генерации» → выбрать документы вручную.
В выпадающем списке кабинета показываются документы коллекции из
`OUTLINE_PROMPTS_COLLECTION`, поэтому переменная из шага 1 обязательна.

### 2.3. Стили авторов

Описания стилей подставляются в `{{ author_style }}` по карте
`config/bothub/author_styles_map.json` (код автора → id документа). Если документы стилей
тоже переехали в новую коллекцию, взять их id из вывода
`node scripts/outline-bind-prompts.js --collection "<название>" --list` и обновить карту
в репозитории (файл попадает в образ при сборке). Если стили по-прежнему описаны блоками
внутри системного промпта generate_article через `{{ author_name }}`, менять ничего не нужно.

### 2.4. Плейсхолдеры

В промптах новой коллекции должны быть:

| Тип | Плейсхолдеры |
|---|---|
| generate_questions | `{{ article_subject }}`, `{{ today }}` |
| generate_article | `{{ article_subject }}`, `{{ QUESTION.content }}`, `{{ today }}`, `{{ author_name }}`, при вынесенных стилях `{{ author_style }}` |
| generate_fact_check | `{{ article_subject }}`, `{{ ARTICLE.content }}`, `{{ today }}` |
| rewrite_article | `{{ article_subject }}`, `{{ ARTICLE.content }}`, `{{ FACT_CHECK.content }}`, `{{ author_name }}` |
| seo_rewrite_article | `{{ ARTICLE.content }}`, `{{ SEO_TZ.content }}`, `{{ author_name }}` |
| article_uniqueness | `{{ ARTICLE.content }}`, `{{ author_name }}` |
| generate_rubrics, generate_products | `{{ ARTICLE.content }}` (рубрики — ещё `{{ article_subject }}`) |
| uniq_prompt | `{{ ARTICLE.content }}`, `{{ USER_PROMPT.content }}` |

Полный список подстановок — [vars.md](vars.md).

---

## Шаг 3. Бэкап базы

Миграция переименовывает `User.telegramId → messengerId` и
`AnalyticsEvents.telegramId → messengerId`; автоматического отката нет.

```bash
mysqldump -h <host> -u <user> -p fedya > /srv/backups/fedya_before_2.0_$(date +%F).sql
```

- [ ] Файл бэкапа существует и не пустой.

---

## Шаг 4. Выкатка

Перед выкаткой убедиться, что **никакой другой процесс не опрашивает бота** с этим токеном
(например, локальный dev-контейнер разработчика остановлен): два процесса делят один поток
обновлений, и часть сообщений будет пропадать.

### Вариант A. Через GitHub Actions

Push в `main` запускает деплой (`.github/workflows/deploy.yml`: `git pull` и
`docker compose -f docker-compose.prod.yml up --build -d` на сервере). Релиз лежит в ветке
`release/2.0-yandex` (снимок кода поверх прод-ветки):

```bash
git push origin release/2.0-yandex:main
```

Дождаться завершения workflow в GitHub.

### Вариант B. Вручную на сервере

```bash
cd /srv/apps/fedyabot/current
git pull origin main
docker compose -f docker-compose.prod.yml up --build -d
docker compose -f docker-compose.prod.yml ps
```

Пересобираются `app`, `cabinet-api`, `cabinet-frontend`. Миграция БД применяется при старте `app`.

### После выкатки

- [ ] `docker compose -f docker-compose.prod.yml logs --tail 100 app` содержит
      `All migrations have been successfully applied` и
      `Yandex Messenger bot started as <логин бота>`.
- [ ] Выполнить шаг 2.2 (привязка промптов новой коллекции).

---

## Шаг 5. Проверка

1. Администратор из `CABINET_ADMIN_LOGINS` пишет боту «Писатель Федя» любое сообщение.
   Ожидается меню с кнопками. Кнопки на пару секунд показывают крутилку и отвечают.
2. Кабинет `https://<CABINET_HOST>`: ввести логин → «Получить код» → код приходит в чат
   с ботом → «Войти». Открывается дашборд.
3. Кабинет → «Настройки генерации»: у каждого типа выбраны документы новой коллекции.
4. Обычный сотрудник пишет боту → «Ваш аккаунт зарегистрирован. Дождитесь подтверждения
   администратора». Администратор активирует его в разделе «Пользователи», сотрудник
   пишет снова и получает меню.
5. Сквозной сценарий: выбрать сценарий → «Создать статью» → тема → «Загрузить свои» →
   docx с вопросами → выбрать стиль автора → дождаться статьи (в чате висит индикатор
   «генерация статьи», затем приходит docx). Проверить «Скачать файлы».
6. В логах `app` нет `Outline API request failed … 401` и `Failed to generate content`.

---

## Шаг 6. Старые пользователи (по желанию)

Записи пользователей Telegram остались в `User` с числовым ID в `messengerId` и не активны.
Чтобы сохранить сотруднику статьи и историю, перепривязать запись к логину Яндекса
**до** того, как он впервые напишет боту:

```sql
UPDATE `User` SET `messengerId` = 'ivan.petrov', `username` = 'ivan.petrov'
WHERE `messengerId` = '123456789';
```

Логин в нижнем регистре; для аккаунтов на своих доменах — полная форма `login@domain`.

---

## Откат

1. `docker compose -f docker-compose.prod.yml stop app cabinet-api cabinet-frontend`
2. Восстановить бэкап из шага 3: `mysql -h <host> -u <user> -p fedya < /srv/backups/fedya_before_2.0_<дата>.sql`
3. Вернуть в `main` предыдущий коммит прод-ветки и запустить деплой (или `git checkout <коммит>`
   на сервере и `docker compose -f docker-compose.prod.yml up --build -d`).
4. Вернуть в `.env` `TELEGRAM_BOT_TOKEN`.

---

## Если что-то пошло не так

| Симптом | Что делать |
|---|---|
| `app` падает с `YANDEX_BOT_TOKEN is required` | Задать токен в `.env`, `docker compose -f docker-compose.prod.yml up -d app`. |
| `Failed to start Yandex Messenger bot: … 401` | Токен неверный, проверить `self/get` из шага 1. |
| Бот молчит, входящих в логах нет | Кто-то ещё опрашивает бота этим токеном — остановить. |
| Кнопки не реагируют | Обновить клиент Мессенджера; текстовые `/start`, `/menu`, `/cancel` работают всегда. |
| «Не удалось отправить код» при входе в кабинет | Пользователь ещё не писал боту или вне организации. Сначала написать боту. |
| Генерация: «Ошибка генерации», в логах `Outline … 401` | Ключ Outline, шаг 2.1. |
| Генерация идёт, но текст «не про то» / без стиля | Привязка промптов осталась на старой коллекции — шаг 2.2. |
| Миграция упала (`P3018`) | Разобрать ошибку в логе; затем `docker compose -f docker-compose.prod.yml run --rm --no-deps app npx prisma migrate resolve --rolled-back 20260903000000_messenger_id` и перезапуск `app`. Если колонка `User.messengerId` уже есть, сначала вернуть: `ALTER TABLE User RENAME COLUMN messengerId TO telegramId; ALTER TABLE User RENAME INDEX User_messengerId_key TO User_telegramId_key;` |
