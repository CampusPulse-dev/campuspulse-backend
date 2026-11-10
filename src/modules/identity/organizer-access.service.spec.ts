import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../common/prisma.service';
import { OrganizerAccessService } from './organizer-access.service';

describe('OrganizerAccessService (S2-01)', () => {
  function buildService(mocks?: {
    memberRole?: 'OWNER' | 'MANAGER' | null;
    eventExists?: boolean;
    grantExpiresAt?: Date | null;
  }) {
    const prisma = {
      organizerMember: {
        findUnique: jest
          .fn()
          .mockResolvedValue(mocks?.memberRole ? { role: mocks.memberRole } : null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      event: {
        findUnique: jest
          .fn()
          .mockResolvedValue(
            mocks?.eventExists === false ? null : { id: 'evt-1', organizerId: 'org-1' },
          ),
      },
      doorStaffGrant: {
        findUnique: jest
          .fn()
          .mockResolvedValue(mocks?.grantExpiresAt ? { expiresAt: mocks.grantExpiresAt } : null),
      },
    } as unknown as PrismaService;

    return new OrganizerAccessService(prisma);
  }

  it('allows matching team role and rejects disallowed or missing role', async () => {
    const ownerAccess = buildService({ memberRole: 'OWNER' });
    await expect(ownerAccess.assertRole('u1', 'org-1', ['OWNER'])).resolves.toBe('OWNER');

    const managerAccess = buildService({ memberRole: 'MANAGER' });
    await expect(managerAccess.assertRole('u1', 'org-1', ['OWNER'])).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(managerAccess.assertRole('u1', 'org-1', ['OWNER', 'MANAGER'])).resolves.toBe(
      'MANAGER',
    );
  });

  it('enforces door access for unexpired DoorStaffGrant and rejects expired grant or missing event', async () => {
    const missingEvent = buildService({ eventExists: false });
    await expect(missingEvent.assertDoorAccess('u1', 'evt-missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );

    const expiredGrant = buildService({
      memberRole: null,
      grantExpiresAt: new Date(Date.now() - 60_000),
    });
    await expect(expiredGrant.assertDoorAccess('u1', 'evt-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    const activeGrant = buildService({
      memberRole: null,
      grantExpiresAt: new Date(Date.now() + 60_000),
    });
    await expect(activeGrant.getDoorAccessRole('u1', 'evt-1')).resolves.toBe('DOOR_STAFF');
  });
});
