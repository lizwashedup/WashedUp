import { evaluateEntitlement } from '../entitlements';

const NOW = Date.parse('2026-08-16T12:00:00.000Z');
const request = (capability: string, scope: unknown = { kind: 'global' }) => ({
  subjectId: 'u1',
  capability,
  scope,
});
const grant = (overrides: Record<string, unknown> = {}) => ({
  id: 'g1',
  subjectId: 'u1',
  capability: 'plans.use',
  scope: { kind: 'global' },
  source: 'incumbent',
  grantedAt: '2026-08-01T00:00:00.000Z',
  expiresAt: null,
  revokedAt: null,
  ...overrides,
});

describe('entitlement contracts', () => {
  it('allows a permanent, non-revocable incumbent plan grant', () => {
    expect(evaluateEntitlement(request('plans.use'), [grant()], NOW)).toEqual({
      decision: 'allow',
      grantId: 'g1',
    });
  });

  it('rejects an incumbent grant with expiry or revocation metadata', () => {
    expect(
      evaluateEntitlement(request('plans.use'), [grant({ expiresAt: '2030-01-01T00:00:00.000Z' })], NOW),
    ).toEqual({ decision: 'deny', reason: 'no_matching_grant' });
    expect(
      evaluateEntitlement(request('plans.use'), [grant({ revokedAt: '2026-08-15T00:00:00.000Z' })], NOW),
    ).toEqual({ decision: 'deny', reason: 'no_matching_grant' });
  });

  it('denies an expired subscription', () => {
    expect(
      evaluateEntitlement(
        request('plans.use'),
        [grant({ source: 'subscription', expiresAt: '2026-08-15T00:00:00.000Z' })],
        NOW,
      ),
    ).toEqual({ decision: 'deny', reason: 'no_matching_grant' });
  });

  it('limits an invite grant to its community and capability', () => {
    const invite = grant({
      capability: 'community.chat',
      scope: { kind: 'community', communityId: 'c1' },
      source: 'community_invite',
    });
    expect(
      evaluateEntitlement(request('community.chat', { kind: 'community', communityId: 'c1' }), [invite], NOW),
    ).toEqual({ decision: 'allow', grantId: 'g1' });
    expect(
      evaluateEntitlement(request('community.chat', { kind: 'community', communityId: 'c2' }), [invite], NOW),
    ).toEqual({ decision: 'deny', reason: 'no_matching_grant' });
    expect(evaluateEntitlement(request('plans.use'), [invite], NOW)).toEqual({
      decision: 'deny',
      reason: 'no_matching_grant',
    });
  });

  it('keeps ticket access outside plan entitlement decisions', () => {
    expect(evaluateEntitlement(request('tickets.buy'), [], NOW)).toEqual({
      decision: 'not_applicable',
      reason: 'ticket_access_is_outside_plan_entitlements',
    });
  });

  it('fails closed for unknown capabilities', () => {
    expect(evaluateEntitlement(request('future.capability'), [grant()], NOW)).toEqual({
      decision: 'deny',
      reason: 'invalid_request',
    });
  });
});
