import { ForbiddenException } from '@nestjs/common';
import type { PrismaService } from '../../common/prisma.service';
import { OrganizerAccessService } from '../identity/organizer-access.service';
import type { OrganizerTeamService } from '../identity/organizer-team.service';
import { ManagementService } from './management.service';

describe('Management reads enforce membership before reading private data [S5-01]', () => {
  const prisma = {
    organizerMember: { findUnique: () => Promise.resolve(null) },
    event: { findUnique: () => Promise.resolve({ organizerId: 'other-club' }) },
  } as unknown as PrismaService;
  const service = new ManagementService(
    prisma,
    new OrganizerAccessService(prisma),
    {} as OrganizerTeamService,
  );
  it('refuses an unrelated user on a dashboard', async () => {
    await expect(service.dashboard('outsider', 'other-club')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
  it('refuses an unrelated user on the private events list', async () => {
    await expect(
      service.listEvents('outsider', 'other-club', { limit: 20 }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('refuses a door-only user on editable event details', async () => {
    await expect(service.event('door-user', 'event')).rejects.toBeInstanceOf(ForbiddenException);
  });
});
