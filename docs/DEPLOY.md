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
