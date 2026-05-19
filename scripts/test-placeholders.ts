
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Скрипт для проверки подстановки переменных в шаблоны Bothub.
 * Имитирует логику BothubService.
 */

const vars = {
  'article_subject': 'Тестовая тема статьи',
  'today': '16.03.2026',
  'ARTICLE.content': 'Это основной текст статьи для теста.',
  'ARTICLE_UNIQ_CHECK.content': '95%',
  'BITRIX_TASK.content': 'TASK-123',
  'FACT_CHECK.content': 'Результаты факт-чека: ошибок нет.',
  'PRODUCT.content': 'Список продуктов: Товар 1, Товар 2.',
  'QUESTION.content': 'Вопрос 1? Вопрос 2?',
  'RUBRIC.content': 'Рубрика: Технологии.',
  'SEO_TZ.content': 'SEO ТЗ: использовать ключи ИИ, бот.',
  'USER_PROMPT.content': 'Сделай текст более формальным.',
  // Для обратной совместимости или если в коде используются другие ключи
  'questions_content': 'Имитация ответов на вопросы.',
  'current_date': '16.03.2026'
};

function resolvePlaceholders(template: string, data: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(data)) {
    // Экранируем точки в ключе для регулярного выражения
    const escapedKey = key.replace(/\./g, '\\.');
    const regex = new RegExp(`{{\\s*${escapedKey}\\s*}}`, 'g');
    result = result.replace(regex, value);
  }
  return result;
}

function checkUnresolved(text: string, templateName: string) {
  const placeholderRegex = /{{\s*[\w\.]+\s*}}/g;
  const matches = text.match(placeholderRegex);
  if (matches) {
    console.error(`[FAIL] Шаблон "${templateName}" содержит неразрешенные плейсхолдеры: ${matches.join(', ')}`);
    return false;
  }
  console.log(`[OK] Шаблон "${templateName}" успешно обработан.`);
  return true;
}

async function runTest() {
  try {
    const configPath = join(process.cwd(), 'config', 'bothub', 'config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    const templates = config.prompts;

    console.log('Начинаю проверку шаблонов Bothub...\n');
    
    let allPassed = true;

    for (const [name, template] of Object.entries(templates)) {
      if (typeof template !== 'string') continue;
      
      const processed = resolvePlaceholders(template, vars);
      if (!checkUnresolved(processed, name)) {
        allPassed = false;
      }
    }

    if (allPassed) {
      console.log('\n✅ Все шаблоны прошли проверку. Плейсхолдеров не осталось.');
    } else {
      console.error('\n❌ Обнаружены ошибки в подстановке переменных.');
      process.exit(1);
    }
  } catch (error) {
    console.error('Ошибка при выполнении теста:', error);
    process.exit(1);
  }
}

runTest();
