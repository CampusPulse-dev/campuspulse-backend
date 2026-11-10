import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { toUserPublic } from '../../common/mappers/entity.mappers';
import { PrismaService } from '../../common/prisma.service';
import type {
  FriendActionBody,
  FriendEntry,
  FriendRequestBody,
  FriendsResponse,
} from '../../contract';

const USER_FRIEND_SELECT = {
  id: true,
  displayName: true,
  avatarUrl: true,
  role: true,
  isVerifiedStudent: true,
  hall: true,
  faculty: true,
} as const;

@Injectable()
export class FriendsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(viewerId: string): Promise<FriendsResponse> {
    const viewer = await this.prisma.user.findUnique({
      where: { id: viewerId },
      select: { id: true, hall: true, faculty: true },
    });
    if (!viewer) {
      throw new NotFoundException('User not found');
    }

    const rows = await this.prisma.friendship.findMany({
      where: {
        OR: [{ requesterId: viewerId }, { addresseeId: viewerId }],
      },
      orderBy: { updatedAt: 'desc' },
      include: {
        requester: { select: USER_FRIEND_SELECT },
        addressee: { select: USER_FRIEND_SELECT },
      },
    });

    const blockedIds = new Set<string>();
    const connectedIds = new Set<string>([viewerId]);

    for (const row of rows) {
      const other = row.requesterId === viewerId ? row.addressee : row.requester;
      connectedIds.add(other.id);
      if (row.status === 'BLOCKED') {
        blockedIds.add(other.id);
      }
    }

    const items: FriendEntry[] = [];
    const seenPeers = new Set<string>();

    for (const row of rows) {
      const other = row.requesterId === viewerId ? row.addressee : row.requester;
      if (blockedIds.has(other.id) || seenPeers.has(other.id)) {
        continue;
      }
      seenPeers.add(other.id);

      const status: FriendEntry['status'] =
        row.status === 'ACCEPTED'
          ? 'ACCEPTED'
          : row.addresseeId === viewerId
            ? 'INCOMING'
            : 'OUTGOING';

      items.push({
        id: row.id,
        user: toUserPublic(other),
        hall: other.hall,
        faculty: other.faculty,
        status,
      });
    }

    const candidates = await this.prisma.user.findMany({
      where: {
        id: { notIn: [...connectedIds] },
        role: 'ATTENDEE',
        hideFromFriends: false,
      },
      select: USER_FRIEND_SELECT,
      orderBy: { createdAt: 'asc' },
      take: 30,
    });

    candidates.sort((a, b) => {
      const score = (u: typeof a) => {
        let s = 0;
        if (viewer.hall && u.hall === viewer.hall) s += 2;
        if (viewer.faculty && u.faculty === viewer.faculty) s += 1;
        return s;
      };
      return score(b) - score(a) || a.displayName.localeCompare(b.displayName);
    });

    for (const candidate of candidates) {
      items.push({
        id: candidate.id,
        user: toUserPublic(candidate),
        hall: candidate.hall,
        faculty: candidate.faculty,
        status: 'SUGGESTED',
      });
    }

    return { items };
  }

  async requestFriendship(viewerId: string, body: FriendRequestBody): Promise<FriendEntry> {
    const targetId = body.userId;
    if (targetId === viewerId) {
      throw new BadRequestException('Cannot send a friend request to yourself');
    }

    const target = await this.prisma.user.findUnique({
      where: { id: targetId },
      select: USER_FRIEND_SELECT,
    });
    if (!target) {
      throw new NotFoundException('Target user not found');
    }

    const existing = await this.prisma.friendship.findMany({
      where: {
        OR: [
          { requesterId: viewerId, addresseeId: targetId },
          { requesterId: targetId, addresseeId: viewerId },
        ],
      },
    });

    if (existing.some((r) => r.status === 'BLOCKED')) {
      throw new ForbiddenException('Cannot send a friend request to this user');
    }

    const accepted = existing.find((r) => r.status === 'ACCEPTED');
    if (accepted) {
      return {
        id: accepted.id,
        user: toUserPublic(target),
        hall: target.hall,
        faculty: target.faculty,
        status: 'ACCEPTED',
      };
    }

    const incoming = existing.find((r) => r.status === 'PENDING' && r.requesterId === targetId);
    if (incoming) {
      const upgraded = await this.prisma.friendship.update({
        where: { id: incoming.id },
        data: { status: 'ACCEPTED' },
      });
      return {
        id: upgraded.id,
        user: toUserPublic(target),
        hall: target.hall,
        faculty: target.faculty,
        status: 'ACCEPTED',
      };
    }

    const outgoing = existing.find((r) => r.status === 'PENDING' && r.requesterId === viewerId);
    if (outgoing) {
      return {
        id: outgoing.id,
        user: toUserPublic(target),
        hall: target.hall,
        faculty: target.faculty,
        status: 'OUTGOING',
      };
    }

    const created = await this.prisma.friendship.create({
      data: {
        requesterId: viewerId,
        addresseeId: targetId,
        status: 'PENDING',
      },
    });

    return {
      id: created.id,
      user: toUserPublic(target),
      hall: target.hall,
      faculty: target.faculty,
      status: 'OUTGOING',
    };
  }

  async respond(viewerId: string, id: string, body: FriendActionBody): Promise<FriendEntry> {
    if (body.action === 'REQUEST') {
      return this.requestFriendship(viewerId, { userId: id });
    }

    if (body.action === 'BLOCK') {
      return this.blockPeer(viewerId, id);
    }

    const friendship = await this.prisma.friendship.findUnique({
      where: { id },
      include: {
        requester: { select: USER_FRIEND_SELECT },
        addressee: { select: USER_FRIEND_SELECT },
      },
    });
    if (!friendship) {
      throw new NotFoundException('Friend request not found');
    }
    if (friendship.requesterId !== viewerId && friendship.addresseeId !== viewerId) {
      throw new ForbiddenException('Not authorized to modify this friendship');
    }
    if (friendship.status !== 'PENDING') {
      throw new BadRequestException('Friend request is no longer pending');
    }

    const other = friendship.requesterId === viewerId ? friendship.addressee : friendship.requester;

    if (body.action === 'ACCEPT') {
      if (friendship.addresseeId !== viewerId) {
        throw new ForbiddenException('Only the recipient can accept a friend request');
      }
      const updated = await this.prisma.friendship.update({
        where: { id: friendship.id },
        data: { status: 'ACCEPTED' },
      });
      return {
        id: updated.id,
        user: toUserPublic(other),
        hall: other.hall,
        faculty: other.faculty,
        status: 'ACCEPTED',
      };
    }

    // DECLINE (or cancel outgoing pending request)
    await this.prisma.friendship.delete({ where: { id: friendship.id } });
    return {
      id: other.id,
      user: toUserPublic(other),
      hall: other.hall,
      faculty: other.faculty,
      status: 'SUGGESTED',
    };
  }

  private async blockPeer(viewerId: string, friendshipOrUserId: string): Promise<FriendEntry> {
    const friendship = await this.prisma.friendship.findUnique({
      where: { id: friendshipOrUserId },
      include: {
        requester: { select: USER_FRIEND_SELECT },
        addressee: { select: USER_FRIEND_SELECT },
      },
    });

    let target: {
      id: string;
      displayName: string;
      avatarUrl: string | null;
      role: FriendEntry['user']['role'];
      isVerifiedStudent: boolean;
      hall: string | null;
      faculty: string | null;
    } | null = null;

    if (friendship) {
      if (friendship.requesterId !== viewerId && friendship.addresseeId !== viewerId) {
        throw new ForbiddenException('Not authorized to modify this friendship');
      }
      target = friendship.requesterId === viewerId ? friendship.addressee : friendship.requester;
    } else {
      target = await this.prisma.user.findUnique({
        where: { id: friendshipOrUserId },
        select: USER_FRIEND_SELECT,
      });
    }

    if (!target) {
      throw new NotFoundException('User not found');
    }
    if (target.id === viewerId) {
      throw new BadRequestException('Cannot block yourself');
    }

    const blocked = await this.prisma.$transaction(async (tx) => {
      await tx.friendship.deleteMany({
        where: {
          OR: [
            { requesterId: viewerId, addresseeId: target.id },
            { requesterId: target.id, addresseeId: viewerId },
          ],
        },
      });
      return tx.friendship.create({
        data: {
          requesterId: viewerId,
          addresseeId: target.id,
          status: 'BLOCKED',
        },
      });
    });

    return {
      id: blocked.id,
      user: toUserPublic(target),
      hall: target.hall,
      faculty: target.faculty,
      status: 'BLOCKED',
    };
  }
}
