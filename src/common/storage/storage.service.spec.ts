import { BadRequestException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';
import { StorageService } from './storage.service';

describe('StorageService (S2-02)', () => {
  function makeStorage(): StorageService {
    const values: Partial<Env> = {
      S3_ENDPOINT: 'http://localhost:9000',
      S3_REGION: 'us-east-1',
      S3_BUCKET: 'campuspulse-media',
      S3_ACCESS_KEY_ID: 'minioadmin',
      S3_SECRET_ACCESS_KEY: 'minioadminpassword',
      S3_PUBLIC_BASE_URL: 'http://localhost:9000/campuspulse-media',
      S3_FORCE_PATH_STYLE: true,
    };
    const config = {
      get: (key: keyof Env) => values[key],
    } as unknown as ConfigService<Env, true>;
    return new StorageService(config);
  }

  it('signs a presigned PUT URL for public media uploads without network round-trip', async () => {
    const storage = makeStorage();
    const res = await storage.createPresignedUpload({
      userId: '44444444-4444-4444-8444-444444444401',
      purpose: 'STORY_MEDIA',
      contentType: 'image/webp',
      size: 250_000,
    });

    expect(res.key).toMatch(/^stories\/44444444-4444-4444-8444-444444444401\/.+\.webp$/);
    expect(res.uploadUrl).toContain('http://localhost:9000/campuspulse-media/stories/');
    expect(res.uploadUrl).toContain('X-Amz-Signature=');
    expect(res.publicUrl).toBe(`http://localhost:9000/campuspulse-media/${res.key}`);
    expect(res.expiresIn).toBe(300);
  });

  it('rejects video MIME types on image-only upload purposes', async () => {
    const storage = makeStorage();
    await expect(
      storage.createPresignedUpload({
        userId: '44444444-4444-4444-8444-444444444401',
        purpose: 'AVATAR',
        contentType: 'video/mp4',
        size: 500_000,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
