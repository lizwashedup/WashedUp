/**
 * First-join candidate orchestrator (spec a1). Pure control flow over injected
 * data access: filter to eligible plans, apply fallback tiers, rank, take n.
 *
 * Contract with every consumer (onboarding screen, push ladder, rebook sheet):
 * this NEVER throws and NEVER auto-joins: an empty result comes back as
 * showWishlistPrompt so the surface renders the wishlist capture, not an error.
 */
import { isEligible, geoMatches, rankCandidates, scoreCandidate, vibeMatches, candidateWindow } from './scoring';
import type { FirstJoinCandidate, FirstJoinDeps, FirstJoinResult, FirstJoinTier, FirstJoinViewer } from './types';

export const DEFAULT_CANDIDATE_COUNT = 3;

const EMPTY_RESULT: FirstJoinResult = {
  candidates: [],
  tier: 'no_vibe',
  showWishlistPrompt: true,
};

/** Viewer fallback when the profile row is missing: everything tiers down gracefully. */
const NO_PROFILE = (userId: string): FirstJoinViewer => ({
  id: userId,
  neighborhood: null,
  vibe_tags: null,
  gender: null,
  birthday: null,
});

export async function getFirstJoinCandidatesWithDeps(
  userId: string,
  n: number,
  deps: FirstJoinDeps,
): Promise<FirstJoinResult> {
  if (!userId || n <= 0) return EMPTY_RESULT;

  try {
    const now = deps.now();
    const { startIso, endIso } = candidateWindow(now);

    const [viewerRow, events, joinedIds] = await Promise.all([
      deps.fetchViewer(userId),
      deps.fetchCandidateEvents(startIso, endIso),
      deps.fetchJoinedEventIds(userId),
    ]);
    const viewer = viewerRow ?? NO_PROFILE(userId);
    if (events.length === 0) return EMPTY_RESULT;

    const creatorIds = [...new Set(events.map((e) => e.creator_user_id).filter(Boolean))] as string[];
    const [creators, realCounts] = await Promise.all([
      deps.fetchCreators(creatorIds),
      deps.fetchRealMemberCounts(events.map((e) => e.id)),
    ]);
    const creatorById = new Map(creators.map((c) => [c.id, c]));
    const joinedEventIds = new Set(joinedIds);

    const eligible: FirstJoinCandidate[] = [];
    for (const event of events) {
      const creator = event.creator_user_id ? (creatorById.get(event.creator_user_id) ?? null) : null;
      // Real joined count from event_members, floored at 1: the creator is
      // always in the room (member_count column drifts; same rule as fetchPlans).
      const memberCount = Math.max(1, realCounts[event.id] ?? event.member_count ?? 1);
      if (!isEligible({ event, creator, memberCount, viewer, joinedEventIds, now })) continue;
      eligible.push(scoreCandidate({ event, creator, memberCount, viewer }));
    }

    // Fallback tiers (spec a1): each widens the previous, so later tiers are
    // supersets: the base tier requires nearby + vibe match, "wider radius"
    // drops the geo constraint, "no vibe" drops both.
    const tiers: Array<{ tier: FirstJoinTier; pool: FirstJoinCandidate[] }> = [
      {
        tier: 'base',
        pool: eligible.filter(
          (c) =>
            geoMatches(viewer.neighborhood, c.event.neighborhood) &&
            vibeMatches(viewer.vibe_tags, c.event.primary_vibe),
        ),
      },
      {
        tier: 'wider_radius',
        pool: eligible.filter((c) => vibeMatches(viewer.vibe_tags, c.event.primary_vibe)),
      },
      { tier: 'no_vibe', pool: eligible },
    ];

    // First tier that can fill the request wins; otherwise fall through to the
    // widest pool and return whatever exists (1-2 cards beat an empty screen).
    const chosen = tiers.find((t) => t.pool.length >= n) ?? tiers[tiers.length - 1];

    return {
      candidates: rankCandidates(chosen.pool).slice(0, n),
      tier: chosen.tier,
      showWishlistPrompt: chosen.pool.length === 0,
    };
  } catch (err) {
    // A ranking hiccup must surface as the wishlist prompt, never an error screen.
    console.warn('[getFirstJoinCandidates]', err instanceof Error ? err.message : err);
    return EMPTY_RESULT;
  }
}
