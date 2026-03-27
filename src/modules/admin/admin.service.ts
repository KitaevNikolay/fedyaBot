import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { PrismaService } from '../../database/prisma.service';
import { UsersService } from '../users/users.service';
import { AdminSessionService } from './admin-session.service';
import { TelegramAuthDto } from './dto/telegram-auth.dto';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly configService: ConfigService,
    private readonly adminSessionService: AdminSessionService,
  ) {}

  async getDashboard() {
    const [articlesCount, usersCount] = await Promise.all([
      this.prisma.article.count(),
      this.prisma.user.count(),
    ]);

    return {
      articlesCount,
      usersCount,
    };
  }

  async getUsers() {
    const users = await this.prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        telegramId: true,
        firstName: true,
        lastName: true,
        username: true,
        isActive: true,
        role: true,
        createdAt: true,
      },
    });

    return users.map(user => ({
      ...user,
      status: user.isActive ? 'approved' : 'blocked',
    }));
  }

  async updateUserStatus(id: string, isActive: boolean) {
    const user = await this.prisma.user.update({
      where: { id },
      data: { isActive },
      select: {
        id: true,
        telegramId: true,
        firstName: true,
        lastName: true,
        username: true,
        isActive: true,
        role: true,
        createdAt: true,
      },
    });

    return {
      ...user,
      status: user.isActive ? 'approved' : 'blocked',
    };
  }

  async updateUserRole(id: string, role: string) {
    const existingUser = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existingUser) {
      throw new NotFoundException('User not found');
    }

    const user = await this.prisma.user.update({
      where: { id },
      data: { role },
      select: {
        id: true,
        telegramId: true,
        firstName: true,
        lastName: true,
        username: true,
        isActive: true,
        role: true,
        createdAt: true,
      },
    });

    return {
      ...user,
      status: user.isActive ? 'approved' : 'blocked',
    };
  }

  async verifyTelegramAuth(payload: TelegramAuthDto) {
    const botToken = this.configService.get<string>('TELEGRAM_BOT_TOKEN');

    if (!botToken) {
      throw new InternalServerErrorException(
        'TELEGRAM_BOT_TOKEN is not configured',
      );
    }

    const dataCheckString = Object.entries(payload)
      .filter(([key, value]) => key !== 'hash' && value !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');

    const secretKey = createHash('sha256').update(botToken).digest();
    const expectedHash = createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');

    const actualBuffer = Buffer.from(payload.hash, 'hex');
    const expectedBuffer = Buffer.from(expectedHash, 'hex');

    if (
      actualBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(actualBuffer, expectedBuffer)
    ) {
      throw new UnauthorizedException('Invalid Telegram authorization payload');
    }

    const authDate = Number(payload.auth_date);
    const nowInSeconds = Math.floor(Date.now() / 1000);
    const maxAgeInSeconds = 60 * 60 * 24;

    if (!Number.isFinite(authDate) || nowInSeconds - authDate > maxAgeInSeconds) {
      throw new UnauthorizedException('Telegram authorization payload is expired');
    }

    const telegramId = payload.id;
    const existingUser = await this.usersService.findByTelegramId(telegramId);

    if (existingUser) {
      await this.usersService.updateProfile(telegramId, {
        firstName: payload.first_name,
        lastName: payload.last_name,
        username: payload.username,
      });
    } else {
      await this.usersService.createInactive(telegramId, {
        firstName: payload.first_name,
        lastName: payload.last_name,
        username: payload.username,
      });
    }

    const user = await this.usersService.findByTelegramId(telegramId);
    const status = user?.isActive
      ? user.role === 'admin'
        ? 'approved'
        : 'forbidden'
      : 'pending';
    const accessToken =
      user?.isActive && user.role === 'admin'
        ? await this.adminSessionService.createSessionToken(user.id)
        : null;

    return {
      user: user
        ? {
            ...user,
            status: user.isActive ? 'approved' : 'blocked',
          }
        : null,
      status,
      accessToken,
    };
  }

  async getCurrentAdminUser(token: string) {
    return this.adminSessionService.getAdminUserFromToken(token);
  }
}
