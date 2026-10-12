import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomInt, timingSafeEqual } from 'crypto';
import { MessengerTransport } from '../messenger/messenger-transport';
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
 * с ботом в Яндекс Мессенджере (или в Telegram при MESSENGER_PLATFORM=telegram).
 * Коды живут в памяти процесса — кабинет работает одним инстансом, а срок
 * жизни кода пять минут.
 */
@Injectable()
export class AdminAuthCodeService {
  private readonly logger = new Logger(AdminAuthCodeService.name);
  private readonly pending = new Map<string, PendingCode>();

  constructor(
    private readonly messengerApi: MessengerTransport,
    private readonly usersService: UsersService,
  ) {}

  get platform() {
    return this.messengerApi.platform;
  }

  async requestCode(rawLogin: string) {
    const login = await this.resolveMessengerId(rawLogin);
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
        `Не удалось отправить код в ${this.messengerApi.displayName}. Проверьте логин и что вы уже писали боту.`,
      );
    }

    this.pending.set(login, record);
    return { ok: true, expiresInSeconds: CODE_TTL_MS / 1000 };
  }

  async verifyCode(rawLogin: string, code: string) {
    const login = await this.resolveMessengerId(rawLogin);
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

  /**
   * В Яндексе логин и есть messengerId. В Telegram писать можно только по
   * числовому ID, а людям привычнее @username — ищем его среди тех, кто
   * уже писал боту.
   */
  private async resolveMessengerId(rawLogin: string) {
    const login = UsersService.normalizeMessengerId(rawLogin);
    if (this.messengerApi.platform !== 'telegram') {
      return login;
    }

    const handle = login.replace(/^@/, '');
    if (/^\d+$/.test(handle)) {
      return handle;
    }
    const user = await this.usersService.findByUsername(handle);
    if (!user || !/^\d+$/.test(user.messengerId)) {
      throw new BadRequestException(
        'Пользователь Telegram не найден. Напишите боту /start или укажите числовой Telegram ID.',
      );
    }
    return user.messengerId;
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
