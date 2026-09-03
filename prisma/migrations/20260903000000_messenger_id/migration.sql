-- Переход бота с Telegram на Яндекс Мессенджер: пользователи и события
-- аналитики теперь идентифицируются логином Яндекса. Значения не меняем —
-- старые Telegram ID остаются у прежних записей, пока их не перепривяжут.
ALTER TABLE `User` RENAME COLUMN `telegramId` TO `messengerId`;
ALTER TABLE `User` RENAME INDEX `User_telegramId_key` TO `User_messengerId_key`;

-- Таблица событий аналитики замаплена как AnalyticsEvents (@@map в schema.prisma)
ALTER TABLE `AnalyticsEvents` RENAME COLUMN `telegramId` TO `messengerId`;
