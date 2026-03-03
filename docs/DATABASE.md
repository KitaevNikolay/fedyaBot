# База данных

## СУБД

- MySQL

## ORM

- Prisma

## Сущности

- User
- Session
- Scenario
- Article
- ArticleAddition
- ArticleVersion
- GenerationSettings

### User

| Поле | Тип | Описание |
| --- | --- | --- |
| id | String (UUID) | Первичный ключ |
| telegramId | String (Unique) | Telegram ID пользователя |
| username | String? | Telegram username |
| firstName | String? | Имя |
| lastName | String? | Фамилия |
| isActive | Boolean | Флаг активированного пользователя |
| role | String | Роль пользователя (user/admin) |
| bitrixId | Int? | ID пользователя в Bitrix24 |
| createdAt | DateTime | Дата создания |
| updatedAt | DateTime | Дата обновления |

### Article

| Поле | Тип | Описание |
| --- | --- | --- |
| id | String (UUID) | Первичный ключ |
| userId | String | ID пользователя |
| title | String (Text) | Заголовок статьи |
| createdAt | DateTime | Дата создания |
| updatedAt | DateTime | Дата обновления |

### ArticleAddition

| Поле | Тип | Описание |
| --- | --- | --- |
| id | String (UUID) | Первичный ключ |
| articleId | String | ID статьи |
| type | ArticleAdditionType | Тип дополнения |
| content | String (LongText) | Содержимое |
| createdAt | DateTime | Дата создания |
| updatedAt | DateTime | Дата обновления |

### ArticleVersion

| Поле | Тип | Описание |
| --- | --- | --- |
| id | String (UUID) | Первичный ключ |
| articleId | String | ID статьи |
| iteration | Int | Номер итерации |
| content | String (LongText) | Содержимое |
| rewriteType | String | Причина перезаписи (default: none) |
| createdAt | DateTime | Дата создания |

### GenerationSettings

Таблица для хранения настроек генерации для каждого типа контента.

| Поле | Тип | Описание |
| --- | --- | --- |
| id | String (UUID) | Первичный ключ |
| type | String (Unique) | Тип генерации (generate_questions, generate_article, generate_rubrics, generate_products и др.) |
| model | String | Модель LLM |
| temperature | Float | Температура генерации |
| maxTokens | Int | Максимальное количество токенов |
| files | String (LongText) | JSON массив URL файлов для контекста |
| systemPromptId | String? | ID документа в Outline для системного промпта |
| userPromptId | String? | ID документа в Outline для пользовательского промпта |
| createdAt | DateTime | Дата создания |
| updatedAt | DateTime | Дата обновления |

### TechnicalArticleAdditions

Таблица для отслеживания асинхронных технических задач (например, проверка уникальности).

| Поле | Тип | Описание |
| --- | --- | --- |
| id | String (UUID) | Первичный ключ |
| articleId | String | ID статьи |
| state | String | Состояние задачи (NEW, RUNNING, PENDING, FINISHED, ERROR) |
| message | String? | Результат (например, % уникальности или ошибка) |
| tries | Int | Количество попыток опроса API |
| technicalInfo | String? | Дополнительная информация (UID задачи в text.ru) |
| createdAt | DateTime | Дата создания |
| updatedAt | DateTime | Дата обновления |

### ArticleAdditionType

- QUESTION
- ARTICLE
- FACT_CHECK
- RUBRIC
- PRODUCT
- SEO_TZ
- ARTICLE_UNIQ_CHECK
- BITRIX_TASK
- USER_PROMPT

## Миграции

- Добавлена таблица `TechnicalArticleAdditions`
- Добавлены новые типы в `ArticleAdditionType`: `SEO_TZ`, `ARTICLE_UNIQ_CHECK`, `BITRIX_TASK`
- В модель `User` добавлено поле `bitrixId`
- Изменен тип поля `title` в модели `Article` на `Text` для поддержки длинных заголовков
- В Docker используется `prisma migrate deploy` на старте приложения
- Регулярные бэкапы через `mysqldump` (см. инструкцию в README)
- В версии статей добавлено поле `rewrite_type` с дефолтом `none`
