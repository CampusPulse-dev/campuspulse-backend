import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import IORedis from 'ioredis';
import type { Env } from '../../config/env';

/**
 * Small expiring key-value port for short-lived secrets (OTP codes, upload
 * handles, review locks). An abstract class so Nest can inject it and tests
 * can swap in an in-memory fake.
 */
export abstract class KeyValueStore {
  abstract get(key: string): Promise<string | null>;
  abstract set(key: string, value: string, ttlSeconds: number): Promise<void>;
  /** Sets only when the key is absent. Returns whether it was written. */
  abstract setIfAbsent(key: string, value: string, ttlSeconds: number): Promise<boolean>;
  /** Remaining lifetime in seconds; 0 when the key is missing. */
  abstract ttl(key: string): Promise<number>;
  abstract del(...keys: string[]): Promise<void>;
}

@Injectable()
export class RedisKeyValueStore extends KeyValueStore implements OnModuleDestroy {
  private client?: IORedis;

  constructor(private readonly config: ConfigService<Env, true>) {
    super();
  }

  private redis(): IORedis {
    this.client ??= new IORedis(this.config.get('REDIS_URL', { infer: true }), {
      maxRetriesPerRequest: 2,
      lazyConnect: false,
    }).on('error', () => {
      // Surfaced to callers as a rejected command; avoid an unhandled 'error' event.
    });
    return this.client;
  }

  get(key: string): Promise<string | null> {
    return this.redis().get(key);
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.redis().set(key, value, 'EX', ttlSeconds);
  }

  async setIfAbsent(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    return (await this.redis().set(key, value, 'EX', ttlSeconds, 'NX')) === 'OK';
  }

  async ttl(key: string): Promise<number> {
    return Math.max(0, await this.redis().ttl(key));
  }

  async del(...keys: string[]): Promise<void> {
    if (keys.length > 0) await this.redis().del(...keys);
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.quit().catch(() => undefined);
  }
}

/** In-memory implementation for unit tests. `advance()` moves its clock. */
export class InMemoryKeyValueStore extends KeyValueStore {
  private readonly entries = new Map<string, { value: string; expiresAt: number }>();
  private now = 0;

  advance(seconds: number): void {
    this.now += seconds;
  }

  private live(key: string) {
    const entry = this.entries.get(key);
    if (entry && entry.expiresAt <= this.now) {
      this.entries.delete(key);
      return undefined;
    }
    return entry;
  }

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.live(key)?.value ?? null);
  }

  set(key: string, value: string, ttlSeconds: number): Promise<void> {
    this.entries.set(key, { value, expiresAt: this.now + ttlSeconds });
    return Promise.resolve();
  }

  setIfAbsent(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    if (this.live(key)) return Promise.resolve(false);
    this.entries.set(key, { value, expiresAt: this.now + ttlSeconds });
    return Promise.resolve(true);
  }

  ttl(key: string): Promise<number> {
    const entry = this.live(key);
    return Promise.resolve(entry ? entry.expiresAt - this.now : 0);
  }

  del(...keys: string[]): Promise<void> {
    for (const key of keys) this.entries.delete(key);
    return Promise.resolve();
  }
}
