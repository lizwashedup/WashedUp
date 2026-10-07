import {
  evaluateCommunityChatMute,
  type ClassifiedCommunityChatSource,
  type CommunityChatMuteInput,
  type CommunityChatMutedSuppression,
} from '../notifications/communityChatMutePolicy';

const main: ClassifiedCommunityChatSource = { kind: 'main', communityId: 'community-a', eventId: null };
const intros: ClassifiedCommunityChatSource = { kind: 'intros', roomId: 'provisioned-intros-a', communityId: 'community-a', eventId: null };
const persistent: ClassifiedCommunityChatSource = { kind: 'persistent-topic', communityId: 'community-a', topicId: 'topic-a', eventId: null };
const event: ClassifiedCommunityChatSource = { kind: 'event-topic', communityId: 'community-a', topicId: 'event-topic-a', eventId: 'event-a' };

function input(source: ClassifiedCommunityChatSource = main): CommunityChatMuteInput {
  return {
    notificationId: 'notification-a', recipientUserId: 'recipient-a', source,
    facts: { userId: 'recipient-a', source, recipientEligible: true,
      activeCommunityMember: true, topicJoined: true,
      parentMuted: false, introsMuted: false, mainMuted: false, topicNotificationsOn: true },
    previousMuteSuppression: null,
  };
}
const withFacts = (value: CommunityChatMuteInput, facts: Partial<CommunityChatMuteInput['facts']>): CommunityChatMuteInput =>
  ({ ...value, facts: { ...value.facts, ...facts } });

function terminal(value: CommunityChatMuteInput): CommunityChatMutedSuppression {
  const decision = evaluateCommunityChatMute(value);
  if (!('terminalSuppression' in decision)) throw new Error('Expected terminal fixture');
  return decision.terminalSuppression;
}

describe('draft community notification preference policy (no sender integration)', () => {
  it.each([intros, main, persistent])('combines the parent and saved room flags for $kind without changing either', source => {
    for (const parentMuted of [false, true]) for (const roomMuted of [false, true]) {
      const value = withFacts(input(source), { parentMuted, introsMuted: roomMuted, mainMuted: roomMuted, topicNotificationsOn: !roomMuted });
      const before = JSON.stringify(value);
      const decision = evaluateCommunityChatMute(value);
      expect(decision.status).toBe(parentMuted || roomMuted ? 'suppressed' : 'eligible');
      expect(decision.reason).toBe(parentMuted ? 'community-muted' : roomMuted ? 'room-muted' : 'preferences-allow');
      expect(JSON.stringify(value)).toBe(before);
    }
  });

  it('keeps provisioned Intros independent of the main preference and topic subscription', () => {
    expect(evaluateCommunityChatMute(withFacts(input(intros), {
      introsMuted: false, mainMuted: true, topicJoined: undefined, topicNotificationsOn: false,
    })).status).toBe('eligible');
    expect(evaluateCommunityChatMute(withFacts(input(main), { introsMuted: true, mainMuted: false })).status).toBe('eligible');
    expect(evaluateCommunityChatMute(withFacts(input(intros), { introsMuted: true, mainMuted: false })).reason).toBe('room-muted');
    expect(evaluateCommunityChatMute(withFacts(input(intros), { activeCommunityMember: false })).reason).toBe('not-community-member');
    expect(evaluateCommunityChatMute(withFacts(input(intros), { activeCommunityMember: undefined })).reason).toBe('unknown-community-membership');
  });

  it('requires an authoritative Intros room identity and its own known preference', () => {
    for (const source of [
      { ...intros, roomId: undefined }, { ...intros, roomId: '' },
      { ...intros, eventId: undefined }, { ...intros, eventId: 'event-a' },
      { ...main, kind: 'intros' },
    ]) {
      const value = { ...input(intros), source, facts: { ...input(intros).facts, source } } as CommunityChatMuteInput;
      expect(evaluateCommunityChatMute(value).reason).toBe('unknown-source');
    }
    expect(evaluateCommunityChatMute(withFacts(input(intros), { source: main })).reason).toBe('source-facts-mismatch');
    expect(evaluateCommunityChatMute(withFacts(input(intros), {
      source: { ...intros, roomId: 'other-intros-room' } as ClassifiedCommunityChatSource,
    })).reason).toBe('source-facts-mismatch');
    for (const introsMuted of [undefined, null]) {
      expect(evaluateCommunityChatMute(withFacts(input(intros), { introsMuted })).reason).toBe('unknown-preferences');
    }
  });

  it('automatically covers newly joined persistent rooms without copying or resetting their preferences', () => {
    const freshRoom = { ...persistent, topicId: 'new-optional-room' } as ClassifiedCommunityChatSource;
    const muted = withFacts(input(freshRoom), { parentMuted: true, topicNotificationsOn: true });
    expect(evaluateCommunityChatMute(muted).reason).toBe('community-muted');
    const changedUnderOverride = withFacts(muted, { topicNotificationsOn: false });
    expect(evaluateCommunityChatMute(withFacts(changedUnderOverride, { parentMuted: false })).reason).toBe('room-muted');
    expect(evaluateCommunityChatMute(withFacts(muted, { parentMuted: false })).status).toBe('eligible');
  });

  it('permits an eligible event attendee without community membership or known parent preferences', () => {
    for (const activeCommunityMember of [false, undefined]) for (const parentMuted of [true, undefined]) {
      const value = withFacts(input(event), { activeCommunityMember, parentMuted, mainMuted: true });
      expect(evaluateCommunityChatMute(value)).toEqual({ status: 'eligible', reason: 'preferences-allow' });
    }
    expect(evaluateCommunityChatMute(withFacts(input(event), { topicNotificationsOn: false })).reason).toBe('room-muted');
  });

  it('requires current eligibility and membership without making an attendee a community member', () => {
    expect(evaluateCommunityChatMute(withFacts(input(persistent), { activeCommunityMember: false })).reason).toBe('not-community-member');
    expect(evaluateCommunityChatMute(withFacts(input(main), { activeCommunityMember: false })).reason).toBe('not-community-member');
    for (const source of [persistent, event]) {
      expect(evaluateCommunityChatMute(withFacts(input(source), { topicJoined: false })).reason).toBe('not-topic-member');
      expect(evaluateCommunityChatMute(withFacts(input(source), { recipientEligible: false })).reason).toBe('recipient-ineligible');
    }
  });

  it('leaves unknown required eligibility unresolved', () => {
    for (const unknown of [undefined, null]) {
      expect(evaluateCommunityChatMute(withFacts(input(), { recipientEligible: unknown })).reason).toBe('unknown-recipient-eligibility');
      expect(evaluateCommunityChatMute(withFacts(input(), { activeCommunityMember: unknown })).reason).toBe('unknown-community-membership');
      expect(evaluateCommunityChatMute(withFacts(input(event), { topicJoined: unknown })).reason).toBe('unknown-topic-membership');
    }
  });

  it('never treats missing applicable preferences as enabled', () => {
    for (const unknown of [undefined, null]) {
      for (const value of [
        withFacts(input(), { parentMuted: unknown }), withFacts(input(), { mainMuted: unknown }),
        withFacts(input(persistent), { topicNotificationsOn: unknown }),
        withFacts(input(event), { topicNotificationsOn: unknown }),
      ]) expect(evaluateCommunityChatMute(value)).toEqual({ status: 'unresolved', reason: 'unknown-preferences' });
    }
    expect(evaluateCommunityChatMute(withFacts(input(), { parentMuted: true, mainMuted: undefined })).reason).toBe('community-muted');
    expect(evaluateCommunityChatMute(withFacts(input(), { parentMuted: undefined, mainMuted: true })).reason).toBe('room-muted');
  });

  it('rejects unknown or contradictory topic provenance, including an omitted event field', () => {
    for (const source of [
      { kind: 'unclassified' }, { ...persistent, eventId: undefined },
      { ...persistent, eventId: 'actually-an-event' }, { ...event, eventId: null },
      { ...event, eventId: '' }, { ...main, communityId: '' },
    ]) {
      const value = { ...input(), source, facts: { ...input().facts, source } } as CommunityChatMuteInput;
      expect(evaluateCommunityChatMute(value)).toEqual({ status: 'unresolved', reason: 'unknown-source' });
    }
  });

  it('does not grant follower/test/other channels eligibility merely because the parent is unmuted', () => {
    const value: CommunityChatMuteInput = { ...input(), source: { kind: 'outside-chat-policy' } };
    expect(evaluateCommunityChatMute(value)).toEqual({ status: 'unresolved', reason: 'outside-chat-policy' });
  });

  it('binds eligibility and preferences to the exact recipient, community and room', () => {
    expect(evaluateCommunityChatMute(withFacts(input(), { userId: undefined })).reason).toBe('unknown-account');
    expect(evaluateCommunityChatMute(withFacts(input(), { userId: 'other-recipient' })).reason).toBe('account-mismatch');
    for (const source of [null, undefined, event, { ...persistent, communityId: 'other-community' }, { ...persistent, topicId: 'other-topic' }]) {
      expect(evaluateCommunityChatMute(withFacts(input(persistent), { source })).reason).toBe('source-facts-mismatch');
    }
  });

  it.each([intros, main, persistent, event])('does not revive a terminal muted notification in $kind after unmute', source => {
    const original = withFacts(input(source), source.kind === 'event-topic'
      ? { topicNotificationsOn: false } : { parentMuted: true });
    const previousMuteSuppression = terminal(original);
    const retry = { ...input(source), previousMuteSuppression };
    const decision = evaluateCommunityChatMute(retry);
    expect(decision.status).toBe('suppressed');
    expect(decision.reason).toBe(previousMuteSuppression.reason);
    expect('terminalSuppression' in decision && decision.terminalSuppression).toEqual(previousMuteSuppression);
    expect(evaluateCommunityChatMute({ ...retry, notificationId: 'new-notification', previousMuteSuppression: null }).status).toBe('eligible');
  });

  it('keeps a terminal decision after membership becomes unknown, without resolving new delivery access', () => {
    const previousMuteSuppression = terminal(withFacts(input(), { mainMuted: true }));
    const retry = withFacts({ ...input(), previousMuteSuppression }, { recipientEligible: undefined, activeCommunityMember: undefined });
    expect(evaluateCommunityChatMute(retry).reason).toBe('room-muted');
  });

  it('does not guess whether a queued notification was already suppressed', () => {
    expect(evaluateCommunityChatMute({ ...input(), previousMuteSuppression: undefined }))
      .toEqual({ status: 'unresolved', reason: 'unknown-prior-suppression' });
  });

  it('rejects suppression records from another notification, account, room or invalid event cascade', () => {
    const previous = terminal(withFacts(input(persistent), { parentMuted: true }));
    for (const previousMuteSuppression of [
      { ...previous, notificationId: 'other-notification' },
      { ...previous, recipientUserId: 'other-recipient' },
      { ...previous, source: { ...persistent, topicId: 'other-topic' } as ClassifiedCommunityChatSource },
      { ...previous, reason: 'unrecognized' } as unknown as CommunityChatMutedSuppression,
    ]) {
      expect(evaluateCommunityChatMute({ ...input(persistent), previousMuteSuppression }).reason).toBe('invalid-prior-suppression');
    }
    expect(evaluateCommunityChatMute({ ...input(event), previousMuteSuppression: { ...previous, source: event } }).reason).toBe('invalid-prior-suppression');
  });

  it('does not accept empty notification or recipient identities', () => {
    expect(evaluateCommunityChatMute({ ...input(), notificationId: ' ' }).reason).toBe('invalid-notification-identity');
    expect(evaluateCommunityChatMute({ ...input(), recipientUserId: '' }).reason).toBe('invalid-notification-identity');
  });

  it('returns independent terminal records and leaves frozen inputs untouched', () => {
    const value = withFacts(input(persistent), { parentMuted: true });
    Object.freeze(value.source); Object.freeze(value.facts); Object.freeze(value);
    const previous = terminal(value);
    Object.freeze(previous.source); Object.freeze(previous);
    const next = evaluateCommunityChatMute({ ...value, previousMuteSuppression: previous });
    expect(next.status).toBe('suppressed');
    if ('terminalSuppression' in next) {
      expect(next.terminalSuppression).not.toBe(previous);
      expect(next.terminalSuppression.source).not.toBe(previous.source);
    }
  });
});
