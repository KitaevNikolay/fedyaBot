export type PromptPlaceholderKey =
  | 'article_subject'
  | 'today'
  | 'QUESTION.content'
  | 'ARTICLE.content'
  | 'FACT_CHECK.content'
  | 'SEO_TZ.content'
  | 'USER_PROMPT.content';

export type PromptPlaceholderDefinition = {
  key: PromptPlaceholderKey;
  token: string;
  label: string;
};

const PLACEHOLDER_LABELS: Record<PromptPlaceholderKey, string> = {
  article_subject: 'Тема статьи',
  today: 'Текущая дата',
  'QUESTION.content': 'Сгенерированные вопросы',
  'ARTICLE.content': 'Текст статьи',
  'FACT_CHECK.content': 'Результат факт-чека',
  'SEO_TZ.content': 'SEO ТЗ',
  'USER_PROMPT.content': 'Пользовательский запрос',
};

function createPlaceholder(
  key: PromptPlaceholderKey,
): PromptPlaceholderDefinition {
  return {
    key,
    token: `{{ ${key} }}`,
    label: PLACEHOLDER_LABELS[key],
  };
}

export const PROMPT_PLACEHOLDERS_BY_TYPE: Record<
  string,
  PromptPlaceholderDefinition[]
> = {
  generate_questions: [
    createPlaceholder('article_subject'),
    createPlaceholder('today'),
  ],
  generate_article: [
    createPlaceholder('article_subject'),
    createPlaceholder('QUESTION.content'),
    createPlaceholder('today'),
  ],
  generate_fact_check: [
    createPlaceholder('ARTICLE.content'),
    createPlaceholder('today'),
  ],
  rewrite_article: [
    createPlaceholder('article_subject'),
    createPlaceholder('ARTICLE.content'),
    createPlaceholder('FACT_CHECK.content'),
  ],
  seo_rewrite_article: [
    createPlaceholder('SEO_TZ.content'),
    createPlaceholder('ARTICLE.content'),
  ],
  generate_rubrics: [
    createPlaceholder('article_subject'),
    createPlaceholder('ARTICLE.content'),
  ],
  generate_products: [createPlaceholder('ARTICLE.content')],
  article_uniqueness: [createPlaceholder('ARTICLE.content')],
  uniq_prompt: [
    createPlaceholder('ARTICLE.content'),
    createPlaceholder('USER_PROMPT.content'),
  ],
};

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function applyPromptTemplate(
  type: string,
  template: string,
  values: Partial<Record<PromptPlaceholderKey, string>>,
) {
  const placeholders = PROMPT_PLACEHOLDERS_BY_TYPE[type] ?? [];

  return placeholders.reduce((result, placeholder) => {
    const replacement = values[placeholder.key] ?? '';
    const pattern = new RegExp(
      `{{\\s*${escapeRegExp(placeholder.key)}\\s*}}`,
      'g',
    );

    return result.replace(pattern, replacement);
  }, template);
}
