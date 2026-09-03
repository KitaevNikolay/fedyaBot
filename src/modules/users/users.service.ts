import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';

export type MessengerProfile = {
  username?: string;
  firstName?: string;
  lastName?: string;
};

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  findByMessengerId(messengerId: string) {
    return this.prisma.user.findUnique({
      where: { messengerId: UsersService.normalizeMessengerId(messengerId) },
    });
  }

  findById(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  createInactive(messengerId: string, profile?: MessengerProfile) {
    return this.prisma.user.create({
      data: {
        messengerId: UsersService.normalizeMessengerId(messengerId),
        username: profile?.username ?? null,
        firstName: profile?.firstName ?? null,
        lastName: profile?.lastName ?? null,
        isActive: false,
      },
    });
  }

  updateProfile(messengerId: string, profile?: MessengerProfile) {
    const data: {
      username?: string | null;
      firstName?: string | null;
      lastName?: string | null;
    } = {};
    if (profile?.username !== undefined) {
      data.username = profile.username ?? null;
    }
    if (profile?.firstName !== undefined) {
      data.firstName = profile.firstName ?? null;
    }
    if (profile?.lastName !== undefined) {
      data.lastName = profile.lastName ?? null;
    }
    return this.prisma.user.update({
      where: { messengerId: UsersService.normalizeMessengerId(messengerId) },
      data,
    });
  }

  /**
   * Регистрирует пользователя мессенджера или обновляет его профиль.
   * Логины из CABINET_ADMIN_LOGINS сразу получают активный аккаунт с ролью
   * admin — иначе после переезда на новый мессенджер некому было бы
   * активировать первого администратора в кабинете.
   */
  async registerFromMessenger(messengerId: string, profile?: MessengerProfile) {
    const normalizedId = UsersService.normalizeMessengerId(messengerId);
    const existing = await this.findByMessengerId(normalizedId);
    const isBootstrapAdmin = this.getBootstrapAdminLogins().has(normalizedId);

    if (!existing) {
      const created = await this.prisma.user.create({
        data: {
          messengerId: normalizedId,
          username: profile?.username ?? null,
          firstName: profile?.firstName ?? null,
          lastName: profile?.lastName ?? null,
          isActive: isBootstrapAdmin,
          role: isBootstrapAdmin ? 'admin' : 'user',
        },
      });
      if (isBootstrapAdmin) {
        this.logger.log(`Bootstrap admin registered: ${normalizedId}`);
      }
      return { user: created, isNew: true };
    }

    const needsPromotion =
      isBootstrapAdmin && (!existing.isActive || existing.role !== 'admin');
    const updated = await this.prisma.user.update({
      where: { id: existing.id },
      data: {
        ...(profile?.username !== undefined
          ? { username: profile.username ?? null }
          : {}),
        ...(profile?.firstName !== undefined
          ? { firstName: profile.firstName ?? null }
          : {}),
        ...(profile?.lastName !== undefined
          ? { lastName: profile.lastName ?? null }
          : {}),
        ...(needsPromotion ? { isActive: true, role: 'admin' } : {}),
      },
    });
    if (needsPromotion) {
      this.logger.log(`Bootstrap admin promoted: ${normalizedId}`);
    }
    return { user: updated, isNew: false };
  }

  updateBitrixId(userId: string, bitrixId: number) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { bitrixId },
    });
  }

  /** Логины Яндекса регистронезависимы — храним в нижнем регистре */
  static normalizeMessengerId(value: string) {
    return value.trim().toLowerCase();
  }

  private getBootstrapAdminLogins() {
    const raw = this.configService.get<string>('CABINET_ADMIN_LOGINS') ?? '';
    return new Set(
      raw
        .split(/[,\s;]+/)
        .map((item) => UsersService.normalizeMessengerId(item))
        .filter(Boolean),
    );
  }
}
