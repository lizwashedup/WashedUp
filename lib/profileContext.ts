export type ProfileContextKind = 'person' | 'creator' | 'community';

export interface LeadershipMembership {
  communityId: string;
  role: 'leader' | 'co_leader' | 'admin' | 'events' | 'member_care' | 'finance' | 'member';
  active: boolean;
}

export interface ProfileContext {
  key: string;
  kind: ProfileContextKind;
  ownerUserId: string;
  communityId: string | null;
}

export interface ProfileContextAccess {
  userId: string;
  hasCreatorGrant: boolean;
  memberships: readonly LeadershipMembership[];
}

export function availableProfileContexts(access: ProfileContextAccess): ProfileContext[] {
  const contexts: ProfileContext[] = [{
    key: `person:${access.userId}`,
    kind: 'person',
    ownerUserId: access.userId,
    communityId: null,
  }];
  const ledCommunityIds = [...new Set(
    access.memberships
      .filter((membership) => membership.active && membership.role !== 'member')
      .map((membership) => membership.communityId)
      .filter(Boolean),
  )].sort();

  if (access.hasCreatorGrant || ledCommunityIds.length > 0) {
    contexts.push({
      key: `creator:${access.userId}`,
      kind: 'creator',
      ownerUserId: access.userId,
      communityId: null,
    });
  }

  for (const communityId of ledCommunityIds) {
    contexts.push({
      key: `community:${communityId}`,
      kind: 'community',
      ownerUserId: access.userId,
      communityId,
    });
  }
  return contexts;
}

export function resolveProfileContext(
  requestedKey: string | null | undefined,
  contexts: readonly ProfileContext[],
): ProfileContext | null {
  if (contexts.length === 0) return null;
  if (requestedKey) {
    const requested = contexts.find((context) => context.key === requestedKey);
    if (requested) return requested;
  }
  return contexts.find((context) => context.kind === 'person') ?? null;
}
