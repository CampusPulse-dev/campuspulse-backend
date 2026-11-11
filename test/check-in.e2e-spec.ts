import { createHash } from 'node:crypto';
import {
  asUser,
  bodyOf,
  createTestApp,
  truncateDatabase,
  type BootstrappedTestApp,
} from './utils/app';
import type {
  AmbassadorLinkResponse,
  CheckInBatchResponse,
  CheckInResponse,
  CreateRsvpResponse,
  DoorStaffGrantResponse,
  EventPublic,
  EventStatsResponse,
  RosterResponse,
  ScannerPackResponse,
} from '../src/contract';

describe('Check-In, Scanner Pack, Roster CSV, Door Staff & Stats (e2e) [S3-02]', () => {
  let ctx: BootstrappedTestApp;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  beforeEach(async () => {
    await truncateDatabase(ctx.prisma);
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function setupVerifiedClubWithEvent() {
    const owner = await ctx.prisma.user.create({
      data: {
        email: 'club.owner@stu.ui.edu.ng',
        studentEmail: 'club.owner@stu.ui.edu.ng',
        passwordHash: 'dev-auth-placeholder',
        displayName: 'Club Owner',
        role: 'ORGANIZER',
        isVerifiedStudent: true,
      },
    });
    const manager = await ctx.prisma.user.create({
      data: {
        email: 'club.manager@stu.ui.edu.ng',
        studentEmail: 'club.manager@stu.ui.edu.ng',
        passwordHash: 'dev-auth-placeholder',
        displayName: 'Club Manager',
        role: 'ORGANIZER',
        isVerifiedStudent: true,
      },
    });

    const organizer = await ctx.prisma.organizer.create({
      data: {
        slug: 'sigma-club-checkin',
        name: 'Sigma Club Check-In',
        isVerified: true,
        ownerId: owner.id,
        members: {
          create: [
            { userId: owner.id, role: 'OWNER' },
            { userId: manager.id, role: 'MANAGER' },
          ],
        },
      },
    });

    const startsAt = new Date(Date.now() + 2 * 3_600_000);
    const endsAt = new Date(Date.now() + 6 * 3_600_000);

    const createRes = await asUser(ctx.app, owner.email)
      .post('/events')
      .send({
        organizerId: organizer.id,
        title: 'Havana Gate Test Night',
        description: 'Offline resilient multi-door check-in test event.',
        category: 'SOCIAL_PARTY',
        template: 'CONCERT_PARTY',
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        venueName: 'SUB Main Field',
        coverImageUrl: 'https://cdn.campuspulse.ng/covers/havana.webp',
        capacity: 100,
      })
      .expect(201);
    const draft = bodyOf<EventPublic>(createRes);

    const pubRes = await asUser(ctx.app, owner.email)
      .post(`/events/${draft.id}/publish`)
      .expect(200);
    const event = bodyOf<EventPublic>(pubRes);

    return { owner, manager, organizer, event, startsAt, endsAt };
  }

  it('grants door staff access expiring at endsAt + 4h (OWNER only), serves scanner-pack, and returns 403 to door staff on roster CSV', async () => {
    const { owner, manager, event, endsAt } = await setupVerifiedClubWithEvent();

    const attendee = await ctx.prisma.user.create({
      data: {
        email: 'tobi@stu.ui.edu.ng',
        studentEmail: 'tobi@stu.ui.edu.ng',
        passwordHash: 'dev-auth-placeholder',
        displayName: '=Tobi "Pulse" Adeyemi',
        isVerifiedStudent: true,
        hall: 'Mellanby Hall',
        faculty: 'Technology',
      },
    });

    const rsvpRes = await asUser(ctx.app, attendee.email)
      .post('/attendance/rsvps')
      .send({ eventId: event.id })
      .expect(201);
    const rsvp = bodyOf<CreateRsvpResponse>(rsvpRes);

    // Manager and stranger cannot grant door-staff access; only Club OWNER can
    await asUser(ctx.app, manager.email)
      .post(`/events/${event.id}/door-staff`)
      .send({ email: 'gate.a@stu.ui.edu.ng' })
      .expect(403);

    await asUser(ctx.app, attendee.email)
      .post(`/events/${event.id}/door-staff`)
      .send({ email: 'gate.a@stu.ui.edu.ng' })
      .expect(403);

    const grantRes = await asUser(ctx.app, owner.email)
      .post(`/events/${event.id}/door-staff`)
      .send({ email: 'gate.a@stu.ui.edu.ng' })
      .expect(201);
    const grant = bodyOf<DoorStaffGrantResponse>(grantRes);

    expect(grant.eventId).toBe(event.id);
    expect(grant.emailHint).toBe('g***@stu.ui.edu.ng');
    expect(JSON.stringify(grant)).not.toContain('gate.a@stu.ui.edu.ng');
    expect(new Date(grant.expiresAt).getTime()).toBe(endsAt.getTime() + 4 * 3_600_000);

    // Door staff CAN fetch minimal scanner-pack (publicKey + qrTokenDigest, zero emails)
    const packRes = await asUser(ctx.app, 'gate.a@stu.ui.edu.ng')
      .get(`/attendance/events/${event.id}/scanner-pack`)
      .expect(200);
    const pack = bodyOf<ScannerPackResponse>(packRes);

    expect(pack.eventId).toBe(event.id);
    expect(pack.publicKey.length).toBeGreaterThanOrEqual(40);
    expect(pack.eventTitle).toBe(event.title);
    expect(pack.roster).toHaveLength(1);
    expect(pack.roster[0]).toEqual({
      rsvpId: rsvp.id,
      displayName: attendee.displayName,
      isVerifiedStudent: true,
      qrTokenDigest: createHash('sha256').update(rsvp.qrToken).digest('hex'),
      checkedInAt: null,
    });
    expect(JSON.stringify(pack)).not.toContain(attendee.email);

    // Door staff get 403 on full roster JSON, ?format=csv, Accept: text/csv, and stats
    await asUser(ctx.app, 'gate.a@stu.ui.edu.ng')
      .get(`/attendance/events/${event.id}/roster`)
      .expect(403);

    await asUser(ctx.app, 'gate.a@stu.ui.edu.ng')
      .get(`/attendance/events/${event.id}/roster?format=csv`)
      .expect(403);

    await asUser(ctx.app, 'gate.a@stu.ui.edu.ng')
      .get(`/attendance/events/${event.id}/roster`)
      .set('Accept', 'text/csv')
      .expect(403);

    await asUser(ctx.app, 'gate.a@stu.ui.edu.ng')
      .get(`/attendance/events/${event.id}/stats`)
      .expect(403);

    // Club Manager & Owner CAN fetch full roster JSON and CSV (with formula-injection protection)
    const rosterJsonRes = await asUser(ctx.app, manager.email)
      .get(`/attendance/events/${event.id}/roster`)
      .expect(200);
    const rosterJson = bodyOf<RosterResponse>(rosterJsonRes);
    expect(rosterJson.items).toHaveLength(1);
    expect(rosterJson.items[0]?.rsvpId).toBe(rsvp.id);

    const csvRes = await asUser(ctx.app, owner.email)
      .get(`/attendance/events/${event.id}/roster?format=csv`)
      .expect(200);
    expect(csvRes.headers['content-type']).toContain('text/csv');
    expect(csvRes.text).toContain('rsvpId,displayName,badge,hall,faculty,status');
    // Leading '=' must be neutralized with a single quote and quotes doubled per RFC 4180
    expect(csvRes.text).toContain('"\'=Tobi ""Pulse"" Adeyemi"');

    // Once grant expires, scanner-pack also returns 403
    await ctx.prisma.doorStaffGrant.update({
      where: { id: grant.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    await asUser(ctx.app, 'gate.a@stu.ui.edu.ng')
      .get(`/attendance/events/${event.id}/scanner-pack`)
      .expect(403);
  });

  it('is idempotent on offline batch replay, flags multi-door duplicates, preserves client scannedAt, and tracks stats + ambassador check-ins once', async () => {
    const { owner, event } = await setupVerifiedClubWithEvent();

    // Grant Gate A and Gate B door staff
    await asUser(ctx.app, owner.email)
      .post(`/events/${event.id}/door-staff`)
      .send({ email: 'gate.a@stu.ui.edu.ng' })
      .expect(201);
    await asUser(ctx.app, owner.email)
      .post(`/events/${event.id}/door-staff`)
      .send({ email: 'gate.b@stu.ui.edu.ng' })
      .expect(201);

    // Verified creator generates ambassador link
    const creatorUser = await ctx.prisma.user.create({
      data: {
        email: 'bisola@stu.ui.edu.ng',
        studentEmail: 'bisola@stu.ui.edu.ng',
        passwordHash: 'dev-auth-placeholder',
        displayName: 'Bisola',
        role: 'CREATOR',
        isVerifiedStudent: true,
      },
    });
    await ctx.prisma.creatorProfile.create({
      data: {
        userId: creatorUser.id,
        handle: 'bisola',
        displayName: 'Bisola',
        isVerified: true,
      },
    });
    const linkRes = await asUser(ctx.app, creatorUser.email)
      .post('/attendance/ambassador-links')
      .send({ eventId: event.id })
      .expect(201);
    const link = bodyOf<AmbassadorLinkResponse>(linkRes);

    // Two attendees RSVP (one via ambassador link, one regular for manual check-in)
    const rsvp1Res = await asUser(ctx.app, 'adaeze@stu.ui.edu.ng')
      .post('/attendance/rsvps')
      .send({ eventId: event.id, ambassadorCode: link.code })
      .expect(201);
    const rsvp1 = bodyOf<CreateRsvpResponse>(rsvp1Res);

    const rsvp2Res = await asUser(ctx.app, 'kunle@stu.ui.edu.ng')
      .post('/attendance/rsvps')
      .send({ eventId: event.id })
      .expect(201);
    const rsvp2 = bodyOf<CreateRsvpResponse>(rsvp2Res);

    const gateAScanTime = '2026-11-10T19:05:00.000Z';
    const manualScanTime = '2026-11-10T19:06:30.000Z';
    const gateBDuplicateTime = '2026-11-10T19:07:15.000Z';

    const batchPayload = {
      checkIns: [
        {
          eventId: event.id,
          qrToken: rsvp1.qrToken,
          method: 'QR_SCAN' as const,
          scannedAt: gateAScanTime,
        },
        {
          eventId: event.id,
          rsvpId: rsvp2.id,
          method: 'MANUAL' as const,
          scannedAt: manualScanTime,
        },
      ],
    };

    // First sync from Gate A
    const batch1Res = await asUser(ctx.app, 'gate.a@stu.ui.edu.ng')
      .post('/attendance/check-in/batch')
      .send(batchPayload)
      .expect(200);
    const batch1 = bodyOf<CheckInBatchResponse>(batch1Res);

    expect(batch1.results).toHaveLength(2);
    expect(batch1.results[0]?.duplicate).toBe(false);
    expect(batch1.results[0]?.checkIn.checkedInAt).toBe(gateAScanTime);
    expect(batch1.results[1]?.duplicate).toBe(false);
    expect(batch1.results[1]?.checkIn.checkedInAt).toBe(manualScanTime);

    // Exact network retry of the same batch from Gate A -> 100% idempotent
    const batchRetryRes = await asUser(ctx.app, 'gate.a@stu.ui.edu.ng')
      .post('/attendance/check-in/batch')
      .send(batchPayload)
      .expect(200);
    const batchRetry = bodyOf<CheckInBatchResponse>(batchRetryRes);

    expect(batchRetry.results[0]?.checkIn.id).toBe(batch1.results[0]?.checkIn.id);
    expect(batchRetry.results[0]?.duplicate).toBe(false);
    expect(batchRetry.results[1]?.checkIn.id).toBe(batch1.results[1]?.checkIn.id);
    expect(batchRetry.results[1]?.duplicate).toBe(false);

    // Gate B scans rsvp1 again across doors -> recorded & surfaced as duplicate: true, never double-counted
    const gateBRes = await asUser(ctx.app, 'gate.b@stu.ui.edu.ng')
      .post('/attendance/check-in')
      .send({
        eventId: event.id,
        qrToken: rsvp1.qrToken,
        method: 'QR_SCAN',
        scannedAt: gateBDuplicateTime,
      })
      .expect(201);
    const gateBScan = bodyOf<CheckInResponse>(gateBRes);

    expect(gateBScan.duplicate).toBe(true);
    expect(gateBScan.checkIn.isDuplicate).toBe(true);
    expect(gateBScan.checkIn.checkedInAt).toBe(gateBDuplicateTime);

    // Stats verify exact headcount, conversionRate, duplicateScanCount, manualCheckInCount, and ambassador checkInCount
    const statsRes = await asUser(ctx.app, owner.email)
      .get(`/attendance/events/${event.id}/stats`)
      .expect(200);
    const stats = bodyOf<EventStatsResponse>(statsRes);

    expect(stats).toEqual({
      eventId: event.id,
      rsvpCount: 2,
      checkInCount: 2,
      conversionRate: 1,
      duplicateScanCount: 1,
      manualCheckInCount: 1,
    });

    const updatedLink = await ctx.prisma.ambassadorLink.findUniqueOrThrow({
      where: { id: link.id },
    });
    expect(updatedLink.rsvpCount).toBe(1);
    expect(updatedLink.checkInCount).toBe(1);
  });

  it('enforces CHECKED_IN_ONLY at linked after-party doors until checked in at the parent event', async () => {
    const { owner, organizer, event: parentEvent, endsAt } = await setupVerifiedClubWithEvent();

    // Create linked after-party initially OPEN so attendee RSVPs ahead of time, then tighten to CHECKED_IN_ONLY
    const apDraftRes = await asUser(ctx.app, owner.email)
      .post('/events')
      .send({
        organizerId: organizer.id,
        title: 'Zik VIP After-Party',
        description: 'Gated after-party.',
        category: 'CLUB_SOCIETY',
        startsAt: endsAt.toISOString(),
        endsAt: new Date(endsAt.getTime() + 3 * 3_600_000).toISOString(),
        venueName: 'Zik SCR',
        coverImageUrl: 'https://cdn.campuspulse.ng/covers/ap.webp',
        parentEventId: parentEvent.id,
        linkType: 'AFTER_PARTY',
        afterPartyAccess: 'OPEN',
      })
      .expect(201);
    const apDraft = bodyOf<EventPublic>(apDraftRes);

    await asUser(ctx.app, owner.email).post(`/events/${apDraft.id}/publish`).expect(200);

    const parentRsvpRes = await asUser(ctx.app, 'guest@stu.ui.edu.ng')
      .post('/attendance/rsvps')
      .send({ eventId: parentEvent.id })
      .expect(201);
    const parentRsvp = bodyOf<CreateRsvpResponse>(parentRsvpRes);

    const apRsvpRes = await asUser(ctx.app, 'guest@stu.ui.edu.ng')
      .post('/attendance/rsvps')
      .send({ eventId: apDraft.id })
      .expect(201);
    const apRsvp = bodyOf<CreateRsvpResponse>(apRsvpRes);

    // Host tightens door rule to CHECKED_IN_ONLY before after-party doors open
    await asUser(ctx.app, owner.email)
      .patch(`/events/${apDraft.id}`)
      .send({ afterPartyAccess: 'CHECKED_IN_ONLY' })
      .expect(200);

    // Trying to check in at the after-party door BEFORE checking in at parent -> 403
    await asUser(ctx.app, owner.email)
      .post('/attendance/check-in')
      .send({
        eventId: apDraft.id,
        qrToken: apRsvp.qrToken,
        method: 'QR_SCAN',
        scannedAt: new Date().toISOString(),
      })
      .expect(403);

    // Check in at parent event -> 201
    await asUser(ctx.app, owner.email)
      .post('/attendance/check-in')
      .send({
        eventId: parentEvent.id,
        qrToken: parentRsvp.qrToken,
        method: 'QR_SCAN',
        scannedAt: new Date().toISOString(),
      })
      .expect(201);

    // Now after-party check-in succeeds -> 201
    await asUser(ctx.app, owner.email)
      .post('/attendance/check-in')
      .send({
        eventId: apDraft.id,
        qrToken: apRsvp.qrToken,
        method: 'QR_SCAN',
        scannedAt: new Date().toISOString(),
      })
      .expect(201);
  });
});
