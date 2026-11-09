import { PrismaClient } from '@prisma/client';
import { seedDatabase, UI_FACULTIES, UI_HALLS } from '../prisma/seed';

describe('Database seed (S1-01)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = new PrismaClient({
      datasources: {
        db: {
          url:
            process.env.DATABASE_URL ??
            'postgresql://campuspulse:campuspulse@localhost:5432/campuspulse_test?schema=public',
        },
      },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('exports University of Ibadan halls and faculties and seeds idempotently', async () => {
    expect(UI_HALLS.length).toBeGreaterThanOrEqual(10);
    expect(UI_FACULTIES.length).toBeGreaterThanOrEqual(8);

    await seedDatabase(prisma);
    // Second run proves idempotency.
    await seedDatabase(prisma);

    const organizers = await prisma.organizer.findMany({
      where: { isVerified: true },
      include: { members: true },
    });
    expect(organizers).toHaveLength(3);
    for (const org of organizers) {
      expect(org.members.some((m) => m.role === 'OWNER')).toBe(true);
      expect(org.members.some((m) => m.role === 'MANAGER')).toBe(true);
    }

    const creators = await prisma.creatorProfile.count();
    expect(creators).toBe(1);

    const attendees = await prisma.user.count({ where: { role: 'ATTENDEE' } });
    expect(attendees).toBe(12);

    const friendships = await prisma.friendship.count();
    expect(friendships).toBeGreaterThanOrEqual(5);

    const events = await prisma.event.findMany({
      where: { status: 'PUBLISHED' },
      include: { showtimes: true, lineupItems: true, fixture: true },
    });
    const templates = new Set(events.map((e) => e.template));
    expect(templates).toEqual(
      new Set(['GENERIC', 'CONCERT_PARTY', 'PLAY_CULTURAL', 'MATCH_TOURNAMENT']),
    );
    expect(events.some((e) => e.linkType === 'AFTER_PARTY' && e.parentEventId !== null)).toBe(true);

    const settings = await prisma.platformSetting.findMany();
    expect(settings.map((s) => s.key)).toEqual(
      expect.arrayContaining([
        'max_daily_non_critical_pushes',
        'quiet_hours_wat',
        'default_waitlist_enabled',
      ]),
    );
  });
});
