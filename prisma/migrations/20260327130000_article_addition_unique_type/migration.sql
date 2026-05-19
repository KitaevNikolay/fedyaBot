DELETE aa
FROM ArticleAddition aa
INNER JOIN (
  SELECT id
  FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY articleId, type
        ORDER BY updatedAt DESC, createdAt DESC, id DESC
      ) AS row_num
    FROM ArticleAddition
  ) ranked
  WHERE ranked.row_num > 1
) duplicates
  ON duplicates.id = aa.id;

CREATE UNIQUE INDEX `ArticleAddition_articleId_type_key`
ON `ArticleAddition`(`articleId`, `type`);
