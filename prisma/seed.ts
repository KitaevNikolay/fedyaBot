import { PrismaClient } from '@prisma/client';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const prisma = new PrismaClient({
    // datasources: {
    //     db: {
    //         url: process.env.DATABASE_URL
    //     }
    // }
});

async function main() {
  const scenarios = [
    {
      code: 'ASTRAL_JOURNAL',
      name: 'Астрал.Журнал',
    },
    {
      code: 'SEO',
      name: 'СЕО',
    },
  ];

  for (const scenario of scenarios) {
    await prisma.scenario.upsert({
      where: { code: scenario.code },
      update: {},
      create: scenario,
    });
  }

  const configPath = join(process.cwd(), 'config', 'bothub', 'config.json');
  const mapPath = join(process.cwd(), 'config', 'bothub', 'outline_map.json');

  if (existsSync(configPath)) {
    const config = JSON.parse(readFileSync(configPath, 'utf-8')) as {
      api?: {
        model?: string;
        temperature?: number;
        max_tokens?: number;
      };
      article_settings?: {
        model?: string;
        temperature?: number;
        max_tokens?: number;
        files?: string[];
      };
      fact_check_settings?: {
        model?: string;
        temperature?: number;
        max_tokens?: number;
        files?: string[];
      };
      rewrite_settings?: {
        model?: string;
        temperature?: number;
        max_tokens?: number;
        files?: string[];
      };
      rubric_settings?: {
        model?: string;
        temperature?: number;
        max_tokens?: number;
        files?: string[];
      };
      product_settings?: {
        model?: string;
        temperature?: number;
        max_tokens?: number;
        files?: string[];
      };
    };

    const map = existsSync(mapPath)
      ? (JSON.parse(readFileSync(mapPath, 'utf-8')) as Record<string, string>)
      : {};

    const settings = [
      {
        type: 'generate_questions',
        model: config.api?.model ?? 'gpt-4o',
        temperature: config.api?.temperature ?? 0.3,
        maxTokens: config.api?.max_tokens ?? 3000,
        files: JSON.stringify([]),
        systemPromptId: map.generate_questions_system ?? null,
        userPromptId:
          map.generate_questions_user ?? map.generate_questions ?? null,
      },
      {
        type: 'generate_article',
        model: config.article_settings?.model ?? 'gemini-3-flash-preview',
        temperature: config.article_settings?.temperature ?? 0.8,
        maxTokens: config.article_settings?.max_tokens ?? 200000,
        files: JSON.stringify(config.article_settings?.files ?? []),
        systemPromptId: map.generate_article_system ?? null,
        userPromptId: map.generate_article_user ?? map.generate_article ?? null,
      },
      {
        type: 'generate_fact_check',
        model: config.fact_check_settings?.model ?? 'gemini-3-flash-preview',
        temperature: config.fact_check_settings?.temperature ?? 0.8,
        maxTokens: config.fact_check_settings?.max_tokens ?? 200000,
        files: JSON.stringify(config.fact_check_settings?.files ?? []),
        systemPromptId: map.generate_fact_check_system ?? null,
        userPromptId:
          map.generate_fact_check_user ?? map.generate_fact_check ?? null,
      },
      {
        type: 'rewrite_article',
        model:
          config.rewrite_settings?.model ??
          config.article_settings?.model ??
          'gemini-3-flash-preview',
        temperature:
          config.rewrite_settings?.temperature ??
          config.article_settings?.temperature ??
          0.5,
        maxTokens:
          config.rewrite_settings?.max_tokens ??
          config.article_settings?.max_tokens ??
          40000,
        files: JSON.stringify(
          config.rewrite_settings?.files ??
            config.article_settings?.files ?? [],
        ),
        systemPromptId: map.rewrite_article_system ?? null,
        userPromptId: map.rewrite_article_user ?? map.rewrite_article ?? null,
      },
      {
        type: 'seo_rewrite_article',
        model:
          config.rewrite_settings?.model ??
          config.article_settings?.model ??
          'gemini-3-flash-preview',
        temperature:
          config.rewrite_settings?.temperature ??
          config.article_settings?.temperature ??
          0.5,
        maxTokens:
          config.rewrite_settings?.max_tokens ??
          config.article_settings?.max_tokens ??
          40000,
        files: JSON.stringify(
          config.rewrite_settings?.files ??
            config.article_settings?.files ?? [],
        ),
        systemPromptId: map.seo_rewrite_article_system ?? null,
        userPromptId:
          map.seo_rewrite_article_user ?? map.seo_rewrite_article ?? null,
      },
      {
        type: 'generate_rubrics',
        model: config.rubric_settings?.model ?? 'gemini-3-flash-preview',
        temperature: config.rubric_settings?.temperature ?? 0.5,
        maxTokens: config.rubric_settings?.max_tokens ?? 40000,
        files: JSON.stringify(
          config.rubric_settings?.files ?? [
            'https://static-server.rilokobotfactory3.ru/static/fedyaBot/aj/rubric/%D0%9F%D0%BE%D0%B4%D1%80%D1%83%D0%B1%D1%80%D0%B8%D0%BA%D0%B8.txt',
            'https://static-server.rilokobotfactory3.ru/static/fedyaBot/aj/rubric/%D0%A0%D1%83%D0%B1%D1%80%D0%B8%D0%BA%D0%B8.txt',
          ],
        ),
        systemPromptId: map.generate_rubrics_system ?? null,
        userPromptId: map.generate_rubrics_user ?? map.generate_rubrics ?? null,
      },
      {
        type: 'generate_products',
        model: config.product_settings?.model ?? 'gemini-3-flash-preview',
        temperature: config.product_settings?.temperature ?? 0.5,
        maxTokens: config.product_settings?.max_tokens ?? 40000,
        files: JSON.stringify(
          config.product_settings?.files ?? [
            'https://static-server.rilokobotfactory3.ru/static/fedyaBot/aj/products/astral-soft-products.md',
          ],
        ),
        systemPromptId: map.generate_products_system ?? null,
        userPromptId: map.generate_products_user ?? null,
      },
    ];

    for (const setting of settings) {
      await prisma.generationSettings.upsert({
        where: { type: setting.type },
        update: setting,
        create: setting,
      });
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
