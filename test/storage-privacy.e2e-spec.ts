import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { JwtService } from '@nestjs/jwt';
import { StorageService } from '../src/common/storage/storage.service';
import {
  type BootstrappedTestApp,
  createTestApp,
  truncateDatabase,
  withToken,
  bodyOf,
} from './utils/app';

describe('Real private storage lifecycle [S6-02]', () => {
  let ctx: BootstrappedTestApp;
  let storage: StorageService;
  let s3: S3Client;
  beforeAll(async () => {
    ctx = await createTestApp({ devAuthEnabled: false });
    storage = ctx.app.get(StorageService);
    s3 = new S3Client({
      endpoint: process.env.S3_ENDPOINT,
      region: process.env.S3_REGION ?? 'us-east-1',
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID!,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
      },
    });
  });
  beforeEach(async () => {
    await truncateDatabase(ctx.prisma);
  });
  afterAll(async () => {
    s3?.destroy();
    await ctx?.close();
  });
  async function account(role: 'SUPER_ADMIN' | 'VERIFIER' | 'ATTENDEE') {
    const user = await ctx.prisma.user.create({
      data: {
        email: `${role.toLowerCase()}@example.test`,
        displayName: role,
        passwordHash: 'unusable-test-password',
        role,
      },
    });
    return {
      user,
      api: withToken(ctx.app, ctx.app.get(JwtService).sign({ sub: user.id }, { expiresIn: '15m' })),
    };
  }
  it('performs real presigned media PUT/read and denies anonymous private object access', async () => {
    const { api, user } = await account('ATTENDEE');
    const upload = bodyOf<{ uploadUrl: string; publicUrl: string }>(
      await api
        .post('/media/upload-url')
        .send({ purpose: 'EVENT_COVER', contentType: 'image/png', size: 3 })
        .expect(201),
    );
    expect(
      (
        await fetch(upload.uploadUrl, {
          method: 'PUT',
          body: Buffer.from('png'),
          headers: { 'Content-Type': 'image/png' },
        })
      ).ok,
    ).toBe(true);
    expect(await (await fetch(upload.publicUrl)).text()).toBe('png');
    const privateUpload = await storage.createPrivateDocumentUpload({
      userId: user.id,
      contentType: 'image/png',
      size: 3,
    });
    expect(
      (
        await fetch(privateUpload.uploadUrl, {
          method: 'PUT',
          body: Buffer.from('png'),
          headers: { 'Content-Type': 'image/png' },
        })
      ).ok,
    ).toBe(true);
    expect(await storage.privateObjectExists(privateUpload.key)).toBe(true);
    const plain = `${process.env.S3_ENDPOINT}/${process.env.S3_PRIVATE_BUCKET}/${privateUpload.key}`;
    expect((await fetch(plain)).status).toBe(403);
    await storage.deletePrivateObject(privateUpload.key);
    expect(await storage.privateObjectExists(privateUpload.key)).toBe(false);
  });
  it.each(['APPROVED', 'REJECTED'] as const)(
    'audits real viewing and deletes the object on %s',
    async (decision) => {
      const admin = await account('SUPER_ADMIN');
      const verifier = await account('VERIFIER');
      const student = await account('ATTENDEE');
      const key = `synthetic-tests/${student.user.id}/id.png`;
      await s3.send(
        new PutObjectCommand({
          Bucket: process.env.S3_PRIVATE_BUCKET!,
          Key: key,
          Body: Buffer.from('synthetic-id-image'),
          ContentType: 'image/png',
        }),
      );
      const item = await ctx.prisma.verificationRequest.create({
        data: { subject: 'STUDENT_ID', submittedById: student.user.id, documentKey: key },
      });
      await verifier.api.get(`/admin/verifications/${item.id}/document`).expect(403);
      await admin.api.post(`/admin/verifications/${item.id}/claim`).expect(200);
      const document = await admin.api.get(`/admin/verifications/${item.id}/document`).expect(200);
      expect(document.headers['cache-control']).toContain('no-store');
      expect(
        await ctx.prisma.auditLog.count({
          where: { targetId: item.id, action: 'verification.document.viewed' },
        }),
      ).toBe(1);
      await admin.api
        .post(`/admin/verifications/${item.id}/decide`)
        .send({ decision, note: decision === 'REJECTED' ? 'Synthetic test rejection' : null })
        .expect(200);
      expect(await storage.privateObjectExists(key)).toBe(false);
      expect(
        (await ctx.prisma.verificationRequest.findUniqueOrThrow({ where: { id: item.id } }))
          .documentKey,
      ).toBeNull();
      await admin.api.get(`/admin/verifications/${item.id}/document`).expect(409);
    },
  );
});
