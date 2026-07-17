/**
 * useFirstJoinCandidates: the "your first week" screen's data source.
 *
 * Wraps the step-1 ranking service (getFirstJoinCandidates, spec a1) and
 * enriches each candidate with joined-member faces for the proof row, using
 * the same event_members → profiles_public pattern as the featured-plans
 * feed. Read-only: nothing here joins, writes, or mutates.
 */
import { useQuery } from '@tanstack/react-query';
import { getFirstJoinCandidates } from '../lib/firstJoin';
import type { FirstJoinTier } from '../lib/firstJoin';
import type { FirstJoinScoreSnapshot } from '../lib/firstJoin/logImpressions';
import { supabase } from '../lib/supabase';
import type { FirstJoinCardPlan } from '../components/firstJoin/FirstJoinPlanCard';

export interface FirstJoinFeed {
  plans: FirstJoinCardPlan[];
  tier: FirstJoinTier;
  showWishlistPrompt: boolean;
  /** Per-weight contributions at render time, for first_join_prompts logging. */
  scoreSnapshots: FirstJoinScoreSnapshot[];
}

async function fetchAttendeePhotos(eventIds: string[]): Promise<Record<string, { profile_photo_url: string | null }[]>> {
  if (eventIds.length === 0) return {};
  const { data: members, error } = await supabase
    .from('event_members')
    .select('event_id, user_id')
    .in('event_id', eventIds)
    .eq('status', 'joined');
  if (error || !members?.length) return {};

  const memberIds = [...new Set(members.map((m: any) => m.user_id))];
  const { data: profiles } = await supabase
    .from('profiles_public')
    .select('id, profile_photo_url')
    .in('id', memberIds);
  const photoById: Record<string, string | null> = {};
  (profiles ?? []).forEach((p: any) => {
    photoById[p.id] = p.profile_photo_url ?? null;
  });

  const byEvent: Record<string, { profile_photo_url: string | null }[]> = {};
  members.forEach((m: any) => {
    (byEvent[m.event_id] ??= []).push({ profile_photo_url: photoById[m.user_id] ?? null });
  });
  return byEvent;
}

export function useFirstJoinCandidates(userId: string | null) {
  return useQuery({
    queryKey: ['first-join-candidates', userId ?? ''],
    enabled: !!userId,
    staleTime: 60_000,
    queryFn: async (): Promise<FirstJoinFeed> => {
      const result = await getFirstJoinCandidates(userId!, 3);
      const attendeesByEvent = await fetchAttendeePhotos(result.candidates.map((c) => c.event.id));

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
        bigRoom: c.bigRoom,
        creatorName: c.creator?.first_name_display ?? null,
        creatorPhotoUrl: c.creator?.profile_photo_url ?? null,
        attendees: attendeesByEvent[c.event.id] ?? [],
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
