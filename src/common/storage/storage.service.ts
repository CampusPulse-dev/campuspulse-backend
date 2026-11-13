import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { BadRequestException, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';
import type {
  MediaUploadPurpose,
  MediaUploadUrlBody,
  MediaUploadUrlResponse,
} from '../../contract';

export interface PresignedUploadInput extends MediaUploadUrlBody {
  userId: string;
}

export interface StorageDriver {
  createPresignedUpload(input: PresignedUploadInput): Promise<MediaUploadUrlResponse>;
  deleteObject(key: string): Promise<void>;
}

const PURPOSE_FOLDERS: Record<MediaUploadPurpose, string> = {
  EVENT_COVER: 'covers',
  STORY_MEDIA: 'stories',
  AVATAR: 'avatars',
  ORGANIZER_LOGO: 'logos',
};

const IMAGE_ONLY_PURPOSES = new Set<MediaUploadPurpose>([
  'EVENT_COVER',
  'AVATAR',
  'ORGANIZER_LOGO',
]);

const EXT_BY_MIME: Record<MediaUploadUrlBody['contentType'], string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
};

const PRESIGN_EXPIRES_SECONDS = 300;

const PRIVATE_EXT_BY_MIME = { 'image/jpeg': 'jpg', 'image/png': 'png' } as const;
export type PrivateDocumentMime = keyof typeof PRIVATE_EXT_BY_MIME;

export interface PrivateObject {
  stream: Readable;
  contentType: string;
  contentLength: number | undefined;
}

@Injectable()
export class StorageService implements StorageDriver, OnModuleDestroy {
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly privateBucket: string;
  private readonly publicBaseUrl: string;

  constructor(config: ConfigService<Env, true>) {
    this.bucket = config.get('S3_BUCKET', { infer: true });
    this.privateBucket = config.get('S3_PRIVATE_BUCKET', { infer: true });
    this.publicBaseUrl = config.get('S3_PUBLIC_BASE_URL', { infer: true }).replace(/\/+$/, '');
    this.s3 = new S3Client({
      endpoint: config.get('S3_ENDPOINT', { infer: true }),
      region: config.get('S3_REGION', { infer: true }),
      forcePathStyle: config.get('S3_FORCE_PATH_STYLE', { infer: true }),
      credentials: {
        accessKeyId: config.get('S3_ACCESS_KEY_ID', { infer: true }),
        secretAccessKey: config.get('S3_SECRET_ACCESS_KEY', { infer: true }),
      },
    });
  }

  async createPresignedUpload(input: PresignedUploadInput): Promise<MediaUploadUrlResponse> {
    if (IMAGE_ONLY_PURPOSES.has(input.purpose) && input.contentType.startsWith('video/')) {
      throw new BadRequestException(`${input.purpose} uploads must be an image`);
    }

    const folder = PURPOSE_FOLDERS[input.purpose];
    const ext = EXT_BY_MIME[input.contentType];
    const key = `${folder}/${input.userId}/${randomUUID()}.${ext}`;

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: input.contentType,
      ContentLength: input.size,
    });

    const uploadUrl = await getSignedUrl(this.s3, command, {
      expiresIn: PRESIGN_EXPIRES_SECONDS,
    });

    return {
      uploadUrl,
      publicUrl: `${this.publicBaseUrl}/${key}`,
      key,
      expiresIn: PRESIGN_EXPIRES_SECONDS,
    };
  }

  async deleteObject(key: string): Promise<void> {
    await this.s3.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );
  }

  /**
   * NDPA: student ID images go to the private bucket only. There is no public
   * URL for these keys; they are read back solely through `getPrivateObject`.
   */
  async createPrivateDocumentUpload(input: {
    userId: string;
    contentType: PrivateDocumentMime;
    size: number;
  }): Promise<{ uploadUrl: string; key: string; expiresIn: number }> {
    const ext = PRIVATE_EXT_BY_MIME[input.contentType];
    const key = `student-ids/${input.userId}/${randomUUID()}.${ext}`;
    const uploadUrl = await getSignedUrl(
      this.s3,
      new PutObjectCommand({
        Bucket: this.privateBucket,
        Key: key,
        ContentType: input.contentType,
        ContentLength: input.size,
      }),
      { expiresIn: PRESIGN_EXPIRES_SECONDS },
    );
    return { uploadUrl, key, expiresIn: PRESIGN_EXPIRES_SECONDS };
  }

  async privateObjectExists(key: string): Promise<boolean> {
    try {
      await this.s3.send(new HeadObjectCommand({ Bucket: this.privateBucket, Key: key }));
      return true;
    } catch (err) {
      const meta = (err as { $metadata?: { httpStatusCode?: number } }).$metadata;
      if (meta?.httpStatusCode === 404 || (err as { name?: string }).name === 'NotFound') {
        return false;
      }
      throw err;
    }
  }

  async getPrivateObject(key: string): Promise<PrivateObject> {
    const res = await this.s3.send(new GetObjectCommand({ Bucket: this.privateBucket, Key: key }));
    return {
      stream: res.Body as Readable,
      contentType: res.ContentType ?? 'application/octet-stream',
      contentLength: res.ContentLength,
    };
  }

  async deletePrivateObject(key: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.privateBucket, Key: key }));
  }

  onModuleDestroy(): void {
    this.s3.destroy();
  }
}
