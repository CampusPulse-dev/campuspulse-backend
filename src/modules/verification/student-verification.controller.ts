import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import {
  ConfirmStudentOtpBody,
  StudentIdRequestBody,
  StudentOtpBody,
  StudentUploadBody,
} from '../../contract';
import { AuthGuard } from '../identity/auth';
import { StudentVerificationService } from './student-verification.service';

type OtpBody = { email: string };
type ConfirmBody = { email: string; code: string };
type UploadBody = { contentType: 'image/jpeg' | 'image/png'; size: number };
type IdRequestBody = { documentUploadId: string };

@ApiTags('verification')
@Controller('verification/student')
@UseGuards(AuthGuard, ThrottlerGuard)
export class StudentVerificationController {
  constructor(private readonly verification: StudentVerificationService) {}

  @Get()
  @ApiOperation({ summary: 'Current student verification state for the signed-in user' })
  @ApiOkResponse({
    description: 'Verification state.',
    schema: { $ref: '#/components/schemas/StudentVerificationState' },
  })
  getState(@CurrentUser() user: AuthenticatedUser) {
    return this.verification.getState(user.id);
  }

  @Post('email-otp')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Send a 6-digit code to a *.ui.edu.ng address (10 min TTL)' })
  @ApiBody({ schema: { $ref: '#/components/schemas/StudentOtpBody' } })
  @ApiOkResponse({
    description: 'Code accepted for delivery.',
    schema: { $ref: '#/components/schemas/StudentOtpSentResponse' },
  })
  requestOtp(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(StudentOtpBody)) body: OtpBody,
  ) {
    return this.verification.requestOtp(user.id, body.email);
  }

  @Post('confirm-otp')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Confirm the emailed code (5 attempts, then a 15 min lock)' })
  @ApiBody({ schema: { $ref: '#/components/schemas/ConfirmStudentOtpBody' } })
  @ApiOkResponse({
    description: 'The now-verified user.',
    schema: { $ref: '#/components/schemas/UserPublic' },
  })
  confirmOtp(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(ConfirmStudentOtpBody)) body: ConfirmBody,
  ) {
    return this.verification.confirmOtp(user.id, body.email, body.code);
  }

  @Post('upload-url')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Presigned PUT to the private bucket for a student ID image' })
  @ApiBody({ schema: { $ref: '#/components/schemas/StudentUploadBody' } })
  @ApiOkResponse({
    description: 'Upload URL plus an opaque handle. No public URL exists for the image.',
    schema: { $ref: '#/components/schemas/StudentUploadResponse' },
  })
  createUpload(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(StudentUploadBody)) body: UploadBody,
  ) {
    return this.verification.createUpload(user.id, body);
  }

  @Post('id-request')
  @HttpCode(200)
  @ApiOperation({ summary: 'Submit the uploaded student ID for Super Admin review' })
  @ApiBody({ schema: { $ref: '#/components/schemas/StudentIdRequestBody' } })
  @ApiOkResponse({
    description: 'Verification state after submission.',
    schema: { $ref: '#/components/schemas/StudentVerificationState' },
  })
  submitIdRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(StudentIdRequestBody)) body: IdRequestBody,
  ) {
    return this.verification.submitIdRequest(user.id, body.documentUploadId);
  }
}
