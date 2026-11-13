import { BadRequestException, ConflictException, HttpException } from '@nestjs/common';
import { InMemoryKeyValueStore } from '../../common/kv/key-value-store';
import type { PrismaService } from '../../common/prisma.service';
import type { StorageService } from '../../common/storage/storage.service';
import type { EmailAdapter, TransactionalEmailInput } from '../notifications/email.adapter';
import {
  OTP_LOCK_SECONDS,
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_SECONDS,
  OTP_TTL_SECONDS,
  StudentVerificationService,
} from './student-verification.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const EMAIL = 'ada@stu.ui.edu.ng';

type UserRow = {
  id: string;
  displayName: string;
  avatarUrl: null;
  role: 'ATTENDEE';
  isVerifiedStudent: boolean;
  studentEmail: string | null;
};
type RequestRow = { status: string; documentKey: string | null; reviewerNote: string | null };

function build(opts: { emailOwnerId?: string; objectExists?: boolean } = {}) {
  const user: UserRow = {
    id: USER_ID,
    displayName: 'Ada',
    avatarUrl: null,
    role: 'ATTENDEE',
    isVerifiedStudent: false,
    studentEmail: null,
  };
  const requests: RequestRow[] = [];
  const sent: TransactionalEmailInput[] = [];
  const deleted: string[] = [];

  const prisma = {
    user: {
      findUnique: jest.fn(({ where }: { where: { id?: string; studentEmail?: string } }) => {
        if (where.studentEmail) {
          return Promise.resolve(opts.emailOwnerId ? { id: opts.emailOwnerId } : null);
        }
        return Promise.resolve({ ...user });
      }),
      update: jest.fn(({ data }: { data: Partial<UserRow> }) => {
        Object.assign(user, data);
        return Promise.resolve({ ...user });
      }),
    },
    verificationRequest: {
      findFirst: jest.fn(({ where }: { where: { status?: { in: string[] } } }) => {
        const pool = where.status
          ? requests.filter((r) => where.status?.in.includes(r.status))
          : requests;
        return Promise.resolve(pool[pool.length - 1] ?? null);
      }),
      create: jest.fn(({ data }: { data: { documentKey: string } }) => {
        const row: RequestRow = { status: 'PENDING', reviewerNote: null, ...data };
        requests.push(row);
        return Promise.resolve(row);
      }),
    },
  } as unknown as PrismaService;

  const storage = {
    createPrivateDocumentUpload: jest.fn().mockResolvedValue({
      uploadUrl: 'http://localhost:9000/campuspulse-private/signed',
      key: `student-ids/${USER_ID}/doc.jpg`,
      expiresIn: 300,
    }),
    privateObjectExists: jest.fn().mockResolvedValue(opts.objectExists ?? true),
    deletePrivateObject: jest.fn((key: string) => {
      deleted.push(key);
      return Promise.resolve();
    }),
  } as unknown as StorageService;

  const email = {
    send: jest.fn((input: TransactionalEmailInput) => {
      sent.push(input);
      return Promise.resolve();
    }),
  } as unknown as EmailAdapter;

  const store = new InMemoryKeyValueStore();
  const service = new StudentVerificationService(prisma, store, storage, email);
  const lastCode = () => /(\d{6})/.exec(sent[sent.length - 1]?.text ?? '')?.[1] ?? '';
  const wrongCode = () => (lastCode() === '000000' ? '111111' : '000000');
  return { service, store, user, requests, sent, deleted, lastCode, wrongCode };
}

describe('StudentVerificationService (S1-03)', () => {
  it('emails a 6-digit code and verifies the student when it is confirmed', async () => {
    const t = build();
    await expect(t.service.requestOtp(USER_ID, ' Ada@Stu.UI.edu.ng ')).resolves.toEqual({
      expiresIn: OTP_TTL_SECONDS,
      resendAfter: OTP_RESEND_SECONDS,
    });
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0]).toMatchObject({ to: EMAIL, template: 'student-otp', userId: USER_ID });
    expect(t.lastCode()).toMatch(/^\d{6}$/);
    // The code itself is never stored, only its hash.
    await expect(t.store.get(`verif:otp:${USER_ID}`)).resolves.not.toContain(t.lastCode());

    const verified = await t.service.confirmOtp(USER_ID, EMAIL, t.lastCode());
    expect(verified.isVerifiedStudent).toBe(true);
    expect(t.user.studentEmail).toBe(EMAIL);
    await expect(t.service.getState(USER_ID)).resolves.toEqual({ status: 'APPROVED', note: null });
  });

  it('expires the code after 10 minutes', async () => {
    const t = build();
    await t.service.requestOtp(USER_ID, EMAIL);
    const code = t.lastCode();
    t.store.advance(OTP_TTL_SECONDS + 1);
    await expect(t.service.confirmOtp(USER_ID, EMAIL, code)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(t.user.isVerifiedStudent).toBe(false);
  });

  it('locks after 5 wrong codes, even if the right one follows', async () => {
    const t = build();
    await t.service.requestOtp(USER_ID, EMAIL);
    const code = t.lastCode();

    for (let i = 1; i < OTP_MAX_ATTEMPTS; i += 1) {
      await expect(t.service.confirmOtp(USER_ID, EMAIL, t.wrongCode())).rejects.toBeInstanceOf(
        BadRequestException,
      );
    }
    await expect(t.service.confirmOtp(USER_ID, EMAIL, t.wrongCode())).rejects.toMatchObject({
      status: 429,
    });
    await expect(t.service.confirmOtp(USER_ID, EMAIL, code)).rejects.toMatchObject({ status: 429 });
    await expect(t.service.requestOtp(USER_ID, EMAIL)).rejects.toMatchObject({ status: 429 });
    expect(t.user.isVerifiedStudent).toBe(false);

    t.store.advance(OTP_LOCK_SECONDS + 1);
    await expect(t.service.requestOtp(USER_ID, EMAIL)).resolves.toBeDefined();
  });

  it('rate-limits resends and refuses a code issued for a different address', async () => {
    const t = build();
    await t.service.requestOtp(USER_ID, EMAIL);
    await expect(t.service.requestOtp(USER_ID, EMAIL)).rejects.toBeInstanceOf(HttpException);
    expect(t.sent).toHaveLength(1);
    await expect(
      t.service.confirmOtp(USER_ID, 'other@stu.ui.edu.ng', t.lastCode()),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a student email already linked to another account, without sending', async () => {
    const t = build({ emailOwnerId: '22222222-2222-4222-8222-222222222222' });
    await expect(t.service.requestOtp(USER_ID, EMAIL)).rejects.toBeInstanceOf(ConflictException);
    expect(t.sent).toHaveLength(0);
  });

  it('turns an uploaded ID into a pending request holding only the private key', async () => {
    const t = build();
    const { uploadId, uploadUrl } = await t.service.createUpload(USER_ID, {
      contentType: 'image/jpeg',
      size: 1024,
    });
    expect(uploadUrl).toContain('campuspulse-private');
    expect(uploadId).not.toContain('student-ids');

    await expect(t.service.submitIdRequest(USER_ID, uploadId)).resolves.toEqual({
      status: 'PENDING',
      note: null,
    });
    expect(t.requests[0]?.documentKey).toBe(`student-ids/${USER_ID}/doc.jpg`);
    // The handle is single-use.
    await expect(t.service.submitIdRequest(USER_ID, uploadId)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects a handle from another user and a handle whose object never arrived', async () => {
    const t = build({ objectExists: false });
    const { uploadId } = await t.service.createUpload(USER_ID, {
      contentType: 'image/png',
      size: 2048,
    });
    await expect(
      t.service.submitIdRequest('33333333-3333-4333-8333-333333333333', uploadId),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(t.service.submitIdRequest(USER_ID, uploadId)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(t.requests).toHaveLength(0);
  });

  it('deletes a second ID image instead of queueing it while one is in review', async () => {
    const t = build();
    const first = await t.service.createUpload(USER_ID, { contentType: 'image/jpeg', size: 1 });
    await t.service.submitIdRequest(USER_ID, first.uploadId);
    const second = await t.service.createUpload(USER_ID, { contentType: 'image/jpeg', size: 1 });
    await expect(t.service.submitIdRequest(USER_ID, second.uploadId)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(t.deleted).toEqual([`student-ids/${USER_ID}/doc.jpg`]);
    expect(t.requests).toHaveLength(1);
  });
});
