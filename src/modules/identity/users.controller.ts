import { Body, Controller, Get, NotFoundException, Patch, Put, UseGuards } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { NotificationCategory as PrismaNotificationCategory } from '@prisma/client';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../common/decorators/current-user.decorator';
import { toAttendeePreferences, toUserPublic } from '../../common/mappers/entity.mappers';
import { PrismaService } from '../../common/prisma.service';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import {
  AttendeePersona,
  AttendeePrivacy,
  NotificationCategory,
  UpdateProfileBody,
  type AttendeePreferences,
  type UserPublic,
} from '../../contract';
import { AuthGuard } from './dev-auth';

const VALID_NOTIFICATION_CATEGORIES = new Set<string>(NotificationCategory.options);

@ApiTags('users')
@Controller('users')
@UseGuards(AuthGuard)
export class UsersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('me')
  @ApiOperation({ summary: 'Current signed-in user profile' })
  @ApiOkResponse({
    description: 'Public profile of the signed-in user.',
    schema: { $ref: '#/components/schemas/UserPublic' },
  })
  async getMe(@CurrentUser() current: AuthenticatedUser): Promise<UserPublic> {
    const user = await this.prisma.user.findUnique({
      where: { id: current.id },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return toUserPublic(user);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update display name of signed-in user' })
  @ApiBody({ schema: { $ref: '#/components/schemas/UpdateProfileBody' } })
  @ApiOkResponse({
    description: 'Updated user profile.',
    schema: { $ref: '#/components/schemas/UserPublic' },
  })
  async updateMe(
    @CurrentUser() current: AuthenticatedUser,
    @Body(new ZodValidationPipe(UpdateProfileBody)) body: UpdateProfileBody,
  ): Promise<UserPublic> {
    const updated = await this.prisma.user.update({
      where: { id: current.id },
      data: { displayName: body.displayName },
    });
    return toUserPublic(updated);
  }

  @Get('me/preferences')
  @ApiOperation({ summary: 'Current attendee persona and privacy preferences' })
  @ApiOkResponse({
    description: 'Attendee persona and privacy settings.',
    schema: { $ref: '#/components/schemas/AttendeePreferences' },
  })
  async getPreferences(@CurrentUser() current: AuthenticatedUser): Promise<AttendeePreferences> {
    return this.loadPreferences(current.id);
  }

  @Put('me/preferences')
  @ApiOperation({ summary: 'Update attendee privacy and notification category mutes' })
  @ApiBody({ schema: { $ref: '#/components/schemas/AttendeePrivacy' } })
  @ApiOkResponse({
    description: 'Updated attendee preferences.',
    schema: { $ref: '#/components/schemas/AttendeePreferences' },
  })
  async updatePreferences(
    @CurrentUser() current: AuthenticatedUser,
    @Body(new ZodValidationPipe(AttendeePrivacy)) body: AttendeePrivacy,
  ): Promise<AttendeePreferences> {
    const mutedCategories = body.mutedCategories.filter((c) =>
      VALID_NOTIFICATION_CATEGORIES.has(c),
    ) as PrismaNotificationCategory[];

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: current.id },
        data: {
          rsvpVisibility: body.stealthRsvp ? 'PRIVATE' : 'FRIENDS',
          hideFromFriends: body.hideFromFriends,
          theme: body.theme,
        },
      }),
      this.prisma.notificationPreference.upsert({
        where: { userId: current.id },
        create: {
          userId: current.id,
          mutedCategories,
        },
        update: {
          mutedCategories,
        },
      }),
    ]);

    return this.loadPreferences(current.id);
  }

  @Put('me/persona')
  @ApiOperation({
    summary: 'Save attendee onboarding persona, UI cohort, and starter club follows',
  })
  @ApiBody({ schema: { $ref: '#/components/schemas/AttendeePersona' } })
  @ApiOkResponse({
    description: 'Saved attendee persona.',
    schema: { $ref: '#/components/schemas/AttendeePersona' },
  })
  async updatePersona(
    @CurrentUser() current: AuthenticatedUser,
    @Body(new ZodValidationPipe(AttendeePersona)) body: AttendeePersona,
  ): Promise<AttendeePersona> {
    const uniqueClubIds = [...new Set(body.followedClubIds)];

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: current.id },
        data: {
          hall: body.hall.trim() || null,
          faculty: body.faculty.trim() || null,
          level: body.level.trim() || null,
        },
      });

      await tx.personaProfile.upsert({
        where: { userId: current.id },
        create: {
          userId: current.id,
          interestTags: body.vibes,
          goingOutRhythm: body.rhythm,
          freeOnly: body.freeEventsOnly,
          personaLabel: body.personaBadge.trim() || 'Campus Explorer',
          skippedAt: body.skipped ? new Date() : null,
        },
        update: {
          interestTags: body.vibes,
          goingOutRhythm: body.rhythm,
          freeOnly: body.freeEventsOnly,
          personaLabel: body.personaBadge.trim() || 'Campus Explorer',
          skippedAt: body.skipped ? new Date() : null,
        },
      });

      if (uniqueClubIds.length > 0) {
        const validClubs = await tx.organizer.findMany({
          where: { id: { in: uniqueClubIds } },
          select: { id: true },
        });
        for (const club of validClubs) {
          await tx.follow.upsert({
            where: { userId_organizerId: { userId: current.id, organizerId: club.id } },
            create: { userId: current.id, organizerId: club.id },
            update: {},
          });
          const count = await tx.follow.count({ where: { organizerId: club.id } });
          await tx.organizer.update({
            where: { id: club.id },
            data: { followerCount: count },
          });
        }
      }
    });

    const prefs = await this.loadPreferences(current.id);
    return (
      prefs.persona ?? {
        ...body,
        followedClubIds: uniqueClubIds,
      }
    );
  }

  private async loadPreferences(userId: string): Promise<AttendeePreferences> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        personaProfile: true,
        follows: { select: { organizerId: true } },
        notificationPreference: true,
      },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return toAttendeePreferences({
      user,
      persona: user.personaProfile,
      followedClubIds: user.follows.map((f) => f.organizerId),
      mutedCategories: user.notificationPreference?.mutedCategories ?? [],
    });
  }
}
