import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DecideVerificationBody } from './api/identity';
import { StudentEmail } from './domain/primitives';
import { CreateEventBody } from './api/events';
import * as domainEnums from './domain/enums';

describe('DecideVerificationBody', () => {
  it('accepts an approval with no note', () => {
    expect(DecideVerificationBody.safeParse({ decision: 'APPROVED' }).success).toBe(true);
  });

  it('rejects a rejection with no note', () => {
    const r = DecideVerificationBody.safeParse({ decision: 'REJECTED' });
    expect(r.success).toBe(false);
  });

  it('rejects a rejection whose note is only whitespace', () => {
    const r = DecideVerificationBody.safeParse({ decision: 'REJECTED', note: '   ' });
    expect(r.success).toBe(false);
  });

  it('accepts an info request with a real note', () => {
    const r = DecideVerificationBody.safeParse({
      decision: 'INFO_REQUESTED',
      note: 'Please re-upload; the ID photo is cropped.',
    });
    expect(r.success).toBe(true);
  });
});

describe('StudentEmail', () => {
  it('accepts a University of Ibadan address', () => {
    expect(StudentEmail.safeParse('tobi@stu.ui.edu.ng').success).toBe(true);
  });

  it('rejects an unaffiliated address', () => {
    expect(StudentEmail.safeParse('tobi@gmail.com').success).toBe(false);
  });
});

describe('CreateEventBody', () => {
  it('requires a category', () => {
    const r = CreateEventBody.safeParse({
      title: 'Freshers Night',
      description: 'Come through',
      startsAt: '2026-09-01T19:00:00+01:00',
      endsAt: '2026-09-01T23:00:00+01:00',
      venueName: 'Trenchard Hall',
      coverImageUrl: 'https://example.com/a.jpg',
    });
    expect(r.success).toBe(false);
  });
});

describe('Phase 1 schema and contract parity (S1-01)', () => {
  const prismaSchema = readFileSync(
    resolve(__dirname, '..', '..', 'prisma', 'schema.prisma'),
    'utf8',
  );

  it('mirrors every Prisma enum value in src/contract/domain/enums.ts', () => {
    const enumBlocks = [...prismaSchema.matchAll(/enum\s+(\w+)\s*\{([^}]+)\}/g)];
    expect(enumBlocks.length).toBeGreaterThanOrEqual(13);

    for (const match of enumBlocks) {
      const enumName = match[1]!;
      const rawValues = match[2]!;
      const prismaValues = rawValues
        .split('\n')
        .map((line) => line.replace(/\/\/.*$/, '').trim())
        .filter(Boolean);
      const zodEnum = (domainEnums as Record<string, { options?: readonly string[] }>)[enumName];
      expect(zodEnum?.options).toEqual(prismaValues);
    }
  });

  it('defines all required Phase 1A + 1B models in prisma/schema.prisma', () => {
    const requiredModels = [
      'User',
      'PersonaProfile',
      'Organizer',
      'OrganizerMember',
      'DoorStaffGrant',
      'CreatorProfile',
      'CreatorFollow',
      'Event',
      'EventShowtime',
      'EventLineupItem',
      'EventFixture',
      'Story',
      'Rsvp',
      'EventInterest',
      'CheckIn',
      'Follow',
      'Friendship',
      'EventInvite',
      'AmbassadorLink',
      'VerificationRequest',
      'ModerationReport',
      'PlatformSetting',
      'AuditLog',
      'Notification',
      'PushSubscription',
      'NotificationPreference',
    ];

    for (const modelName of requiredModels) {
      expect(prismaSchema).toMatch(new RegExp(`model\\s+${modelName}\\s*\\{`));
    }
  });
});
