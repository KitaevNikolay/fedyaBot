# Деплой (Deployment Guide)

Данное руководство описывает процесс развертывания бота на удаленном Linux-сервере согласно корпоративным стандартам.

## 1. Подготовка окружения

### Структура каталогов
Приложение должно быть развернуто в каталоге:
`/srv/www/fedyaBot.<domain>/`

### Переменные окружения
Создайте файл `.env.prod` в корне проекта на сервере на основе `.env.example`.
**Важно:** Для доступа к PostgreSQL/MySQL на хосте из контейнера используйте IP `172.17.0.1` или `host.docker.internal`.

```bash
cp .env.example .env.prod
# Отредактируйте переменные (DATABASE_URL, BOT_TOKEN и др.)
```

## 2. Сборка и запуск

Используйте Docker Compose для управления сервисами приложения.

```bash
docker compose up -d --build
```

Это создаст и запустит:
- `fedyabot-app`: Основное приложение (NestJS)
- `fedyabot-redis`: Redis для сессий и кэша

## 3. Настройка Nginx и SSL

### Конфигурация Nginx
Создайте файл `/etc/nginx/sites-available/fedyaBot.<domain>.conf`:

```nginx
server {
    listen 80;
    server_name <domain>;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Активируйте конфиг:
```bash
sudo ln -s /etc/nginx/sites-available/fedyaBot.<domain>.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

### SSL (Certbot)
Оформите сертификат:
```bash
sudo certbot --nginx -d <domain>
```

## 4. Проверка

### Логи
Просмотр логов приложения:
```bash
docker logs -f fedyabot-app
```

### Статус контейнеров
```bash
docker ps
```

## 5. Обновление приложения

Для обновления выполните:
```bash
git pull
docker compose up -d --build
```
Миграции Prisma применяются автоматически при каждом старте контейнера `app`.

## 6. Релиз 2.0 — переезд в Яндекс Мессенджер (2026-09)

Порядок выкатки на проде:

1. **Бэкап БД** до обновления: миграция `20260903000000_messenger_id` переименовывает
   `User.telegramId` → `User.messengerId` и `AnalyticsEvent.telegramId` → `messengerId`.
   ```bash
   docker exec <mysql-container> mysqldump -u<user> -p<pass> fedya > backup_before_2.0.sql
   ```
2. **Переменные окружения** в `.env.prod` (см. `.env.example`):
   - `YANDEX_BOT_TOKEN` — OAuth-токен бота из Яндекс 360 (Мессенджер → Боты). Бот должен
     быть подключён к организации, сотрудники которой будут им пользоваться.
   - `YANDEX_WEBHOOK_URL` — оставить пустым: бот сам опрашивает `getUpdates` (polling),
     публиковать порт наружу не нужно. Заполнять только если нужен webhook — тогда путь из URL
     должен проксироваться на порт приложения.
   - `CABINET_ADMIN_LOGINS` — логины Яндекса первых администраторов через запятую
     (например `ivan.petrov,anna@company.ru`): они получат активный аккаунт с ролью admin при
     первом сообщении боту или входе в кабинет. Без этого некому будет активировать остальных.
   - `TELEGRAM_*` и `VITE_TELEGRAM_BOT_USERNAME` больше не используются, их можно удалить.
3. **Сборка**: `docker compose up -d --build` (пересобираются `app`, `cabinet-api`, `cabinet-frontend`).
4. **Проверка**: в логах `app` должно появиться `Yandex Messenger bot started as <login бота>`.
   Написать боту любое сообщение — он ответит статусом доступа; администратор входит в кабинет
   по коду из чата с ботом и активирует остальных пользователей.
5. **Перепривязка истории** (по желанию). Старые пользователи остались в `User` с Telegram ID
   в `messengerId`. Чтобы сохранить за сотрудником его статьи и аналитику, замените ID на логин:
   ```sql
   UPDATE `User` SET `messengerId` = 'ivan.petrov', `username` = 'ivan.petrov'
   WHERE `messengerId` = '123456789';
   ```
   Делать это до того, как сотрудник впервые напишет боту (иначе создастся вторая запись).
   Неперепривязанные записи можно оставить — они просто не будут активны.
6. **Откат**: вернуть предыдущий образ и восстановить бэкап БД (миграция переименования
   обратно не откатывается автоматически).
