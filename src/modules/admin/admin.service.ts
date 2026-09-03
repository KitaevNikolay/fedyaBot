import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { UsersService } from '../users/users.service';
import { AdminAuthCodeService } from './admin-auth-code.service';
import { AdminSessionService } from './admin-session.service';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly adminSessionService: AdminSessionService,
    private readonly adminAuthCodeService: AdminAuthCodeService,
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
        messengerId: true,
        firstName: true,
        lastName: true,
        username: true,
        isActive: true,
        role: true,
        createdAt: true,
      },
    });

    return users.map((user) => ({
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
        messengerId: true,
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
        messengerId: true,
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

  /** Шаг 1: отправить одноразовый код в Яндекс Мессенджер */
  async requestAuthCode(login: string) {
    return this.adminAuthCodeService.requestCode(login);
  }

  /** Шаг 2: проверить код, зарегистрировать пользователя и выдать сессию */
  async verifyAuthCode(rawLogin: string, code: string) {
    const login = this.adminAuthCodeService.verifyCode(rawLogin, code);
    const { user } = await this.usersService.registerFromMessenger(login, {
      username: login,
    });

    const status = user.isActive
      ? user.role === 'admin'
        ? 'approved'
        : 'forbidden'
      : 'pending';
    const accessToken =
      user.isActive && user.role === 'admin'
        ? await this.adminSessionService.createSessionToken(user.id)
        : null;

    return {
      user: {
        ...user,
        status: user.isActive ? 'approved' : 'blocked',
      },
      status,
      accessToken,
    };
  }

  async getCurrentAdminUser(token: string) {
    return this.adminSessionService.getAdminUserFromToken(token);
  }
}
