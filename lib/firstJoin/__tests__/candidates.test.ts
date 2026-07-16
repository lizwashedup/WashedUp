/**
 * Orchestrator tests (spec a1): fallback tiers (widen radius, then drop vibe),
 * the wishlist-instead-of-error contract, big-room slot 1 end to end, and the
 * real-member-count correction.
 */
import { getFirstJoinCandidatesWithDeps, DEFAULT_CANDIDATE_COUNT } from '../candidates';
import { BIG_ROOM_MIN } from '../scoring';
import type { FirstJoinDeps, FirstJoinEventRow } from '../types';
import { mkCreator, mkEvent, mkViewer, NOW } from './builders';

function mkDeps(overrides: Partial<FirstJoinDeps> = {}): FirstJoinDeps {
  return {
    fetchViewer: async () => mkViewer(),
    fetchCandidateEvents: async () => [],
    fetchCreators: async (ids) => ids.map((id) => mkCreator({ id })),
    fetchRealMemberCounts: async () => ({}),
    fetchJoinedEventIds: async () => [],
    now: () => NOW,
    ...overrides,
  };
}

// Echo Park + Sports matches the default viewer; Long Beach + Gaming matches neither.
const nearMatching = (id: string, extra: Partial<FirstJoinEventRow> = {}) => mkEvent({ id, ...extra });
const farMatching = (id: string) => mkEvent({ id, neighborhood: 'Long Beach', primary_vibe: 'Sports' });
const farOffVibe = (id: string) => mkEvent({ id, neighborhood: 'Long Beach', primary_vibe: 'Gaming' });

describe('getFirstJoinCandidatesWithDeps', () => {
  it('defaults to three cards', () => {
    expect(DEFAULT_CANDIDATE_COUNT).toBe(3);
  });

  it('serves the base tier when enough nearby vibe-matching plans exist', async () => {
    const deps = mkDeps({
      fetchCandidateEvents: async () => [nearMatching('a'), nearMatching('b'), nearMatching('c'), farOffVibe('d')],
    });
    const result = await getFirstJoinCandidatesWithDeps('viewer-1', 3, deps);
    expect(result.tier).toBe('base');
    expect(result.candidates.map((c) => c.event.id).sort()).toEqual(['a', 'b', 'c']);
    expect(result.showWishlistPrompt).toBe(false);
  });

  it('fallback tier 1: widens radius when the neighborhood cannot fill the request', async () => {
    const deps = mkDeps({
      fetchCandidateEvents: async () => [nearMatching('near'), farMatching('far-1'), farMatching('far-2'), farOffVibe('off')],
    });
    const result = await getFirstJoinCandidatesWithDeps('viewer-1', 3, deps);
    expect(result.tier).toBe('wider_radius');
    expect(result.candidates.map((c) => c.event.id).sort()).toEqual(['far-1', 'far-2', 'near']);
    // The nearby plan still ranks first inside the widened pool (+3 neighborhood).
    expect(result.candidates[0].event.id).toBe('near');
  });

  it('fallback tier 2: drops the vibe match when radius alone is not enough', async () => {
    const deps = mkDeps({
      fetchCandidateEvents: async () => [nearMatching('near'), farOffVibe('off-1'), farOffVibe('off-2')],
    });
    const result = await getFirstJoinCandidatesWithDeps('viewer-1', 3, deps);
    expect(result.tier).toBe('no_vibe');
    expect(result.candidates).toHaveLength(3);
    expect(result.candidates[0].event.id).toBe('near');
  });

  it('returns a short list rather than nothing when even the widest tier is thin', async () => {
    const deps = mkDeps({ fetchCandidateEvents: async () => [farOffVibe('only')] });
    const result = await getFirstJoinCandidatesWithDeps('viewer-1', 3, deps);
    expect(result.tier).toBe('no_vibe');
    expect(result.candidates.map((c) => c.event.id)).toEqual(['only']);
    expect(result.showWishlistPrompt).toBe(false);
  });

  it('empty result: no plans at all → wishlist prompt, never an error', async () => {
    const result = await getFirstJoinCandidatesWithDeps('viewer-1', 3, mkDeps());
    expect(result.candidates).toEqual([]);
    expect(result.showWishlistPrompt).toBe(true);
  });

  it('empty result: plans exist but none are eligible → wishlist prompt', async () => {
    const deps = mkDeps({
      fetchCandidateEvents: async () => [mkEvent({ id: 'locked', invite_locked: true }), mkEvent({ id: 'closed', waitlist_closed: true })],
    });
    const result = await getFirstJoinCandidatesWithDeps('viewer-1', 3, deps);
    expect(result.candidates).toEqual([]);
    expect(result.showWishlistPrompt).toBe(true);
  });

  it('a data-access failure degrades to the wishlist prompt, never a throw', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const deps = mkDeps({
      fetchCandidateEvents: async () => {
        throw new Error('network down');
      },
    });
    await expect(getFirstJoinCandidatesWithDeps('viewer-1', 3, deps)).resolves.toEqual({
      candidates: [],
      tier: 'no_vibe',
      showWishlistPrompt: true,
    });
    warn.mockRestore();
  });

  it('big-room plan takes slot 1 end to end', async () => {
    const deps = mkDeps({
      fetchCandidateEvents: async () => [
        nearMatching('strong'),
        nearMatching('mid'),
        // Off-neighborhood, off-vibe: outscored by 'strong', promoted anyway.
        nearMatching('big-room', { is_featured: true, neighborhood: 'Long Beach', primary_vibe: 'Gaming' }),
      ],
      fetchRealMemberCounts: async () => ({ strong: 5, mid: 4, 'big-room': BIG_ROOM_MIN }),
    });
    const result = await getFirstJoinCandidatesWithDeps('viewer-1', 3, deps);
    expect(result.candidates[0].event.id).toBe('big-room');
    expect(result.candidates[0].bigRoom).toBe(true);
  });

  it('uses real joined counts (floored at 1) over the drifting member_count column', async () => {
    const deps = mkDeps({
      // Column claims 2 spots free; real count says full.
      fetchCandidateEvents: async () => [
        mkEvent({ id: 'actually-full', member_count: 8, max_invites: 10 }),
        mkEvent({ id: 'zero-count', member_count: 0 }),
      ],
      fetchRealMemberCounts: async () => ({ 'actually-full': 10 }),
    });
    const result = await getFirstJoinCandidatesWithDeps('viewer-1', 3, deps);
    expect(result.candidates.map((c) => c.event.id)).toEqual(['zero-count']);
    expect(result.candidates[0].memberCount).toBe(1); // creator is always in the room
  });

  it('excludes plans the viewer created or already joined', async () => {
    const deps = mkDeps({
      fetchCandidateEvents: async () => [
        mkEvent({ id: 'mine', creator_user_id: 'viewer-1' }),
        mkEvent({ id: 'joined' }),
        mkEvent({ id: 'fresh' }),
      ],
      fetchJoinedEventIds: async () => ['joined'],
    });
    const result = await getFirstJoinCandidatesWithDeps('viewer-1', 3, deps);
    expect(result.candidates.map((c) => c.event.id)).toEqual(['fresh']);
  });

  it('slices to n', async () => {
    const deps = mkDeps({
      fetchCandidateEvents: async () => [nearMatching('a'), nearMatching('b'), nearMatching('c'), nearMatching('d')],
    });
    const result = await getFirstJoinCandidatesWithDeps('viewer-1', 2, deps);
    expect(result.candidates).toHaveLength(2);
  });

  it('survives a missing profile row (all fields null → widest tier)', async () => {
    const deps = mkDeps({
      fetchViewer: async () => null,
      fetchCandidateEvents: async () => [nearMatching('a')],
    });
    const result = await getFirstJoinCandidatesWithDeps('viewer-1', 3, deps);
    expect(result.tier).toBe('no_vibe');
    expect(result.candidates.map((c) => c.event.id)).toEqual(['a']);
  });

  it('returns the empty shape for a missing user id or non-positive n', async () => {
    const deps = mkDeps({ fetchCandidateEvents: async () => [nearMatching('a')] });
    expect((await getFirstJoinCandidatesWithDeps('', 3, deps)).showWishlistPrompt).toBe(true);
    expect((await getFirstJoinCandidatesWithDeps('viewer-1', 0, deps)).showWishlistPrompt).toBe(true);
  });
});
