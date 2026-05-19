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
    message?: {
      content?: string;
    };
  }>;
  usage?: {
    bothub?: {
      caps?: number;
    };
  };
}

export interface BothubBalanceResponse {
  subscription?: {
    plan?: {
      type?: string;
    };
    availableBalance?: number;
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
