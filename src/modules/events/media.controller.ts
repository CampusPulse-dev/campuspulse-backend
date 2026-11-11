import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBody, ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../common/decorators/current-user.decorator';
import { StorageService } from '../../common/storage/storage.service';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { MediaUploadUrlBody, type MediaUploadUrlResponse } from '../../contract';
import { AuthGuard } from '../identity/auth';

@ApiTags('media')
@Controller('media')
@UseGuards(AuthGuard)
export class MediaController {
  constructor(private readonly storage: StorageService) {}

  @Post('upload-url')
  @ApiOperation({ summary: 'Issue a short-lived presigned PUT URL for public media uploads' })
  @ApiBody({ schema: { $ref: '#/components/schemas/MediaUploadUrlBody' } })
  @ApiCreatedResponse({
    description: 'Presigned S3/MinIO upload URL and canonical public URL.',
    schema: { $ref: '#/components/schemas/MediaUploadUrlResponse' },
  })
  createUploadUrl(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(MediaUploadUrlBody)) body: MediaUploadUrlBody,
  ): Promise<MediaUploadUrlResponse> {
    return this.storage.createPresignedUpload({
      ...body,
      userId: user.id,
    });
  }
}
