-- Временный режим Telegram: в messengerId теперь логины Яндекса, а старые
-- Telegram ID нужны отдельно, чтобы пользователи вернулись в свои аккаунты.
ALTER TABLE `User` ADD COLUMN `telegramId` VARCHAR(191) NULL;
CREATE UNIQUE INDEX `User_telegramId_key` ON `User`(`telegramId`);
