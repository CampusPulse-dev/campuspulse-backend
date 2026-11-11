import {
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../../../common/decorators/current-user.decorator';
import { DevAuthService } from '../dev-auth/dev-auth.service';
import { AuthService } from './auth.service';

type RequestWithUser = Request & { user?: AuthenticatedUser };

function bearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token : null;
}

/**
 * Resolves the caller from `Authorization: Bearer <access JWT>`.
 *
 * `X-Dev-User` is honoured only when no Bearer token is present AND
 * `DEV_AUTH_ENABLED=true` (rejected at boot in production). It exists for
 * local development and the e2e suites; a Bearer token always wins.
 */
async function resolveUser(
  req: RequestWithUser,
  auth: AuthService,
  devAuth: DevAuthService,
): Promise<AuthenticatedUser | null> {
  const token = bearerToken(req);
  if (token) return auth.authenticateAccessToken(token);

  const devHeader = req.headers['x-dev-user'];
  if (devHeader && devAuth.isEnabled()) return devAuth.resolveHeader(devHeader);

  return null;
}

/** Requires a signed-in user. */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly devAuth: DevAuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequestWithUser>();
    const user = await resolveUser(req, this.auth, this.devAuth);
    if (!user) throw new UnauthorizedException('Authentication required');
    req.user = user;
    return true;
  }
}

/**
 * For public routes that personalise when signed in (feed, event page).
 * No credentials → anonymous. Bad credentials → 401, so a client with an
 * expired token refreshes instead of silently seeing the signed-out view.
 */
@Injectable()
export class OptionalJwtAuthGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly devAuth: DevAuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequestWithUser>();
    const user = await resolveUser(req, this.auth, this.devAuth);
    if (user) req.user = user;
    return true;
  }
}
