import { Logger } from '@nestjs/common';
import { BotService } from './bot.service';
import { LocalesService } from '../../config/locales.service';

describe('document failure feedback', () => {
  afterEach(() => jest.restoreAllMocks());

  async function handle(download: () => Promise<Buffer | null>) {
    const state = new Map([['state:user', 'WAITING_FOR_QUESTIONS_FILE']]);
    const messages: string[] = [];
    const bot = Object.create(BotService.prototype);
    Object.assign(bot, {
      usersService: { findByMessengerId: async () => ({ id: 'user' }) },
      redisService: { get: async (key: string) => state.get(key) },
      messengerApi: { getFile: download },
      localesService: new LocalesService(),
      logger: new Logger('test'),
    });
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    await bot.handleDocument({
      from: { id: '1' },
      message: { document: { file_id: 'file-id', file_name: 'test.docx' } },
      reply: async (text: string) => {
        messages.push(text);
      },
    });
    expect(state.get('state:user')).toBe('WAITING_FOR_QUESTIONS_FILE');
    expect(messages).toHaveLength(1);
    return messages[0];
  }

  it.each(['error', 'empty'])(
    'explains download failure (%s) and how to retry',
    async (mode) => {
      const message = await handle(async () => {
        if (mode === 'error') throw new Error('network timeout');
        return null;
      });
      expect(message).toContain('скачать файл');
      expect(message).toContain('отправьте');
      expect(message).toContain('/cancel');
      expect(message).not.toContain('прочитать');
    },
  );

  it('keeps a separate read error for downloaded but invalid DOCX', async () => {
    const message = await handle(async () => Buffer.from('invalid zip'));
    expect(message).toContain('прочитать');
    expect(message).not.toContain('скачать');
  });
});
