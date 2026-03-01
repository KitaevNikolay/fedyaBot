import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findByTelegramId(telegramId: string) {
    return this.prisma.user.findUnique({ where: { telegramId } });
  }

  findById(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  createInactive(
    telegramId: string,
    profile?: { username?: string; firstName?: string; lastName?: string },
  ) {
    return this.prisma.user.create({
      data: {
        telegramId,
        username: profile?.username ?? null,
        firstName: profile?.firstName ?? null,
        lastName: profile?.lastName ?? null,
        isActive: false,
      },
    });
  }

  updateProfile(
    telegramId: string,
    profile?: { username?: string; firstName?: string; lastName?: string },
  ) {
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
      where: { telegramId },
      data,
    });
  }

  updateBitrixId(userId: string, bitrixId: number) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { bitrixId },
    });
  }
}
