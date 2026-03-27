Свободный промпт пользовательский (uniq_prompt) 
{{ USER_PROMPT.content }}
{{ ARTICLE.content }}

Уникализация статьи пользовательские промт (article_uniqueness)
{{ ARTICLE.content }}

Переписать статью под SEO ТЗ системный (seo_rewrite_article) V2
Нет

Переписать статью под SEO ТЗ пользовательский (seo_rewrite_article)
{{ SEO_TZ.content }}
{{ ARTICLE.content }}

Генерация рубрик/подрубрик. Системный промпт (generate_rubrics)
{{ article_subject }}
{{ ARTICLE.content }}

Генерация статьи системный промт (generate_article)
Нет

Генерация продуктов. Пользовательский промпт (generate_products)
{{ ARTICLE.content }}

Генерация факт-чека. Пользовательский промпт (generate_fact_check)
{{ ARTICLE.content }}
{{ today }}
{{ FACT_CHECK.content }}

Генерация продуктов. Системный промпт (generate_products)
Нет

Генерация вопросов (generate_questions)
{{ article_subject }} 
{{ today }}

Генерация факт-чека. Системный промпт (generate_fact_check)
Нет

Переписать статью с фак-чеком (rewrite_article)
{{ FACT_CHECK.content }}
{{ ARTICLE.content }}

Генерация статьи пользовательский промт (generate_article)
{{ article_subject }}
{{ QUESTION.content }}
{{ today }}