import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export interface NearbyPlan {
  id: string;
  title: string;
  start_time: string;
  member_count: number | null;
}

/**
 * Soonest joinable plans, for the new-user activation moment. This is a
 * lightweight time-ordered query, not geo-ranked; a follow-up can swap in
 * the feed's distance ranking (get_filtered_feed).
 */
export function useNearbyPlans(enabled: boolean) {
  return useQuery({
    queryKey: ['yours', 'nearby-plans'],
    enabled,
    queryFn: async (): Promise<NearbyPlan[]> => {
      const { data, error } = await supabase
        .from('events')
        .select('id, title, start_time, member_count, status')
        .in('status', ['forming', 'active', 'full'])
        .gte('start_time', new Date().toISOString())
        .order('start_time', { ascending: true })
        .limit(3);
      if (error) throw error;
      return (data ?? []).map((e: any) => ({
        id: e.id,
        title: e.title,
        start_time: e.start_time,
        member_count: e.member_count,
      }));
    },
  });
}
