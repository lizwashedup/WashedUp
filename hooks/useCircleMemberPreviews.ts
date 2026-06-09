/**
 * useCircleMemberPreviews - member faces for the Yours > Circles directory cards.
 *
 * get_my_circles() returns member_count but no member faces, so the rich cards
 * batch-resolve a few joined members (name + photo) per visible circle in one
 * query. This mirrors the unnamed-circle name resolver already in useMyCircles:
 * circle_members joined to profiles_public (whose profile_photo_url is a
 * directly-renderable URL), filtered to joined status. Additive and read-only;
 * it degrades quietly (cards still render tile + name + meta if it fails).
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { MemberPreview } from '../lib/circles/types';

export type CircleMemberPreviews = Record<string, MemberPreview[]>;

export function useCircleMemberPreviews(
  circleIds: string[],
  userId: string | null | undefined,
) {
  // Stable, order-independent key so cache hits survive list re-ordering.
  const idsKey = [...circleIds].sort().join(',');

  return useQuery({
    queryKey: ['circleMemberPreviews', userId ?? '', idsKey],
    enabled: !!userId && circleIds.length > 0,
    queryFn: async (): Promise<CircleMemberPreviews> => {
      const { data: rows, error } = await supabase
        .from('circle_members')
        .select(
          'circle_id, user_id, joined_at, profiles_public!inner(first_name_display, profile_photo_url)',
        )
        .in('circle_id', circleIds)
        .eq('status', 'joined')
        .order('joined_at');
      if (error) throw error;

      const byCircle: CircleMemberPreviews = {};
      (rows ?? []).forEach((r: any) => {
        const prof = r.profiles_public as
          | { first_name_display: string | null; profile_photo_url: string | null }
          | null;
        (byCircle[r.circle_id] ??= []).push({
          user_id: r.user_id,
          name: prof?.first_name_display ?? null,
          photo_url: prof?.profile_photo_url ?? null,
        });
      });
      return byCircle;
    },
  });
}
