import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { TelegramBotApiService } from './telegram-bot-api.service';

const networkError = (code = 'ECONNABORTED') =>
  Object.assign(new Error('request failed'), { isAxiosError: true, code });
const httpError = (status: number) =>
  Object.assign(new Error('request failed'), {
    isAxiosError: true,
    response: { status, data: { description: 'unavailable' } },
  });

describe('Telegram file download', () => {
  let transport: TelegramBotApiService;
  let post: jest.Mock;
  let get: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    transport = new TelegramBotApiService(
      new ConfigService({ TELEGRAM_BOT_TOKEN: '123:test-token' }),
    );
    post = jest.fn().mockResolvedValue({
      data: { ok: true, result: { file_path: 'documents/test.docx' } },
    });
    get = jest.fn().mockResolvedValue({ data: Buffer.from('document bytes') });
    Object.assign(transport, { http: { post, get } });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it.each(['ECONNABORTED', 'ETIMEDOUT', 'ECONNRESET'])(
    'recovers from getFile %s with bounded backoff',
    async (code) => {
      post.mockRejectedValueOnce(networkError(code));
      const result = transport.getFile('file-id');
      const assertion = expect(result).resolves.toEqual(
        Buffer.from('document bytes'),
      );
      void assertion.catch(() => {});
      await jest.advanceTimersByTimeAsync(1999);
      expect(post).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(1);
      await assertion;
      expect(post).toHaveBeenCalledTimes(2);
      expect(post.mock.calls[1][1]).toEqual({ file_id: 'file-id' });
    },
  );

  it('retries byte download failures and returns complete bytes', async () => {
    get
      .mockRejectedValueOnce(networkError())
      .mockRejectedValueOnce(httpError(502));
    const assertion = expect(transport.getFile('file-id')).resolves.toEqual(
      Buffer.from('document bytes'),
    );
    void assertion.catch(() => {});
    await jest.runAllTimersAsync();
    await assertion;
    expect(get).toHaveBeenCalledTimes(3);
  });

  it('stops after three attempts and preserves the final error', async () => {
    const start = Date.now();
    post.mockRejectedValue(networkError());
    const assertion = expect(
      transport.getFile('file-id'),
    ).rejects.toMatchObject({ code: 'ECONNABORTED' });
    await jest.runAllTimersAsync();
    await assertion;
    expect(post).toHaveBeenCalledTimes(3);
    expect(Date.now() - start).toBe(6000);
    expect(get).not.toHaveBeenCalled();
  });

  it.each([400, 401, 403, 404])(
    'does not retry permanent HTTP %s errors',
    async (status) => {
      post.mockRejectedValue(httpError(status));
      await expect(transport.getFile('file-id')).rejects.toMatchObject({
        status,
      });
      expect(post).toHaveBeenCalledTimes(1);
      expect(get).not.toHaveBeenCalled();
    },
  );

  it('does not retry an unusable file response', async () => {
    post.mockResolvedValue({ data: { ok: true, result: {} } });
    await expect(transport.getFile('file-id')).rejects.toThrow(
      'file_path is empty',
    );
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('does not retry sendDocument timeouts, which could duplicate messages', async () => {
    post.mockRejectedValue(networkError());
    await expect(
      transport.sendFile({ login: '1' }, Buffer.from('doc'), 'a.docx'),
    ).rejects.toMatchObject({ code: 'ECONNABORTED' });
    expect(post).toHaveBeenCalledTimes(1);
  });
});
