# Docker

## Development

- Dockerfile.dev
- docker-compose.dev.yml
- Hot-reload через volume mapping
- При необходимости используйте --env-file .env.dev
- Prisma Client генерируется на этапе npm install
- Миграции применяются при старте контейнера приложения
- Для заполнения GenerationSettings используйте prisma db seed
- **Redis**: используется для сессий, порт 6379, volume redis_data_dev
- Для интеграции Outline задайте OUTLINE_API_URL и OUTLINE_API_KEY в .env.dev
- LOG_FILE_PATH указывает путь к файлу логов в контейнере
- В dev папка ./logs монтируется в /app/logs для доступа к логам на хосте
- Ошибки генерации пишутся в тот же файл логов
- Бэкапы БД сохраняются на хосте в ./backups перед миграциями
- В этой итерации docker-конфиги не менялись
- Добавлена миграция Prisma для типа ArticleAdditionType.SEO_TZ
- В этой итерации сборка пересобирается без дополнительных шагов
- Добавлена поддержка Bitrix24 и Text.ru через переменные окружения в `.env.dev` и `.env.prod`.
- Приложение больше не падает при отсутствии `TEXT_RU_API_KEY`, если он не используется.

## Production

- Multi-stage Dockerfile
- docker-compose.yml
- Non-root user
- **Важно:** В образ установлен `openssl` для поддержки Prisma Engine на Alpine
- Логи пишутся в volume logs_data

