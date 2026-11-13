import { seedDatabase } from '../prisma/seed';
import type {
  CreatorPublic,
  EventPublic,
  FeedResponse,
  FollowCreatorResponse,
  FollowOrganizerResponse,
  MediaUploadUrlResponse,
  OrganizerPublic,
  StoriesResponse,
  Story,
} from '../src/contract';
import {
  anon,
  asUser,
  bodyOf,
  createTestApp,
  truncateDatabase,
  type BootstrappedTestApp,
} from './utils/app';

describe('Stories, media upload URLs, follows & public profiles (S2-02)', () => {
  let ctx: BootstrappedTestApp;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  beforeEach(async () => {
    await truncateDatabase(ctx.prisma);
    await seedDatabase(ctx.prisma);
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('issues presigned S3/MinIO upload URLs for authenticated users and rejects unauthenticated requests', async () => {
    await anon(ctx.app)
      .post('/media/upload-url')
      .send({ purpose: 'STORY_MEDIA', contentType: 'image/webp', size: 120_000 })
      .expect(401);

    const res = await asUser(ctx.app, 'sigma.owner@stu.ui.edu.ng')
      .post('/media/upload-url')
      .send({ purpose: 'STORY_MEDIA', contentType: 'image/webp', size: 120_000 })
      .expect(201);

    const data = bodyOf<MediaUploadUrlResponse>(res);
    expect(data.uploadUrl).toContain('X-Amz-Signature=');
    expect(data.publicUrl).toContain(data.key);
    expect(data.expiresIn).toBeGreaterThan(0);
  });

  it('enforces server-side 24h story expiry, hides expired stories, groups by organizer with followed first, and enforces delete permissions', async () => {
    // Post a newer story from UI Sports Council (which Tobi does NOT follow)
    const sportsStoryRes = await asUser(ctx.app, 'sports.owner@stu.ui.edu.ng')
      .post('/stories')
      .send({
        eventId: '22222222-2222-4222-8222-222222222202',
        mediaUrl: 'https://images.unsplash.com/photo-1574629810360-7efbbe195018',
        mediaType: 'IMAGE',
        caption: 'Warmups underway at New Stadium!',
      })
      .expect(201);

    const createdStory = bodyOf<Story>(sportsStoryRes);
    const ttlMs = Date.parse(createdStory.expiresAt) - Date.parse(createdStory.createdAt);
    expect(ttlMs).toBeGreaterThan(23.9 * 3600_000);
    expect(ttlMs).toBeLessThanOrEqual(24.1 * 3600_000);

    // Insert an already-expired story directly in DB to verify it never leaks
    const expiredStory = await ctx.prisma.story.create({
      data: {
        organizerId: '11111111-1111-4111-8111-111111111101',
        mediaUrl: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819',
        mediaType: 'IMAGE',
        caption: 'Yesterday expired clip',
        createdAt: new Date(Date.now() - 30 * 3600_000),
        expiresAt: new Date(Date.now() - 6 * 3600_000),
      },
    });

    // Tobi follows Sigma Club UI (11111111-1111-4111-8111-111111111101), not Sports Council.
    // Even though Sports Council just posted a newer story, Sigma Club UI must appear FIRST!
    const tobiStoriesRes = await asUser(ctx.app, 'tobi@stu.ui.edu.ng').get('/stories').expect(200);
    const tobiStories = bodyOf<StoriesResponse>(tobiStoriesRes);

    expect(tobiStories.items.some((s) => s.id === expiredStory.id)).toBe(false);
    expect(tobiStories.groups).toBeDefined();
    expect(tobiStories.groups![0]?.organizer.slug).toBe('sigma-club-ui');
    expect(tobiStories.groups![0]?.following).toBe(true);
    expect(tobiStories.items[0]?.organizer.slug).toBe('sigma-club-ui');

    // Non-member cannot delete Sports Council's story
    await asUser(ctx.app, 'tobi@stu.ui.edu.ng').delete(`/stories/${createdStory.id}`).expect(403);

    // Sports manager can delete it
    await asUser(ctx.app, 'sports.manager@stu.ui.edu.ng')
      .delete(`/stories/${createdStory.id}`)
      .expect(204);

    const afterDelete = bodyOf<StoriesResponse>(await anon(ctx.app).get('/stories').expect(200));
    expect(afterDelete.items.some((s) => s.id === createdStory.id)).toBe(false);
  });

  it('blocks unverified organizers from posting stories', async () => {
    const u = await ctx.prisma.user.create({
      data: {
        email: 'unverified.story@stu.ui.edu.ng',
        passwordHash: 'dev-only',
        displayName: 'Unverified Host',
        role: 'ORGANIZER',
      },
    });
    await ctx.prisma.organizer.create({
      data: {
        slug: 'unverified-story-club',
        name: 'Unverified Story Club',
        isVerified: false,
        ownerId: u.id,
        members: { create: { userId: u.id, role: 'OWNER' } },
      },
    });

    await asUser(ctx.app, 'unverified.story@stu.ui.edu.ng')
      .post('/stories')
      .send({
        mediaUrl: 'https://images.unsplash.com/photo-1492684223066-81342ee5ff30',
        mediaType: 'IMAGE',
        caption: 'Should be rejected',
      })
      .expect(403);
  });

  it('maintains transactional, idempotent followerCount on organizer and creator follow/unfollow', async () => {
    const theatreId = '11111111-1111-4111-8111-111111111102';
    const creatorId = '77777777-7777-4777-8777-777777777701';

    // Seed has 1 follower on theatreOrg (adaeze). Tobi follows twice -> count becomes 2 (idempotent).
    const f1 = bodyOf<FollowOrganizerResponse>(
      await asUser(ctx.app, 'tobi@stu.ui.edu.ng')
        .post(`/organizers/${theatreId}/follow`)
        .expect(200),
    );
    expect(f1).toEqual({ organizerId: theatreId, following: true, followerCount: 2 });

    const f2 = bodyOf<FollowOrganizerResponse>(
      await asUser(ctx.app, 'tobi@stu.ui.edu.ng')
        .post(`/organizers/${theatreId}/follow`)
        .expect(200),
    );
    expect(f2.followerCount).toBe(2);

    const uf = bodyOf<FollowOrganizerResponse>(
      await asUser(ctx.app, 'tobi@stu.ui.edu.ng')
        .delete(`/organizers/${theatreId}/follow`)
        .expect(200),
    );
    expect(uf).toEqual({ organizerId: theatreId, following: false, followerCount: 1 });

    // Seed has 1 follower on Bisola (tobi). Adaeze follows -> count becomes 2, unfollows -> 1.
    const cf = bodyOf<FollowCreatorResponse>(
      await asUser(ctx.app, 'adaeze@stu.ui.edu.ng')
        .post(`/creators/${creatorId}/follow`)
        .expect(200),
    );
    expect(cf).toEqual({ creatorId, following: true, followerCount: 2 });

    const cuf = bodyOf<FollowCreatorResponse>(
      await asUser(ctx.app, 'adaeze@stu.ui.edu.ng')
        .delete(`/creators/${creatorId}/follow`)
        .expect(200),
    );
    expect(cuf).toEqual({ creatorId, following: false, followerCount: 1 });
  });

  it('serves public organizer profile, organizer published events, and creator profile by handle', async () => {
    const orgRes = await anon(ctx.app).get('/organizers/sigma-club-ui').expect(200);
    expect(bodyOf<OrganizerPublic>(orgRes)).toMatchObject({
      slug: 'sigma-club-ui',
      name: 'Sigma Club UI',
      isVerified: true,
    });

    await anon(ctx.app).get('/organizers/non-existent-club').expect(404);

    // Create a DRAFT event under Sigma Club UI to prove /organizers/:slug/events never leaks drafts
    const draftRes = await asUser(ctx.app, 'sigma.owner@stu.ui.edu.ng')
      .post('/events')
      .send({
        title: 'Secret Sigma Draft',
        description: 'Not published yet',
        category: 'SOCIAL_PARTY',
        startsAt: '2027-05-01T20:00:00.000Z',
        endsAt: '2027-05-02T01:00:00.000Z',
        venueName: 'SUB Field',
        coverImageUrl: 'https://images.unsplash.com/photo-1492684223066-81342ee5ff30',
      })
      .expect(201);
    const draftId = bodyOf<EventPublic>(draftRes).id;

    const orgEvents = bodyOf<FeedResponse>(
      await anon(ctx.app).get('/organizers/sigma-club-ui/events').expect(200),
    );
    expect(orgEvents.items.length).toBeGreaterThanOrEqual(1);
    expect(orgEvents.items.some((e) => e.id === draftId)).toBe(false);

    const creator = bodyOf<CreatorPublic>(await anon(ctx.app).get('/creators/bisola').expect(200));
    expect(creator.handle).toBe('bisola');
    expect(creator.isVerified).toBe(true);
    expect(creator.events.length).toBeGreaterThanOrEqual(1);

    await anon(ctx.app).get('/creators/unknown-creator').expect(404);
  });
});
