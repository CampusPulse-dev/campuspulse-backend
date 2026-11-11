import { Readable } from 'node:stream';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import type { PrismaService } from '../../common/prisma.service';
import type { StorageService } from '../../common/storage/storage.service';
import {
  AdminVerificationsService,
  CLAIM_LOCK_MS,
  reviewableSubjects,
} from './admin-verifications.service';

const SUPER: AuthenticatedUser = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  email: 'super@campuspulse.ng',
  role: 'SUPER_ADMIN',
};
const OTHER_SUPER: AuthenticatedUser = { ...SUPER, id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' };
const VERIFIER: AuthenticatedUser = {
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  email: 'verifier@campuspulse.ng',
  role: 'VERIFIER',
};
const STUDENT_ID = '11111111-1111-4111-8111-111111111111';
const REQUEST_ID = '22222222-2222-4222-8222-222222222222';
const DOC_KEY = `student-ids/${STUDENT_ID}/doc.jpg`;

type Subject = 'STUDENT_ID' | 'ORGANIZER_CLUB' | 'CREATOR_PROFILE';
type Row = {
  id: string;
  subject: Subject;
  status: string;
  submittedById: string;
  submittedAt: Date;
  claimedById: string | null;
  claimedAt: Date | null;
  reviewerNote: string | null;
  decidedAt: Date | null;
  documentKey: string | null;
  evidenceUrl: string | null;
};

const person = (id: string) => ({
  id,
  displayName: 'Someone',
  avatarUrl: null,
  role: 'ATTENDEE' as const,
  isVerifiedStudent: false,
});

function build(subject: Subject = 'STUDENT_ID') {
  const row: Row = {
    id: REQUEST_ID,
    subject,
    status: 'PENDING',
    submittedById: STUDENT_ID,
    submittedAt: new Date('2026-11-10T08:00:00Z'),
    claimedById: null,
    claimedAt: null,
    reviewerNote: null,
    decidedAt: null,
    documentKey: subject === 'STUDENT_ID' ? DOC_KEY : null,
    evidenceUrl: null,
  };
  /** Ordered trace of side effects, to prove audit-before-read and delete-before-decide. */
  const trace: string[] = [];
  const audits: { action: string; actorId: string; metadata: Record<string, unknown> }[] = [];
  const userUpdates: Record<string, unknown>[] = [];
  const organizerUpdates: Record<string, unknown>[] = [];
  const notifications: { userId: string; title: string }[] = [];

  const hydrate = () => ({
    ...row,
    submittedBy: person(row.submittedById),
    claimedBy: row.claimedById ? person(row.claimedById) : null,
  });

  const verificationRequest = {
    findUnique: jest.fn(({ where }: { where: { id: string } }) =>
      Promise.resolve(where.id === row.id ? hydrate() : null),
    ),
    findUniqueOrThrow: jest.fn(() => Promise.resolve(hydrate())),
    updateMany: jest.fn(
      ({
        where,
        data,
      }: {
        where: {
          claimedById?: string;
          status?: { in: string[] };
          OR?: { claimedById?: string | null; claimedAt?: { lt: Date } }[];
        };
        data: Partial<Row>;
      }) => {
        if (where.status && !where.status.in.includes(row.status)) {
          return Promise.resolve({ count: 0 });
        }
        if (where.claimedById !== undefined && where.claimedById !== row.claimedById) {
          return Promise.resolve({ count: 0 });
        }
        if (where.OR) {
          const free = where.OR.some((cond) => {
            if (cond.claimedAt) return row.claimedAt !== null && row.claimedAt < cond.claimedAt.lt;
            return cond.claimedById === row.claimedById;
          });
          if (!free) return Promise.resolve({ count: 0 });
        }
        if (data.status && data.status !== 'IN_REVIEW') trace.push(`db:${data.status}`);
        Object.assign(row, data);
        return Promise.resolve({ count: 1 });
      },
    ),
  };

  const tx = {
    verificationRequest,
    auditLog: {
      create: jest.fn(({ data }: { data: (typeof audits)[number] }) => {
        audits.push(data);
        trace.push(`audit:${data.action}`);
        return Promise.resolve(data);
      }),
    },
    user: {
      update: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        userUpdates.push(data);
        return Promise.resolve({});
      }),
      updateMany: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        userUpdates.push(data);
        return Promise.resolve({ count: 1 });
      }),
    },
    organizer: {
      updateMany: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        organizerUpdates.push(data);
        return Promise.resolve({ count: 1 });
      }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    creatorProfile: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    notification: {
      create: jest.fn(({ data }: { data: (typeof notifications)[number] }) => {
        notifications.push(data);
        return Promise.resolve(data);
      }),
    },
  };
  const prisma = {
    ...tx,
    $transaction: jest.fn((fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
  } as unknown as PrismaService;

  const getObject = jest.fn((key: string) => {
    trace.push(`storage:get:${key}`);
    return Promise.resolve({
      stream: Readable.from(['bytes']),
      contentType: 'image/jpeg',
      contentLength: 5,
    });
  });
  const deleteObject = jest.fn((key: string) => {
    trace.push(`storage:delete:${key}`);
    return Promise.resolve();
  });
  const storage = {
    getPrivateObject: getObject,
    deletePrivateObject: deleteObject,
  } as unknown as StorageService;

  return {
    service: new AdminVerificationsService(prisma, storage),
    row,
    trace,
    audits,
    userUpdates,
    organizerUpdates,
    notifications,
    getObject,
    deleteObject,
  };
}

describe('AdminVerificationsService — NDPA guarantees (S1-04)', () => {
  it('keeps student IDs out of the Verifier role entirely', async () => {
    expect(reviewableSubjects('VERIFIER')).not.toContain('STUDENT_ID');
    expect(reviewableSubjects('MODERATOR')).toEqual([]);
    expect(reviewableSubjects('SUPER_ADMIN')).toContain('STUDENT_ID');

    const t = build();
    await expect(
      t.service.list(VERIFIER, { subject: 'STUDENT_ID', limit: 20 }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    // The request does not exist as far as a Verifier can tell.
    await expect(t.service.claim(VERIFIER, REQUEST_ID)).rejects.toBeInstanceOf(NotFoundException);
    await expect(t.service.openDocument(VERIFIER, REQUEST_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      t.service.decide(VERIFIER, REQUEST_ID, { decision: 'APPROVED', note: null }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(t.getObject).not.toHaveBeenCalled();
    expect(t.audits).toHaveLength(0);
  });

  it('writes the audit row before reading the document, and only for the claim holder', async () => {
    const t = build();
    await expect(t.service.openDocument(SUPER, REQUEST_ID)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(t.getObject).not.toHaveBeenCalled();

    await t.service.claim(SUPER, REQUEST_ID);
    await expect(t.service.openDocument(OTHER_SUPER, REQUEST_ID)).rejects.toBeInstanceOf(
      ConflictException,
    );

    const object = await t.service.openDocument(SUPER, REQUEST_ID);
    expect(object.contentType).toBe('image/jpeg');
    expect(t.trace).toEqual(['audit:verification.document.viewed', `storage:get:${DOC_KEY}`]);
    expect(t.audits[0]).toMatchObject({
      actorId: SUPER.id,
      action: 'verification.document.viewed',
      metadata: { subject: 'STUDENT_ID', submittedById: STUDENT_ID },
    });
    // The audit trail never contains the storage key.
    expect(JSON.stringify(t.audits)).not.toContain(DOC_KEY);
  });

  it.each(['APPROVED', 'REJECTED', 'INFO_REQUESTED'] as const)(
    'deletes the ID image and clears documentKey on %s',
    async (decision) => {
      const t = build();
      await t.service.claim(SUPER, REQUEST_ID);
      const note = decision === 'APPROVED' ? null : 'Photo is unreadable';
      const item = await t.service.decide(SUPER, REQUEST_ID, { decision, note });

      // Storage delete happens before the decision is recorded.
      expect(t.trace).toEqual([
        `storage:delete:${DOC_KEY}`,
        `db:${decision}`,
        `audit:verification.${decision.toLowerCase()}`,
      ]);
      expect(t.row.documentKey).toBeNull();
      expect(item.hasDocument).toBe(false);
      expect(item.status).toBe(decision);
      expect(t.audits[0]?.metadata).toMatchObject({ documentDeleted: true });
      expect(t.notifications).toHaveLength(1);
      expect(t.notifications[0]?.userId).toBe(STUDENT_ID);
      expect(t.userUpdates).toEqual(decision === 'APPROVED' ? [{ isVerifiedStudent: true }] : []);

      // Gone means gone: the document can no longer be opened, and it cannot be re-decided.
      await expect(t.service.openDocument(SUPER, REQUEST_ID)).rejects.toBeDefined();
      await expect(
        t.service.decide(SUPER, REQUEST_ID, { decision: 'APPROVED', note: null }),
      ).rejects.toBeInstanceOf(ConflictException);
    },
  );

  it('does not record a decision when the image cannot be deleted', async () => {
    const t = build();
    await t.service.claim(SUPER, REQUEST_ID);
    t.deleteObject.mockRejectedValueOnce(new Error('S3 down'));
    await expect(
      t.service.decide(SUPER, REQUEST_ID, { decision: 'APPROVED', note: null }),
    ).rejects.toThrow('S3 down');
    expect(t.row.status).toBe('IN_REVIEW');
    expect(t.row.documentKey).toBe(DOC_KEY);
    expect(t.userUpdates).toEqual([]);
  });
});

describe('AdminVerificationsService — soft-lock and approvals (S1-04)', () => {
  it('blocks a second reviewer for 15 minutes, then lets them take over', async () => {
    const t = build('ORGANIZER_CLUB');
    const claimed = await t.service.claim(VERIFIER, REQUEST_ID);
    expect(claimed.status).toBe('IN_REVIEW');
    expect(claimed.lockExpiresAt).not.toBeNull();

    await expect(t.service.claim(SUPER, REQUEST_ID)).rejects.toBeInstanceOf(ConflictException);
    await expect(
      t.service.decide(SUPER, REQUEST_ID, { decision: 'APPROVED', note: null }),
    ).rejects.toBeInstanceOf(ConflictException);
    // The holder can extend their own lock.
    await expect(t.service.claim(VERIFIER, REQUEST_ID)).resolves.toBeDefined();

    t.row.claimedAt = new Date(Date.now() - CLAIM_LOCK_MS - 1000);
    await expect(
      t.service.decide(VERIFIER, REQUEST_ID, { decision: 'APPROVED', note: null }),
    ).rejects.toBeInstanceOf(ConflictException);
    const takenOver = await t.service.claim(SUPER, REQUEST_ID);
    expect(takenOver.claimedBy?.id).toBe(SUPER.id);
  });

  it('approving a club verifies it and promotes an attendee owner to ORGANIZER', async () => {
    const t = build('ORGANIZER_CLUB');
    await t.service.claim(VERIFIER, REQUEST_ID);
    await t.service.decide(VERIFIER, REQUEST_ID, { decision: 'APPROVED', note: null });
    expect(t.organizerUpdates).toEqual([{ isVerified: true }]);
    expect(t.userUpdates).toEqual([{ role: 'ORGANIZER' }]);
    expect(t.deleteObject).not.toHaveBeenCalled();
  });

  it('rejecting a club changes nothing but the request', async () => {
    const t = build('ORGANIZER_CLUB');
    await t.service.claim(VERIFIER, REQUEST_ID);
    await t.service.decide(VERIFIER, REQUEST_ID, {
      decision: 'REJECTED',
      note: 'No registration evidence',
    });
    expect(t.organizerUpdates).toEqual([]);
    expect(t.userUpdates).toEqual([]);
    expect(t.row.reviewerNote).toBe('No registration evidence');
  });
});
