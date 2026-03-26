import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { AdminSessionService } from './admin-session.service';
import { ADMIN_PUBLIC_ROUTE_KEY } from './public-admin-route.decorator';

@Injectable()
export class CabinetAdminGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly adminSessionService: AdminSessionService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(
      ADMIN_PUBLIC_ROUTE_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (isPublic) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<Request & { adminUser?: unknown }>();
    const token = this.adminSessionService.extractBearerToken(
      request.headers.authorization,
    );

    if (!token) {
      throw new UnauthorizedException('Admin authorization is required');
    }

    request.adminUser = await this.adminSessionService.getAdminUserFromToken(
      token,
    );

    return true;
  }
}
