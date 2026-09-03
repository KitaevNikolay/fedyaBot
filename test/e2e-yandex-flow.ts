/**
 * Сквозной прогон бота на реальных модулях (MySQL, Redis, локали, сценарии)
 * с подменённым клиентом Bot API Яндекса: обновления подаются напрямую в
 * маршрутизатор, исходящие сообщения собираются в память.
 *
 * Запуск (dev-стек в Docker, порты из override):
 *   DATABASE_URL=mysql://fedya:fedya@localhost:3308/fedya REDIS_HOST=localhost REDIS_PORT=6380 \
 *   npx ts-node test/e2e-yandex-flow.ts
 */
import assert from 'node:assert/strict';

process.env.BOTHUB_MOCK_MODE = process.env.BOTHUB_MOCK_MODE ?? 'true';
process.env.YANDEX_WEBHOOK_URL = '';
process.env.LOG_FILE_PATH = process.env.LOG_FILE_PATH ?? 'logs/e2e-yandex.log';

const stamp = Date.now().toString(36);
const USER_LOGIN = `e2e.user.${stamp}`;
const ADMIN_LOGIN = `e2e.admin.${stamp}`;
process.env.CABINET_ADMIN_LOGINS = `${ADMIN_LOGIN}, someone.else`;

import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { DocxUtil } from '../src/common/utils/docx.util';
import { PrismaService } from '../src/database/prisma.service';
import { BotService } from '../src/modules/bot/bot.service';
import { YandexMessengerApiService } from '../src/modules/messenger/yandex-messenger-api.service';
import {
  YandexSuggestButtons,
  YandexUpdate,
} from '../src/modules/messenger/yandex-messenger.types';

type SentText = {
  kind: 'text';
  target: { login?: string; chat_id?: string };
  text: string;
  buttons: string[];
};
type SentFile = {
  kind: 'file';
  target: { login?: string; chat_id?: string };
  filename: string;
  size: number;
};
type Sent = SentText | SentFile;

const sent: Sent[] = [];
let fileToServe: Buffer = Buffer.alloc(0);
let updateCounter = 1000;

function buttonsOf(suggest?: YandexSuggestButtons): string[] {
  const rows = (suggest?.buttons ?? []) as Array<
    | {
        directives?: Array<{
          type: string;
          payload?: { data?: string };
          uri?: string;
        }>;
      }
    | Array<{
        directives?: Array<{
          type: string;
          payload?: { data?: string };
          uri?: string;
        }>;
      }>
  >;
  const flat = rows.flatMap((row) => (Array.isArray(row) ? row : [row]));
  return flat.map((button) => {
    const directive = button.directives?.[0];
    if (!directive) return '';
    return directive.type === 'server_action'
      ? (directive.payload?.data ?? '')
      : `url:${directive.uri ?? ''}`;
  });
}

const fakeApi = {
  isConfigured: () => true,
  getSelf: async () => ({ ok: true, id: 'bot', login: 'fake-bot' }),
  setWebhook: async () => ({ ok: true, id: 'bot', login: 'fake-bot' }),
  getUpdates: async () => [],
  sendTyping: async () => undefined,
  sendText: async (
    target: { login?: string; chat_id?: string },
    text: string,
    options: { suggest_buttons?: YandexSuggestButtons } = {},
  ) => {
    sent.push({
      kind: 'text',
      target,
      text,
      buttons: buttonsOf(options.suggest_buttons),
    });
    return { ok: true, message_id: sent.length };
  },
  sendFile: async (
    target: { login?: string; chat_id?: string },
    data: Buffer,
    filename: string,
  ) => {
    sent.push({ kind: 'file', target, filename, size: data.length });
    return { ok: true, message_id: sent.length, file_id: `f${sent.length}` };
  },
  getFile: async () => fileToServe,
};

function update(login: string, extra: Partial<YandexUpdate>): YandexUpdate {
  updateCounter += 1;
  return {
    update_id: updateCounter,
    message_id: 1_700_000_000_000_000 + updateCounter,
    timestamp: Math.floor(Date.now() / 1000),
    chat: { type: 'private' },
    from: {
      id: `guid-${login}`,
      login,
      display_name: 'Тест Тестов',
      robot: false,
    },
    ...extra,
  };
}

function callback(login: string, data: string) {
  return update(login, {
    bot_request: {
      server_action: { name: 'callback', payload: { data } },
      element_id: data,
    },
  });
}

function lastText(): SentText {
  const item = [...sent]
    .reverse()
    .find((entry): entry is SentText => entry.kind === 'text');
  assert.ok(item, 'expected at least one text message');
  return item;
}

function textsSince(index: number) {
  return sent
    .slice(index)
    .filter((entry): entry is SentText => entry.kind === 'text');
}

async function main() {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(YandexMessengerApiService)
    .useValue(fakeApi)
    .compile();
  const app = moduleRef.createNestApplication({ logger: ['error', 'warn'] });
  await app.init();

  const bot = app.get(BotService).getBot();
  const prisma = app.get(PrismaService);
  const createdUserIds: string[] = [];

  try {
    // 1. Первое сообщение незнакомого пользователя регистрирует его (неактивным)
    await bot.handleUpdate(update(USER_LOGIN, { text: 'Привет, бот' }));
    let user = await prisma.user.findUnique({
      where: { messengerId: USER_LOGIN },
    });
    assert.ok(user, 'user must be created');
    createdUserIds.push(user.id);
    assert.equal(user.isActive, false);
    assert.equal(user.firstName, 'Тест');
    assert.equal(user.lastName, 'Тестов');
    assert.match(lastText().text, /Ваш аккаунт зарегистрирован/);
    assert.deepEqual(lastText().target, { login: USER_LOGIN });

    // 2. Повторное сообщение неактивного — «ещё не активирован»
    await bot.handleUpdate(update(USER_LOGIN, { text: '/start' }));
    assert.match(lastText().text, /еще не активирован/);

    // 3. Логин из CABINET_ADMIN_LOGINS сразу активен и admin
    await bot.handleUpdate(update(ADMIN_LOGIN, { text: 'hi' }));
    const admin = await prisma.user.findUnique({
      where: { messengerId: ADMIN_LOGIN },
    });
    assert.ok(admin);
    createdUserIds.push(admin.id);
    assert.equal(admin.isActive, true);
    assert.equal(admin.role, 'admin');
    assert.match(lastText().text, /^Меню:/);
    assert.ok(lastText().buttons.includes('select_scenario'));
    assert.ok(lastText().buttons.some((item) => item.startsWith('url:')));

    // 4. Активируем обычного пользователя и проходим сценарий
    await prisma.user.update({
      where: { id: user.id },
      data: { isActive: true },
    });
    await bot.handleUpdate(update(USER_LOGIN, { text: '/start' }));
    assert.match(lastText().text, /^Меню:/);
    assert.ok(lastText().buttons.includes('select_scenario'));

    await bot.handleUpdate(callback(USER_LOGIN, 'select_scenario'));
    const scenarioMenu = lastText();
    assert.match(scenarioMenu.text, /Выберите сценарий работы/);
    const scenarioButton = scenarioMenu.buttons.find((item) =>
      item.startsWith('scenario:'),
    );
    assert.ok(scenarioButton, 'at least one scenario expected in DB');

    await bot.handleUpdate(callback(USER_LOGIN, scenarioButton));
    assert.match(lastText().text, /Выбранный сценарий работы/);
    assert.ok(lastText().buttons.includes('work_with_article'));

    await bot.handleUpdate(callback(USER_LOGIN, 'work_with_article'));
    assert.match(lastText().text, /Выбранная статья: Не выбрана/);
    assert.ok(lastText().buttons.includes('create_article'));
    assert.ok(lastText().buttons.includes('upload_article'));

    await bot.handleUpdate(callback(USER_LOGIN, 'create_article'));
    assert.match(lastText().text, /Введите тему статьи/);

    await bot.handleUpdate(update(USER_LOGIN, { text: 'Тестовая тема e2e' }));
    assert.match(
      lastText().text,
      /Вы ввели заголовок статьи: "Тестовая тема e2e"/,
    );
    assert.deepEqual(lastText().buttons, ['confirm_title', 'reenter_title']);

    await bot.handleUpdate(callback(USER_LOGIN, 'confirm_title'));
    assert.match(lastText().text, /Новые вопросы или загрузим/);
    assert.deepEqual(lastText().buttons, [
      'generate_questions_choice',
      'upload_questions_choice',
    ]);
    const article = await prisma.article.findFirst({
      where: { userId: user.id, title: 'Тестовая тема e2e' },
    });
    assert.ok(article, 'article must be created');

    // 5. Загрузка вопросов docx-файлом → выбор автора
    fileToServe = await DocxUtil.createDocx(
      '1. Что такое e2e?\n2. Зачем он нужен?',
    );
    await bot.handleUpdate(
      update(USER_LOGIN, {
        file: {
          id: 'file-questions',
          name: 'questions.docx',
          size: fileToServe.length,
        },
      }),
    );
    assert.match(lastText().text, /Выберите стиль автора/);
    assert.ok(lastText().buttons.includes('author_select:none'));
    assert.ok(lastText().buttons.includes('author_select:memruk'));

    // 6. Не-docx файл на шаге загрузки отклоняется
    await bot.handleUpdate(callback(USER_LOGIN, 'restart_process'));
    assert.match(lastText().text, /Введите тему статьи/);
    await bot.handleUpdate(update(USER_LOGIN, { text: '/cancel' }));
    assert.match(lastText().text, /Выбранная статья: Тестовая тема e2e/);

    await bot.handleUpdate(callback(USER_LOGIN, 'upload_article'));
    assert.match(lastText().text, /Введите тему для загружаемой статьи/);
    await bot.handleUpdate(update(USER_LOGIN, { text: '/same' }));
    assert.match(lastText().text, /Пришлите статью в виде файла/);
    await bot.handleUpdate(
      update(USER_LOGIN, {
        file: { id: 'file-bad', name: 'notes.txt', size: 10 },
      }),
    );
    assert.match(lastText().text, /Нужен файл в формате docx/);

    // 7. Загрузка статьи docx → меню статьи с факт-чеком
    fileToServe = await DocxUtil.createDocx('Текст статьи для e2e-проверки.');
    await bot.handleUpdate(
      update(USER_LOGIN, {
        file: {
          id: 'file-article',
          name: 'article.docx',
          size: fileToServe.length,
        },
      }),
    );
    const afterUpload = textsSince(0).map((item) => item.text);
    assert.ok(
      afterUpload.some((text) => /Статья успешно загружена/.test(text)),
    );
    assert.ok(lastText().buttons.includes('fact_check_generation'));
    assert.ok(lastText().buttons.includes('download_files'));

    // 8. Скачивание файла
    await bot.handleUpdate(callback(USER_LOGIN, 'download_files'));
    assert.ok(lastText().buttons.includes('download:ARTICLE'));
    const beforeDownload = sent.length;
    await bot.handleUpdate(callback(USER_LOGIN, 'download:ARTICLE'));
    const files = sent
      .slice(beforeDownload)
      .filter((entry) => entry.kind === 'file');
    assert.equal(files.length, 1);
    assert.equal((files[0] as SentFile).filename, 'article.docx');

    // 9. Текст вне сценария показывает меню, /menu — меню статьи
    await bot.handleUpdate(update(USER_LOGIN, { text: 'ку' }));
    assert.match(lastText().text, /^Меню:/);
    await bot.handleUpdate(update(USER_LOGIN, { text: '/menu' }));
    assert.match(lastText().text, /Выбранный сценарий работы/);

    // 10. Дубль update_id не обрабатывается повторно
    const dup = update(USER_LOGIN, { text: 'ку' });
    const before = sent.length;
    await bot.handleUpdate(dup);
    await bot.handleUpdate(dup);
    assert.equal(sent.length - before, 1, 'duplicate update must be ignored');

    // 11. Генерация в mock-режиме (Bothub не вызывается, промпты из Outline)
    if (process.env.BOTHUB_MOCK_MODE === 'true') {
      const beforeGen = sent.length;
      await bot.handleUpdate(callback(USER_LOGIN, 'fact_check_generation'));
      const genTexts = textsSince(beforeGen).map((item) => item.text);
      console.log(
        'mock fact-check flow:',
        genTexts.map((t) => t.slice(0, 60)),
      );
    }

    console.log(
      `e2e-yandex-flow: all checks passed (${sent.length} outgoing calls)`,
    );
  } finally {
    // Уборка тестовых данных
    for (const userId of createdUserIds) {
      const articles = await prisma.article.findMany({
        where: { userId },
        select: { id: true },
      });
      const articleIds = articles.map((item) => item.id);
      if (articleIds.length > 0) {
        await prisma.articleAddition.deleteMany({
          where: { articleId: { in: articleIds } },
        });
        await prisma.articleVersion.deleteMany({
          where: { articleId: { in: articleIds } },
        });
        await prisma.technicalArticleAddition
          .deleteMany({ where: { articleId: { in: articleIds } } })
          .catch(() => undefined);
        await prisma.article.deleteMany({ where: { id: { in: articleIds } } });
      }
      await prisma.session.deleteMany({ where: { userId } });
      await prisma.analyticsEvent
        .deleteMany({ where: { userId } })
        .catch(() => undefined);
      await prisma.user
        .delete({ where: { id: userId } })
        .catch(() => undefined);
    }
    await app.close();
  }
}

void main()
  .then(() => {
    // Открытые соединения Redis/Prisma держат event loop — выходим явно
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
