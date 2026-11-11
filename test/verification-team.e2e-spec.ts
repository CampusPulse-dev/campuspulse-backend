import type { INestApplication } from '@nestjs/common';
import type { PrismaService } from '../src/common/prisma.service';
import type {
  MyOrganizersResponse,
  OrganizerMembership,
  TeamResponse,
  UserPublic,
  VerificationSubmittedResponse,
} from '../src/contract';
import { EmailAdapter } from '../src/modules/notifications/email.adapter';
import { anon, asUser, bodyOf, createTestApp, truncateDatabase } from './utils/app';

const OWNER = 'owner@stu.ui.edu.ng';
const MANAGER = 'manager@stu.ui.edu.ng';
const OUTSIDER = 'outsider@stu.ui.edu.ng';

const CLUB = {
  organizerName: 'UI Drama Society',
  slug: 'ui-drama',
  evidenceUrl: 'https://example.com/registration.pdf',
  note: null,
};

describe('Verification submission & club teams (S1-03)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let emails: EmailAdapter;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ app, prisma, close } = await createTestApp());
    emails = app.get(EmailAdapter);
  });

  beforeEach(async () => {
    await truncateDatabase(prisma);
    emails.clearSentMessages();
  });

  afterAll(async () => {
    await close();
  });

  async function idOf(email: string): Promise<string> {
    const me = await asUser(app, email).get('/users/me').expect(200);
    return bodyOf<UserPublic>(me).id;
  }

  describe('student email OTP', () => {
    it('verifies with the emailed code and rejects non-UI addresses', async () => {
      const student = 'fresher@gmail.com';
      await anon(app)
        .post('/verification/student/email-otp')
        .send({ email: 'a@stu.ui.edu.ng' })
        .expect(401);
      await asUser(app, student)
        .post('/verification/student/email-otp')
        .send({ email: 'someone@gmail.com' })
        .expect(400);

      await asUser(app, student)
        .post('/verification/student/email-otp')
        .send({ email: 'fresher@stu.ui.edu.ng' })
        .expect(200);
      const code = /(\d{6})/.exec(emails.getSentMessages()[0]?.text ?? '')?.[1];
      expect(code).toBeDefined();

      const confirmed = await asUser(app, student)
        .post('/verification/student/confirm-otp')
        .send({ email: 'fresher@stu.ui.edu.ng', code })
        .expect(200);
      expect(bodyOf<UserPublic>(confirmed).isVerifiedStudent).toBe(true);

      const state = await asUser(app, student).get('/verification/student').expect(200);
      expect(bodyOf<{ status: string }>(state).status).toBe('APPROVED');
    });

    it('locks out after five wrong codes', async () => {
      const student = 'guesser@gmail.com';
      await asUser(app, student)
        .post('/verification/student/email-otp')
        .send({ email: 'guesser@stu.ui.edu.ng' })
        .expect(200);
      const real = /(\d{6})/.exec(emails.getSentMessages()[0]?.text ?? '')?.[1] ?? '';
      const wrong = real === '000000' ? '111111' : '000000';

      for (let i = 0; i < 4; i += 1) {
        await asUser(app, student)
          .post('/verification/student/confirm-otp')
          .send({ email: 'guesser@stu.ui.edu.ng', code: wrong })
          .expect(400);
      }
      await asUser(app, student)
        .post('/verification/student/confirm-otp')
        .send({ email: 'guesser@stu.ui.edu.ng', code: wrong })
        .expect(429);
      await asUser(app, student)
        .post('/verification/student/confirm-otp')
        .send({ email: 'guesser@stu.ui.edu.ng', code: real })
        .expect(429);
    });
  });

  describe('club application and team roles', () => {
    it('creates an unverified club, lists it under /organizers/mine, and enforces roles', async () => {
      const applied = await asUser(app, OWNER).post('/organizers').send(CLUB).expect(201);
      const membership = bodyOf<OrganizerMembership>(applied);
      expect(membership).toMatchObject({ role: 'OWNER', verificationStatus: 'PENDING' });
      expect(membership.organizer.isVerified).toBe(false);
      const clubId = membership.organizer.id;

      await asUser(app, OWNER).post('/organizers').send(CLUB).expect(409);
      await asUser(app, OUTSIDER)
        .post('/organizers')
        .send({ ...CLUB, organizerName: 'Copycat' })
        .expect(409);
      await asUser(app, OUTSIDER)
        .post('/organizers')
        .send({ ...CLUB, slug: 'mine' })
        .expect(409);

      const pending = await prisma.verificationRequest.findMany({
        where: { subject: 'ORGANIZER_CLUB' },
      });
      expect(pending).toHaveLength(1);

      const mine = await asUser(app, OWNER).get('/organizers/mine').expect(200);
      expect(bodyOf<MyOrganizersResponse>(mine).items).toHaveLength(1);
      const none = await asUser(app, OUTSIDER).get('/organizers/mine').expect(200);
      expect(bodyOf<MyOrganizersResponse>(none).items).toHaveLength(0);

      // Outsiders cannot even read the team.
      await asUser(app, OUTSIDER).get(`/organizers/${clubId}/team`).expect(403);
      await anon(app).get(`/organizers/${clubId}/team`).expect(401);

      // Owner adds a registered user as manager; unknown emails are refused.
      const managerId = await idOf(MANAGER);
      await asUser(app, OWNER)
        .post(`/organizers/${clubId}/team`)
        .send({ email: 'nobody@stu.ui.edu.ng' })
        .expect(404);
      const added = await asUser(app, OWNER)
        .post(`/organizers/${clubId}/team`)
        .send({ email: MANAGER })
        .expect(200);
      const team = bodyOf<TeamResponse>(added);
      expect(team.members.map((m) => m.role).sort()).toEqual(['MANAGER', 'OWNER']);
      // Emails only ever leave the API masked.
      expect(JSON.stringify(team)).not.toContain(MANAGER);
      expect(team.members.find((m) => m.userId === managerId)?.emailHint).toBe(
        'm***@stu.ui.edu.ng',
      );
      await asUser(app, OWNER)
        .post(`/organizers/${clubId}/team`)
        .send({ email: MANAGER })
        .expect(409);

      // A manager can view the team but not change it.
      const viewed = await asUser(app, MANAGER).get(`/organizers/${clubId}/team`).expect(200);
      expect(bodyOf<TeamResponse>(viewed).role).toBe('MANAGER');
      await asUser(app, MANAGER)
        .post(`/organizers/${clubId}/team`)
        .send({ email: OUTSIDER })
        .expect(403);
      const ownerId = await idOf(OWNER);
      await asUser(app, MANAGER).delete(`/organizers/${clubId}/team/${ownerId}`).expect(403);

      // The owner cannot be removed; a manager can.
      await asUser(app, OWNER).delete(`/organizers/${clubId}/team/${ownerId}`).expect(400);
      const removed = await asUser(app, OWNER)
        .delete(`/organizers/${clubId}/team/${managerId}`)
        .expect(200);
      expect(bodyOf<TeamResponse>(removed).members).toHaveLength(1);
      await asUser(app, MANAGER).get(`/organizers/${clubId}/team`).expect(403);
    });

    it('accepts one creator application per user and unique handles', async () => {
      const body = { handle: 'DJ.Kola', displayName: 'DJ Kola' };
      const applied = await asUser(app, OWNER).post('/creators/apply').send(body).expect(201);
      expect(bodyOf<VerificationSubmittedResponse>(applied)).toMatchObject({
        subject: 'CREATOR_PROFILE',
        status: 'PENDING',
      });
      const profile = await prisma.creatorProfile.findUniqueOrThrow({
        where: { handle: 'dj.kola' },
      });
      expect(profile.isVerified).toBe(false);

      await asUser(app, OWNER).post('/creators/apply').send(body).expect(409);
      await asUser(app, OUTSIDER).post('/creators/apply').send(body).expect(409);
      await asUser(app, OUTSIDER)
        .post('/creators/apply')
        .send({ handle: 'no spaces', displayName: 'X' })
        .expect(400);
    });
  });
});
