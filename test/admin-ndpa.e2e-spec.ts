import { Readable } from 'node:stream';
import type { INestApplication } from '@nestjs/common';
import type { UserRole } from '@prisma/client';
import type { PrismaService } from '../src/common/prisma.service';
import { StorageService } from '../src/common/storage/storage.service';
import type {
  AdminOverview,
  AdminReportsResponse,
  AdminVerificationItem,
  AdminVerificationQueueResponse,
  AuditLogResponse,
} from '../src/contract';
import { asUser, bodyOf, createTestApp, truncateDatabase } from './utils/app';

const SUPER = 'super@campuspulse.ng';
const VERIFIER = 'verifier@campuspulse.ng';
const MODERATOR = 'moderator@campuspulse.ng';
const STUDENT = 'student@gmail.com';

describe('Admin portal backend & NDPA guarantees (S1-04)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let close: () => Promise<void>;
  let deleted: string[];

  beforeAll(async () => {
    ({ app, prisma, close } = await createTestApp());
    const storage = app.get(StorageService);
    jest.spyOn(storage, 'getPrivateObject').mockImplementation(() =>
      Promise.resolve({
        stream: Readable.from([Buffer.from('fake-jpeg-bytes')]),
        contentType: 'image/jpeg',
        contentLength: 15,
      }),
    );
    jest.spyOn(storage, 'deletePrivateObject').mockImplementation((key: string) => {
      deleted.push(key);
      return Promise.resolve();
    });
  });

  beforeEach(async () => {
    await truncateDatabase(prisma);
    deleted = [];
  });

  afterAll(async () => {
    await close();
  });

  async function staff(email: string, role: UserRole): Promise<string> {
    const user = await prisma.user.create({
      data: { email, passwordHash: 'x', displayName: role, role },
    });
    return user.id;
  }

  async function studentIdRequest(): Promise<{
    requestId: string;
    studentId: string;
    key: string;
  }> {
    const student = await prisma.user.create({
      data: { email: STUDENT, passwordHash: 'x', displayName: 'Student' },
    });
    const key = `student-ids/${student.id}/doc.jpg`;
    const request = await prisma.verificationRequest.create({
      data: { subject: 'STUDENT_ID', submittedById: student.id, documentKey: key },
    });
    return { requestId: request.id, studentId: student.id, key };
  }

  it('(a) a VERIFIER cannot see, claim or open student ID requests', async () => {
    await staff(VERIFIER, 'VERIFIER');
    const { requestId } = await studentIdRequest();

    const queue = await asUser(app, VERIFIER).get('/admin/verifications').expect(200);
    expect(bodyOf<AdminVerificationQueueResponse>(queue).items).toHaveLength(0);
    await asUser(app, VERIFIER).get('/admin/verifications?subject=STUDENT_ID').expect(403);
    await asUser(app, VERIFIER).post(`/admin/verifications/${requestId}/claim`).expect(404);
    await asUser(app, VERIFIER).get(`/admin/verifications/${requestId}/document`).expect(403);

    const overview = await asUser(app, VERIFIER).get('/admin/overview').expect(200);
    expect(bodyOf<AdminOverview>(overview).pendingVerifications.studentId).toBeNull();

    // Non-staff get nothing at all.
    await asUser(app, STUDENT).get('/admin/overview').expect(403);
    expect(await prisma.auditLog.count()).toBe(0);
  });

  it('(b) a SUPER_ADMIN view is uncacheable and writes an audit row', async () => {
    const superId = await staff(SUPER, 'SUPER_ADMIN');
    const { requestId, key } = await studentIdRequest();

    // Must hold the claim first.
    await asUser(app, SUPER).get(`/admin/verifications/${requestId}/document`).expect(409);
    const claimed = await asUser(app, SUPER)
      .post(`/admin/verifications/${requestId}/claim`)
      .expect(200);
    const item = bodyOf<AdminVerificationItem>(claimed);
    expect(item.hasDocument).toBe(true);
    // The storage key never leaves the API.
    expect(JSON.stringify(item)).not.toContain(key);

    const doc = await asUser(app, SUPER)
      .get(`/admin/verifications/${requestId}/document`)
      .expect(200);
    expect(doc.headers['cache-control']).toContain('no-store');
    expect(doc.headers['content-disposition']).toBe('inline');
    expect(doc.headers['x-content-type-options']).toBe('nosniff');
    expect(doc.headers['content-type']).toContain('image/jpeg');

    const audit = await prisma.auditLog.findMany({
      where: { action: 'verification.document.viewed' },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorId: superId, targetId: requestId });
  });

  it('(c) deciding deletes the stored image and clears documentKey', async () => {
    await staff(SUPER, 'SUPER_ADMIN');
    const { requestId, studentId, key } = await studentIdRequest();

    await asUser(app, SUPER).post(`/admin/verifications/${requestId}/claim`).expect(200);
    // Rejecting without a note is refused by the contract.
    await asUser(app, SUPER)
      .post(`/admin/verifications/${requestId}/decide`)
      .send({ decision: 'REJECTED', note: null })
      .expect(400);
    expect(deleted).toEqual([]);

    const decided = await asUser(app, SUPER)
      .post(`/admin/verifications/${requestId}/decide`)
      .send({ decision: 'APPROVED', note: null })
      .expect(200);
    expect(bodyOf<AdminVerificationItem>(decided)).toMatchObject({
      status: 'APPROVED',
      hasDocument: false,
    });

    expect(deleted).toEqual([key]);
    const row = await prisma.verificationRequest.findUniqueOrThrow({ where: { id: requestId } });
    expect(row.documentKey).toBeNull();
    const student = await prisma.user.findUniqueOrThrow({ where: { id: studentId } });
    expect(student.isVerifiedStudent).toBe(true);
    expect(await prisma.notification.count({ where: { userId: studentId } })).toBe(1);

    await asUser(app, SUPER).get(`/admin/verifications/${requestId}/document`).expect(409);
    const logs = await asUser(app, SUPER).get('/admin/audit-logs').expect(200);
    expect(bodyOf<AuditLogResponse>(logs).items.map((l) => l.action)).toContain(
      'verification.approved',
    );
  });

  it('club approval verifies the organizer; role, settings and audit are Super Admin only', async () => {
    const superId = await staff(SUPER, 'SUPER_ADMIN');
    const verifierId = await staff(VERIFIER, 'VERIFIER');
    const applied = await asUser(app, 'owner@stu.ui.edu.ng')
      .post('/organizers')
      .send({
        organizerName: 'UI Drama Society',
        slug: 'ui-drama',
        evidenceUrl: 'https://example.com/reg.pdf',
        note: null,
      })
      .expect(201);
    const clubId = bodyOf<{ organizer: { id: string } }>(applied).organizer.id;

    const queue = await asUser(app, VERIFIER).get('/admin/verifications').expect(200);
    const [request] = bodyOf<AdminVerificationQueueResponse>(queue).items;
    expect(request?.organizer?.slug).toBe('ui-drama');
    const requestId = request?.id ?? '';

    await asUser(app, VERIFIER).post(`/admin/verifications/${requestId}/claim`).expect(200);
    // Soft-lock: a second reviewer is turned away.
    await asUser(app, SUPER).post(`/admin/verifications/${requestId}/claim`).expect(409);
    await asUser(app, VERIFIER)
      .post(`/admin/verifications/${requestId}/decide`)
      .send({ decision: 'APPROVED', note: null })
      .expect(200);

    const club = await prisma.organizer.findUniqueOrThrow({ where: { id: clubId } });
    expect(club.isVerified).toBe(true);
    const owner = await prisma.user.findUniqueOrThrow({ where: { id: club.ownerId } });
    expect(owner.role).toBe('ORGANIZER');

    await asUser(app, VERIFIER).get('/admin/audit-logs').expect(403);
    await asUser(app, VERIFIER).get('/admin/users').expect(403);
    await asUser(app, VERIFIER)
      .put('/admin/settings')
      .send({ key: 'stories.enabled', value: false })
      .expect(403);
    await asUser(app, VERIFIER)
      .patch(`/admin/users/${owner.id}/role`)
      .send({ role: 'SUPER_ADMIN' })
      .expect(403);

    await asUser(app, SUPER)
      .patch(`/admin/users/${verifierId}/role`)
      .send({ role: 'MODERATOR' })
      .expect(200);
    await asUser(app, SUPER)
      .patch(`/admin/users/${superId}/role`)
      .send({ role: 'ATTENDEE' })
      .expect(400);
    await asUser(app, SUPER)
      .put('/admin/settings')
      .send({ key: 'stories.enabled', value: false })
      .expect(200);
    expect(
      await prisma.auditLog.count({
        where: { action: { in: ['user.role.changed', 'platform.setting.changed'] } },
      }),
    ).toBe(2);
  });

  it('moderation: a suspended reporter target loses API access at once', async () => {
    await staff(MODERATOR, 'MODERATOR');
    const offender = await prisma.user.create({
      data: { email: 'offender@gmail.com', passwordHash: 'x', displayName: 'Offender' },
    });
    const reporter = await prisma.user.create({
      data: { email: 'reporter@gmail.com', passwordHash: 'x', displayName: 'Reporter' },
    });
    const report = await prisma.moderationReport.create({
      data: {
        reporterId: reporter.id,
        targetType: 'USER',
        targetId: offender.id,
        details: 'Harassment in event comments',
      },
    });

    await asUser(app, 'reporter@gmail.com').get('/admin/reports').expect(403);
    const open = await asUser(app, MODERATOR).get('/admin/reports').expect(200);
    expect(bodyOf<AdminReportsResponse>(open).items).toHaveLength(1);

    await asUser(app, 'offender@gmail.com').get('/users/me').expect(200);
    await asUser(app, MODERATOR)
      .post(`/admin/reports/${report.id}/resolve`)
      .send({ action: 'SUSPEND_USER', note: 'Confirmed harassment' })
      .expect(400);
    await asUser(app, MODERATOR)
      .post(`/admin/reports/${report.id}/resolve`)
      .send({ action: 'SUSPEND_USER', note: 'Confirmed harassment', userId: offender.id })
      .expect(200);
    await asUser(app, 'offender@gmail.com').get('/users/me').expect(403);
    await asUser(app, MODERATOR)
      .post(`/admin/reports/${report.id}/resolve`)
      .send({ action: 'DISMISS', note: 'again' })
      .expect(409);
  });
});
