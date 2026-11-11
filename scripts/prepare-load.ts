import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (!['campuspulse_test', 'campuspulse_e2e'].includes(url.pathname.slice(1)))
    throw new Error('Load fixtures require a dedicated test database');
  const prisma = new PrismaClient();
  const jwt = new JwtService({ secret: process.env.JWT_SECRET });
  const runId = randomUUID();
  try {
    const owner = await prisma.user.create({
      data: {
        email: `owner-${runId}@example.test`,
        displayName: 'Load test owner',
        passwordHash: 'unusable-load-test',
        role: 'ORGANIZER',
      },
    });
    const organizer = await prisma.organizer.create({
      data: {
        ownerId: owner.id,
        slug: `load-${runId}`,
        name: 'Synthetic load test',
        isVerified: true,
        members: { create: { userId: owner.id, role: 'OWNER' } },
      },
    });
    const event = async (capacity: number, suffix: string) =>
      prisma.event.create({
        data: {
          organizerId: organizer.id,
          title: `Synthetic ${suffix}`,
          slug: `load-${runId}-${suffix}`,
          description: 'Synthetic load validation',
          category: 'SOCIAL_PARTY',
          status: 'PUBLISHED',
          startsAt: new Date(Date.now() + 86400000),
          endsAt: new Date(Date.now() + 90000000),
          venueName: 'Synthetic venue',
          capacity,
          studentsOnly: false,
          waitlistEnabled: true,
        },
      });
    const sustained = await event(1000, 'sustained');
    const race = await event(10, 'race');
    const users = Array.from({ length: 1100 }, (_, i) => ({
      id: randomUUID(),
      email: `load-${runId}-${i}@example.test`,
      displayName: `Synthetic ${i}`,
      passwordHash: 'unusable-load-test',
    }));
    await prisma.user.createMany({ data: users });
    const directory = resolve('test-results');
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      resolve(directory, 'load-fixture.json'),
      JSON.stringify({
        runId,
        eventId: sustained.id,
        raceEventId: race.id,
        ownerToken: jwt.sign({ sub: owner.id }, { expiresIn: '1h' }),
        tokens: users.map((u) => jwt.sign({ sub: u.id }, { expiresIn: '1h' })),
      }),
      { mode: 0o600 },
    );
    process.stdout.write(`Prepared isolated synthetic load run ${runId}\n`);
  } finally {
    await prisma.$disconnect();
  }
}
void main().catch(() => {
  process.stderr.write('Load fixture setup failed\n');
  process.exitCode = 1;
});
