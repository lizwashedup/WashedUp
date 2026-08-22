import {
  decideInviteBindingOutcome,
  isBindingMatch,
  normalizeEmail,
  normalizePhoneDigits,
  looksLikeEmail,
  looksLikePhone,
  type CoCreatorInviteRecord,
  type CallerIdentity,
} from '../coCreatorInvites';

// Mirrors the SQL self-test fixtures in
// supabase/migrations/20260817180000_community_co_creator_invites.sql:
// Liz (leader), Sage (correct invitee), "other" (the wrong person a leaked
// link ends up with). This file is the DB-independent form of that same
// battery -- see the migration's header note on why both exist and must stay
// in lockstep.
const COMMUNITY_ID = 'community-1';
const SAGE = 'sage-user-id';
const OTHER = 'other-user-id';

const HOUR_MS = 60 * 60 * 1000;
const NOW = new Date('2026-08-17T18:00:00.000Z');
const FUTURE = new Date(NOW.getTime() + HOUR_MS).toISOString();
const PAST = new Date(NOW.getTime() - HOUR_MS).toISOString();

// Matches the RPC's own p_role default (see create_co_creator_invite) so a
// fixture that doesn't care about tier still reflects realistic data.
const DEFAULT_ROLE = 'admin';

function profileInvite(overrides: Partial<CoCreatorInviteRecord> = {}): CoCreatorInviteRecord {
  return {
    id: 'invite-1',
    communityId: COMMUNITY_ID,
    targetUserId: SAGE,
    targetEmail: null,
    targetPhone: null,
    status: 'pending',
    expiresAt: FUTURE,
    role: DEFAULT_ROLE,
    ...overrides,
  };
}

function emailInvite(overrides: Partial<CoCreatorInviteRecord> = {}): CoCreatorInviteRecord {
  return {
    id: 'invite-2',
    communityId: COMMUNITY_ID,
    targetUserId: null,
    targetEmail: 'invitee@example.com',
    targetPhone: null,
    status: 'pending',
    expiresAt: FUTURE,
    role: DEFAULT_ROLE,
    ...overrides,
  };
}

function caller(overrides: Partial<CallerIdentity> = {}): CallerIdentity {
  return { userId: SAGE, confirmedEmail: null, confirmedPhone: null, ...overrides };
}

describe('decideInviteBindingOutcome: the binding guarantee', () => {
  // ============ THE CORE ASK: a forwarded/leaked link must not grant access
  // ============ to a different person than intended. ========================
  describe('forwarded / leaked invite link (existing-profile path)', () => {
    const invite = profileInvite({ targetUserId: SAGE });

    it('grants access to the intended recipient', () => {
      const outcome = decideInviteBindingOutcome(invite, caller({ userId: SAGE }), NOW);
      expect(outcome).toEqual({ ok: true, grantedRole: DEFAULT_ROLE });
    });

    it('REFUSES the same token/invite when redeemed by anyone else', () => {
      const outcome = decideInviteBindingOutcome(invite, caller({ userId: OTHER }), NOW);
      expect(outcome).toEqual({ ok: false, reason: 'not_your_invite' });
    });

    it('the wrong-person attempt does not consume the invite: the real target can still redeem it', () => {
      const wrongAttempt = decideInviteBindingOutcome(invite, caller({ userId: OTHER }), NOW);
      expect(wrongAttempt.ok).toBe(false);
      // the pure function is side-effect-free by construction (it never
      // mutates `invite`), so re-deciding with the correct caller against the
      // SAME untouched record still succeeds -- this is the property the SQL
      // RPC's "status stays pending after a failed attempt" assertion proves
      // against a real row; here it falls straight out of purity.
      const realAttempt = decideInviteBindingOutcome(invite, caller({ userId: SAGE }), NOW);
      expect(realAttempt).toEqual({ ok: true, grantedRole: DEFAULT_ROLE });
    });
  });

  describe('forwarded / leaked invite link (email-bound, no account yet)', () => {
    const invite = emailInvite({ targetEmail: 'invitee@example.com' });

    it('grants access to whoever holds the matching CONFIRMED email', () => {
      const outcome = decideInviteBindingOutcome(
        invite,
        caller({ userId: OTHER, confirmedEmail: 'invitee@example.com' }),
        NOW,
      );
      expect(outcome).toEqual({ ok: true, grantedRole: DEFAULT_ROLE });
    });

    it('REFUSES a signed-in caller whose confirmed email does not match, even holding a valid token', () => {
      const outcome = decideInviteBindingOutcome(
        invite,
        caller({ userId: OTHER, confirmedEmail: 'someone-else@example.com' }),
        NOW,
      );
      expect(outcome).toEqual({ ok: false, reason: 'not_your_invite' });
    });

    it('REFUSES when the caller has no confirmed email at all (signed in via phone/Apple/Google only)', () => {
      const outcome = decideInviteBindingOutcome(
        invite,
        caller({ userId: OTHER, confirmedEmail: null }),
        NOW,
      );
      expect(outcome).toEqual({ ok: false, reason: 'not_your_invite' });
    });

    it('REFUSES an UNCONFIRMED matching email -- possession of the address is not enough, it must be verified', () => {
      // caller "typed" the right email into a profile field but never
      // confirmed it; decideInviteBindingOutcome only ever receives
      // confirmedEmail, so an unconfirmed address must never be passed in as
      // proof by the caller of this function. Simulated here as null,
      // matching what the SQL RPC reads when email_confirmed_at IS NULL.
      const outcome = decideInviteBindingOutcome(
        invite,
        caller({ userId: OTHER, confirmedEmail: null }),
        NOW,
      );
      expect(outcome.ok).toBe(false);
    });

    it('email match is case-insensitive and trims whitespace on both sides', () => {
      const mixedCaseInvite = emailInvite({ targetEmail: normalizeEmail('  Invitee@Example.COM  ') });
      const outcome = decideInviteBindingOutcome(
        mixedCaseInvite,
        caller({ userId: OTHER, confirmedEmail: 'INVITEE@example.com' }),
        NOW,
      );
      expect(outcome).toEqual({ ok: true, grantedRole: DEFAULT_ROLE });
    });
  });

  describe('forwarded / leaked invite link (phone-bound, no account yet)', () => {
    const invite: CoCreatorInviteRecord = {
      id: 'invite-3',
      communityId: COMMUNITY_ID,
      targetUserId: null,
      targetEmail: null,
      targetPhone: normalizePhoneDigits('+1 (555) 123-4567'),
      status: 'pending',
      expiresAt: FUTURE,
      role: DEFAULT_ROLE,
    };

    it('grants access to whoever holds the matching CONFIRMED phone, regardless of formatting', () => {
      const outcome = decideInviteBindingOutcome(
        invite,
        caller({ userId: OTHER, confirmedPhone: '15551234567' }),
        NOW,
      );
      expect(outcome).toEqual({ ok: true, grantedRole: DEFAULT_ROLE });
    });

    it('REFUSES a different phone number', () => {
      const outcome = decideInviteBindingOutcome(
        invite,
        caller({ userId: OTHER, confirmedPhone: '19995550000' }),
        NOW,
      );
      expect(outcome).toEqual({ ok: false, reason: 'not_your_invite' });
    });
  });

  describe('single-use / already-consumed', () => {
    it('refuses an already-accepted invite, even for the correct recipient', () => {
      const invite = profileInvite({ targetUserId: SAGE, status: 'accepted' });
      const outcome = decideInviteBindingOutcome(invite, caller({ userId: SAGE }), NOW);
      expect(outcome).toEqual({ ok: false, reason: 'not_pending' });
    });

    it('refuses a revoked invite, even for the correct recipient', () => {
      const invite = profileInvite({ targetUserId: SAGE, status: 'revoked' });
      const outcome = decideInviteBindingOutcome(invite, caller({ userId: SAGE }), NOW);
      expect(outcome).toEqual({ ok: false, reason: 'not_pending' });
    });
  });

  describe('viewed (opened via preview, not yet accepted)', () => {
    it('is still acceptable for the correct recipient, same as pending', () => {
      const invite = profileInvite({ targetUserId: SAGE, status: 'viewed' });
      const outcome = decideInviteBindingOutcome(invite, caller({ userId: SAGE }), NOW);
      expect(outcome).toEqual({ ok: true, grantedRole: DEFAULT_ROLE });
    });

    it('still REFUSES the wrong person, viewed or not', () => {
      const invite = profileInvite({ targetUserId: SAGE, status: 'viewed' });
      const outcome = decideInviteBindingOutcome(invite, caller({ userId: OTHER }), NOW);
      expect(outcome).toEqual({ ok: false, reason: 'not_your_invite' });
    });

    it('still expires on the same schedule as pending', () => {
      const invite = profileInvite({ targetUserId: SAGE, status: 'viewed', expiresAt: PAST });
      const outcome = decideInviteBindingOutcome(invite, caller({ userId: SAGE }), NOW);
      expect(outcome).toEqual({ ok: false, reason: 'expired' });
    });
  });

  describe('expiry', () => {
    it('refuses a pending invite past its expiresAt, even for the correct recipient', () => {
      const invite = profileInvite({ targetUserId: SAGE, status: 'pending', expiresAt: PAST });
      const outcome = decideInviteBindingOutcome(invite, caller({ userId: SAGE }), NOW);
      expect(outcome).toEqual({ ok: false, reason: 'expired' });
    });

    it('refuses an invite already flipped to status expired', () => {
      const invite = profileInvite({ targetUserId: SAGE, status: 'expired' });
      const outcome = decideInviteBindingOutcome(invite, caller({ userId: SAGE }), NOW);
      expect(outcome).toEqual({ ok: false, reason: 'expired' });
    });

    it('a not-yet-expired invite at the exact boundary instant is expired (<=, not <)', () => {
      const invite = profileInvite({ targetUserId: SAGE, expiresAt: NOW.toISOString() });
      const outcome = decideInviteBindingOutcome(invite, caller({ userId: SAGE }), NOW);
      expect(outcome).toEqual({ ok: false, reason: 'expired' });
    });
  });

  describe('not found', () => {
    it('refuses when there is no invite to decide against', () => {
      const outcome = decideInviteBindingOutcome(null, caller({ userId: SAGE }), NOW);
      expect(outcome).toEqual({ ok: false, reason: 'not_found' });
    });
  });

  describe('an invite with both target_email and target_phone matches on EITHER', () => {
    const invite: CoCreatorInviteRecord = {
      id: 'invite-4',
      communityId: COMMUNITY_ID,
      targetUserId: null,
      targetEmail: 'invitee@example.com',
      targetPhone: '15551234567',
      status: 'pending',
      expiresAt: FUTURE,
      role: DEFAULT_ROLE,
    };

    it('matches on confirmed email alone', () => {
      expect(isBindingMatch(invite, caller({ userId: OTHER, confirmedEmail: 'invitee@example.com' }))).toBe(true);
    });

    it('matches on confirmed phone alone', () => {
      expect(isBindingMatch(invite, caller({ userId: OTHER, confirmedPhone: '15551234567' }))).toBe(true);
    });

    it('matches when both are confirmed and correct', () => {
      expect(
        isBindingMatch(
          invite,
          caller({ userId: OTHER, confirmedEmail: 'invitee@example.com', confirmedPhone: '15551234567' }),
        ),
      ).toBe(true);
    });

    it('refuses when neither matches', () => {
      expect(
        isBindingMatch(
          invite,
          caller({ userId: OTHER, confirmedEmail: 'nope@example.com', confirmedPhone: '10000000000' }),
        ),
      ).toBe(false);
    });
  });

  // S-03 regression guard: decideInviteBindingOutcome must report whatever
  // tier the invite itself was created at, not a fixed constant -- it has to
  // stay in lockstep with accept_co_creator_invite()'s real INSERT. A prior
  // version of this function hardcoded grantedRole to the pre-S03 'co_leader'
  // value, which every test above would have missed since they all used the
  // same default role.
  describe('grantedRole reflects the invite\'s own tier, not a fixed constant', () => {
    it('grants the exact non-default tier the invite was created at', () => {
      const invite = profileInvite({ targetUserId: SAGE, role: 'finance' });
      const outcome = decideInviteBindingOutcome(invite, caller({ userId: SAGE }), NOW);
      expect(outcome).toEqual({ ok: true, grantedRole: 'finance' });
    });
  });
});

describe('normalizeEmail', () => {
  it('lowercases and trims', () => {
    expect(normalizeEmail('  Sage@WashedUp.App  ')).toBe('sage@washedup.app');
  });
});

describe('normalizePhoneDigits', () => {
  it('strips everything but digits', () => {
    expect(normalizePhoneDigits('+1 (555) 123-4567')).toBe('15551234567');
  });
  it('is idempotent on an already-normalized value', () => {
    expect(normalizePhoneDigits('15551234567')).toBe('15551234567');
  });
});

describe('looksLikeEmail / looksLikePhone (form-input hints, not security checks)', () => {
  it('accepts a plausible email', () => {
    expect(looksLikeEmail('a@b.com')).toBe(true);
  });
  it('rejects a bare string', () => {
    expect(looksLikeEmail('not an email')).toBe(false);
  });
  it('accepts a 10+ digit phone in any formatting', () => {
    expect(looksLikePhone('(555) 123-4567')).toBe(true);
  });
  it('rejects a too-short digit string', () => {
    expect(looksLikePhone('12345')).toBe(false);
  });
});
