import { Controller, Post, Body, Res, HttpCode, HttpStatus } from '@nestjs/common';
import { Response } from 'express';
import { IdentityService } from './identity.service';
import { SignUpDto, SignInDto } from './dto/auth.dto';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { SignUpBody, SignInBody } from '../../contract/api/identity';

@ApiTags('auth')
@Controller('auth')
export class IdentityController {
  constructor(private readonly identityService: IdentityService) {}

  @Post('signup')
  @ApiOperation({ summary: 'Register a new user' })
  @ApiResponse({ status: 201, description: 'User created' })
  async signUp(
    @Body(new ZodValidationPipe(SignUpBody)) dto: SignUpDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const session = await this.identityService.signUp(dto);
    this.setCookie(res, session.accessToken, session.expiresIn);
    return session;
  }

  @Post('signin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login an existing user' })
  @ApiResponse({ status: 200, description: 'User logged in' })
  async signIn(
    @Body(new ZodValidationPipe(SignInBody)) dto: SignInDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const session = await this.identityService.signIn(dto);
    this.setCookie(res, session.accessToken, session.expiresIn);
    return session;
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Log out user' })
  @ApiResponse({ status: 200, description: 'User logged out' })
  logout(@Res({ passthrough: true }) res: Response) {
    res.cookie('jwt', '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      expires: new Date(0), // expire immediately
    });
    return { success: true };
  }

  private setCookie(res: Response, token: string, expiresInSeconds: number) {
    res.cookie('jwt', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production', // true if production
      sameSite: 'lax',
      maxAge: expiresInSeconds * 1000,
    });
  }
}
