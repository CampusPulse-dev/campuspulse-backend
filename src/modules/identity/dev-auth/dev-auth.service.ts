import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import type { AuthenticatedUser } from '../../../common/decorators/current-user.decorator';
import { PrismaService } from '../../../common/prisma.service';
import type { Env } from '../../../config/env';

const DevEmailSchema = z.email();

// TODO(S1-02): replace with JWT authentication service and remove DevAuthService.
@Injectable()
export class DevAuthService {
  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly prisma: PrismaService,
  ) {}

  isEnabled(): boolean {
    return this.config.get('DEV_AUTH_ENABLED', { infer: true });
  }

  async resolveHeader(rawHeader: string | string[] | undefined): Promise<AuthenticatedUser> {
    if (!this.isEnabled()) {
      throw new UnauthorizedException('Development header auth is disabled');
    }

    const candidate = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
    if (!candidate) {
      throw new UnauthorizedException('Missing X-Dev-User header');
    }

    const parsed = DevEmailSchema.safeParse(candidate.trim().toLowerCase());
    if (!parsed.success) {
      throw new UnauthorizedException('Invalid X-Dev-User email');
    }

    const email = parsed.data;
    const existing = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, role: true },
    });
    if (existing) {
      return existing;
    }

    const localPart = email.split('@')[0]?.slice(0, 80) || 'Attendee';
    const created = await this.prisma.user.upsert({
      where: { email },
      update: {},
      create: {
        email,
        passwordHash: 'dev-auth-placeholder',
        displayName: localPart,
        role: 'ATTENDEE',
      },
      select: { id: true, email: true, role: true },
    });

    return created;
  }
}
