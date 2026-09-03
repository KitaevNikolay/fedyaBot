import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomInt, timingSafeEqual } from 'crypto';
import { YandexMessengerApiService } from '../messenger/yandex-messenger-api.service';
import { UsersService } from '../users/users.service';

type PendingCode = {
  codeHash: string;
  expiresAt: number;
  attempts: number;
  issuedAt: number;
};

const CODE_TTL_MS = 5 * 60 * 1000;
const RESEND_COOLDOWN_MS = 30 * 1000;
const MAX_ATTEMPTS = 5;

/**
 * Вход в кабинет по одноразовому коду: код уходит пользователю в личный чат
 * с ботом в Яндекс Мессенджере. Коды живут в памяти процесса — кабинет
 * работает одним инстансом, а срок жизни кода пять минут.
 */
@Injectable()
export class AdminAuthCodeService {
  private readonly logger = new Logger(AdminAuthCodeService.name);
  private readonly pending = new Map<string, PendingCode>();

  constructor(private readonly messengerApi: YandexMessengerApiService) {}

  async requestCode(rawLogin: string) {
    const login = UsersService.normalizeMessengerId(rawLogin);
    this.cleanup();

    const existing = this.pending.get(login);
    if (existing && Date.now() - existing.issuedAt < RESEND_COOLDOWN_MS) {
      throw new BadRequestException(
        'Код уже отправлен. Повторить запрос можно через полминуты.',
      );
    }

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const record: PendingCode = {
      codeHash: this.hash(login, code),
      expiresAt: Date.now() + CODE_TTL_MS,
      attempts: 0,
      issuedAt: Date.now(),
    };

    try {
      await this.messengerApi.sendText(
        { login },
        `Код входа в кабинет FedyaBot: ${code}\nКод действует 5 минут. Если вы не запрашивали вход — просто проигнорируйте сообщение.`,
      );
    } catch (error) {
      this.logger.warn(`Failed to send auth code to ${login}: ${error}`);
      throw new BadRequestException(
        'Не удалось отправить код в Яндекс Мессенджер. Проверьте логин и что вы уже писали боту.',
      );
    }

    this.pending.set(login, record);
    return { ok: true, expiresInSeconds: CODE_TTL_MS / 1000 };
  }

  verifyCode(rawLogin: string, code: string) {
    const login = UsersService.normalizeMessengerId(rawLogin);
    this.cleanup();

    const record = this.pending.get(login);
    if (!record) {
      throw new UnauthorizedException('Код не запрашивался или истёк');
    }

    record.attempts += 1;
    if (record.attempts > MAX_ATTEMPTS) {
      this.pending.delete(login);
      throw new UnauthorizedException(
        'Слишком много попыток. Запросите новый код.',
      );
    }

    const expected = Buffer.from(record.codeHash, 'hex');
    const provided = Buffer.from(this.hash(login, code), 'hex');
    if (
      expected.length !== provided.length ||
      !timingSafeEqual(expected, provided)
    ) {
      throw new UnauthorizedException('Неверный код');
    }

    this.pending.delete(login);
    return login;
  }

  private hash(login: string, code: string) {
    return createHash('sha256').update(`${login}:${code}`).digest('hex');
  }

  private cleanup() {
    const now = Date.now();
    for (const [login, record] of this.pending) {
      if (record.expiresAt <= now) {
        this.pending.delete(login);
      }
    }
  }
}
