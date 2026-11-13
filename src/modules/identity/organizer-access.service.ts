import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { OrganizerTeamRole } from '../../contract';
import { PrismaService } from '../../common/prisma.service';

export type DoorAccessRole = OrganizerTeamRole | 'DOOR_STAFF';

@Injectable()
export class OrganizerAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async isMember(userId: string, organizerId: string): Promise<boolean> {
    const membership = await this.prisma.organizerMember.findUnique({
      where: {
        organizerId_userId: { organizerId, userId },
      },
      select: { role: true },
    });
    return membership !== null;
  }

  async assertRole(
    userId: string,
    organizerId: string,
    allowedRoles: OrganizerTeamRole[],
  ): Promise<OrganizerTeamRole> {
    const membership = await this.prisma.organizerMember.findUnique({
      where: {
        organizerId_userId: { organizerId, userId },
      },
      select: { role: true },
    });

    if (!membership || !allowedRoles.includes(membership.role)) {
      throw new ForbiddenException('Insufficient organizer team permissions');
    }

    return membership.role;
  }

  async resolveOrganizerForUser(userId: string, organizerId?: string): Promise<string> {
    if (organizerId) {
      await this.assertRole(userId, organizerId, ['OWNER', 'MANAGER']);
      return organizerId;
    }

    const memberships = await this.prisma.organizerMember.findMany({
      where: { userId },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
      select: { organizerId: true, role: true },
    });

    const ownerMatch = memberships.find((m) => m.role === 'OWNER');
    const chosen = ownerMatch ?? memberships[0];
    if (!chosen) {
      throw new ForbiddenException('User is not a member of any organizer team');
    }

    return chosen.organizerId;
  }

  async getDoorAccessRole(userId: string, eventId: string): Promise<DoorAccessRole> {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true, organizerId: true },
    });
    if (!event) {
      throw new NotFoundException('Event not found');
    }

    const membership = await this.prisma.organizerMember.findUnique({
      where: {
        organizerId_userId: { organizerId: event.organizerId, userId },
      },
      select: { role: true },
    });
    if (membership) {
      return membership.role;
    }

    const grant = await this.prisma.doorStaffGrant.findUnique({
      where: {
        eventId_userId: { eventId, userId },
      },
      select: { expiresAt: true },
    });
    if (grant && grant.expiresAt > new Date()) {
      return 'DOOR_STAFF';
    }

    throw new ForbiddenException('Door access denied for this event');
  }

  async assertDoorAccess(userId: string, eventId: string): Promise<void> {
    await this.getDoorAccessRole(userId, eventId);
  }
}
