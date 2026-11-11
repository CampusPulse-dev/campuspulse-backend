import { Body, Controller, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { CookieOptions, Request, Response } from 'express';
import { ZodValidationPipe } from '../../../common/zod-validation.pipe';
import type { Env } from '../../../config/env';
import { SignInBody, SignUpBody, type SessionResponse } from '../../../contract';
import { AuthService, type IssuedSession } from './auth.service';

export const REFRESH_COOKIE = 'cp_refresh';
/** Scoped to the auth routes so the refresh token is not sent with every API call. */
const REFRESH_COOKIE_PATH = '/api/v1/auth';

export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}

@ApiTags('auth')
@Controller('auth')
@UseGuards(ThrottlerGuard)
// Credential endpoints: far stricter than the 120/min API baseline.
@Throttle({ default: { limit: 10, ttl: 60_000 } })
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Post('sign-up')
  @ApiOperation({ summary: 'Create an account and start a session' })
  @ApiBody({ schema: { $ref: '#/components/schemas/SignUpBody' } })
  @ApiCreatedResponse({
    description: 'Session for the new account. The refresh token is set as an httpOnly cookie.',
    schema: { $ref: '#/components/schemas/SessionResponse' },
  })
  async signUp(
    @Body(new ZodValidationPipe(SignUpBody)) body: SignUpBody,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionResponse> {
    return this.deliver(res, await this.auth.signUp(body));
  }

  @Post('sign-in')
  @HttpCode(200)
  @ApiOperation({ summary: 'Sign in with email and password' })
  @ApiBody({ schema: { $ref: '#/components/schemas/SignInBody' } })
  @ApiOkResponse({
    description: 'Session. The refresh token is set as an httpOnly cookie.',
    schema: { $ref: '#/components/schemas/SessionResponse' },
  })
  async signIn(
    @Body(new ZodValidationPipe(SignInBody)) body: SignInBody,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionResponse> {
    return this.deliver(res, await this.auth.signIn(body));
  }

  @Post('refresh')
  @HttpCode(200)
  // Called silently on every page load and access-token expiry.
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Rotate the refresh cookie and issue a new access token' })
  @ApiOkResponse({
    description: 'Fresh session. The previous refresh token stops working.',
    schema: { $ref: '#/components/schemas/SessionResponse' },
  })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionResponse> {
    try {
      return this.deliver(
        res,
        await this.auth.refresh(readCookie(req.headers.cookie, REFRESH_COOKIE)),
      );
    } catch (err) {
      res.clearCookie(REFRESH_COOKIE, this.cookieOptions());
      throw err;
    }
  }

  @Post('sign-out')
  @HttpCode(204)
  @ApiOperation({ summary: 'End the session and clear the refresh cookie' })
  @ApiNoContentResponse({ description: 'Signed out.' })
  async signOut(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.signOut(readCookie(req.headers.cookie, REFRESH_COOKIE));
    res.clearCookie(REFRESH_COOKIE, this.cookieOptions());
  }

  private deliver(res: Response, issued: IssuedSession): SessionResponse {
    res.cookie(REFRESH_COOKIE, issued.refreshToken, {
      ...this.cookieOptions(),
      maxAge: issued.refreshMaxAgeMs,
    });
    return issued.session;
  }

  private cookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.config.get('NODE_ENV', { infer: true }) === 'production',
      path: REFRESH_COOKIE_PATH,
    };
  }
}
