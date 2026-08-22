import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { UserRole } from '../../contract';

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: UserRole;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser =>
    ctx.switchToHttp().getRequest<{ user: AuthenticatedUser }>().user,
);
