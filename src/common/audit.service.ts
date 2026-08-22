import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * PRD §6 — every view of an ID document is logged, and the verification
 * trail must answer audit questions without reconstruction. Writes here
 * are deliberately not fire-and-forget.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(params: {
    actorId: string;
    action: string;
    targetType: string;
    targetId: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        actorId: params.actorId,
        action: params.action,
        targetType: params.targetType,
        targetId: params.targetId,
        metadata: (params.metadata ?? {}) as never,
      },
    });
  }
}
