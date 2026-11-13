import {
  ForbiddenException,
  Injectable,
  SetMetadata,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { OrganizerTeamRole } from '@prisma/client';
import type { AuthenticatedUser } from '../../../common/decorators/current-user.decorator';
import { OrganizerAccessService } from '../organizer-access.service';

export type OrganizerAccessRule =
  /** Caller must hold one of `roles` on the organizer named by route param `param`. */
  | { scope: 'organizer'; param: string; roles: OrganizerTeamRole[] }
  /** Caller must be team or hold a live door-staff grant for the event in route param `param`. */
  | { scope: 'door'; param: string };

export const ORGANIZER_ACCESS_KEY = 'organizerAccess';

/** Use after the auth guard: `@UseGuards(AuthGuard, OrganizerAccessGuard)`. */
export const OrganizerAccess = (rule: OrganizerAccessRule) =>
  SetMetadata(ORGANIZER_ACCESS_KEY, rule);

@Injectable()
export class OrganizerAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly access: OrganizerAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const rule = this.reflector.getAllAndOverride<OrganizerAccessRule | undefined>(
      ORGANIZER_ACCESS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!rule) return true;

    const req = context
      .switchToHttp()
      .getRequest<{ user?: AuthenticatedUser; params: Record<string, string | undefined> }>();
    const target = req.params[rule.param];
    if (!req.user || !target) throw new ForbiddenException('Insufficient permissions');

    if (rule.scope === 'organizer') {
      await this.access.assertRole(req.user.id, target, rule.roles);
    } else {
      await this.access.assertDoorAccess(req.user.id, target);
    }
    return true;
  }
}
