import { buildSmartShortlist, type ShortlistAccessLists } from '../smartShortlist';

const lists = (overrides: Partial<ShortlistAccessLists> = {}): ShortlistAccessLists => ({
  allowedPersonIds: new Set(['p1', 'p2', 'p3', 'p4']),
  blockedPersonIds: new Set(),
  dismissedPersonIds: new Set(),
  alreadyInvitedPersonIds: new Set(),
  ...overrides,
});
const candidate = (personId: string, overrides: Record<string, unknown> = {}) => ({
  personId,
  sharedActivityCount: 1,
  matchingCategoryActivityCount: 1,
  activityRecency: 0.5,
  payload: {},
  ...overrides,
});
const weights = { sharedActivityCount: 1, matchingCategoryActivityCount: 2, activityRecency: 1 };

describe('smart invite shortlist contracts', () => {
  it('excludes a stranger before scoring even when their activity metrics are highest', () => {
    const result = buildSmartShortlist(
      [candidate('stranger', { sharedActivityCount: 1000 }), candidate('p1')],
      lists(),
      weights,
    );
    expect(result.map((entry) => entry.candidate.personId)).toEqual(['p1']);
  });

  it('excludes blocked, dismissed, and already invited people', () => {
    const result = buildSmartShortlist(
      [candidate('p1'), candidate('p2'), candidate('p3'), candidate('p4')],
      lists({
        blockedPersonIds: new Set(['p1']),
        dismissedPersonIds: new Set(['p2']),
        alreadyInvitedPersonIds: new Set(['p3']),
      }),
      weights,
    );
    expect(result.map((entry) => entry.candidate.personId)).toEqual(['p4']);
  });

  it('uses caller-supplied weights and deterministic ID ties', () => {
    const result = buildSmartShortlist([candidate('p2'), candidate('p1')], lists(), weights);
    expect(result.map((entry) => entry.candidate.personId)).toEqual(['p1', 'p2']);
  });

  it('fails closed for invalid weights and malformed metrics', () => {
    expect(
      buildSmartShortlist([candidate('p1')], lists(), { ...weights, activityRecency: -1 }),
    ).toEqual([]);
    expect(buildSmartShortlist([candidate('p1', { sharedActivityCount: -1 })], lists(), weights)).toEqual([]);
  });

  it('fails closed for duplicate candidate rows', () => {
    expect(buildSmartShortlist([candidate('p1'), candidate('p1')], lists(), weights)).toEqual([]);
  });
});
