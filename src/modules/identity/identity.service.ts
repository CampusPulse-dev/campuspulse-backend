import { Injectable, ConflictException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { SignUpDto, SignInDto } from './dto/auth.dto';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import type { SessionResponse } from '../../contract/api/identity';
import type { Env } from '../../config/env';
import type { User } from '@prisma/client';

@Injectable()
export class IdentityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async signUp(dto: SignUpDto): Promise<SessionResponse> {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });

    if (existing) {
      throw new ConflictException('Email already in use');
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(dto.password, salt);

    const user = await this.prisma.user.create({
      data: {
        email: dto.email.toLowerCase(),
        passwordHash,
        displayName: dto.displayName,
      },
    });

    return this.createSession(user);
  }

  async signIn(dto: SignInDto): Promise<SessionResponse> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isMatch = await bcrypt.compare(dto.password, user.passwordHash);
    if (!isMatch) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return this.createSession(user);
  }

  private async createSession(user: User): Promise<SessionResponse> {
    const payload = { sub: user.id, role: user.role };
    const expiresIn = 7 * 24 * 60 * 60;

    const accessToken = await this.jwtService.signAsync(payload);

    return {
      user: {
        id: user.id,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        // Enums from Prisma might differ slightly in type from Zod enums but usually cast cleanly
        role: user.role,
        isVerifiedStudent: user.isVerifiedStudent,
      },
      accessToken,
      expiresIn,
    };
  }
}
