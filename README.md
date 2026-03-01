## Описание

Telegram-бот на NestJS для взаимодействия с AI-вендором и генерации статей.

## 📚 Документация

- [Руководство пользователя (How-To)](docs/howTo.md)
- [Архитектура проекта](docs/ARCHITECTURE.md)
- [Описание проекта](docs/PROJECT_OVERVIEW.md)
- [API Endpoints](docs/API.md)
- [База данных](docs/DATABASE.md)
- [Docker](docs/DOCKER.md)

## Стек

- NestJS
- grammY
- Prisma + MySQL
- Redis (ioredis)
- class-validator

## Настройки генерации

Настройки генерации (model, temperature, tokens, files, systemPromptId, userPromptId)
хранятся в БД, а сами промпты — в Outline.

## Логи

Все пользовательские действия и внешние запросы логируются в файл, заданный переменной LOG_FILE_PATH.
В Docker dev логи доступны на хосте в папке ./logs.
Ошибки генерации пишутся в этот же лог с типом generation_error.

## Пользователи

В таблице Users сохраняются telegramId, username, firstName и lastName.
Поле role используется для доступа в админ-меню.

## Файлы и ввод

После генерации вопросов и факт-чека можно загрузить .docx файл и использовать его содержимое для следующего шага. Для SEO‑оптимизации принимается .docx ТЗ. Ввод темы статьи и загрузку файла можно отменить командой /cancel.

## Локальный запуск

```bash
npm install
npm run start:dev
```

Prisma Client генерируется автоматически после npm install.

## 🐳 Запуск через Docker

### Development
```bash
cp .env.example .env.dev
nano .env.dev
docker-compose -f docker-compose.dev.yml up --build
```

### Production
```bash
cp .env.example .env.prod
nano .env.prod
docker-compose up --build -d
```

Если переменные из .env.dev не подхватываются, используйте:

```bash
docker-compose --env-file .env.dev -f docker-compose.dev.yml up --build
```

## Бэкап базы данных

Для создания бэкапа MySQL из Docker контейнера:

```bash
docker exec fedyabot-db-1 mysqldump --no-tablespaces -u fedya -pfedya fedya > backup_$(date +%Y%m%d_%H%M%S).sql
```

(Для Windows PowerShell используйте `$(Get-Date -Format "yyyyMMdd_HHmmss")` вместо `date`).

## Миграции Prisma

```bash
npx prisma migrate dev
```

## Seed данных

```bash
npx prisma db seed
```

В Docker миграции применяются автоматически при старте контейнера приложения.
