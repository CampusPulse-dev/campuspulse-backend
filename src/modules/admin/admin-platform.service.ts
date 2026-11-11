import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { maskEmail } from '../../common/mask-email';
import { PrismaService } from '../../common/prisma.service';
import type {
  AdminUser,
  AdminUsersQuery,
  AdminUsersResponse,
  AuditLogQuery,
  AuditLogResponse,
  PlatformSettingsResponse,
  PutPlatformSettingBody,
  SetUserSuspensionBody,
  UserRole,
} from '../../contract';
import { suspendUser } from './admin-moderation.service';

const STAFF_ROLES: UserRole[] = ['VERIFIER', 'MODERATOR', 'SUPER_ADMIN'];

const USER_SELECT = {
  id: true,
  displayName: true,
  email: true,
  role: true,
  isVerifiedStudent: true,
  suspendedAt: true,
} as const;
type UserRow = Prisma.UserGetPayload<{ select: typeof USER_SELECT }>;

function toAdminUser(row: UserRow): AdminUser {
  return {
    id: row.id,
    displayName: row.displayName,
    emailHint: maskEmail(row.email),
    role: row.role,
    isVerifiedStudent: row.isVerifiedStudent,
    suspendedAt: row.suspendedAt ? row.suspendedAt.toISOString() : null,
  };
}

/** Role administration, runtime settings and the audit log (Super Admin surfaces). */
@Injectable()
export class AdminPlatformService {
  constructor(private readonly prisma: PrismaService) {}

  async listUsers(query: AdminUsersQuery): Promise<AdminUsersResponse> {
    const search = query.search?.trim();
    const where: Prisma.UserWhereInput = {
      ...(query.staffOnly ? { role: { in: STAFF_ROLES } } : {}),
      ...(search
        ? {
            // Emails match exactly only: no partial-email enumeration of students.
            OR: [
              { displayName: { contains: search, mode: 'insensitive' } },
              { email: search.toLowerCase() },
            ],
          }
        : {}),
    };
    const rows = await this.prisma.user.findMany({
      where,
      select: USER_SELECT,
      orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const pageRows = rows.slice(0, query.limit);
    return {
      items: pageRows.map(toAdminUser),
      nextCursor: rows.length > query.limit ? (pageRows[pageRows.length - 1]?.id ?? null) : null,
    };
  }

  async setRole(actor: AuthenticatedUser, userId: string, role: UserRole): Promise<AdminUser> {
    // Guards against the last Super Admin locking everyone out by demoting themselves.
    if (userId === actor.id) throw new BadRequestException('You cannot change your own role');

    return this.prisma.$transaction(async (tx) => {
      const before = await tx.user.findUnique({ where: { id: userId }, select: { role: true } });
      if (!before) throw new NotFoundException('User not found');

      const updated = await tx.user.update({
        where: { id: userId },
        data: { role },
        select: USER_SELECT,
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'user.role.changed',
          targetType: 'User',
          targetId: userId,
          metadata: { from: before.role, to: role },
        },
      });
      return toAdminUser(updated);
    });
  }

  async setSuspension(
    actor: AuthenticatedUser,
    userId: string,
    body: SetUserSuspensionBody,
  ): Promise<AdminUser> {
    return this.prisma.$transaction(async (tx) => {
      if (body.suspended) {
        await suspendUser(tx, actor, userId);
      } else {
        const exists = await tx.user.findUnique({ where: { id: userId }, select: { id: true } });
        if (!exists) throw new NotFoundException('User not found');
        await tx.user.update({ where: { id: userId }, data: { suspendedAt: null } });
      }
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: body.suspended ? 'user.suspended' : 'user.reinstated',
          targetType: 'User',
          targetId: userId,
          metadata: { note: body.note },
        },
      });
      const row = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: USER_SELECT });
      return toAdminUser(row);
    });
  }

  async listSettings(): Promise<PlatformSettingsResponse> {
    const rows = await this.prisma.platformSetting.findMany({ orderBy: { key: 'asc' } });
    return {
      items: rows.map((row) => ({
        key: row.key,
        value: row.value,
        updatedAt: row.updatedAt.toISOString(),
      })),
    };
  }

  async putSetting(
    actor: AuthenticatedUser,
    body: PutPlatformSettingBody,
  ): Promise<PlatformSettingsResponse> {
    await this.prisma.$transaction(async (tx) => {
      await tx.platformSetting.upsert({
        where: { key: body.key },
        create: { key: body.key, value: body.value, updatedById: actor.id },
        update: { value: body.value, updatedById: actor.id },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'platform.setting.changed',
          targetType: 'PlatformSetting',
          targetId: body.key,
          metadata: { value: body.value },
        },
      });
    });
    return this.listSettings();
  }

  async listAuditLogs(query: AuditLogQuery): Promise<AuditLogResponse> {
    const rows = await this.prisma.auditLog.findMany({
      where: {
        ...(query.actorId ? { actorId: query.actorId } : {}),
        ...(query.targetType ? { targetType: query.targetType } : {}),
        ...(query.targetId ? { targetId: query.targetId } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const pageRows = rows.slice(0, query.limit);
    return {
      items: pageRows.map((row) => ({
        id: row.id,
        actorId: row.actorId,
        action: row.action,
        targetType: row.targetType,
        targetId: row.targetId,
        metadata: (row.metadata ?? {}) as Record<string, unknown>,
        createdAt: row.createdAt.toISOString(),
      })),
      nextCursor: rows.length > query.limit ? (pageRows[pageRows.length - 1]?.id ?? null) : null,
    };
  }
}
