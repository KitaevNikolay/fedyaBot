export interface ArticleSettings {
  model: string;
  temperature: number;
  max_tokens: number;
  files: string[];
}

export interface BothubConfig {
  api: {
    url: string;
    model: string;
    temperature: number;
    max_tokens: number;
  };
  prompts: {
    generate_questions: string;
    generate_article: string;
    generate_fact_check: string;
    rewrite_article: string;
    seo_rewrite_article: string;
    generate_rubrics: string;
    generate_products: string;
    article_uniqueness: string;
    uniq_prompt: string;
  };
  article_settings?: ArticleSettings;
  fact_check_settings?: ArticleSettings;
  rewrite_settings?: ArticleSettings;
  rubric_settings?: ArticleSettings;
  product_settings?: ArticleSettings;
}

export interface GenerationResult {
  content: string;
  usage?: number;
  mockSystemPrompt?: string;
  mockUserPrompt?: string;
}

export interface BothubResponse {
  choices?: Array<{
    /** stop — ответ завершён, length — упёрлись в лимит токенов */
    finish_reason?: string;
    message?: {
      content?: string;
      /** Рассуждения reasoning-моделей: расходуют тот же лимит токенов */
      reasoning?: string;
    };
  }>;
  usage?: {
    bothub?: {
      caps?: number;
    };
  };
}

/**
 * Ошибка генерации со стороны Bothub. Отдельный тип нужен, чтобы бот отличал
 * «кончились деньги» от прочих сбоев: раньше пользователь на любой отказ видел
 * «Попробуйте позже» и не мог понять, что счёт ушёл в минус.
 */
export class BothubGenerationError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'BothubGenerationError';
  }

  get isBalanceExhausted() {
    return this.code === 'NOT_ENOUGH_TOKENS' || this.status === 403;
  }
}

/**
 * Поток генерации закончился, не прислав finish_reason. Ответ неполный, но и
 * не доставлен — повторять безопасно: платить дважды за выданный результат
 * здесь не за что.
 */
export class BothubStreamAbortedError extends Error {
  constructor(
    readonly contentLength: number,
    readonly reasoningLength: number,
  ) {
    super(
      `Ответ модели оборван: поток закончился без finish_reason ` +
        `(текста ${contentLength} символов, рассуждений ${reasoningLength})`,
    );
    this.name = 'BothubStreamAbortedError';
  }
}

export interface BothubBalanceResponse {
  subscription?: {
    plan?: {
      type?: string;
    };
    // Bothub переименовал поле из snake_case в camelCase: читаем оба, иначе
    // баланс молча превращается в 0 и утечка счёта остаётся незамеченной
    availableBalance?: number;
    available_balance?: number;
  };
  error?: {
    message?: string;
  };
}

export type BothubModelListItem =
  | string
  | {
      id?: string;
      model?: string;
      name?: string;
      title?: string;
      label?: string;
      slug?: string;
      display_name?: string;
      displayName?: string;
      provider?: string;
      owned_by?: string;
      children?: BothubModelListItem[];
    };

export type BothubModelListResponse =
  | BothubModelListItem[]
  | {
      data?: BothubModelListItem[];
      items?: BothubModelListItem[];
      results?: BothubModelListItem[];
      models?: BothubModelListItem[];
    };

export type GenerationSettingsPayload = {
  type: string;
  model: string;
  temperature: number;
  maxTokens: number;
  files: string[];
  systemPromptId: string | null;
  userPromptId: string | null;
  additionalPayload?: Record<string, any> | null;
};

export type BothubModelOption = {
  id: string;
  label: string;
  provider: string | null;
};

export type ResolvedBothubPrompts = {
  system: string | null;
  user: string;
};
