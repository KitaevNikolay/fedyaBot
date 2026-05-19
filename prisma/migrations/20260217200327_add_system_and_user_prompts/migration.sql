/*
  Warnings:

  - You are about to drop the column `promptId` on the `GenerationSettings` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE `GenerationSettings` DROP COLUMN `promptId`,
    ADD COLUMN `systemPromptId` VARCHAR(191) NULL,
    ADD COLUMN `userPromptId` VARCHAR(191) NULL;
