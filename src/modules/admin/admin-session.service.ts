import {
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { PrismaService } from '../../database/prisma.service';

type AdminSessionPayload = {
  sub: string;
  telegramId: string;
  role: string;
  exp: number;
};

@Injectable()
export class AdminSessionService {
  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async createSessionToken(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        telegramId: true,
        role: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const payload: AdminSessionPayload = {
      sub: user.id,
      telegramId: user.telegramId,
      role: user.role,
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7,
    };

    return this.encode(payload);
  }

  async getAdminUserFromToken(token: string) {
    const payload = this.decode(token);

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
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

    if (!user || !user.isActive || user.role !== 'admin') {
      throw new UnauthorizedException('Admin access is required');
    }

    return {
      ...user,
      status: user.isActive ? 'approved' : 'blocked',
    };
  }

  extractBearerToken(headerValue?: string | string[]) {
    if (!headerValue) {
      return null;
    }

    const header = Array.isArray(headerValue) ? headerValue[0] : headerValue;
    if (!header?.startsWith('Bearer ')) {
      return null;
    }

    return header.slice('Bearer '.length).trim() || null;
  }

  private encode(payload: AdminSessionPayload) {
    const encodedPayload = this.toBase64Url(JSON.stringify(payload));
    const signature = this.sign(encodedPayload);

    return `${encodedPayload}.${signature}`;
  }

  private decode(token: string) {
    const [encodedPayload, providedSignature] = token.split('.');

    if (!encodedPayload || !providedSignature) {
      throw new UnauthorizedException('Invalid admin session token');
    }

    const expectedSignature = this.sign(encodedPayload);
    const providedBuffer = Buffer.from(providedSignature, 'utf8');
    const expectedBuffer = Buffer.from(expectedSignature, 'utf8');

    if (
      providedBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(providedBuffer, expectedBuffer)
    ) {
      throw new UnauthorizedException('Invalid admin session signature');
    }

    let payload: AdminSessionPayload;

    try {
      payload = JSON.parse(
        Buffer.from(encodedPayload, 'base64url').toString('utf8'),
      ) as AdminSessionPayload;
    } catch {
      throw new UnauthorizedException('Invalid admin session payload');
    }

    if (!payload.exp || payload.exp <= Math.floor(Date.now() / 1000)) {
      throw new UnauthorizedException('Admin session token is expired');
    }

    return payload;
  }

  private sign(value: string) {
    return createHmac('sha256', this.getSecret())
      .update(value)
      .digest('base64url');
  }

  private getSecret() {
    const secret =
      this.configService.get<string>('CABINET_AUTH_SECRET') ??
      this.configService.get<string>('TELEGRAM_BOT_TOKEN');

    if (!secret) {
      throw new InternalServerErrorException(
        'CABINET_AUTH_SECRET or TELEGRAM_BOT_TOKEN must be configured',
      );
    }

    return secret;
  }

  private toBase64Url(value: string) {
    return Buffer.from(value, 'utf8').toString('base64url');
  }
}
