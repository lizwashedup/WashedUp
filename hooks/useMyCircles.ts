/**
 * useMyCircles - the caller's joined circles for the Yours > Circles directory.
 *
 * Wraps the `get_my_circles()` RPC (SECURITY DEFINER, authorizes on auth.uid()).
 * The RPC takes no params; userId is passed only to gate `enabled` and key the
 * cache. Returns jsonb, so the payload arrives already parsed as MyCircle[].
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { circleKeys } from '../lib/circles/keys';
import { circleDisplay, type DisplayMember } from '../lib/circles/display';
import type { MyCircle } from '../lib/circles/types';

export function useMyCircles(userId: string | null | undefined) {
  return useQuery({
    queryKey: circleKeys.mine(userId ?? ''),
    enabled: !!userId,
    queryFn: async (): Promise<MyCircle[]> => {
      const { data, error } = await supabase.rpc('get_my_circles');
      if (error) throw error;
      const circles = (data ?? []) as MyCircle[];

      // Unnamed circles (a DM grown to 3+ people) have no stored name. Resolve a
      // member-name title client-side so the directory never shows a blank row.
      // (get_my_circles returns no member names; one batch query covers them.)
      const unnamed = circles.filter((c) => !(c.name ?? '').trim());
      if (unnamed.length === 0 || !userId) return circles;

      const { data: rows } = await supabase
        .from('circle_members')
        .select('circle_id, user_id, profiles_public!inner(first_name_display)')
        .in('circle_id', unnamed.map((c) => c.id))
        .eq('status', 'joined');

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
