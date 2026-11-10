import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBody, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { PushSubscriptionBody, UpdateNotificationPreferencesBody } from '../../contract';
import { AuthGuard } from '../identity/dev-auth';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@Controller('notifications')
@UseGuards(AuthGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'List in-app notifications for the signed-in user (newest first)' })
  @ApiOkResponse({
    description: 'User notifications.',
    schema: { $ref: '#/components/schemas/NotificationsResponse' },
  })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.notifications.listNotifications(user.id);
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark all unread notifications as read for the signed-in user' })
  @ApiOkResponse({
    description: 'Count of notifications marked read.',
    schema: { $ref: '#/components/schemas/ReadAllNotificationsResponse' },
  })
  markAllRead(@CurrentUser() user: AuthenticatedUser) {
    return this.notifications.markAllRead(user.id);
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark a single notification as read' })
  @ApiOkResponse({
    description: 'Updated notification with readAt populated.',
    schema: { $ref: '#/components/schemas/AttendeeNotification' },
  })
  markRead(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.notifications.markRead(user.id, id);
  }

  @Post('push-subscribe')
  @ApiOperation({ summary: 'Register an HTTPS Web Push VAPID subscription for this device' })
  @ApiBody({ schema: { $ref: '#/components/schemas/PushSubscriptionBody' } })
  @ApiCreatedResponse({
    description: 'Saved Web Push subscription.',
    schema: { $ref: '#/components/schemas/PushSubscribeResponse' },
  })
  subscribePush(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(PushSubscriptionBody)) body: PushSubscriptionBody,
  ) {
    return this.notifications.subscribePush(user.id, body);
  }

  @Patch('preferences')
  @ApiOperation({ summary: 'Update notification category mute preferences' })
  @ApiBody({ schema: { $ref: '#/components/schemas/UpdateNotificationPreferencesBody' } })
  @ApiOkResponse({
    description: 'Saved notification mute preferences.',
    schema: { $ref: '#/components/schemas/NotificationPreferencesResponse' },
  })
  updatePreferences(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(UpdateNotificationPreferencesBody))
    body: UpdateNotificationPreferencesBody,
  ) {
    return this.notifications.updatePreferences(user.id, body);
  }
}
