/**
 * Проверка маршрутизатора Яндекс Мессенджера без сети: фейковый API
 * записывает исходящие вызовы, обновления подаются как из getUpdates/вебхука.
 * Запуск: npx ts-node -r tsconfig-paths/register test/messenger-bot.spec.ts
 */
import assert from 'node:assert/strict';
import { MessengerBot } from '../src/modules/messenger/messenger-bot';
import { MessengerContext } from '../src/modules/messenger/messenger-context';
import {
  InlineKeyboard,
  InputFile,
} from '../src/modules/messenger/messenger-keyboard';
import { YandexMessengerApiService } from '../src/modules/messenger/yandex-messenger-api.service';
import { YandexUpdate } from '../src/modules/messenger/yandex-messenger.types';

type Sent = { kind: string; target: unknown; payload: unknown };

function createFakeApi() {
  const sent: Sent[] = [];
  let messageId = 100;
  const api = {
    isConfigured: () => true,
    sendText: async (target: unknown, text: string, options: unknown) => {
      sent.push({ kind: 'text', target, payload: { text, options } });
      return { ok: true, message_id: ++messageId };
    },
    sendFile: async (
      target: unknown,
      data: Buffer,
      filename: string,
      options: unknown,
      mimeType: string,
    ) => {
      sent.push({
        kind: 'file',
        target,
        payload: { size: data.length, filename, options, mimeType },
      });
      return { ok: true, message_id: ++messageId, file_id: 'f1' };
    },
    getFile: async () => Buffer.from('docx-bytes'),
    getSelf: async () => ({ ok: true, id: 'bot', login: 'fedya-bot' }),
    setWebhook: async () => ({ ok: true, id: 'bot', login: 'fedya-bot' }),
    getUpdates: async () => [],
  };
  return { api: api as unknown as YandexMessengerApiService, sent };
}

function privateUpdate(
  updateId: number,
  extra: Partial<YandexUpdate>,
  login = 'ivan_ivanov',
): YandexUpdate {
  return {
    update_id: updateId,
    message_id: 1_700_000_000_000_000 + updateId,
    timestamp: 1_700_000_000,
    chat: { type: 'private' },
    from: { id: 'guid-1', login, display_name: 'Иван Иванов', robot: false },
    ...extra,
  };
}

async function main() {
  const { api, sent } = createFakeApi();
  const bot = new MessengerBot(api);
  const log: string[] = [];

  bot.use(async (ctx, next) => {
    log.push(`mw:${ctx.update.update_id}`);
    await next();
  });
  bot.command('start', async (ctx) => {
    log.push(`start:${ctx.from?.id}`);
    await ctx.reply('Меню:', {
      reply_markup: new InlineKeyboard()
        .url('Админка', 'https://example.org/')
        .row()
        .text('Выбрать сценарий', 'select_scenario')
        .row(),
    });
  });
  bot.callbackQuery('select_scenario', async (ctx) => {
    log.push(`cb:${ctx.callbackQuery?.data}`);
    await ctx.answerCallbackQuery();
    await ctx.reply('Сценарии');
  });
  bot.callbackQuery(/^download:/, async (ctx) => {
    log.push(`download:${ctx.callbackQuery?.data}`);
    await ctx.replyWithDocument(
      new InputFile(Buffer.from('hello'), 'article.docx'),
    );
  });
  bot.on('message:text', async (ctx) => {
    log.push(`text:${ctx.message?.text}`);
    await ctx.reply('x'.repeat(7000));
  });
  bot.on('message:document', async (ctx) => {
    log.push(`doc:${ctx.message?.document?.file_name}`);
    const buffer = await bot.api.getFile(ctx.message!.document!.file_id);
    await ctx.reply(`got ${buffer.length} bytes`);
  });
  bot.catch(async ({ error }) => {
    log.push(`error:${String(error)}`);
  });

  // 1. Команда /start от нового пользователя
  await bot.handleUpdate(privateUpdate(1, { text: '/start' }));
  assert.deepEqual(log, ['mw:1', 'start:ivan_ivanov']);
  assert.equal(sent.length, 1);
  const menu = sent[0].payload as {
    text: string;
    options: {
      suggest_buttons: {
        layout: string;
        persist: boolean;
        buttons: unknown[][];
      };
    };
  };
  assert.deepEqual(sent[0].target, { login: 'ivan_ivanov' });
  assert.equal(menu.options.suggest_buttons.layout, 'true');
  assert.equal(menu.options.suggest_buttons.persist, true);
  assert.equal(menu.options.suggest_buttons.buttons.length, 2);
  const [[urlButton], [callbackButton]] = menu.options.suggest_buttons
    .buttons as Array<
    Array<{ title: string; directives: Array<Record<string, unknown>> }>
  >;
  assert.equal(urlButton.directives[0].type, 'open_uri');
  assert.deepEqual(callbackButton.directives[0], {
    type: 'server_action',
    name: 'callback',
    payload: { data: 'select_scenario' },
  });

  // 2. Нажатие кнопки приходит как bot_request.server_action
  await bot.handleUpdate(
    privateUpdate(2, {
      bot_request: {
        server_action: {
          name: 'callback',
          payload: { data: 'select_scenario' },
        },
        element_id: 'select_scenario',
      },
    }),
  );
  assert.equal(log.at(-1), 'cb:select_scenario');
  assert.equal((sent.at(-1)!.payload as { text: string }).text, 'Сценарии');

  // 3. Устаревший формат callback_data тоже распознаётся
  await bot.handleUpdate(
    privateUpdate(3, { callback_data: 'download:ARTICLE' }),
  );
  assert.equal(log.at(-1), 'download:download:ARTICLE');
  assert.equal(sent.at(-1)!.kind, 'file');
  assert.equal(
    (sent.at(-1)!.payload as { mimeType: string }).mimeType,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  );

  // 4. Длинный текст режется по лимиту 6000
  await bot.handleUpdate(privateUpdate(4, { text: 'привет' }));
  assert.equal(log.at(-1), 'text:привет');
  const chunks = sent
    .slice(-2)
    .map((item) => (item.payload as { text: string }).text.length);
  assert.deepEqual(chunks, [6000, 1000]);

  // 5. Документ
  await bot.handleUpdate(
    privateUpdate(5, {
      file: { id: 'file-1', name: 'questions.docx', size: 10 },
    }),
  );
  assert.equal(log.at(-1), 'doc:questions.docx');
  assert.equal((sent.at(-1)!.payload as { text: string }).text, 'got 10 bytes');

  // 6. Тело вебхука в формате ответа getUpdates; порядок в одном чате сохраняется
  const before = log.length;
  const accepted = bot.handleWebhookBody({
    ok: true,
    updates: [privateUpdate(6, { text: 'a' }), privateUpdate(7, { text: 'b' })],
  });
  assert.equal(accepted, 2);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(log.slice(before), ['mw:6', 'text:a', 'mw:7', 'text:b']);

  // 7. Групповой чат адресуется по chat_id
  await bot.handleUpdate({
    ...privateUpdate(8, { text: '/start' }),
    chat: { type: 'group', id: '0/0/abc' },
  });
  assert.deepEqual(sent.at(-1)!.target, { chat_id: '0/0/abc' });

  // 8. Ошибка обработчика уходит в catch и не роняет процесс
  bot.command('boom', async () => {
    throw new Error('boom');
  });
  await bot.handleUpdate(privateUpdate(9, { text: '/boom' }));
  assert.equal(log.at(-1), 'error:Error: boom');

  // 9. Разбиение текста по переносам
  const parts = MessengerContext.splitText(
    `${'a'.repeat(5990)}\n${'b'.repeat(20)}`,
  );
  assert.deepEqual(
    parts.map((part) => part.length),
    [5990, 20],
  );

  console.log('messenger-bot.spec: all checks passed');
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
