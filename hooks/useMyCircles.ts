/**
 * useMyCircles - the caller's joined circles for the Yours > Circles directory.
 *
 * Wraps the `get_my_circles()` RPC (SECURITY DEFINER, authorizes on auth.uid()).
 * The RPC takes no params; userId is passed only to gate `enabled` and key the
 * cache. Returns jsonb, so the payload arrives already parsed as MyCircle[].
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { CirclePlansScope } from './useCirclePlans';
import { circleKeys } from '../lib/circles/keys';
import { circleDisplay, type DisplayMember } from '../lib/circles/display';
import type { MyCircle } from '../lib/circles/types';

export function useMyCircles(userId: string | null | undefined, scope?: CirclePlansScope) {
  return useQuery({
    queryKey: scope ? [...circleKeys.mine(userId ?? ''), scope.epoch] : circleKeys.mine(userId ?? ''),
    enabled: !!userId,
    queryFn: async ({ signal }): Promise<MyCircle[]> => {
      const requireCurrent = () => {
        if (signal.aborted || (scope && (!scope.userId || scope.userId !== userId || !scope.isCurrent()))) {
          throw new Error('This circle directory request is no longer current.');
        }
      };
      requireCurrent();
      if (scope) {
        const { data: auth, error: authError } = await supabase.auth.getUser();
        requireCurrent();
        if (authError) throw authError;
        if (auth.user?.id !== scope.userId) throw new Error('This account changed. Please try again.');
      }
      requireCurrent();
      const request = supabase.rpc('get_my_circles');
      const { data, error } = await (scope ? request.abortSignal(signal) : request);
      requireCurrent();
      if (error) throw error;
      const circles = (data ?? []) as MyCircle[];

      // Unnamed circles (a DM grown to 3+ people) have no stored name. Resolve a
      // member-name title client-side so the directory never shows a blank row.
      // (get_my_circles returns no member names; one batch query covers them.)
      const unnamed = circles.filter((c) => !(c.name ?? '').trim());
      if (unnamed.length === 0 || !userId) return circles;

      const memberRequest = supabase
        .from('circle_members')
        .select('circle_id, user_id, profiles_public!inner(first_name_display)')
        .in('circle_id', unnamed.map((c) => c.id))
        .eq('status', 'joined');
      const { data: rows } = await (scope ? memberRequest.abortSignal(signal) : memberRequest);
      requireCurrent();

      const byCircle: Record<string, DisplayMember[]> = {};
      (rows ?? []).forEach((r: any) => {
        if (!byCircle[r.circle_id]) byCircle[r.circle_id] = [];
        byCircle[r.circle_id].push({
          user_id: r.user_id,
          name: (r.profiles_public as any)?.first_name_display ?? null,
          avatar_url: null,
        });
      });

      return circles.map((c) =>
        (c.name ?? '').trim()
          ? c
          : { ...c, display_name: circleDisplay('', byCircle[c.id] ?? [], userId).title },
      );
    },
  });
}
