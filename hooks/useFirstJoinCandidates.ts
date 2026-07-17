/**
 * useFirstJoinCandidates: the "your first week" screen's data source.
 *
 * Wraps the step-1 ranking service (getFirstJoinCandidates, spec a1) and maps
 * candidates to card props. Read-only: nothing here joins, writes, or mutates.
 * (The attendee face cluster was cut by founder decision 7-16, so no member
 * photo fetch: the "{n} going" count carries the proof.)
 */
import { useQuery } from '@tanstack/react-query';
import { getFirstJoinCandidates } from '../lib/firstJoin';
import type { FirstJoinTier } from '../lib/firstJoin';
import type { FirstJoinScoreSnapshot } from '../lib/firstJoin/logImpressions';
import type { FirstJoinCardPlan } from '../components/firstJoin/FirstJoinPlanCard';

export interface FirstJoinFeed {
  plans: FirstJoinCardPlan[];
  tier: FirstJoinTier;
  showWishlistPrompt: boolean;
  /** Per-weight contributions at render time, for first_join_prompts logging. */
  scoreSnapshots: FirstJoinScoreSnapshot[];
}

export function useFirstJoinCandidates(userId: string | null) {
  return useQuery({
    queryKey: ['first-join-candidates', userId ?? ''],
    enabled: !!userId,
    staleTime: 60_000,
    queryFn: async (): Promise<FirstJoinFeed> => {
      const result = await getFirstJoinCandidates(userId!, 3);

      const plans: FirstJoinCardPlan[] = result.candidates.map((c) => ({
        id: c.event.id,
        title: c.event.title,
        start_time: c.event.start_time,
        neighborhood: c.event.neighborhood,
        image_url: c.event.image_url,
        primary_vibe: c.event.primary_vibe,
        memberCount: c.memberCount,
        max_invites: c.event.max_invites,
        min_invites: c.event.min_invites,
        creatorName: c.creator?.first_name_display ?? null,
        creatorPhotoUrl: c.creator?.profile_photo_url ?? null,
      }));

      const scoreSnapshots: FirstJoinScoreSnapshot[] = result.candidates.map((c) => ({
        event_id: c.event.id,
        score: c.score,
        breakdown: c.breakdown,
      }));

      return { plans, tier: result.tier, showWishlistPrompt: result.showWishlistPrompt, scoreSnapshots };
    },
  });
}
