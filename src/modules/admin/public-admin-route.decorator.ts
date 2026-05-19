import { SetMetadata } from '@nestjs/common';

export const ADMIN_PUBLIC_ROUTE_KEY = 'admin_public_route';
export const PublicAdminRoute = () => SetMetadata(ADMIN_PUBLIC_ROUTE_KEY, true);
