/** Draft, pure policy only. Nothing imports a database, provider, clock or UI.
 * "eligible" means this preference/recipient gate permits further evaluation;
 * it is not a send instruction or proof of consent, dedupe, or delivery. */
export type CommunityChatKnownBoolean = boolean | null | undefined;

export type ClassifiedCommunityChatSource =
  /** Future provisioned Intros room only. Never infer this role from a mixed
   * legacy broadcast stream, its name, or an introductory-looking message. */
  | { readonly kind: 'intros'; readonly roomId: string; readonly communityId: string; readonly eventId: null }
  | { readonly kind: 'main'; readonly communityId: string; readonly eventId: null }
  | { readonly kind: 'persistent-topic'; readonly communityId: string; readonly topicId: string; readonly eventId: null }
  | { readonly kind: 'event-topic'; readonly communityId: string; readonly topicId: string; readonly eventId: string };

export type CommunityChatNotificationSource = ClassifiedCommunityChatSource
  | { readonly kind: 'unclassified' }
  | { readonly kind: 'outside-chat-policy' };

export interface CommunityChatRecipientFacts {
  /** Account whose authoritative eligibility and preferences were read. */
  readonly userId: string | null | undefined;
  readonly source: CommunityChatNotificationSource | null | undefined;
  /** Caller must resolve current access, blocks, self-notification and any
   * message-author requirements. This evaluator never grants those rights. */
  readonly recipientEligible: CommunityChatKnownBoolean;
  readonly activeCommunityMember: CommunityChatKnownBoolean;
  readonly topicJoined: CommunityChatKnownBoolean;
  readonly parentMuted: CommunityChatKnownBoolean;
  readonly introsMuted: CommunityChatKnownBoolean;
  readonly mainMuted: CommunityChatKnownBoolean;
  readonly topicNotificationsOn: CommunityChatKnownBoolean;
}

export type CommunityChatMuteReason = 'community-muted' | 'room-muted';

/** A terminal decision for ONE logical notification, not a room preference.
 * A later unmute must not revive this notification or suppress a new one. */
export interface CommunityChatMutedSuppression {
  readonly notificationId: string;
  readonly recipientUserId: string;
  readonly source: ClassifiedCommunityChatSource;
  readonly reason: CommunityChatMuteReason;
}

export interface CommunityChatMuteInput {
  readonly notificationId: string;
  readonly recipientUserId: string;
  readonly source: CommunityChatNotificationSource;
  readonly facts: CommunityChatRecipientFacts;
  /** null means confirmed no previous mute suppression (including fresh
   * activity); undefined means its status has not been resolved. */
  readonly previousMuteSuppression: CommunityChatMutedSuppression | null | undefined;
}

export type CommunityChatMuteDecision =
  | { readonly status: 'eligible'; readonly reason: 'preferences-allow' }
  | { readonly status: 'suppressed'; readonly reason: CommunityChatMuteReason;
      readonly terminalSuppression: CommunityChatMutedSuppression }
  | { readonly status: 'suppressed'; readonly reason: 'recipient-ineligible' | 'not-community-member' | 'not-topic-member' }
  | { readonly status: 'unresolved'; readonly reason:
      'invalid-notification-identity' | 'unknown-source' | 'outside-chat-policy'
      | 'unknown-account' | 'account-mismatch' | 'source-facts-mismatch'
      | 'unknown-prior-suppression' | 'invalid-prior-suppression'
      | 'unknown-recipient-eligibility' | 'unknown-community-membership'
      | 'unknown-topic-membership' | 'unknown-preferences' };

const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const known = (value: unknown): value is boolean => typeof value === 'boolean';

function sourceIdentity(source: CommunityChatNotificationSource | null | undefined): string | null {
  if (!source || !('communityId' in source) || !nonempty(source.communityId)) return null;
  if (source.kind === 'intros' && nonempty(source.roomId) && source.eventId === null) {
    return JSON.stringify([source.kind, source.communityId, source.roomId]);
  }
  if (source.kind === 'main' && source.eventId === null) {
    return JSON.stringify([source.kind, source.communityId]);
  }
  if (source.kind === 'persistent-topic' && nonempty(source.topicId) && source.eventId === null) {
    return JSON.stringify([source.kind, source.communityId, source.topicId]);
  }
  if (source.kind === 'event-topic' && nonempty(source.topicId) && nonempty(source.eventId)) {
    return JSON.stringify([source.kind, source.communityId, source.topicId, source.eventId]);
  }
  return null;
}

export function evaluateCommunityChatMute(input: CommunityChatMuteInput): CommunityChatMuteDecision {
  const { notificationId, recipientUserId, source, facts, previousMuteSuppression } = input;
  if (!nonempty(notificationId) || !nonempty(recipientUserId)) {
    return { status: 'unresolved', reason: 'invalid-notification-identity' };
  }
  if (source?.kind === 'outside-chat-policy') return { status: 'unresolved', reason: 'outside-chat-policy' };
  const identity = sourceIdentity(source);
  if (!identity) return { status: 'unresolved', reason: 'unknown-source' };
  // sourceIdentity validates both the discriminant and required provenance.
  const classified = source as ClassifiedCommunityChatSource;
  if (!nonempty(facts?.userId)) return { status: 'unresolved', reason: 'unknown-account' };
  if (facts.userId !== recipientUserId) return { status: 'unresolved', reason: 'account-mismatch' };
  if (sourceIdentity(facts.source) !== identity) return { status: 'unresolved', reason: 'source-facts-mismatch' };

  if (previousMuteSuppression === undefined) return { status: 'unresolved', reason: 'unknown-prior-suppression' };
  if (previousMuteSuppression !== null) {
    const previous = previousMuteSuppression;
    if (previous.notificationId !== notificationId || previous.recipientUserId !== recipientUserId
      || sourceIdentity(previous.source) !== identity
      || !['community-muted', 'room-muted'].includes(previous.reason)
      || (classified.kind === 'event-topic' && previous.reason === 'community-muted')) {
      return { status: 'unresolved', reason: 'invalid-prior-suppression' };
    }
    // This exact notification is already terminal, even if current preferences
    // or membership have changed. Its old body must never become a catch-up push.
    return { status: 'suppressed', reason: previous.reason,
      terminalSuppression: { ...previous, source: { ...previous.source } } };
  }

  if (facts.recipientEligible === false) return { status: 'suppressed', reason: 'recipient-ineligible' };
  if (!known(facts.recipientEligible)) return { status: 'unresolved', reason: 'unknown-recipient-eligibility' };
  if (classified.kind !== 'event-topic') {
    if (facts.activeCommunityMember === false) return { status: 'suppressed', reason: 'not-community-member' };
    if (!known(facts.activeCommunityMember)) return { status: 'unresolved', reason: 'unknown-community-membership' };
  }
  if (classified.kind === 'persistent-topic' || classified.kind === 'event-topic') {
    if (facts.topicJoined === false) return { status: 'suppressed', reason: 'not-topic-member' };
    if (!known(facts.topicJoined)) return { status: 'unresolved', reason: 'unknown-topic-membership' };
  }

  const suppress = (reason: CommunityChatMuteReason): CommunityChatMuteDecision => ({
    status: 'suppressed', reason,
    terminalSuppression: { notificationId, recipientUserId, source: { ...classified }, reason },
  });
  // Event attendance is an independent path; do not require or inspect the
  // community membership/parent preference to authorize this preference gate.
  if (classified.kind !== 'event-topic' && facts.parentMuted === true) return suppress('community-muted');
  const roomEnabled = classified.kind === 'intros'
    ? (known(facts.introsMuted) ? !facts.introsMuted : undefined)
    : classified.kind === 'main'
      ? (known(facts.mainMuted) ? !facts.mainMuted : undefined)
      : facts.topicNotificationsOn;
  if (roomEnabled === false) return suppress('room-muted');
  // A known mute above is conclusive even if the other layer is unavailable.
  // Permission to proceed, however, requires every applicable layer known.
  if (!known(roomEnabled) || (classified.kind !== 'event-topic' && !known(facts.parentMuted))) {
    return { status: 'unresolved', reason: 'unknown-preferences' };
  }
  return { status: 'eligible', reason: 'preferences-allow' };
}
