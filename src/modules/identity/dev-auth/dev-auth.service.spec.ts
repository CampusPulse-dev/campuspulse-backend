import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../../../common/prisma.service';
import type { Env } from '../../../config/env';
import { DevAuthService } from './dev-auth.service';

describe('DevAuthService (S2-01)', () => {
  function buildService(opts: {
    enabled: boolean;
    existingUser?: { id: string; email: string; role: 'ATTENDEE' | 'ORGANIZER' } | null;
  }) {
    const config = {
      get: jest.fn().mockReturnValue(opts.enabled),
    } as unknown as ConfigService<Env, true>;

    const findUnique = jest.fn().mockResolvedValue(opts.existingUser ?? null);
    const upsert = jest.fn().mockImplementation(({ create }: { create: { email: string } }) =>
      Promise.resolve({
        id: '99999999-9999-4999-8999-999999999999',
        email: create.email,
        role: 'ATTENDEE' as const,
      }),
    );

    const prisma = {
      user: { findUnique, upsert },
    } as unknown as PrismaService;

    return { service: new DevAuthService(config, prisma), findUnique, upsert };
  }

  it('throws UnauthorizedException when DEV_AUTH_ENABLED is false', async () => {
    const { service } = buildService({ enabled: false });
    await expect(service.resolveHeader('tobi@stu.ui.edu.ng')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('throws UnauthorizedException when header is missing or malformed', async () => {
    const { service } = buildService({ enabled: true });
    await expect(service.resolveHeader(undefined)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.resolveHeader('not-an-email')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('returns existing user normalized by lowercase email', async () => {
    const existing = {
      id: '44444444-4444-4444-8444-444444444401',
      email: 'tobi@stu.ui.edu.ng',
      role: 'ATTENDEE' as const,
    };
    const { service, findUnique, upsert } = buildService({
      enabled: true,
      existingUser: existing,
    });

    const user = await service.resolveHeader('  Tobi@Stu.UI.edu.ng ');
    expect(findUnique).toHaveBeenCalledWith({
      where: { email: 'tobi@stu.ui.edu.ng' },
      select: { id: true, email: true, role: true },
    });
    expect(upsert).not.toHaveBeenCalled();
    expect(user).toEqual(existing);
  });

  it('auto-creates unknown email as ATTENDEE', async () => {
    const { service, upsert } = buildService({ enabled: true, existingUser: null });
    const user = await service.resolveHeader('new.student@stu.ui.edu.ng');
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(user).toEqual({
      id: '99999999-9999-4999-8999-999999999999',
      email: 'new.student@stu.ui.edu.ng',
      role: 'ATTENDEE',
    });
  });
});
