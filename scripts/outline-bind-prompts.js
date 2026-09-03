/**
 * Привязка промптов из коллекции Outline к типам генерации.
 *
 * Показывает коллекции и документы Outline и подбирает документы для каждого
 * типа генерации по названию: в заголовке должен быть тип в скобках, например
 * «Генерация статьи системный промт (generate_article)»; слово «систем…»
 * в заголовке — системный промпт, иначе — пользовательский.
 *
 * Использование (переменные OUTLINE_API_URL, OUTLINE_API_KEY, DATABASE_URL
 * берутся из окружения контейнера):
 *
 *   node scripts/outline-bind-prompts.js                       # список коллекций
 *   node scripts/outline-bind-prompts.js --collection "<имя или id>"          # план привязки
 *   node scripts/outline-bind-prompts.js --collection "<имя или id>" --apply  # записать в БД
 *   node scripts/outline-bind-prompts.js --collection "<имя или id>" --list   # все документы коллекции
 */
const rawUrl = process.env.OUTLINE_API_URL || '';
const normalizedUrl = rawUrl.replace(/\/+$/, '');
const apiUrl = normalizedUrl.endsWith('/api')
  ? normalizedUrl
  : `${normalizedUrl}/api`;
const apiKey = process.env.OUTLINE_API_KEY;

const args = process.argv.slice(2);
const getArg = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const collectionArg = getArg('--collection');
const apply = args.includes('--apply');
const listOnly = args.includes('--list');

if (!rawUrl || !apiKey) {
  process.stdout.write(
    'OUTLINE_API_URL и OUTLINE_API_KEY должны быть заданы\n',
  );
  process.exit(1);
}

const request = async (endpoint, body) => {
  const response = await fetch(`${apiUrl}/${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body ?? {}),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Outline ${endpoint}: HTTP ${response.status} ${text}`);
  }
  const json = text ? JSON.parse(text) : {};
  return json.data ?? json;
};

const listAllDocuments = async (collectionId) => {
  const documents = [];
  const limit = 100;
  for (let offset = 0; ; offset += limit) {
    const page = await request('documents.list', {
      collectionId,
      sort: 'title',
      direction: 'ASC',
      limit,
      offset,
    });
    documents.push(...page);
    if (page.length < limit) {
      break;
    }
  }
  return documents;
};

const KNOWN_TYPES = [
  'generate_questions',
  'generate_article',
  'generate_fact_check',
  'rewrite_article',
  'seo_rewrite_article',
  'article_uniqueness',
  'generate_rubrics',
  'generate_products',
  'uniq_prompt',
];

const classify = (title) => {
  const match = /\(([a-z_]+)\)/i.exec(title);
  if (!match) {
    return null;
  }
  const type = match[1].toLowerCase();
  if (!KNOWN_TYPES.includes(type)) {
    return null;
  }
  const role = /систем/i.test(title) ? 'system' : 'user';
  return { type, role };
};

const main = async () => {
  const collections = await request('collections.list', { limit: 100 });

  if (!collectionArg) {
    process.stdout.write('Коллекции Outline:\n');
    for (const collection of collections) {
      process.stdout.write(`  ${collection.id}  ${collection.name}\n`);
    }
    process.stdout.write(
      '\nУкажите коллекцию: --collection "<имя или id>" [--list | --apply]\n',
    );
    return;
  }

  const collection = collections.find(
    (item) =>
      item.id === collectionArg ||
      item.name.trim().toLowerCase() === collectionArg.trim().toLowerCase(),
  );
  if (!collection) {
    throw new Error(`Коллекция «${collectionArg}» не найдена`);
  }

  const documents = await listAllDocuments(collection.id);
  process.stdout.write(
    `Коллекция «${collection.name}» (${collection.id}): документов ${documents.length}\n\n`,
  );

  if (listOnly) {
    for (const document of documents) {
      process.stdout.write(`  ${document.id}  ${document.title}\n`);
    }
    return;
  }

  // План: тип генерации → системный/пользовательский документ
  const plan = new Map();
  const conflicts = [];
  for (const document of documents) {
    const info = classify(document.title);
    if (!info) {
      continue;
    }
    const entry = plan.get(info.type) ?? {};
    if (entry[info.role]) {
      conflicts.push(
        `${info.type}/${info.role}: «${entry[info.role].title}» и «${document.title}»`,
      );
      continue;
    }
    entry[info.role] = document;
    plan.set(info.type, entry);
  }

  process.stdout.write('План привязки:\n');
  for (const type of KNOWN_TYPES) {
    const entry = plan.get(type) ?? {};
    const system = entry.system
      ? `${entry.system.id}  «${entry.system.title}»`
      : '—';
    const user = entry.user ? `${entry.user.id}  «${entry.user.title}»` : '—';
    process.stdout.write(
      `  ${type}\n    system: ${system}\n    user:   ${user}\n`,
    );
  }

  if (conflicts.length > 0) {
    process.stdout.write(
      `\nНеоднозначные заголовки (взят первый по алфавиту, проверьте вручную):\n  ${conflicts.join('\n  ')}\n`,
    );
  }

  const unmatched = documents.filter((document) => !classify(document.title));
  if (unmatched.length > 0) {
    process.stdout.write(
      `\nДокументы без типа в скобках (например, стили авторов), в план не вошли:\n`,
    );
    for (const document of unmatched) {
      process.stdout.write(`  ${document.id}  ${document.title}\n`);
    }
  }

  if (!apply) {
    process.stdout.write(
      '\nЭто предпросмотр. Для записи в GenerationSettings добавьте --apply.\n',
    );
    return;
  }

  // Запись: пустой слот в плане оставляет текущее значение в БД
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  try {
    const settings = await prisma.generationSettings.findMany({
      select: { type: true, systemPromptId: true, userPromptId: true },
    });
    for (const setting of settings) {
      const entry = plan.get(setting.type);
      if (!entry) {
        process.stdout.write(
          `  ${setting.type}: в коллекции нет документов, без изменений\n`,
        );
        continue;
      }
      const data = {};
      if (entry.system) data.systemPromptId = entry.system.id;
      if (entry.user) data.userPromptId = entry.user.id;
      await prisma.generationSettings.update({
        where: { type: setting.type },
        data,
      });
      process.stdout.write(
        `  ${setting.type}: system ${setting.systemPromptId ?? '—'} → ${
          data.systemPromptId ?? '(без изменений)'
        }, user ${setting.userPromptId ?? '—'} → ${data.userPromptId ?? '(без изменений)'}\n`,
      );
    }
    process.stdout.write('\nГотово. Привязки обновлены.\n');
  } finally {
    await prisma.$disconnect();
  }
};

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
