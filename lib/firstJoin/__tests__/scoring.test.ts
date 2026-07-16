/**
 * Unit tests for the pure first-join ranking logic (spec a1): eligibility
 * filtering, every scoring weight, ordering, and the big-room slot-1 rule.
 */
import { NEIGHBORHOOD_OPTIONS, NEIGHBORHOOD_SET } from '../../../constants/Neighborhoods';
import { NEIGHBORHOOD_ADJACENCY, isSameOrAdjacentNeighborhood } from '../adjacency';
import {
  ageFromBirthday,
  BIG_ROOM_MIN,
  candidateWindow,
  isEligible,
  passesGenderRule,
  rankCandidates,
  scoreCandidate,
  SOCIAL_PROOF_MIN,
  startsOnLAWeekend,
  vibeMatches,
  WEIGHT_BIG_ROOM,
  WEIGHT_LIKELIHOOD,
  WEIGHT_NEIGHBORHOOD,
  WEIGHT_SOCIAL_PROOF,
  WEIGHT_VIBE,
  WEIGHT_WEEKEND,
} from '../scoring';
import type { FirstJoinCreator, FirstJoinEventRow, FirstJoinViewer } from '../types';
import { mkCreator, mkEvent, mkViewer, NOW, SATURDAY_START, TUESDAY_START } from './builders';

function eligible(
  event: FirstJoinEventRow,
  extra: { creator?: FirstJoinCreator | null; memberCount?: number; viewer?: FirstJoinViewer; joined?: string[] } = {},
): boolean {
  return isEligible({
    event,
    creator: extra.creator === undefined ? mkCreator() : extra.creator,
    memberCount: extra.memberCount ?? 1,
    viewer: extra.viewer ?? mkViewer(),
    joinedEventIds: new Set(extra.joined ?? []),
    now: NOW,
  });
}

// ─── Eligibility ─────────────────────────────────────────────────────────────

describe('isEligible', () => {
  it('accepts a joinable plan inside the window', () => {
    expect(eligible(mkEvent())).toBe(true);
  });

  it.each(['completed', 'cancelled', 'draft', 'full'])('rejects status %s', (status) => {
    expect(eligible(mkEvent({ status }))).toBe(false);
  });

  it('rejects plans starting sooner than now+12h', () => {
    const start = new Date(NOW.getTime() + 11 * 60 * 60 * 1000).toISOString();
    expect(eligible(mkEvent({ start_time: start }))).toBe(false);
  });

  it('accepts a plan starting just past now+12h', () => {
    const start = new Date(NOW.getTime() + 13 * 60 * 60 * 1000).toISOString();
    expect(eligible(mkEvent({ start_time: start }))).toBe(true);
  });

  it('rejects plans starting past now+10d', () => {
    const start = new Date(NOW.getTime() + 11 * 24 * 60 * 60 * 1000).toISOString();
    expect(eligible(mkEvent({ start_time: start }))).toBe(false);
  });

  it('rejects gender_rule mismatches and accepts matches', () => {
    expect(eligible(mkEvent({ gender_rule: 'men_only' }))).toBe(false);
    expect(eligible(mkEvent({ gender_rule: 'women_only' }))).toBe(true);
    expect(eligible(mkEvent({ gender_rule: 'mixed' }))).toBe(true);
  });

  it('only passes mixed plans for a viewer with null gender (legacy rows)', () => {
    const viewer = mkViewer({ gender: null });
    expect(eligible(mkEvent({ gender_rule: 'women_only' }), { viewer })).toBe(false);
    expect(eligible(mkEvent({ gender_rule: 'mixed' }), { viewer })).toBe(true);
  });

  it('enforces the target age range against the viewer birthday', () => {
    // Viewer born 1998-03-14 is 28 at NOW (2026-07-16).
    expect(eligible(mkEvent({ target_age_min: 30 }))).toBe(false);
    expect(eligible(mkEvent({ target_age_max: 25 }))).toBe(false);
    expect(eligible(mkEvent({ target_age_min: 25, target_age_max: 30 }))).toBe(true);
  });

  it('passes every age range when the viewer has no birthday', () => {
    const viewer = mkViewer({ birthday: null });
    expect(eligible(mkEvent({ target_age_min: 60 }), { viewer })).toBe(true);
  });

  it('rejects a full plan (real member count >= max_invites)', () => {
    expect(eligible(mkEvent({ max_invites: 4 }), { memberCount: 4 })).toBe(false);
    expect(eligible(mkEvent({ max_invites: 4 }), { memberCount: 3 })).toBe(true);
  });

  it('treats null max_invites as open capacity', () => {
    expect(eligible(mkEvent({ max_invites: null }), { memberCount: 40 })).toBe(true);
  });

  it('rejects waitlist_closed and invite_locked plans', () => {
    expect(eligible(mkEvent({ waitlist_closed: true }))).toBe(false);
    expect(eligible(mkEvent({ invite_locked: true }))).toBe(false);
  });

  it('treats null waitlist_closed / invite_locked as open (legacy rows)', () => {
    expect(eligible(mkEvent({ waitlist_closed: null, invite_locked: null }))).toBe(true);
  });

  it('rejects plans by a currently suspended creator, accepts expired suspensions', () => {
    const active = mkCreator({ suspended_until: new Date(NOW.getTime() + 60_000).toISOString() });
    const expired = mkCreator({ suspended_until: new Date(NOW.getTime() - 60_000).toISOString() });
    expect(eligible(mkEvent(), { creator: active })).toBe(false);
    expect(eligible(mkEvent(), { creator: expired })).toBe(true);
  });

  it('rejects circle_only plans', () => {
    expect(eligible(mkEvent({ circle_visibility: 'circle_only' }))).toBe(false);
    expect(eligible(mkEvent({ circle_visibility: 'open' }))).toBe(true);
  });

  it("rejects the viewer's own plan and plans they already joined", () => {
    expect(eligible(mkEvent({ creator_user_id: 'viewer-1' }))).toBe(false);
    expect(eligible(mkEvent({ id: 'event-9' }), { joined: ['event-9'] })).toBe(false);
  });
});

// ─── Individual weights ──────────────────────────────────────────────────────

describe('scoreCandidate weights', () => {
  // Zero-score baseline: far neighborhood, no vibe overlap, weekday, nothing likely.
  const baseEvent = () =>
    mkEvent({
      neighborhood: 'Long Beach',
      primary_vibe: 'Gaming',
      min_invites: 4,
      drop_in: false,
      is_featured: false,
    });
  const score = (event: FirstJoinEventRow, memberCount = 1, creator = mkCreator(), viewer = mkViewer()) =>
    scoreCandidate({ event, creator, memberCount, viewer });

  it('baseline candidate scores zero', () => {
    expect(score(baseEvent()).score).toBe(0);
  });

  it('+3 same neighborhood', () => {
    const c = score(baseEvent(), 1, mkCreator(), mkViewer({ neighborhood: 'Long Beach' }));
    expect(c.breakdown.neighborhood).toBe(WEIGHT_NEIGHBORHOOD);
    expect(c.score).toBe(WEIGHT_NEIGHBORHOOD);
  });

  it('+3 adjacent neighborhood, symmetric', () => {
    const there = score(mkEvent({ ...baseEvent(), neighborhood: 'Silver Lake' }), 1, mkCreator(), mkViewer({ neighborhood: 'Echo Park' }));
    const back = score(mkEvent({ ...baseEvent(), neighborhood: 'Echo Park' }), 1, mkCreator(), mkViewer({ neighborhood: 'Silver Lake' }));
    expect(there.breakdown.neighborhood).toBe(WEIGHT_NEIGHBORHOOD);
    expect(back.breakdown.neighborhood).toBe(WEIGHT_NEIGHBORHOOD);
  });

  it('+3 likelihood via member_count >= min_invites', () => {
    const c = score(baseEvent(), 4);
    expect(c.breakdown.likelihood).toBe(WEIGHT_LIKELIHOOD);
  });

  it('+3 likelihood via drop_in', () => {
    expect(score(mkEvent({ ...baseEvent(), drop_in: true })).breakdown.likelihood).toBe(WEIGHT_LIKELIHOOD);
  });

  it('+3 likelihood via is_featured', () => {
    expect(score(mkEvent({ ...baseEvent(), is_featured: true })).breakdown.likelihood).toBe(WEIGHT_LIKELIHOOD);
  });

  it('+3 likelihood via official creator flag', () => {
    const c = score(baseEvent(), 1, mkCreator({ is_official_host: true }));
    expect(c.breakdown.likelihood).toBe(WEIGHT_LIKELIHOOD);
  });

  it(`+2 social proof at ${SOCIAL_PROOF_MIN} going`, () => {
    expect(score(baseEvent(), SOCIAL_PROOF_MIN - 1).breakdown.socialProof).toBe(0);
    expect(score(baseEvent(), SOCIAL_PROOF_MIN).breakdown.socialProof).toBe(WEIGHT_SOCIAL_PROOF);
  });

  it(`+2 big room only when featured AND ${BIG_ROOM_MIN}+ going`, () => {
    const featured = mkEvent({ ...baseEvent(), is_featured: true });
    expect(score(featured, BIG_ROOM_MIN).breakdown.bigRoom).toBe(WEIGHT_BIG_ROOM);
    expect(score(featured, BIG_ROOM_MIN).bigRoom).toBe(true);
    expect(score(featured, BIG_ROOM_MIN - 1).breakdown.bigRoom).toBe(0);
    expect(score(baseEvent(), BIG_ROOM_MIN).breakdown.bigRoom).toBe(0);
  });

  it('+2 vibe overlap, case-insensitive (prod casing drifts)', () => {
    const c = score(mkEvent({ ...baseEvent(), primary_vibe: 'sports' }));
    expect(c.breakdown.vibe).toBe(WEIGHT_VIBE);
    expect(vibeMatches(['Sports'], 'SPORTS')).toBe(true);
    expect(vibeMatches(['Sports'], 'Gaming')).toBe(false);
    expect(vibeMatches(null, 'Sports')).toBe(false);
    expect(vibeMatches([], 'Sports')).toBe(false);
  });

  it('+1 weekend start on the LA clock', () => {
    expect(score(mkEvent({ ...baseEvent(), start_time: SATURDAY_START })).breakdown.weekend).toBe(WEIGHT_WEEKEND);
    expect(score(baseEvent()).breakdown.weekend).toBe(0);
    // Sunday 11pm PDT is Monday in UTC: must still count as an LA weekend.
    expect(startsOnLAWeekend('2026-07-20T06:00:00Z')).toBe(true);
  });
});

// ─── Ordering + slot 1 ───────────────────────────────────────────────────────

describe('rankCandidates', () => {
  const viewer = mkViewer();
  const candidate = (id: string, overrides: Partial<FirstJoinEventRow>, memberCount: number) =>
    scoreCandidate({ event: mkEvent({ id, ...overrides }), creator: mkCreator(), memberCount, viewer });

  it('orders by score descending', () => {
    const low = candidate('low', { neighborhood: 'Long Beach', primary_vibe: 'Gaming', drop_in: false, is_featured: false }, 1);
    const high = candidate('high', {}, 4);
    expect(rankCandidates([low, high]).map((c) => c.event.id)).toEqual(['high', 'low']);
  });

  it('breaks score ties by soonest start, then id', () => {
    const later = candidate('b-later', { start_time: '2026-07-23T02:00:00Z' }, 1);
    const sooner = candidate('c-sooner', { start_time: TUESDAY_START }, 1);
    const same = candidate('a-same', { start_time: TUESDAY_START }, 1);
    expect(rankCandidates([later, sooner, same]).map((c) => c.event.id)).toEqual(['a-same', 'c-sooner', 'b-later']);
  });

  it('promotes the big-room candidate to slot 1 even when outscored', () => {
    const strong = candidate('strong', {}, 4); // neighborhood+likelihood+social proof
    const bigRoom = candidate(
      'big-room',
      { neighborhood: 'Long Beach', primary_vibe: 'Gaming', is_featured: true },
      BIG_ROOM_MIN,
    );
    expect(strong.score).toBeGreaterThan(bigRoom.score);
    const ranked = rankCandidates([strong, bigRoom]);
    expect(ranked[0].event.id).toBe('big-room');
    expect(ranked[0].bigRoom).toBe(true);
    expect(ranked[1].event.id).toBe('strong');
  });

  it('promotes only the best big-room candidate when several exist', () => {
    const weakBig = candidate('weak-big', { neighborhood: 'Long Beach', primary_vibe: 'Gaming', is_featured: true }, BIG_ROOM_MIN);
    const strongBig = candidate('strong-big', { is_featured: true }, BIG_ROOM_MIN);
    const ranked = rankCandidates([weakBig, strongBig]);
    expect(ranked[0].event.id).toBe('strong-big');
  });

  it('leaves order untouched when no big room exists', () => {
    const a = candidate('a', {}, 4);
    const b = candidate('b', { neighborhood: 'Long Beach' }, 4);
    expect(rankCandidates([b, a])[0].event.id).toBe('a');
  });
});

// ─── Helpers + adjacency data ────────────────────────────────────────────────

describe('helpers', () => {
  it('ageFromBirthday handles pre/post birthday and null', () => {
    expect(ageFromBirthday('1998-03-14', NOW)).toBe(28);
    expect(ageFromBirthday('1998-11-30', NOW)).toBe(27);
    expect(ageFromBirthday(null, NOW)).toBeNull();
  });

  it('passesGenderRule handles null rule as mixed', () => {
    expect(passesGenderRule(null, 'man')).toBe(true);
    expect(passesGenderRule('nonbinary_only', 'non_binary')).toBe(true);
    expect(passesGenderRule('nonbinary_only', 'woman')).toBe(false);
  });

  it('candidateWindow spans now+12h to now+10d', () => {
    const { startIso, endIso } = candidateWindow(NOW);
    expect(new Date(startIso).getTime()).toBe(NOW.getTime() + 12 * 60 * 60 * 1000);
    expect(new Date(endIso).getTime()).toBe(NOW.getTime() + 10 * 24 * 60 * 60 * 1000);
  });
});

describe('neighborhood adjacency map', () => {
  it('only references real picker neighborhoods', () => {
    for (const [name, neighbors] of Object.entries(NEIGHBORHOOD_ADJACENCY)) {
      expect(NEIGHBORHOOD_SET.has(name)).toBe(true);
      for (const other of neighbors) expect(NEIGHBORHOOD_SET.has(other)).toBe(true);
    }
  });

  it('covers every picker neighborhood and is symmetric', () => {
    for (const name of NEIGHBORHOOD_OPTIONS) {
      expect(NEIGHBORHOOD_ADJACENCY[name]?.size ?? 0).toBeGreaterThan(0);
    }
    for (const [name, neighbors] of Object.entries(NEIGHBORHOOD_ADJACENCY)) {
      for (const other of neighbors) {
        expect(NEIGHBORHOOD_ADJACENCY[other].has(name)).toBe(true);
      }
    }
  });

  it('never matches null, unknown, or "Other"', () => {
    expect(isSameOrAdjacentNeighborhood(null, 'Echo Park')).toBe(false);
    expect(isSameOrAdjacentNeighborhood('Echo Park', null)).toBe(false);
    expect(isSameOrAdjacentNeighborhood('Other', 'Other')).toBe(false); // "somewhere else" twice is not shared geography
    expect(isSameOrAdjacentNeighborhood('Other', 'Echo Park')).toBe(false);
  });
});
