ALTER TABLE `GenerationSettings`
ADD COLUMN `type_name` VARCHAR(255) NULL AFTER `type`;

UPDATE `GenerationSettings`
SET `type_name` = CASE `type`
  WHEN 'generate_questions' THEN 'Генерация вопросов'
  WHEN 'generate_article' THEN 'Генерация статьи'
  WHEN 'generate_fact_check' THEN 'Факт-чек'
  WHEN 'rewrite_article' THEN 'Переписывание статьи'
  WHEN 'seo_rewrite_article' THEN 'SEO-оптимизация'
  WHEN 'generate_rubrics' THEN 'Подбор рубрик'
  WHEN 'generate_products' THEN 'Подбор продуктов'
  WHEN 'article_uniqueness' THEN 'Уникализация статьи'
  WHEN 'uniq_prompt' THEN 'Пользовательский промпт'
  ELSE `type_name`
END
WHERE `type_name` IS NULL;
