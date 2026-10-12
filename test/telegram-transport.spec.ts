/**
 * Проверка Telegram-транспорта без сети: HTTP-клиент подменён, исходящие
 * вызовы Bot API записываются, ответы Telegram подаются заготовками.
 * Запуск: npx ts-node -r tsconfig-paths/register test/telegram-transport.spec.ts
 */
import assert from 'node:assert/strict';
import { ConfigService } from '@nestjs/config';
import { MessengerBot } from '../src/modules/messenger/messenger-bot';
import { MessengerContext } from '../src/modules/messenger/messenger-context';
import { InlineKeyboard } from '../src/modules/messenger/messenger-keyboard';
import { TelegramBotApiService } from '../src/modules/messenger/telegram-bot-api.service';

type Call = { method: string; body: unknown };

function createTransport(updates: unknown[] = []) {
  const calls: Call[] = [];
  const config = new ConfigService({ TELEGRAM_BOT_TOKEN: '123:secret' });
  const transport = new TelegramBotApiService(config);
  let messageId = 500;

  (transport as unknown as { http: unknown }).http = {
    post: async (url: string, body: unknown) => {
      const method = url.split('/').pop()!;
      calls.push({ method, body });
      const results: Record<string, unknown> = {
        getUpdates: updates,
        getMe: {
          id: 42,
          is_bot: true,
          first_name: 'Федя',
          username: 'fedya_bot',
        },
        getFile: { file_path: 'documents/q.docx' },
      };
      return {
        data: {
          ok: true,
          result: results[method] ?? { message_id: ++messageId },
        },
      };
    },
    get: async () => ({ data: new TextEncoder().encode('docx').buffer }),
  };
  return { transport, calls };
}

const user = {
  id: 777,
  is_bot: false,
  first_name: 'Иван',
  last_name: 'Петров',
  username: 'ivan_p',
};
const chat = { id: 777, type: 'private' };

async function testUpdatesConversion() {
  const { transport, calls } = createTransport([
    {
      update_id: 10,
      message: { message_id: 1, date: 1, from: user, chat, text: '/start' },
    },
    {
      update_id: 11,
      message: {
        message_id: 2,
        date: 2,
        from: { ...user, username: undefined },
        chat,
        caption: 'вопросы',
        document: { file_id: 'F1', file_name: 'q.docx', file_size: 99 },
      },
    },
    {
      update_id: 12,
      callback_query: {
        id: 'cb1',
        from: user,
        message: { message_id: 3, date: 3, chat },
        data: 'scenario:abc',
      },
    },
  ]);

  const updates = await transport.getUpdates(0);
  assert.equal(updates.length, 3);
  const poll = calls.find((call) => call.method === 'getUpdates')!.body as {
    timeout: number;
  };
  assert.ok(poll.timeout > 0, 'getUpdates must long-poll');

  const start = new MessengerContext(updates[0], transport);
  assert.equal(start.from?.id, '777');
  assert.equal(start.from?.username, 'ivan_p');
  assert.equal(start.from?.first_name, 'Иван');
  assert.equal(start.from?.last_name, 'Петров');
  assert.equal(start.message?.text, '/start');
  assert.deepEqual(start.target, { login: '777' });

  const doc = new MessengerContext(updates[1], transport);
  assert.equal(doc.message?.document?.file_id, 'F1');
  assert.equal(doc.message?.document?.file_name, 'q.docx');
  assert.equal(doc.message?.caption, 'вопросы');
  assert.equal(
    doc.from?.username,
    undefined,
    'без @username нельзя подставлять числовой id',
  );

  const callback = new MessengerContext(updates[2], transport);
  assert.equal(callback.callbackQuery?.data, 'scenario:abc');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(
    calls.find((call) => call.method === 'answerCallbackQuery')?.body,
    { callback_query_id: 'cb1' },
  );
}

async function testKeyboardAndLongCallbackData() {
  const longData = `style:${'x'.repeat(80)}`;
  const { transport, calls } = createTransport();
  const keyboard = new InlineKeyboard()
    .text('Сценарий', 'scenario:abc')
    .row()
    .text('Длинная', longData)
    .url('Сайт', 'https://example.com');

  await transport.sendText({ login: '777' }, 'Меню', {
    suggest_buttons: keyboard.toSuggestButtons(),
    disable_web_page_preview: true,
  });

  const sent = calls.find((call) => call.method === 'sendMessage')!.body as {
    chat_id: string;
    reply_markup: { inline_keyboard: Array<Array<Record<string, string>>> };
    link_preview_options: unknown;
  };
  assert.equal(sent.chat_id, '777');
  assert.deepEqual(sent.link_preview_options, { is_disabled: true });
  const [firstRow, secondRow] = sent.reply_markup.inline_keyboard;
  assert.deepEqual(firstRow, [
    { text: 'Сценарий', callback_data: 'scenario:abc' },
  ]);
  assert.equal(secondRow[1].url, 'https://example.com');
  const packed = secondRow[0].callback_data;
  assert.ok(Buffer.byteLength(packed) <= 64, 'callback_data must fit 64 bytes');

  // Нажатие на кнопку с хешем возвращает исходные данные
  (transport as unknown as { http: { post: unknown } }).http.post =
    async () => ({
      data: {
        ok: true,
        result: [
          {
            update_id: 20,
            callback_query: {
              id: 'cb2',
              from: user,
              message: { message_id: 4, date: 4, chat },
              data: packed,
            },
          },
        ],
      },
    });
  const [update] = await transport.getUpdates(0);
  assert.equal(
    new MessengerContext(update, transport).callbackQuery?.data,
    longData,
  );
}

async function testTypingAndTargets() {
  const { transport, calls } = createTransport();
  await transport.sendTyping(
    { login: '777' },
    { type: 'processing', timeout: 60 },
  );
  await transport.sendTyping({ login: '777' }, { type: 'text', timeout: 1 });
  const typing = calls.filter((call) => call.method === 'sendChatAction');
  assert.equal(typing.length, 1, 'гашение индикатора не шлёт запрос');
  assert.deepEqual(typing[0].body, { chat_id: '777', action: 'typing' });

  await assert.rejects(
    transport.sendText({ login: 'ivan.petrov' }, 'код'),
    /chat_id должен быть числом/,
  );
}

async function testBotReplySplitsByTelegramLimit() {
  const { transport, calls } = createTransport();
  const bot = new MessengerBot(transport);
  bot.command('start', async (ctx) => {
    await ctx.reply('a'.repeat(5000), {
      reply_markup: new InlineKeyboard().text('OK', 'ok'),
    });
  });

  const [update] = await (async () => {
    (transport as unknown as { http: { post: unknown } }).http.post = async (
      url: string,
      body: unknown,
    ) => {
      const method = url.split('/').pop()!;
      calls.push({ method, body });
      return {
        data: {
          ok: true,
          result:
            method === 'getUpdates'
              ? [
                  {
                    update_id: 30,
                    message: {
                      message_id: 5,
                      date: 5,
                      from: user,
                      chat,
                      text: '/start',
                    },
                  },
                ]
              : { message_id: 900 + calls.length },
        },
      };
    };
    return transport.getUpdates(0);
  })();
  await bot.handleUpdate(update);

  const messages = calls.filter((call) => call.method === 'sendMessage');
  assert.equal(messages.length, 2, '5000 символов → два сообщения Telegram');
  const [first, second] = messages.map(
    (call) => call.body as { text: string; reply_markup?: unknown },
  );
  assert.ok(first.text.length <= 4096);
  assert.equal(first.reply_markup, undefined);
  assert.ok(second.reply_markup, 'клавиатура — на последнем фрагменте');
}

async function testFileDownload() {
  const { transport, calls } = createTransport();
  const data = await transport.getFile('F1');
  assert.equal(data.toString(), 'docx');
  assert.deepEqual(calls[0], { method: 'getFile', body: { file_id: 'F1' } });

  const info = await transport.getSelf();
  assert.equal(info.login, 'fedya_bot');
}

async function main() {
  await testUpdatesConversion();
  await testKeyboardAndLongCallbackData();
  await testTypingAndTargets();
  await testBotReplySplitsByTelegramLimit();
  await testFileDownload();
  console.log('telegram-transport.spec: all checks passed');
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
