import type { Prisma } from '@prisma/client';
import type {
  AttendeePreferences,
  EventPublic,
  OrganizerPublic,
  Story,
  UserPublic,
} from '../../contract';

export const EVENT_PUBLIC_INCLUDE = {
  organizer: true,
  showtimes: {
    orderBy: { startsAt: 'asc' },
  },
  lineupItems: {
    orderBy: { sortOrder: 'asc' },
  },
  fixture: true,
  parentEvent: {
    select: {
      id: true,
      slug: true,
      title: true,
      status: true,
    },
  },
  childEvents: {
    where: {
      linkType: 'AFTER_PARTY',
      parentLinkApproved: true,
      status: 'PUBLISHED',
    },
    orderBy: { startsAt: 'asc' },
    take: 1,
  },
} satisfies Prisma.EventInclude;

export type EventWithPublicRelations = Prisma.EventGetPayload<{
  include: typeof EVENT_PUBLIC_INCLUDE;
}>;

export function toUserPublic(user: {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  role: UserPublic['role'];
  isVerifiedStudent: boolean;
}): UserPublic {
  return {
    id: user.id,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    role: user.role,
    isVerifiedStudent: user.isVerifiedStudent,
  };
}

export function toOrganizerPublic(organizer: {
  id: string;
  slug: string;
  name: string;
  bio: string | null;
  logoUrl: string | null;
  isVerified: boolean;
  followerCount: number;
}): OrganizerPublic {
  return {
    id: organizer.id,
    slug: organizer.slug,
    name: organizer.name,
    bio: organizer.bio,
    logoUrl: organizer.logoUrl,
    isVerified: organizer.isVerified,
    followerCount: organizer.followerCount,
  };
}

const V1_TEMPLATES = new Set(['GENERIC', 'CONCERT_PARTY', 'PLAY_CULTURAL', 'MATCH_TOURNAMENT']);

export interface EventMapperExtras {
  friendsGoing?: Array<Pick<UserPublic, 'id' | 'displayName' | 'avatarUrl'>>;
  friendsGoingCount?: number;
}

export function toEventPublic(
  event: EventWithPublicRelations,
  extras?: EventMapperExtras,
): EventPublic {
  const template: NonNullable<EventPublic['template']> = V1_TEMPLATES.has(event.template)
    ? (event.template as NonNullable<EventPublic['template']>)
    : 'GENERIC';

  const lineup = event.lineupItems
    .filter((item) => item.roleType !== 'CAST_CREW')
    .map((item) => ({
      id: item.id,
      performerName: item.displayName,
      role: item.roleLabel,
      setTime: item.setTime ?? '',
    }));

  const castAndCrew = event.lineupItems
    .filter((item) => item.roleType === 'CAST_CREW')
    .map((item) => item.displayName);

  const showtimes = event.showtimes.map((st) => {
    const cap = st.capacity ?? event.capacity ?? 100;
    return {
      id: st.id,
      label: st.label,
      startsAt: st.startsAt.toISOString(),
      spotsLeft: Math.max(0, cap - st.rsvpCount),
    };
  });

  const afterParty = event.childEvents[0];
  const linkedAfterParty = afterParty
    ? {
        id: afterParty.id,
        slug: afterParty.slug,
        title: afterParty.title,
        startsAt: afterParty.startsAt.toISOString(),
        venueName: afterParty.venueName,
        accessRule: afterParty.afterPartyAccess,
      }
    : null;

  const hasVisibleParent =
    event.parentEvent !== null &&
    event.parentLinkApproved &&
    event.parentEvent.status === 'PUBLISHED';

  return {
    id: event.id,
    slug: event.slug,
    title: event.title,
    description: event.description,
    category: event.category,
    status: event.status,
    startsAt: event.startsAt.toISOString(),
    endsAt: event.endsAt.toISOString(),
    venueName: event.venueName,
    venueDetail: event.venueDetail,
    coverImageUrl: event.coverImageUrl,
    capacity: event.capacity,
    rsvpCount: event.rsvpCount,
    organizer: toOrganizerPublic(event.organizer),
    createdAt: event.createdAt.toISOString(),
    updatedAt: event.updatedAt.toISOString(),
    template,
    studentsOnly: event.studentsOnly,
    waitlistEnabled: event.waitlistEnabled,
    dressCode: event.dressCode,
    doorPolicy: event.doorPolicy,
    ...(event.tonightMood ? { tonightMood: event.tonightMood } : {}),
    friendsGoing: extras?.friendsGoing ?? [],
    friendsGoingCount: extras?.friendsGoingCount ?? 0,
    ...(lineup.length > 0 ? { lineup } : {}),
    ...(castAndCrew.length > 0 ? { castAndCrew } : {}),
    ...(showtimes.length > 0 ? { showtimes } : {}),
    ...(event.fixture
      ? {
          fixture: {
            homeTeam: event.fixture.homeTeamName,
            awayTeam: event.fixture.awayTeamName,
            homeScore: event.fixture.homeScore,
            awayScore: event.fixture.awayScore,
            isLive: event.fixture.isLive,
            periodLabel: event.fixture.statusLabel,
          },
        }
      : {}),
    linkedAfterParty,
    parentEventSlug: hasVisibleParent ? event.parentEvent!.slug : null,
    parentEventTitle: hasVisibleParent ? event.parentEvent!.title : null,
  };
}

export function toStoryContract(story: {
  id: string;
  organizer: Parameters<typeof toOrganizerPublic>[0];
  eventId: string | null;
  mediaUrl: string;
  mediaType: string;
  caption: string | null;
  createdAt: Date;
  expiresAt: Date;
}): Story {
  return {
    id: story.id,
    organizer: toOrganizerPublic(story.organizer),
    eventId: story.eventId,
    mediaUrl: story.mediaUrl,
    mediaType: story.mediaType === 'VIDEO' ? 'VIDEO' : 'IMAGE',
    caption: story.caption,
    createdAt: story.createdAt.toISOString(),
    expiresAt: story.expiresAt.toISOString(),
  };
}

export function toAttendeePreferences(params: {
  user: {
    hall: string | null;
    faculty: string | null;
    level: string | null;
    rsvpVisibility: string;
    hideFromFriends: boolean;
    theme: string;
  };
  persona: {
    interestTags: string[];
    goingOutRhythm: string;
    freeOnly: boolean;
    personaLabel: string;
    skippedAt: Date | null;
  } | null;
  followedClubIds: string[];
  mutedCategories: string[];
}): AttendeePreferences {
  const { user, persona, followedClubIds, mutedCategories } = params;
  const rhythm: 'WEEKNIGHTS' | 'WEEKENDS' | 'BOTH' =
    persona?.goingOutRhythm === 'WEEKNIGHTS' || persona?.goingOutRhythm === 'WEEKENDS'
      ? persona.goingOutRhythm
      : 'BOTH';
  const theme: 'system' | 'dark' | 'light' =
    user.theme === 'dark' || user.theme === 'light' ? user.theme : 'system';

  return {
    persona: persona
      ? {
          skipped: persona.skippedAt !== null,
          vibes: persona.interestTags.slice(0, 5),
          hall: user.hall ?? '',
          faculty: user.faculty ?? '',
          level: user.level ?? '',
          rhythm,
          freeEventsOnly: persona.freeOnly,
          personaBadge: persona.personaLabel,
          followedClubIds,
        }
      : null,
    privacy: {
      stealthRsvp: user.rsvpVisibility === 'PRIVATE',
      hideFromFriends: user.hideFromFriends,
      mutedCategories,
      theme,
    },
  };
}
