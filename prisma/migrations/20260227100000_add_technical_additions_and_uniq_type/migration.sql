-- AlterTable
ALTER TABLE `ArticleAddition` MODIFY `type` ENUM('QUESTION', 'ARTICLE', 'FACT_CHECK', 'RUBRIC', 'PRODUCT', 'SEO_TZ', 'ARTICLE_UNIQ_CHECK') NOT NULL;

-- CreateTable
CREATE TABLE `TechnicalArticleAdditions` (
    `id` VARCHAR(191) NOT NULL,
    `articleId` VARCHAR(191) NOT NULL,
    `state` ENUM('NEW', 'RUNNING', 'PENDING', 'FINISHED', 'ERROR') NOT NULL,
    `message` LONGTEXT NULL,
    `tries` INTEGER NOT NULL DEFAULT 0,
    `technicalInfo` LONGTEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `TechnicalArticleAddition_articleId_fkey`(`articleId`),
    INDEX `TechnicalArticleAddition_state_idx`(`state`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `TechnicalArticleAdditions` ADD CONSTRAINT `TechnicalArticleAddition_articleId_fkey` FOREIGN KEY (`articleId`) REFERENCES `Article`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
