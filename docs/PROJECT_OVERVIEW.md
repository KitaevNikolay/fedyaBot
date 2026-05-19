# Описание проекта

## Стек
- Backend: NestJS (TypeScript), модульная архитектура
- Telegram: grammY
- БД: MySQL + Prisma
- Кеш/состояния: Redis (ioredis)
- Валидация: class-validator, глобальный ValidationPipe
- Документы: docx (создание), mammoth (извлечение текста)

## Архитектура
Точка входа — `main.ts`, сборка модулей — `app.module.ts`. Приложение разделено на модули по доменам:
- Bot
- Users
- Sessions
- Scenarios
- Articles
- Bothub
- GenerationSettings
- Outline
- Redis
- Database
- Config

## Бизнес-логика
Основная цель — автоматизация контентного цикла:
1. Пользователь выбирает сценарий и создаёт статью.
2. Генерируются вопросы по теме.
3. На основе вопросов генерируется статья.
4. Генерируется факт‑чек и при необходимости статья переписывается.
5. При необходимости выполняется SEO‑оптимизация по ТЗ.
6. Дополнительно генерируются рубрики и продукты.
7. Результаты сохраняются в БД и доступны для скачивания.

## Функциональная часть
- Telegram‑бот с нативными командами меню и inline‑кнопками.
- Работа со сценариями и активными сессиями.
- Генерация вопросов, статьи, факт‑чека, SEO‑оптимизации, рубрик и продуктов.
- Автоматическое сохранение факт-чека и переписанной статьи (без ручного подтверждения).
- SEO‑оптимизация по пользовательскому ТЗ (.docx).
- Скачивание результатов в виде .docx файлов.
- Загрузка .docx файлов пользователем для контекста статьи.
- Roadmap: подсказки следующего шага в интерфейсе.
- Админ‑меню с ограничением по роли пользователя.
- Файловое логирование пользовательских действий и внешних запросов.

## UI
UI реализован внутри Telegram:
- Нативные команды `/start` и `/cancel` (через меню ввода)
- Inline‑клавиатуры для выбора сценария и управления процессом
- Сообщения и тексты интерфейса вынесены в локализацию

## Конфиги и окружения
- `.env.dev` и `.env.prod`: токены, ключи, подключения к БД/Redis, логирование.
- `config/bothub/config.json`: базовые промпты и параметры генерации.
- `config/bothub/outline_map.json`: ID документов Outline для system/user промптов.
- `config/constants/bot.json`: команды и callback‑ключи.
- `config/locales/ru.json`: тексты интерфейса.
- Docker dev/prod: `Dockerfile.dev`, `docker-compose.dev.yml`, `Dockerfile`, `docker-compose.yml`.

## Схема базы данных
### User
| Поле | Тип | Описание |
| --- | --- | --- |
| id | String (UUID) | Идентификатор пользователя |
| telegramId | String (Unique) | Telegram ID |
| username | String? | Telegram username |
| firstName | String? | Имя |
| lastName | String? | Фамилия |
| isActive | Boolean | Активен ли доступ |
| role | String | Роль пользователя (user/admin) |
| createdAt | DateTime | Дата создания |
| updatedAt | DateTime | Дата обновления |

### Session
| Поле | Тип | Описание |
| --- | --- | --- |
| id | String (UUID) | Идентификатор сессии |
| userId | String | Ссылка на пользователя |
| scenarioId | String? | Ссылка на сценарий |
| articleId | String? | Ссылка на статью |
| createdAt | DateTime | Дата создания |
| updatedAt | DateTime | Дата обновления |

### Scenario
| Поле | Тип | Описание |
| --- | --- | --- |
| id | String (UUID) | Идентификатор сценария |
| code | String (Unique) | Технический код |
| name | String | Название сценария |
| createdAt | DateTime | Дата создания |

### Article
| Поле | Тип | Описание |
| --- | --- | --- |
| id | String (UUID) | Идентификатор статьи |
| userId | String | Ссылка на пользователя |
| title | String | Заголовок статьи |
| createdAt | DateTime | Дата создания |
| updatedAt | DateTime | Дата обновления |

### ArticleAddition
| Поле | Тип | Описание |
| --- | --- | --- |
| id | String (UUID) | Идентификатор дополнения |
| articleId | String | Ссылка на статью |
| type | ArticleAdditionType | Тип дополнения |
| content | String (LongText) | Контент дополнения |
| createdAt | DateTime | Дата создания |
| updatedAt | DateTime | Дата обновления |

### ArticleVersion
| Поле | Тип | Описание |
| --- | --- | --- |
| id | String (UUID) | Идентификатор версии |
| articleId | String | Ссылка на статью |
| iteration | Int | Номер итерации |
| content | String (LongText) | Текст версии |
| createdAt | DateTime | Дата создания |

### GenerationSettings
| Поле | Тип | Описание |
| --- | --- | --- |
| id | String (UUID) | Идентификатор настроек |
| type | String (Unique) | Тип генерации |
| model | String | Модель LLM |
| temperature | Float | Температура генерации |
| maxTokens | Int | Лимит токенов |
| files | String (LongText) | JSON массив URL файлов |
| systemPromptId | String? | ID system‑промпта в Outline |
| userPromptId | String? | ID user‑промпта в Outline |
| createdAt | DateTime | Дата создания |
| updatedAt | DateTime | Дата обновления |

### ArticleAdditionType
- QUESTION
- ARTICLE
- FACT_CHECK
- RUBRIC
- PRODUCT

## Интеграции
### Bothub (LLM)
Назначение: генерация вопросов, статьи, факт‑чека, рубрик и продуктов.  
Синхронизация: настройки генерации хранятся в БД (GenerationSettings), промпты берутся из Outline, файловые контексты передаются в запросе.

### Outline
Назначение: хранение промптов (system/user).  
Синхронизация: на старте возможна миграция и загрузка промптов, ID документов фиксируются в `outline_map.json`.

### MySQL + Prisma
Назначение: хранение пользователей, сессий, статей, дополнений и настроек генерации.  
Синхронизация: через Prisma Client, миграции применяются при старте контейнера.

### Redis
Назначение: хранение временных состояний пользователя и контекста генерации.  
Синхронизация: прямое чтение/запись в Redis из сервиса состояния.

### Telegram
Назначение: пользовательский интерфейс и доставка файлов.  
Синхронизация: все команды/коллбэки обрабатываются ботом, ответы и документы отправляются через grammY.
