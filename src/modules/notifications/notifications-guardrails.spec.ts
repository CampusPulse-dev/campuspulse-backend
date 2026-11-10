import {
  computeWatQuietHoursDelayMs,
  NotificationsGuardrailService,
} from './notifications-guardrails.service';

describe('NotificationsGuardrailService [S3-03]', () => {
  describe('computeWatQuietHoursDelayMs (23:00–07:00 WAT / Africa/Lagos UTC+1)', () => {
    it('defers late-night WAT notifications (23:30 WAT / 22:30 UTC) until 07:00 WAT', () => {
      // 22:30 UTC = 23:30 WAT -> 7.5 hours until 07:00 WAT (06:00 UTC next day)
      const now = new Date('2026-11-10T22:30:00.000Z');
      expect(computeWatQuietHoursDelayMs(now)).toBe(7.5 * 3_600_000);
    });

    it('defers early-morning WAT notifications (03:15 WAT / 02:15 UTC) until 07:00 WAT', () => {
      // 02:15 UTC = 03:15 WAT -> 3 hours 45 mins until 07:00 WAT (06:00 UTC same day)
      const now = new Date('2026-11-11T02:15:00.000Z');
      expect(computeWatQuietHoursDelayMs(now)).toBe((3 * 60 + 45) * 60_000);
    });

    it('returns 0ms during daytime WAT hours (15:00 WAT / 14:00 UTC)', () => {
      const now = new Date('2026-11-11T14:00:00.000Z');
      expect(computeWatQuietHoursDelayMs(now)).toBe(0);
    });
  });

  describe('evaluatePushDelivery (daily cap, mutes, and critical/event-day bypass)', () => {
    function buildService(options?: { maxCap?: number; mutedCategories?: string[] }) {
      const counters = new Map<string, { value: number; ttl?: number }>();
      const redisStub = {
        incr: jest.fn((key: string) => {
          const entry = counters.get(key) ?? { value: 0 };
          entry.value += 1;
          counters.set(key, entry);
          return Promise.resolve(entry.value);
        }),
        expire: jest.fn((key: string, seconds: number) => {
          const entry = counters.get(key);
          if (entry) entry.ttl = seconds;
          return Promise.resolve(1);
        }),
      };

      const prismaStub = {
        platformSetting: {
          findUnique: jest.fn(({ where }: { where: { key: string } }) => {
            if (where.key === 'max_daily_non_critical_pushes') {
              return Promise.resolve({ key: where.key, value: options?.maxCap ?? 3 });
            }
            if (where.key === 'quiet_hours_wat') {
              return Promise.resolve({ key: where.key, value: { startHour: 23, endHour: 7 } });
            }
            return Promise.resolve(null);
          }),
        },
        notificationPreference: {
          findUnique: jest.fn(() =>
            Promise.resolve(
              options?.mutedCategories ? { mutedCategories: options.mutedCategories } : null,
            ),
          ),
        },
      };

      const service = new NotificationsGuardrailService(prismaStub as never);
      return { service, redisStub, counters };
    }

    it('enforces PlatformSetting daily cap via Redis INCR + EXPIRE on non-critical pushes', async () => {
      const { service, redisStub } = buildService({ maxCap: 3 });
      const daytimeUtc = new Date('2026-11-11T12:00:00.000Z'); // 13:00 WAT

      const r1 = await service.evaluatePushDelivery(redisStub, {
        userId: 'u-1',
        category: 'FOLLOWED_POST',
        isEventDayStage: false,
        now: daytimeUtc,
      });
      const r2 = await service.evaluatePushDelivery(redisStub, {
        userId: 'u-1',
        category: 'RECOMMENDATION',
        isEventDayStage: false,
        now: daytimeUtc,
      });
      const r3 = await service.evaluatePushDelivery(redisStub, {
        userId: 'u-1',
        category: 'REMINDER',
        isEventDayStage: false,
        now: daytimeUtc,
      });
      const r4 = await service.evaluatePushDelivery(redisStub, {
        userId: 'u-1',
        category: 'FOLLOWED_POST',
        isEventDayStage: false,
        now: daytimeUtc,
      });

      expect(r1).toEqual({ allowPush: true, deferMs: 0 });
      expect(r2).toEqual({ allowPush: true, deferMs: 0 });
      expect(r3).toEqual({ allowPush: true, deferMs: 0 });
      expect(r4).toEqual({ allowPush: false, deferMs: 0, suppressedReason: 'DAILY_CAP' });
      expect(redisStub.expire).toHaveBeenCalledTimes(1);
    });

    it('suppresses muted categories for standard pushes', async () => {
      const { service, redisStub } = buildService({
        maxCap: 3,
        mutedCategories: ['RECOMMENDATION'],
      });
      const daytimeUtc = new Date('2026-11-11T12:00:00.000Z');

      const res = await service.evaluatePushDelivery(redisStub, {
        userId: 'u-1',
        category: 'RECOMMENDATION',
        isEventDayStage: false,
        now: daytimeUtc,
      });

      expect(res).toEqual({ allowPush: false, deferMs: 0, suppressedReason: 'MUTED' });
      expect(redisStub.incr).not.toHaveBeenCalled();
    });

    it('defers non-critical pushes arriving during WAT quiet hours without burning daily cap early', async () => {
      const { service, redisStub } = buildService({ maxCap: 3 });
      const quietUtc = new Date('2026-11-10T23:00:00.000Z'); // 00:00 WAT

      const res = await service.evaluatePushDelivery(redisStub, {
        userId: 'u-1',
        category: 'REMINDER',
        isEventDayStage: false,
        now: quietUtc,
      });

      expect(res.allowPush).toBe(false);
      expect(res.deferMs).toBe(7 * 3_600_000);
      expect(res.suppressedReason).toBe('QUIET_HOURS');
      expect(redisStub.incr).not.toHaveBeenCalled();
    });

    it('bypasses quiet hours, daily cap, and mutes for EVENT_CRITICAL and event-day stages', async () => {
      const { service, redisStub } = buildService({
        maxCap: 0,
        mutedCategories: ['REMINDER', 'EVENT_CRITICAL'],
      });
      const quietUtc = new Date('2026-11-10T23:00:00.000Z'); // 00:00 WAT

      const criticalRes = await service.evaluatePushDelivery(redisStub, {
        userId: 'u-1',
        category: 'EVENT_CRITICAL',
        isEventDayStage: false,
        now: quietUtc,
      });
      const eventDayRes = await service.evaluatePushDelivery(redisStub, {
        userId: 'u-1',
        category: 'REMINDER',
        isEventDayStage: true,
        now: quietUtc,
      });

      expect(criticalRes).toEqual({ allowPush: true, deferMs: 0 });
      expect(eventDayRes).toEqual({ allowPush: true, deferMs: 0 });
      expect(redisStub.incr).not.toHaveBeenCalled();
    });
  });
});
