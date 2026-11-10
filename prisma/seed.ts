import { createHash, createPrivateKey, sign as cryptoSign } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

export const UI_HALLS = [
  'Mellanby Hall',
  'Tedder Hall',
  'Kuti Hall',
  'Sultan Bello Hall',
  'Queen Elizabeth II Hall',
  'Idia Hall',
  'Independence (Indy) Hall',
  'Nnamdi Azikiwe (Zik) Hall',
  'Obafemi Awolowo (Awo) Hall',
  'Abdulsalami Abubakar Hall',
  'Alexander Brown Hall',
] as const;

export const UI_FACULTIES = [
  'Technology',
  'Science',
  'Arts',
  'The Social Sciences',
  'Law',
  'Clinical Sciences (UCH)',
  'Agriculture',
  'Education',
  'Pharmacy',
] as const;

const SEED_PASSWORD_HASH = 'dev-seed-placeholder-hash';
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

function signSeedQrToken(input: { rsvpId: string; eventId: string; showtimeId?: string }): string {
  const pkcs8Base64 = process.env.QR_SIGNING_PRIVATE_KEY?.trim();
  const legacySecret =
    process.env.QR_SIGNING_SECRET?.trim() || 'replace-me-with-at-least-32-characters-of-random';
  const privateKey = pkcs8Base64
    ? createPrivateKey({
        key: Buffer.from(pkcs8Base64, 'base64'),
        format: 'der',
        type: 'pkcs8',
      })
    : createPrivateKey({
        key: Buffer.concat([
          ED25519_PKCS8_PREFIX,
          createHash('sha256').update(legacySecret).digest(),
        ]),
        format: 'der',
        type: 'pkcs8',
      });

  const payload = {
    v: 1 as const,
    rsvpId: input.rsvpId,
    eventId: input.eventId,
    ...(input.showtimeId ? { showtimeId: input.showtimeId } : {}),
    issuedAt: Date.now(),
  };
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = cryptoSign(null, Buffer.from(body, 'utf8'), privateKey).toString('base64url');
  return `${body}.${sig}`;
}

export async function seedDatabase(prisma: PrismaClient): Promise<void> {
  const webOrigin = (process.env.WEB_ORIGIN ?? 'http://localhost:3000').replace(/\/$/, '');

  // Clear dependent data in deterministic order so repeated seeding is idempotent.
  await prisma.$transaction([
    prisma.checkIn.deleteMany(),
    prisma.rsvp.deleteMany(),
    prisma.eventInterest.deleteMany(),
    prisma.eventInvite.deleteMany(),
    prisma.ambassadorLink.deleteMany(),
    prisma.doorStaffGrant.deleteMany(),
    prisma.eventShowtime.deleteMany(),
    prisma.eventLineupItem.deleteMany(),
    prisma.eventFixture.deleteMany(),
    prisma.story.deleteMany(),
    prisma.follow.deleteMany(),
    prisma.creatorFollow.deleteMany(),
    prisma.friendship.deleteMany(),
    prisma.notification.deleteMany(),
    prisma.pushSubscription.deleteMany(),
    prisma.notificationPreference.deleteMany(),
    prisma.moderationReport.deleteMany(),
    prisma.verificationRequest.deleteMany(),
    prisma.auditLog.deleteMany(),
    prisma.platformSetting.deleteMany(),
    prisma.event.deleteMany(),
    prisma.organizerMember.deleteMany(),
    prisma.organizer.deleteMany(),
    prisma.creatorProfile.deleteMany(),
    prisma.personaProfile.deleteMany(),
    prisma.user.deleteMany(),
  ]);

  // 1. Platform settings defaults
  await prisma.platformSetting.createMany({
    data: [
      { key: 'max_daily_non_critical_pushes', value: 3 },
      { key: 'quiet_hours_wat', value: { startHour: 23, endHour: 7 } },
      { key: 'default_waitlist_enabled', value: true },
      {
        key: 'feature_flags',
        value: {
          storiesEnabled: true,
          afterPartiesEnabled: true,
          forYouRankingEnabled: true,
        },
      },
    ],
  });

  // 2. Organizer Owners & Managers (3 verified UI clubs)
  const sigmaOwner = await prisma.user.create({
    data: {
      id: '10000000-0000-4000-8000-000000000001',
      email: 'sigma.owner@stu.ui.edu.ng',
      studentEmail: 'sigma.owner@stu.ui.edu.ng',
      passwordHash: SEED_PASSWORD_HASH,
      displayName: 'Babatunde Ogunyemi',
      role: 'ORGANIZER',
      isVerifiedStudent: true,
      hall: 'Mellanby Hall',
      faculty: 'Law',
      level: '400L',
    },
  });
  const sigmaManager = await prisma.user.create({
    data: {
      id: '10000000-0000-4000-8000-000000000002',
      email: 'sigma.manager@stu.ui.edu.ng',
      studentEmail: 'sigma.manager@stu.ui.edu.ng',
      passwordHash: SEED_PASSWORD_HASH,
      displayName: 'Ngozi Okafor',
      role: 'ORGANIZER',
      isVerifiedStudent: true,
      hall: 'Queen Elizabeth II Hall',
      faculty: 'The Social Sciences',
      level: '300L',
    },
  });

  const theatreOwner = await prisma.user.create({
    data: {
      id: '10000000-0000-4000-8000-000000000003',
      email: 'theatre.owner@stu.ui.edu.ng',
      studentEmail: 'theatre.owner@stu.ui.edu.ng',
      passwordHash: SEED_PASSWORD_HASH,
      displayName: 'Ayoade Faleti',
      role: 'ORGANIZER',
      isVerifiedStudent: true,
      hall: 'Tedder Hall',
      faculty: 'Arts',
      level: '400L',
    },
  });
  const theatreManager = await prisma.user.create({
    data: {
      id: '10000000-0000-4000-8000-000000000004',
      email: 'theatre.manager@stu.ui.edu.ng',
      studentEmail: 'theatre.manager@stu.ui.edu.ng',
      passwordHash: SEED_PASSWORD_HASH,
      displayName: 'Funke Adewale',
      role: 'ORGANIZER',
      isVerifiedStudent: true,
      hall: 'Idia Hall',
      faculty: 'Arts',
      level: '300L',
    },
  });

  const sportsOwner = await prisma.user.create({
    data: {
      id: '10000000-0000-4000-8000-000000000005',
      email: 'sports.owner@stu.ui.edu.ng',
      studentEmail: 'sports.owner@stu.ui.edu.ng',
      passwordHash: SEED_PASSWORD_HASH,
      displayName: 'Ibrahim Musa',
      role: 'ORGANIZER',
      isVerifiedStudent: true,
      hall: 'Sultan Bello Hall',
      faculty: 'Education',
      level: '400L',
    },
  });
  const sportsManager = await prisma.user.create({
    data: {
      id: '10000000-0000-4000-8000-000000000006',
      email: 'sports.manager@stu.ui.edu.ng',
      studentEmail: 'sports.manager@stu.ui.edu.ng',
      passwordHash: SEED_PASSWORD_HASH,
      displayName: 'Kemi Balogun',
      role: 'ORGANIZER',
      isVerifiedStudent: true,
      hall: 'Obafemi Awolowo (Awo) Hall',
      faculty: 'Science',
      level: '300L',
    },
  });

  const sigmaOrg = await prisma.organizer.create({
    data: {
      id: '11111111-1111-4111-8111-111111111101',
      slug: 'sigma-club-ui',
      name: 'Sigma Club UI',
      bio: 'The oldest student philanthropic & social organization in Sub-Saharan Africa (Est. 1950). Hosts of Havana Night & Sigma Chief.',
      logoUrl: `${webOrigin}/demo/orgs/sigma-club-ui.webp`,
      isVerified: true,
      ownerId: sigmaOwner.id,
      followerCount: 2,
      members: {
        create: [
          { userId: sigmaOwner.id, role: 'OWNER' },
          { userId: sigmaManager.id, role: 'MANAGER' },
        ],
      },
    },
  });

  const theatreOrg = await prisma.organizer.create({
    data: {
      id: '11111111-1111-4111-8111-111111111102',
      slug: 'wole-soyinka-theatre',
      name: 'Wole Soyinka Theatre Troupe',
      bio: 'Stage plays, cultural nights, and spoken word showcases at the Department of Theatre Arts, University of Ibadan.',
      logoUrl: `${webOrigin}/demo/orgs/wole-soyinka-theatre.webp`,
      isVerified: true,
      ownerId: theatreOwner.id,
      followerCount: 1,
      members: {
        create: [
          { userId: theatreOwner.id, role: 'OWNER' },
          { userId: theatreManager.id, role: 'MANAGER' },
        ],
      },
    },
  });

  const sportsOrg = await prisma.organizer.create({
    data: {
      id: '11111111-1111-4111-8111-111111111103',
      slug: 'ui-sports-council',
      name: 'UI Inter-Hall Sports Council',
      bio: 'Official fixtures, Inter-Hall football finals, basketball courtside nights, and track meets at the UI New Stadium.',
      logoUrl: `${webOrigin}/demo/orgs/ui-sports-council.webp`,
      isVerified: true,
      ownerId: sportsOwner.id,
      followerCount: 1,
      members: {
        create: [
          { userId: sportsOwner.id, role: 'OWNER' },
          { userId: sportsManager.id, role: 'MANAGER' },
        ],
      },
    },
  });

  // 3. Creator profile (1 verified campus creator)
  const creatorUser = await prisma.user.create({
    data: {
      id: '77777777-7777-4777-8777-777777777700',
      email: 'bisola@stu.ui.edu.ng',
      studentEmail: 'bisola@stu.ui.edu.ng',
      passwordHash: SEED_PASSWORD_HASH,
      displayName: 'Bisola',
      avatarUrl: `${webOrigin}/demo/avatars/bisola.webp`,
      role: 'CREATOR',
      isVerifiedStudent: true,
      hall: 'Queen Elizabeth II Hall',
      faculty: 'Arts',
      level: '400L',
    },
  });

  const creatorProfile = await prisma.creatorProfile.create({
    data: {
      id: '77777777-7777-4777-8777-777777777701',
      userId: creatorUser.id,
      handle: 'bisola',
      displayName: 'Bisola',
      bio: 'Your next great night at UI. Music, culture, and campus connections.',
      instagramUrl: 'https://instagram.com/bisola.ui',
      tiktokUrl: 'https://tiktok.com/@bisola.ui',
      isVerified: true,
      followerCount: 1,
    },
  });

  // 4. Twelve Attendees across UI halls & faculties
  const attendeeSpecs = [
    {
      id: '44444444-4444-4444-8444-444444444401',
      email: 'tobi@stu.ui.edu.ng',
      displayName: 'Tobi Adeyemi',
      avatarUrl: `${webOrigin}/demo/avatars/tobi-adeyemi.webp`,
      isVerifiedStudent: true,
      hall: UI_HALLS[0],
      faculty: UI_FACULTIES[0],
      level: '300L',
    },
    {
      id: '44444444-4444-4444-8444-444444444402',
      email: 'adaeze@stu.ui.edu.ng',
      displayName: 'Adaeze Obi',
      avatarUrl: `${webOrigin}/demo/avatars/adaeze-obi.webp`,
      isVerifiedStudent: true,
      hall: UI_HALLS[5],
      faculty: UI_FACULTIES[1],
      level: '300L',
    },
    {
      id: '44444444-4444-4444-8444-444444444403',
      email: 'kunle@stu.ui.edu.ng',
      displayName: 'Kunle Bello',
      avatarUrl: `${webOrigin}/demo/avatars/kunle-bello.webp`,
      isVerifiedStudent: true,
      hall: UI_HALLS[0],
      faculty: UI_FACULTIES[0],
      level: '400L',
    },
    {
      id: '44444444-4444-4444-8444-444444444404',
      email: 'fisayo@stu.ui.edu.ng',
      displayName: 'Fisayo Ajayi',
      avatarUrl: `${webOrigin}/demo/avatars/fisayo-ajayi.webp`,
      isVerifiedStudent: true,
      hall: UI_HALLS[1],
      faculty: UI_FACULTIES[2],
      level: '200L',
    },
    {
      id: '44444444-4444-4444-8444-444444444405',
      email: 'zainab@stu.ui.edu.ng',
      displayName: 'Zainab Lawal',
      avatarUrl: null,
      isVerifiedStudent: true,
      hall: UI_HALLS[4],
      faculty: UI_FACULTIES[4],
      level: '300L',
    },
    {
      id: '44444444-4444-4444-8444-444444444406',
      email: 'chinedu@stu.ui.edu.ng',
      displayName: 'Chinedu Eze',
      avatarUrl: null,
      isVerifiedStudent: true,
      hall: UI_HALLS[7],
      faculty: UI_FACULTIES[5],
      level: '500L',
    },
    {
      id: '44444444-4444-4444-8444-444444444407',
      email: 'damilola@stu.ui.edu.ng',
      displayName: 'Damilola Ojo',
      avatarUrl: null,
      isVerifiedStudent: true,
      hall: UI_HALLS[8],
      faculty: UI_FACULTIES[3],
      level: '200L',
    },
    {
      id: '44444444-4444-4444-8444-444444444408',
      email: 'tunde@stu.ui.edu.ng',
      displayName: 'Tunde Bakare',
      avatarUrl: null,
      isVerifiedStudent: true,
      hall: UI_HALLS[2],
      faculty: UI_FACULTIES[1],
      level: '400L',
    },
    {
      id: '44444444-4444-4444-8444-444444444409',
      email: 'amina@stu.ui.edu.ng',
      displayName: 'Amina Yusuf',
      avatarUrl: null,
      isVerifiedStudent: true,
      hall: UI_HALLS[5],
      faculty: UI_FACULTIES[8],
      level: '300L',
    },
    {
      id: '44444444-4444-4444-8444-444444444410',
      email: 'segun@stu.ui.edu.ng',
      displayName: 'Segun Oladipo',
      avatarUrl: null,
      isVerifiedStudent: true,
      hall: UI_HALLS[3],
      faculty: UI_FACULTIES[6],
      level: '200L',
    },
    {
      id: '44444444-4444-4444-8444-444444444411',
      email: 'halima@stu.ui.edu.ng',
      displayName: 'Halima Ibrahim',
      avatarUrl: null,
      isVerifiedStudent: true,
      hall: UI_HALLS[9],
      faculty: UI_FACULTIES[7],
      level: '400L',
    },
    {
      id: '44444444-4444-4444-8444-444444444412',
      email: 'guest.bolu@example.com',
      displayName: 'Bolu Ogunleye',
      avatarUrl: null,
      isVerifiedStudent: false,
      hall: null,
      faculty: null,
      level: null,
    },
  ] as const;

  const attendees = [];
  for (const spec of attendeeSpecs) {
    const u = await prisma.user.create({
      data: {
        id: spec.id,
        email: spec.email,
        studentEmail: spec.isVerifiedStudent ? spec.email : null,
        passwordHash: SEED_PASSWORD_HASH,
        displayName: spec.displayName,
        avatarUrl: spec.avatarUrl,
        role: 'ATTENDEE',
        isVerifiedStudent: spec.isVerifiedStudent,
        hall: spec.hall,
        faculty: spec.faculty,
        level: spec.level,
      },
    });
    attendees.push(u);
  }

  const tobi = attendees[0]!;
  const adaeze = attendees[1]!;
  const kunle = attendees[2]!;
  const fisayo = attendees[3]!;
  const zainab = attendees[4]!;
  const damilola = attendees[6]!;
  const tunde = attendees[7]!;
  const amina = attendees[8]!;

  await prisma.personaProfile.create({
    data: {
      userId: tobi.id,
      interestTags: ['Parties & nightlife', 'Concerts & live music', 'Sports & matches'],
      goingOutRhythm: 'WEEKENDS',
      freeOnly: true,
      personaLabel: 'Night Owl',
      completedAt: new Date(),
    },
  });

  // Friendships (mutual accepted + 1 incoming pending request)
  await prisma.friendship.createMany({
    data: [
      { requesterId: tobi.id, addresseeId: adaeze.id, status: 'ACCEPTED' },
      { requesterId: kunle.id, addresseeId: tobi.id, status: 'ACCEPTED' },
      { requesterId: tobi.id, addresseeId: fisayo.id, status: 'ACCEPTED' },
      { requesterId: zainab.id, addresseeId: tobi.id, status: 'ACCEPTED' },
      { requesterId: damilola.id, addresseeId: tobi.id, status: 'PENDING' },
      { requesterId: adaeze.id, addresseeId: amina.id, status: 'ACCEPTED' },
      { requesterId: kunle.id, addresseeId: tunde.id, status: 'ACCEPTED' },
    ],
  });

  // Follows
  await prisma.follow.createMany({
    data: [
      { userId: tobi.id, organizerId: sigmaOrg.id },
      { userId: adaeze.id, organizerId: sigmaOrg.id },
      { userId: adaeze.id, organizerId: theatreOrg.id },
      { userId: kunle.id, organizerId: sportsOrg.id },
    ],
  });
  await prisma.creatorFollow.create({
    data: { userId: tobi.id, creatorId: creatorProfile.id },
  });

  // 5. Published events covering all 4 v1 templates + linked after-party
  const now = Date.now();
  const hour = 3_600_000;

  const havanaEvent = await prisma.event.create({
    data: {
      id: '22222222-2222-4222-8222-222222222201',
      slug: 'havana-night-sub-field',
      title: 'Sigma Havana Night: Neon Pulse Edition',
      description:
        'The flagship open-air concert and night market at SUB Field. Live Afrobeats sets, campus DJs, food stalls, and fast offline QR check-in at Gate A & Gate B.',
      category: 'SOCIAL_PARTY',
      status: 'PUBLISHED',
      template: 'CONCERT_PARTY',
      tonightMood: 'TURN_UP',
      startsAt: new Date(now + 2 * hour),
      endsAt: new Date(now + 6 * hour),
      venueName: 'SUB Main Field, University of Ibadan',
      venueDetail:
        'Enter via Student Union Building main gate opposite Queen Elizabeth II Hall. Gate A handles Verified Student QR Passes; Gate B handles Open RSVPs.',
      coverImageUrl: `${webOrigin}/demo/events/havana-night-sub-field.webp`,
      capacity: 500,
      rsvpCount: 3,
      studentsOnly: false,
      waitlistEnabled: true,
      dressCode: 'Touch of Lavender or Neon Streetwear',
      doorPolicy:
        'Doors open at 7:00 PM WAT. Have your offline QR pass ready before reaching the SUB perimeter check.',
      organizerId: sigmaOrg.id,
      lineupItems: {
        create: [
          {
            roleType: 'LINEUP',
            displayName: 'DJ Spinz UI',
            roleLabel: 'Opening Deck Set',
            setTime: '7:30 PM',
            sortOrder: 0,
          },
          {
            roleType: 'LINEUP',
            displayName: 'MC Bisola',
            roleLabel: 'Host & Crowd Control',
            setTime: '8:30 PM',
            sortOrder: 1,
            creatorId: creatorProfile.id,
          },
          {
            roleType: 'LINEUP',
            displayName: 'Tolu & The Pulse Collective',
            roleLabel: 'Headliner Live Band',
            setTime: '9:30 PM',
            sortOrder: 2,
          },
        ],
      },
    },
  });

  const matchEvent = await prisma.event.create({
    data: {
      id: '22222222-2222-4222-8222-222222222202',
      slug: 'mellanby-vs-tedder-interhall-final',
      title: 'Inter-Hall Football Final: Mellanby vs Tedder',
      description:
        'Under the floodlights at the UI New Stadium. Can Mellanby defend the title against Tedder Hall? Free entry with instant courtside RSVP.',
      category: 'SPORTS_RECREATION',
      status: 'PUBLISHED',
      template: 'MATCH_TOURNAMENT',
      tonightMood: 'WATCH_GAME',
      startsAt: new Date(now + 1 * hour),
      endsAt: new Date(now + 3 * hour),
      venueName: 'UI New Stadium Complex (Awo Pitch)',
      venueDetail:
        'Home stands (West) reserved for Mellanby & Kuti; East stands for Tedder & Indy.',
      coverImageUrl: `${webOrigin}/demo/events/mellanby-vs-tedder-interhall-final.webp`,
      capacity: 800,
      rsvpCount: 2,
      studentsOnly: false,
      waitlistEnabled: true,
      organizerId: sportsOrg.id,
      fixture: {
        create: {
          homeTeamName: 'Mellanby Hall',
          awayTeamName: 'Tedder Hall',
          homeScore: 2,
          awayScore: 1,
          isLive: true,
          statusLabel: "LIVE · 68'",
        },
      },
    },
  });

  const playEvent = await prisma.event.create({
    data: {
      id: '22222222-2222-4222-8222-222222222203',
      slug: 'lion-and-the-jewel-stage',
      title: 'The Lion & The Jewel: Command Stage Adaptation',
      description:
        'An immersive candlelight stage production by the Department of Theatre Arts featuring live bata percussion and contemporary choreography.',
      category: 'PERFORMANCE_ARTS',
      status: 'PUBLISHED',
      template: 'PLAY_CULTURAL',
      tonightMood: 'CHILL',
      startsAt: new Date(now + 3 * hour),
      endsAt: new Date(now + 5 * hour),
      venueName: 'Wole Soyinka Arts Theatre',
      venueDetail:
        'Doors close strictly 10 minutes after curtain call. Pick your preferred showtime below.',
      coverImageUrl: `${webOrigin}/demo/events/lion-and-the-jewel-stage.webp`,
      capacity: 220,
      rsvpCount: 1,
      studentsOnly: false,
      waitlistEnabled: true,
      dressCode: 'Smart Traditional or Dark Casual',
      organizerId: theatreOrg.id,
      showtimes: {
        create: [
          {
            id: '22222222-2222-4222-8222-222222222301',
            label: '6:00 PM · Opening Curtain',
            startsAt: new Date(now + 3 * hour),
            endsAt: new Date(now + 4.5 * hour),
            capacity: 110,
            rsvpCount: 1,
          },
          {
            id: '22222222-2222-4222-8222-222222222302',
            label: '8:30 PM · Encore Night',
            startsAt: new Date(now + 5.5 * hour),
            endsAt: new Date(now + 7 * hour),
            capacity: 110,
            rsvpCount: 0,
          },
        ],
      },
      lineupItems: {
        create: [
          {
            roleType: 'CAST_CREW',
            displayName: 'Directed by Dr. Ayoade & Damilola O.',
            roleLabel: 'Director',
            sortOrder: 0,
          },
          {
            roleType: 'CAST_CREW',
            displayName: 'Lead Cast: Zainab Bello (Sidi), Chinedu Eze (Lakunle)',
            roleLabel: 'Cast',
            sortOrder: 1,
          },
          {
            roleType: 'CAST_CREW',
            displayName: 'Live Percussion: Heritage Drum Ensemble',
            roleLabel: 'Music',
            sortOrder: 2,
          },
        ],
      },
    },
  });

  await prisma.event.create({
    data: {
      id: '22222222-2222-4222-8222-222222222204',
      slug: 'ui-ai-and-systems-summit',
      title: 'Building Offline-First Products for African Campuses',
      description:
        'Hands-on engineering workshop & founder panel on Web Crypto, IndexedDB sync, and resilient mobile UX. Refreshments provided.',
      category: 'ACADEMIC_CONFERENCE',
      status: 'PUBLISHED',
      template: 'GENERIC',
      tonightMood: 'LEARN',
      startsAt: new Date(now + 24 * hour),
      endsAt: new Date(now + 27 * hour),
      venueName: 'Trenchard Hall, University of Ibadan',
      venueDetail:
        'Bring your laptop; local Wi-Fi hub and offline starter packs available at check-in.',
      coverImageUrl: `${webOrigin}/demo/events/ui-ai-and-systems-summit.webp`,
      capacity: 300,
      rsvpCount: 0,
      studentsOnly: true,
      waitlistEnabled: true,
      organizerId: sigmaOrg.id,
    },
  });

  await prisma.event.create({
    data: {
      id: '22222222-2222-4222-8222-222222222205',
      slug: 'havana-official-afterparty-zik',
      title: 'Havana Official After-Party: Zik Hall Lounge',
      description:
        'Keep your night going after SUB Field wraps! Linked directly to Sigma Havana Night—attendees checked in at the main concert get priority lane access.',
      category: 'CLUB_SOCIETY',
      status: 'PUBLISHED',
      template: 'CONCERT_PARTY',
      tonightMood: 'TURN_UP',
      startsAt: new Date(now + 5.5 * hour),
      endsAt: new Date(now + 8.5 * hour),
      venueName: 'Zik Hall Senior Common Room',
      venueDetail: 'Priority entry lane for guests holding a scanned Havana Night QR pass.',
      coverImageUrl: `${webOrigin}/demo/events/havana-official-afterparty-zik.webp`,
      capacity: 150,
      rsvpCount: 0,
      studentsOnly: true,
      waitlistEnabled: true,
      doorPolicy: 'Priority lane for guests checked in at Sigma Havana Night (SUB Field).',
      parentEventId: havanaEvent.id,
      linkType: 'AFTER_PARTY',
      parentLinkApproved: true,
      afterPartyAccess: 'PRIORITY_CHECKED_IN',
      organizerId: sigmaOrg.id,
    },
  });

  // Ambassador link for Bisola on Havana Night
  await prisma.ambassadorLink.create({
    data: {
      creatorId: creatorProfile.id,
      eventId: havanaEvent.id,
      code: 'bisola-havana',
      clickCount: 24,
      rsvpCount: 1,
    },
  });

  // Seeded friend RSVPs so Tobi sees mutual friendsGoing on the feed immediately
  const seededRsvps = [
    {
      id: '33333333-3333-4333-8333-333333333301',
      eventId: havanaEvent.id,
      userId: adaeze.id,
    },
    {
      id: '33333333-3333-4333-8333-333333333302',
      eventId: havanaEvent.id,
      userId: kunle.id,
    },
    {
      id: '33333333-3333-4333-8333-333333333303',
      eventId: havanaEvent.id,
      userId: fisayo.id,
    },
    {
      id: '33333333-3333-4333-8333-333333333304',
      eventId: matchEvent.id,
      userId: adaeze.id,
    },
    {
      id: '33333333-3333-4333-8333-333333333305',
      eventId: matchEvent.id,
      userId: kunle.id,
    },
    {
      id: '33333333-3333-4333-8333-333333333306',
      eventId: playEvent.id,
      userId: adaeze.id,
      showtimeId: '22222222-2222-4222-8222-222222222301',
    },
  ];
  await prisma.rsvp.createMany({
    data: seededRsvps.map((r) => ({
      id: r.id,
      eventId: r.eventId,
      userId: r.userId,
      showtimeId: r.showtimeId ?? null,
      status: 'CONFIRMED',
      qrToken: signSeedQrToken({
        rsvpId: r.id,
        eventId: r.eventId,
        ...(r.showtimeId ? { showtimeId: r.showtimeId } : {}),
      }),
    })),
  });

  // Active 24h stories
  await prisma.story.createMany({
    data: [
      {
        organizerId: sigmaOrg.id,
        eventId: havanaEvent.id,
        mediaUrl: `${webOrigin}/demo/stories/havana-soundcheck.webp`,
        mediaType: 'IMAGE',
        caption: 'Gate A & Gate B scanners are synced for Havana Night!',
        expiresAt: new Date(now + 20 * hour),
      },
      {
        organizerId: sportsOrg.id,
        eventId: matchEvent.id,
        mediaUrl: `${webOrigin}/demo/stories/stadium-goal.webp`,
        mediaType: 'IMAGE',
        caption: 'Floodlights are electric at the UI New Stadium. Mellanby leads 2–1!',
        expiresAt: new Date(now + 21 * hour),
      },
      {
        organizerId: theatreOrg.id,
        eventId: playEvent.id,
        mediaUrl: `${webOrigin}/demo/stories/theatre-backstage.webp`,
        mediaType: 'IMAGE',
        caption: 'Backstage at Wole Soyinka Arts Theatre before opening curtain.',
        expiresAt: new Date(now + 18 * hour),
      },
    ],
  });

  // Initial notification for Tobi
  await prisma.notification.create({
    data: {
      userId: tobi.id,
      category: 'FOLLOWED_POST',
      title: 'Sigma Club UI posted a new night',
      body: 'Sigma Havana Night: Neon Pulse Edition is live at SUB Main Field.',
      linkUrl: '/e/havana-night-sub-field',
    },
  });
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    await seedDatabase(prisma);
    process.stdout.write('CampusPulse database seeded successfully.\n');
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    process.stderr.write(`Seed failed: ${String(error)}\n`);
    process.exit(1);
  });
}
