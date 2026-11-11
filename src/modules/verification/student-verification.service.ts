import { createHash, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { KeyValueStore } from '../../common/kv/key-value-store';
import { toUserPublic } from '../../common/mappers/entity.mappers';
import { PrismaService } from '../../common/prisma.service';
import { StorageService, type PrivateDocumentMime } from '../../common/storage/storage.service';
import type { StudentOtpSentResponse, UserPublic } from '../../contract';
import { EmailAdapter } from '../notifications/email.adapter';

export const OTP_TTL_SECONDS = 600;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_SECONDS = 60;
export const OTP_LOCK_SECONDS = 900;
const UPLOAD_HANDLE_TTL_SECONDS = 900;

type StudentState = {
  status: 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'INFO_REQUESTED';
  note: string | null;
};

interface PendingOtp {
  email: string;
  codeHash: string;
  attempts: number;
}

interface PendingUpload {
  userId: string;
  key: string;
}

const otpKey = (userId: string) => `verif:otp:${userId}`;
const cooldownKey = (userId: string) => `verif:otp-cooldown:${userId}`;
const lockKey = (userId: string) => `verif:otp-lock:${userId}`;
const uploadKey = (uploadId: string) => `verif:upload:${uploadId}`;

function hashCode(userId: string, code: string): string {
  return createHash('sha256').update(`${userId}:${code}`).digest('hex');
}

function tooMany(message: string): HttpException {
  return new HttpException(message, HttpStatus.TOO_MANY_REQUESTS);
}

/**
 * Two routes to a verified-student badge (PRD §6):
 *  1. OTP sent to a `*.ui.edu.ng` address — instant.
 *  2. A private student-ID image reviewed by a Super Admin (S1-04).
 *
 * NDPA: the student email is never logged or echoed back, the OTP is stored
 * hashed, and ID images only ever get a private-bucket key.
 */
@Injectable()
export class StudentVerificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly store: KeyValueStore,
    private readonly storage: StorageService,
    private readonly email: EmailAdapter,
  ) {}

  async getState(userId: string): Promise<StudentState> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isVerifiedStudent: true },
    });
    if (!user) throw new NotFoundException('User not found');
    if (user.isVerifiedStudent) return { status: 'APPROVED', note: null };

    const latest = await this.prisma.verificationRequest.findFirst({
      where: { submittedById: userId, subject: 'STUDENT_ID' },
      orderBy: { submittedAt: 'desc' },
      select: { status: true, reviewerNote: true },
    });
    if (!latest) return { status: 'NONE', note: null };
    if (latest.status === 'PENDING' || latest.status === 'IN_REVIEW') {
      return { status: 'PENDING', note: null };
    }
    return { status: latest.status, note: latest.reviewerNote };
  }

  async requestOtp(userId: string, rawEmail: string): Promise<StudentOtpSentResponse> {
    const email = rawEmail.trim().toLowerCase();
    await this.assertNotVerified(userId);

    if ((await this.store.ttl(lockKey(userId))) > 0) {
      throw tooMany('Too many incorrect codes. Try again later.');
    }
    const owner = await this.prisma.user.findUnique({
      where: { studentEmail: email },
      select: { id: true },
    });
    if (owner && owner.id !== userId) {
      throw new ConflictException('This student email is already linked to another account');
    }
    if (!(await this.store.setIfAbsent(cooldownKey(userId), '1', OTP_RESEND_SECONDS))) {
      throw tooMany('A code was just sent. Wait a minute before requesting another.');
    }

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const pending: PendingOtp = { email, codeHash: hashCode(userId, code), attempts: 0 };
    await this.store.set(otpKey(userId), JSON.stringify(pending), OTP_TTL_SECONDS);

    await this.email.send({
      userId,
      to: email,
      subject: 'Your CampusPulse verification code',
      text: `Your CampusPulse student verification code is ${code}. It expires in 10 minutes.`,
      template: 'student-otp',
    });

    return { expiresIn: OTP_TTL_SECONDS, resendAfter: OTP_RESEND_SECONDS };
  }

  async confirmOtp(userId: string, rawEmail: string, code: string): Promise<UserPublic> {
    const email = rawEmail.trim().toLowerCase();
    if ((await this.store.ttl(lockKey(userId))) > 0) {
      throw tooMany('Too many incorrect codes. Try again later.');
    }

    const raw = await this.store.get(otpKey(userId));
    const pending = raw ? (JSON.parse(raw) as PendingOtp) : null;
    if (!pending || pending.email !== email) {
      throw new BadRequestException('This code has expired. Request a new one.');
    }

    const expected = Buffer.from(pending.codeHash, 'hex');
    const actual = Buffer.from(hashCode(userId, code), 'hex');
    if (!timingSafeEqual(expected, actual)) {
      const attempts = pending.attempts + 1;
      if (attempts >= OTP_MAX_ATTEMPTS) {
        await this.store.del(otpKey(userId));
        await this.store.set(lockKey(userId), '1', OTP_LOCK_SECONDS);
        throw tooMany('Too many incorrect codes. Try again later.');
      }
      const remaining = await this.store.ttl(otpKey(userId));
      if (remaining > 0) {
        await this.store.set(otpKey(userId), JSON.stringify({ ...pending, attempts }), remaining);
      }
      throw new BadRequestException('Incorrect code');
    }

    await this.store.del(otpKey(userId), cooldownKey(userId));
    try {
      const user = await this.prisma.user.update({
        where: { id: userId },
        data: { studentEmail: email, isVerifiedStudent: true },
      });
      return toUserPublic(user);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('This student email is already linked to another account');
      }
      throw err;
    }
  }

  async createUpload(
    userId: string,
    body: { contentType: PrivateDocumentMime; size: number },
  ): Promise<{ uploadUrl: string; uploadId: string }> {
    await this.assertNotVerified(userId);
    const { uploadUrl, key } = await this.storage.createPrivateDocumentUpload({ userId, ...body });
    // The client only ever holds this opaque handle, never the storage key.
    const uploadId = randomUUID();
    const pending: PendingUpload = { userId, key };
    await this.store.set(uploadKey(uploadId), JSON.stringify(pending), UPLOAD_HANDLE_TTL_SECONDS);
    return { uploadUrl, uploadId };
  }

  async submitIdRequest(userId: string, uploadId: string): Promise<StudentState> {
    await this.assertNotVerified(userId);

    const raw = await this.store.get(uploadKey(uploadId));
    const pending = raw ? (JSON.parse(raw) as PendingUpload) : null;
    if (!pending || pending.userId !== userId) {
      throw new BadRequestException('This upload has expired. Upload your ID again.');
    }

    const open = await this.prisma.verificationRequest.findFirst({
      where: {
        submittedById: userId,
        subject: 'STUDENT_ID',
        status: { in: ['PENDING', 'IN_REVIEW'] },
      },
      select: { id: true },
    });
    if (open) {
      // Do not leave a second ID image sitting in storage.
      await this.storage.deletePrivateObject(pending.key);
      await this.store.del(uploadKey(uploadId));
      throw new ConflictException('Your student ID is already being reviewed');
    }

    if (!(await this.storage.privateObjectExists(pending.key))) {
      throw new BadRequestException('The ID image was not uploaded. Upload it and try again.');
    }

    await this.prisma.verificationRequest.create({
      data: { subject: 'STUDENT_ID', submittedById: userId, documentKey: pending.key },
    });
    await this.store.del(uploadKey(uploadId));
    return { status: 'PENDING', note: null };
  }

  private async assertNotVerified(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isVerifiedStudent: true },
    });
    if (!user) throw new NotFoundException('User not found');
    if (user.isVerifiedStudent) throw new ConflictException('You are already a verified student');
  }
}
