import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { JwtService } from '@nestjs/jwt';
import { createTestApp } from '../test/utils/app';
import { AuthService } from '../src/modules/identity/auth/auth.service';
import { PasswordService } from '../src/modules/identity/auth/password.service';
import { sealRefreshCookie } from '../src/modules/identity/auth/refresh-cookie';
import { QrTokenService } from '../src/modules/attendance/qr-token.service';

const PASSWORD = 'Synthetic-browser-test-password';
const roles = [
  'ATTENDEE',
  'ORGANIZER',
  'ATTENDEE',
  'ATTENDEE',
  'SUPER_ADMIN',
  'VERIFIER',
  'MODERATOR',
  'CREATOR',
] as const;
const mainRoles: number[] = [
  0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 3, 3, 3, 3, 7, 4, 5, 6, 4, 0, 0, 1,
];
async function main() {
  const target = new URL(process.env.DATABASE_URL ?? '');
  if (!['campuspulse_test', 'campuspulse_e2e'].includes(target.pathname.slice(1)))
    throw new Error('Browser fixtures require a dedicated test database');
  const ctx = await createTestApp({ devAuthEnabled: false });
  const s3 = new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID!,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
    },
  });
  const output: Record<string, unknown> = {};
  try {
    const passwordHash = await ctx.app.get(PasswordService).hash(PASSWORD);
    for (const project of ['chromium', 'mobile-safari']) {
      const cases = [];
      for (let index = 0; index < 31; index += 1) {
        const runId = randomUUID();
        const users = [];
        for (const [i, role] of roles.entries())
          users.push(
            await ctx.prisma.user.create({
              data: {
                email: `s6-${runId}-${i}@example.test`,
                displayName: `S6 ${project} ${index + 1} person ${i}`,
                passwordHash,
                role,
                isVerifiedStudent: false,
              },
            }),
          );
        const owner = users[1]!;
        const attendee = users[0]!;
        const manager = users[2]!;
        const door = users[3]!;
        const organizer = await ctx.prisma.organizer.create({
          data: {
            ownerId: owner.id,
            slug: `s6-${runId}`,
            name: `S6 ${project} ${index + 1} Club`,
            isVerified: true,
            members: {
              create: [
                { userId: owner.id, role: 'OWNER' },
                { userId: manager.id, role: 'MANAGER' },
              ],
            },
          },
        });
        const event = await ctx.prisma.event.create({
          data: {
            organizerId: organizer.id,
            slug: `event-${runId}`,
            title: `S6 ${project} ${index + 1} Event`,
            description: 'Synthetic campus event for live release acceptance.',
            status: 'PUBLISHED',
            category: 'SOCIAL_PARTY',
            startsAt: new Date(Date.now() + 2 * 3600000),
            endsAt: new Date(Date.now() + 6 * 3600000),
            venueName: 'Synthetic SUB Field',
            coverImageUrl: `${process.env.WEB_ORIGIN}/demo/events/havana-night-sub-field.webp`,
            capacity: 50,
            rsvpCount: 2,
            studentsOnly: false,
            waitlistEnabled: true,
          },
        });
        const rsvpId = randomUUID();
        const qrToken = ctx.app
          .get(QrTokenService)
          .sign({ rsvpId, eventId: event.id, issuedAt: Date.now() });
        await ctx.prisma.rsvp.create({
          data: {
            id: rsvpId,
            userId: attendee.id,
            eventId: event.id,
            status: 'CONFIRMED',
            qrToken,
          },
        });
        const otherRsvpId = randomUUID();
        await ctx.prisma.rsvp.create({
          data: {
            id: otherRsvpId,
            userId: users[7]!.id,
            eventId: event.id,
            status: 'CONFIRMED',
            qrToken: ctx.app
              .get(QrTokenService)
              .sign({ rsvpId: otherRsvpId, eventId: event.id, issuedAt: Date.now() }),
          },
        });
        await ctx.prisma.doorStaffGrant.create({
          data: {
            eventId: event.id,
            userId: door.id,
            grantedById: owner.id,
            expiresAt: new Date(Date.now() + 10 * 3600000),
          },
        });
        await ctx.prisma.creatorProfile.create({
          data: {
            userId: users[7]!.id,
            handle: `creator_${runId.replaceAll('-', '')}`.slice(0, 30),
            displayName: users[7]!.displayName,
            isVerified: true,
          },
        });
        let verificationId: string | null = null;
        if (index === 24) {
          const key = `browser-synthetic/${runId}/id.png`;
          const image = Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC9sAAAAASUVORK5CYII=',
            'base64',
          );
          await s3.send(
            new PutObjectCommand({
              Bucket: process.env.S3_PRIVATE_BUCKET!,
              Key: key,
              Body: image,
              ContentType: 'image/png',
            }),
          );
          verificationId = (
            await ctx.prisma.verificationRequest.create({
              data: { subject: 'STUDENT_ID', submittedById: attendee.id, documentKey: key },
            })
          ).id;
        }
        const person = users[mainRoles[index]!]!;
        const issued = await ctx.app
          .get(AuthService)
          .signIn({ email: person.email, password: PASSWORD });
        cases.push({
          runId,
          organizerId: organizer.id,
          organizerSlug: organizer.slug,
          organizerName: organizer.name,
          eventId: event.id,
          eventSlug: event.slug,
          eventTitle: event.title,
          venueName: event.venueName,
          rsvpId,
          qrToken,
          verificationId,
          attendeeName: attendee.displayName,
          selectedName: person.displayName,
          cookie: sealRefreshCookie(issued.refreshToken, process.env.JWT_SECRET!),
          password: PASSWORD,
          email: person.email,
          users: users.map((u) => ({
            id: u.id,
            email: u.email,
            name: u.displayName,
            token: ctx.app.get(JwtService).sign({ sub: u.id }, { expiresIn: '1h' }),
          })),
        });
      }
      output[project] = cases;
    }
    mkdirSync('test-results', { recursive: true });
    writeFileSync(resolve('test-results/browser-fixtures.json'), JSON.stringify(output), {
      mode: 0o600,
    });
    process.stdout.write('Created isolated browser fixtures (credentials omitted)\n');
  } finally {
    s3.destroy();
    await ctx.close();
  }
}
void main().catch((error) => {
  process.stderr.write(
    `Browser fixture setup failed: ${error instanceof Error ? error.name : 'unknown'}\n`,
  );
  process.exitCode = 1;
});
