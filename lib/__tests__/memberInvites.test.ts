import {
  decideMemberInviteBindingOutcome,
  isMemberInviteBindingMatch,
  memberInviteBucket,
  type MemberInviteRecord,
  type MemberInviteCallerIdentity,
} from '../memberInvites';

// Mirrors the SQL self-test fixtures in
// supabase/migrations/20260901020000_build35_screen56_member_invites.sql:
// Liz (leader), Sage (correct invitee), "other" (the wrong person a leaked
// link ends up with). This file is the DB-independent form of that same
// battery -- see lib/coCreatorInvites.ts' own test file and its header note
// on why both exist and must stay in lockstep.
const COMMUNITY_ID = 'community-1';
const SAGE = 'sage-user-id';
const OTHER = 'other-user-id';

const HOUR_MS = 60 * 60 * 1000;
const NOW = new Date('2026-09-01T18:00:00.000Z');
const FUTURE = new Date(NOW.getTime() + HOUR_MS).toISOString();
const PAST = new Date(NOW.getTime() - HOUR_MS).toISOString();

function invite(overrides: Partial<MemberInviteRecord> = {}): MemberInviteRecord {
  return {
    id: 'invite-1',
    communityId: COMMUNITY_ID,
    targetUserId: SAGE,
    status: 'pending',
    expiresAt: FUTURE,
    ...overrides,
  };
}

function caller(overrides: Partial<MemberInviteCallerIdentity> = {}): MemberInviteCallerIdentity {
  return { userId: SAGE, ...overrides };
}

describe('decideMemberInviteBindingOutcome: the binding guarantee', () => {
  // ============ THE CORE ASK: a forwarded/leaked link must not grant access
  // ============ to a different person than intended. ========================
  describe('forwarded / leaked invite link', () => {
    const inv = invite({ targetUserId: SAGE });

    it('grants access to the intended recipient', () => {
      const outcome = decideMemberInviteBindingOutcome(inv, caller({ userId: SAGE }), NOW);
      expect(outcome).toEqual({ ok: true });
    });

    it('REFUSES the same token/invite when redeemed by anyone else', () => {
      const outcome = decideMemberInviteBindingOutcome(inv, caller({ userId: OTHER }), NOW);
      expect(outcome).toEqual({ ok: false, reason: 'not_your_invite' });
    });

    it('the wrong-person attempt does not consume the invite: the real target can still redeem it', () => {
      const wrongAttempt = decideMemberInviteBindingOutcome(inv, caller({ userId: OTHER }), NOW);
      expect(wrongAttempt.ok).toBe(false);
      // decideMemberInviteBindingOutcome is side-effect-free by construction
      // (it never mutates `invite`), so re-deciding with the correct caller
      // against the SAME untouched record still succeeds -- this is the
      // property the SQL RPC's "status stays pending after a failed attempt"
      // self-test case (C2) proves against a real row; here it falls
      // straight out of purity.
      const realAttempt = decideMemberInviteBindingOutcome(inv, caller({ userId: SAGE }), NOW);
      expect(realAttempt).toEqual({ ok: true });
    });
  });

  describe('single-use / already-consumed', () => {
    it('refuses an already-accepted invite, even for the correct recipient', () => {
      const inv = invite({ status: 'accepted' });
      const outcome = decideMemberInviteBindingOutcome(inv, caller(), NOW);
      expect(outcome).toEqual({ ok: false, reason: 'not_pending' });
    });

    it('refuses a revoked invite, even for the correct recipient', () => {
      const inv = invite({ status: 'revoked' });
      const outcome = decideMemberInviteBindingOutcome(inv, caller(), NOW);
      expect(outcome).toEqual({ ok: false, reason: 'not_pending' });
    });
  });

  describe('viewed (opened via preview, not yet accepted)', () => {
    it('is still acceptable for the correct recipient, same as pending', () => {
      const inv = invite({ status: 'viewed' });
      const outcome = decideMemberInviteBindingOutcome(inv, caller(), NOW);
      expect(outcome).toEqual({ ok: true });
    });

    it('still REFUSES the wrong person, viewed or not', () => {
      const inv = invite({ status: 'viewed' });
      const outcome = decideMemberInviteBindingOutcome(inv, caller({ userId: OTHER }), NOW);
      expect(outcome).toEqual({ ok: false, reason: 'not_your_invite' });
    });

    it('still expires on the same schedule as pending', () => {
      const inv = invite({ status: 'viewed', expiresAt: PAST });
      const outcome = decideMemberInviteBindingOutcome(inv, caller(), NOW);
      expect(outcome).toEqual({ ok: false, reason: 'expired' });
    });
  });

  describe('expiry', () => {
    it('refuses a pending invite past its expiresAt, even for the correct recipient', () => {
      const inv = invite({ status: 'pending', expiresAt: PAST });
      const outcome = decideMemberInviteBindingOutcome(inv, caller(), NOW);
      expect(outcome).toEqual({ ok: false, reason: 'expired' });
    });

    it('refuses an invite already flipped to status expired', () => {
      const inv = invite({ status: 'expired' });
      const outcome = decideMemberInviteBindingOutcome(inv, caller(), NOW);
      expect(outcome).toEqual({ ok: false, reason: 'expired' });
    });

    it('a not-yet-expired invite at the exact boundary instant is expired (<=, not <)', () => {
      const inv = invite({ expiresAt: NOW.toISOString() });
      const outcome = decideMemberInviteBindingOutcome(inv, caller(), NOW);
      expect(outcome).toEqual({ ok: false, reason: 'expired' });
    });
  });

  describe('not found', () => {
    it('refuses when there is no invite to decide against', () => {
      const outcome = decideMemberInviteBindingOutcome(null, caller(), NOW);
      expect(outcome).toEqual({ ok: false, reason: 'not_found' });
    });
  });
});

describe('isMemberInviteBindingMatch', () => {
  it('matches only the exact target user id -- v1 has no email/phone fallback path', () => {
    const inv = invite({ targetUserId: SAGE });
    expect(isMemberInviteBindingMatch(inv, { userId: SAGE })).toBe(true);
    expect(isMemberInviteBindingMatch(inv, { userId: OTHER })).toBe(false);
  });
});

describe('memberInviteBucket (the inviter\'s Invited/Joined/Expired review view)', () => {
  it('buckets pending and viewed together as "invited" (outstanding)', () => {
    expect(memberInviteBucket('pending')).toBe('invited');
    expect(memberInviteBucket('viewed')).toBe('invited');
  });

  it('buckets accepted as "joined"', () => {
    expect(memberInviteBucket('accepted')).toBe('joined');
  });

  it('buckets revoked and expired together as "past"', () => {
    expect(memberInviteBucket('revoked')).toBe('past');
    expect(memberInviteBucket('expired')).toBe('past');
  });
});
