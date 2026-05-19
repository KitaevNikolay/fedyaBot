-- AlterTable
ALTER TABLE `GenerationSettings` ADD COLUMN `additionalPayload` JSON NULL;

-- AlterTable
ALTER TABLE `User` ADD COLUMN `bitrixId` INTEGER NULL;

-- AlterTable
ALTER TABLE `Article` MODIFY `title` TEXT NOT NULL;
