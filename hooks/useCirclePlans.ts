/**
 * useCirclePlans - a circle's upcoming plans for the noticeboard "coming up"
 * slot. Direct events query (events are directly readable like elsewhere in the
 * app); circle plans carry circle_id. Gated upstream by GROUPS_ENABLED, so this
 * only runs where the circle-plan columns exist.
 *
 * v1 simplification (see build notes A6): shows all of the circle's upcoming
 * plans to members; subset-plan privacy is enforced on the chat (event_members
 * / RLS), not by hiding the plan from this list.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export interface CirclePlanRow {
  id: string;
  title: string;
  start_time: string;
  location_text: string | null;
  circle_visibility: 'circle_only' | 'open' | null;
  has_own_chat: boolean;
  member_count: number;
  stranger_cap: number | null;
}

/** Optional caller identity from useCircle; legacy consumers keep the same key. */
export interface CirclePlansScope {
  userId: string;
  epoch: number;
  isCurrent: () => boolean;
}

export function useCirclePlans(circleId: string | null | undefined, scope?: CirclePlansScope) {
  return useQuery({
    queryKey: scope ? ['circle-plans', circleId ?? '', scope.userId, scope.epoch] : ['circle-plans', circleId ?? ''],
    enabled: !!circleId && (!scope || !!scope.userId),
    staleTime: 30_000,
    queryFn: async ({ signal }): Promise<CirclePlanRow[]> => {
      const requireCurrent = () => {
        if (signal.aborted || (scope && !scope.isCurrent())) throw new Error('This circle plan request is no longer current.');
      };
      requireCurrent();
      if (scope) {
        const { data: auth, error: authError } = await supabase.auth.getUser();
        requireCurrent();
        if (authError) throw authError;
        if (auth.user?.id !== scope.userId) throw new Error('This account changed. Please try again.');
      }
      requireCurrent();
      const request = supabase
        .from('events')
        .select('id, title, start_time, end_time, location_text, circle_visibility, has_own_chat, member_count, stranger_cap')
        .eq('circle_id', circleId)
        .in('status', ['forming', 'active', 'full'])
        .order('start_time', { ascending: true });
      const { data, error } = await (scope ? request.abortSignal(signal) : request);
      requireCurrent();
      // A failed request does not establish that this circle has no plans.
      if (error) throw error;
      const now = Date.now();
      return ((data ?? []) as any[])
        .filter((r) => {
          const end = r.end_time ? new Date(r.end_time).getTime() : new Date(r.start_time).getTime() + 3 * 60 * 60 * 1000;
          return end > now;
        })
        .map((r) => ({
          id: r.id,
          title: r.title,
          start_time: r.start_time,
          location_text: r.location_text ?? null,
          circle_visibility: r.circle_visibility ?? null,
          has_own_chat: !!r.has_own_chat,
          member_count: r.member_count ?? 0,
          stranger_cap: r.stranger_cap ?? null,
        }));
    },
  });
}
