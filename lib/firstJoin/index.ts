/**
 * getFirstJoinCandidates(user_id, n): the plan ranking service every
 * first-join surface consumes (spec a1): onboarding "your first week" screen,
 * the week-one push ladder, and the rebook-on-cancel sheet.
 *
 * Returns candidates only. It never joins, never throws to the caller, and an
 * empty result asks the surface for the wishlist capture instead of an error.
 *
 * Supabase-backed data access lives here; all filtering/scoring logic is in
 * scoring.ts + candidates.ts and takes injected deps, so tests run without
 * the native supabase client. SQL narrows to joinable statuses inside the
 * time window; isEligible re-applies every rule in memory so the ranker is
 * correct even if the query loosens later.
 *
 * Reachability note for later steps: any push logic built on top of this must
 * read device_tokens, NOT profiles.expo_push_token (stale).
 */
import { GROUPS_ENABLED } from '../../constants/FeatureFlags';
import { fetchRealMemberCounts } from '../fetchPlans';
import { supabase } from '../supabase';
import { getFirstJoinCandidatesWithDeps, DEFAULT_CANDIDATE_COUNT } from './candidates';
import type { FirstJoinCreator, FirstJoinDeps, FirstJoinEventRow, FirstJoinResult, FirstJoinViewer } from './types';

const EVENT_COLUMNS =
  'id, title, start_time, status, neighborhood, primary_vibe, gender_rule, ' +
  'target_age_min, target_age_max, max_invites, min_invites, member_count, ' +
  'drop_in, is_featured, waitlist_closed, invite_locked, creator_user_id, ' +
  'image_url, location_text, slug';

export const supabaseFirstJoinDeps: FirstJoinDeps = {
  async fetchViewer(userId) {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, neighborhood, vibe_tags, gender, birthday')
      .eq('id', userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as FirstJoinViewer | null) ?? null;
  },

  async fetchCandidateEvents(windowStartIso, windowEndIso) {
    const { data, error } = await supabase
      .from('events')
      .select(
        // Circle columns only exist behind the (held) circle-plan migrations;
        // same gate as fetchPlans so this query never errors while they land.
        GROUPS_ENABLED ? `${EVENT_COLUMNS}, circle_visibility` : EVENT_COLUMNS,
      )
      .in('status', ['forming', 'active'])
      .gte('start_time', windowStartIso)
      .lte('start_time', windowEndIso);
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as FirstJoinEventRow[];
  },

  async fetchCreators(creatorIds) {
    if (creatorIds.length === 0) return [];
    const { data, error } = await supabase
      .from('profiles')
      .select('id, first_name_display, profile_photo_url, is_official_host, suspended_until')
      .in('id', creatorIds);
    if (error) throw new Error(error.message);
    return (data ?? []) as FirstJoinCreator[];
  },

  fetchRealMemberCounts,

  async fetchJoinedEventIds(userId) {
    const { data, error } = await supabase
      .from('event_members')
      .select('event_id')
      .eq('user_id', userId)
      .eq('status', 'joined');
    if (error) throw new Error(error.message);
    return ((data ?? []) as { event_id: string }[]).map((r) => r.event_id);
  },

  now: () => new Date(),
};

/** The n best joinable plans for a new user. Candidates only: never a join. */
export function getFirstJoinCandidates(
  userId: string,
  n: number = DEFAULT_CANDIDATE_COUNT,
): Promise<FirstJoinResult> {
  return getFirstJoinCandidatesWithDeps(userId, n, supabaseFirstJoinDeps);
}

export type { FirstJoinCandidate, FirstJoinResult, FirstJoinTier } from './types';
