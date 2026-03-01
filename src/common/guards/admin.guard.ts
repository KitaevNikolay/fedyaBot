import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { UsersService } from '../../modules/users/users.service';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private usersService: UsersService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: { telegramId?: string } }>();
    const user = request.user;

    if (!user || !user.telegramId) {
      return false;
    }

    const dbUser = await this.usersService.findByTelegramId(user.telegramId);
    return dbUser?.role === 'admin';
  }
}
