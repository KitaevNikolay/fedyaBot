/**
 * Сквозная проверка входа в кабинет по коду из Яндекс Мессенджера:
 * поднимает CabinetAppModule на случайном порту с подменённым Bot API,
 * запрашивает код, читает его из «отправленного» сообщения и обменивает на сессию.
 *
 * Запуск (dev-стек в Docker):
 *   DATABASE_URL=mysql://fedya:fedya@localhost:3308/fedya npx ts-node test/e2e-cabinet-auth.ts
 */
import assert from 'node:assert/strict';

const stamp = Date.now().toString(36);
const ADMIN_LOGIN = `e2e.cabinet.admin.${stamp}`;
const USER_LOGIN = `e2e.cabinet.user.${stamp}`;
process.env.CABINET_ADMIN_LOGINS = ADMIN_LOGIN;
process.env.CABINET_AUTH_SECRET =
  process.env.CABINET_AUTH_SECRET ?? 'e2e-secret';
process.env.LOG_FILE_PATH = process.env.LOG_FILE_PATH ?? 'logs/e2e-cabinet.log';

import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CabinetAppModule } from '../src/cabinet-app.module';
import { PrismaService } from '../src/database/prisma.service';
import { YandexMessengerApiService } from '../src/modules/messenger/yandex-messenger-api.service';

const outbox: Array<{ login?: string; text: string }> = [];
let failSend = false;

const fakeApi = {
  isConfigured: () => true,
  sendText: async (target: { login?: string }, text: string) => {
    if (failSend) {
      throw new Error('Bot is not a member of the chat');
    }
    outbox.push({ login: target.login, text });
    return { ok: true, message_id: outbox.length };
  },
};

async function main() {
  const moduleRef = await Test.createTestingModule({
    imports: [CabinetAppModule],
  })
    .overrideProvider(YandexMessengerApiService)
    .useValue(fakeApi)
    .compile();
  const app = moduleRef.createNestApplication({ logger: ['error', 'warn'] });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  await app.listen(0);
  const address = app.getHttpServer().address() as { port: number };
  const base = `http://127.0.0.1:${address.port}`;
  const prisma = app.get(PrismaService);
  const createdLogins = [ADMIN_LOGIN, USER_LOGIN];

  const post = async (path: string, body: unknown) => {
    const response = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return {
      status: response.status,
      json: (await response.json()) as Record<string, unknown>,
    };
  };

  try {
    // 1. Валидация логина
    const bad = await post('/admin/auth/request-code', { login: 'bad login!' });
    assert.equal(bad.status, 400);

    // 2. Запрос кода: сообщение уходит боту на нужный логин
    const requested = await post('/admin/auth/request-code', {
      login: ADMIN_LOGIN.toUpperCase(),
    });
    assert.equal(requested.status, 201, JSON.stringify(requested.json));
    assert.equal(outbox.length, 1);
    assert.equal(outbox[0].login, ADMIN_LOGIN);
    const code = /(\d{6})/.exec(outbox[0].text)?.[1];
    assert.ok(code, 'code must be in the message');

    // 3. Повторный запрос сразу — отказ (антиспам)
    const again = await post('/admin/auth/request-code', {
      login: ADMIN_LOGIN,
    });
    assert.equal(again.status, 400);

    // 4. Неверный код
    const wrong = await post('/admin/auth/verify-code', {
      login: ADMIN_LOGIN,
      code: '000000',
    });
    assert.equal(wrong.status, 401);

    // 5. Верный код: bootstrap-админ получает сессию
    const verified = await post('/admin/auth/verify-code', {
      login: ADMIN_LOGIN,
      code,
    });
    assert.equal(verified.status, 201, JSON.stringify(verified.json));
    assert.equal(verified.json.status, 'approved');
    const token = verified.json.accessToken as string;
    assert.ok(token);
    const user = verified.json.user as {
      messengerId: string;
      role: string;
      isActive: boolean;
    };
    assert.equal(user.messengerId, ADMIN_LOGIN);
    assert.equal(user.role, 'admin');
    assert.equal(user.isActive, true);

    // 6. Код одноразовый
    const reuse = await post('/admin/auth/verify-code', {
      login: ADMIN_LOGIN,
      code,
    });
    assert.equal(reuse.status, 401);

    // 7. Сессия работает на защищённом маршруте
    const me = await fetch(`${base}/admin/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(me.status, 200);
    const meJson = (await me.json()) as { messengerId: string };
    assert.equal(meJson.messengerId, ADMIN_LOGIN);
    const noToken = await fetch(`${base}/admin/users`);
    assert.equal(noToken.status, 401);

    // 8. Обычный пользователь: создаётся неактивным, статус pending, без токена
    const requestedUser = await post('/admin/auth/request-code', {
      login: USER_LOGIN,
    });
    assert.equal(requestedUser.status, 201);
    const userCode = /(\d{6})/.exec(outbox.at(-1)!.text)?.[1];
    const verifiedUser = await post('/admin/auth/verify-code', {
      login: USER_LOGIN,
      code: userCode,
    });
    assert.equal(verifiedUser.status, 201);
    assert.equal(verifiedUser.json.status, 'pending');
    assert.equal(verifiedUser.json.accessToken, null);

    // 9. Админ активирует пользователя через API кабинета
    const dbUser = await prisma.user.findUnique({
      where: { messengerId: USER_LOGIN },
    });
    assert.ok(dbUser);
    const activate = await fetch(`${base}/admin/users/${dbUser.id}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ isActive: true }),
    });
    assert.equal(activate.status, 200);
    const activated = (await activate.json()) as {
      isActive: boolean;
      messengerId: string;
    };
    assert.equal(activated.isActive, true);
    assert.equal(activated.messengerId, USER_LOGIN);

    // 10. Если бот не может написать пользователю — понятная ошибка
    failSend = true;
    const unreachable = await post('/admin/auth/request-code', {
      login: 'nobody.here',
    });
    assert.equal(unreachable.status, 400);
    assert.match(String(unreachable.json.message), /Не удалось отправить код/);

    console.log('e2e-cabinet-auth: all checks passed');
  } finally {
    await prisma.user.deleteMany({
      where: { messengerId: { in: createdLogins } },
    });
    await app.close();
  }
}

void main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
