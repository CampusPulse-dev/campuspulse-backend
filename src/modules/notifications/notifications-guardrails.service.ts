import { Injectable } from '@nestjs/common';
import type { NotificationCategory } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';

const WAT_OFFSET_MS = 3_600_000; // Africa/Lagos is permanently UTC+1
const DEFAULT_MAX_DAILY_PUSHES = 3;
const CAP_KEY_TTL_SECONDS = 86_400;

export interface CapRedisCounter {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
}

export interface EvaluatePushInput {
  userId: string;
  category: NotificationCategory;
  isEventDayStage: boolean;
  now?: Date;
}

export interface PushDeliveryDecision {
  allowPush: boolean;
  deferMs: number;
  suppressedReason?: 'MUTED' | 'QUIET_HOURS' | 'DAILY_CAP';
}

export function computeWatQuietHoursDelayMs(now: Date, startHour = 23, endHour = 7): number {
  const watDate = new Date(now.getTime() + WAT_OFFSET_MS);
  const watHour = watDate.getUTCHours();

  const inQuietHours =
    startHour > endHour
      ? watHour >= startHour || watHour < endHour
      : watHour >= startHour && watHour < endHour;

  if (!inQuietHours) {
    return 0;
  }

  const dayOffset = startHour > endHour && watHour >= startHour ? 1 : 0;
  const targetWatEpochMs = Date.UTC(
    watDate.getUTCFullYear(),
    watDate.getUTCMonth(),
    watDate.getUTCDate() + dayOffset,
    endHour,
    0,
    0,
    0,
  );

  return Math.max(0, targetWatEpochMs - watDate.getTime());
}

function formatWatDateKey(now: Date): string {
  const watDate = new Date(now.getTime() + WAT_OFFSET_MS);
  return watDate.toISOString().slice(0, 10);
}

@Injectable()
export class NotificationsGuardrailService {
  constructor(private readonly prisma: PrismaService) {}

  async evaluatePushDelivery(
    redis: CapRedisCounter,
    input: EvaluatePushInput,
  ): Promise<PushDeliveryDecision> {
    // EVENT_CRITICAL and event-day reminder stages bypass mutes, quiet hours, and daily caps.
    if (input.category === 'EVENT_CRITICAL' || input.isEventDayStage) {
      return { allowPush: true, deferMs: 0 };
    }

    const now = input.now ?? new Date();

    const [pref, capSetting, quietSetting] = await Promise.all([
      this.prisma.notificationPreference.findUnique({
        where: { userId: input.userId },
      }),
      this.prisma.platformSetting.findUnique({
        where: { key: 'max_daily_non_critical_pushes' },
      }),
      this.prisma.platformSetting.findUnique({
        where: { key: 'quiet_hours_wat' },
      }),
    ]);

    if (pref?.mutedCategories.includes(input.category)) {
      return { allowPush: false, deferMs: 0, suppressedReason: 'MUTED' };
    }

    let startHour = 23;
    let endHour = 7;
    if (
      quietSetting &&
      typeof quietSetting.value === 'object' &&
      quietSetting.value !== null &&
      !Array.isArray(quietSetting.value)
    ) {
      const cfg = quietSetting.value as { startHour?: unknown; endHour?: unknown };
      if (typeof cfg.startHour === 'number') startHour = cfg.startHour;
      if (typeof cfg.endHour === 'number') endHour = cfg.endHour;
    }

    const deferMs = computeWatQuietHoursDelayMs(now, startHour, endHour);
    if (deferMs > 0) {
      return {
        allowPush: false,
        deferMs,
        suppressedReason: 'QUIET_HOURS',
      };
    }

    const maxCap =
      typeof capSetting?.value === 'number' && Number.isFinite(capSetting.value)
        ? Math.max(0, Math.floor(capSetting.value))
        : DEFAULT_MAX_DAILY_PUSHES;

    if (maxCap <= 0) {
      return { allowPush: false, deferMs: 0, suppressedReason: 'DAILY_CAP' };
    }

    const capKey = `notify:cap:${input.userId}:${formatWatDateKey(now)}`;
    const count = await redis.incr(capKey);
    if (count === 1) {
      await redis.expire(capKey, CAP_KEY_TTL_SECONDS);
    }

    if (count > maxCap) {
      return { allowPush: false, deferMs: 0, suppressedReason: 'DAILY_CAP' };
    }

    return { allowPush: true, deferMs: 0 };
  }
}
