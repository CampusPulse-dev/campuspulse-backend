import {
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../../../common/decorators/current-user.decorator';
import { DevAuthService } from './dev-auth.service';

type RequestWithUser = Request & { user?: AuthenticatedUser };

// TODO(S1-02): replace with JWT AuthGuard.
@Injectable()
export class DevAuthGuard implements CanActivate {
  constructor(private readonly devAuth: DevAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequestWithUser>();
    req.user = await this.devAuth.resolveHeader(req.headers['x-dev-user']);
    return true;
  }
}

// TODO(S1-02): replace with optional JWT AuthGuard.
@Injectable()
export class OptionalDevAuthGuard implements CanActivate {
  constructor(private readonly devAuth: DevAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.devAuth.isEnabled()) {
      return true;
    }
    const req = context.switchToHttp().getRequest<RequestWithUser>();
    const rawHeader = req.headers['x-dev-user'];
    if (!rawHeader) {
      return true;
    }
    try {
      req.user = await this.devAuth.resolveHeader(rawHeader);
    } catch (err) {
      if (err instanceof UnauthorizedException) {
        throw err;
      }
      throw err;
    }
    return true;
  }
}
