/**
 * useCircleSuggestions — the caller's pending co-attendance suggestions
 * ("people you keep showing up with could be a circle"). Wraps
 * get_circle_suggestions (jsonb, names pre-resolved). Empty until the detection
 * job has run; degrades to [] on error so the directory never breaks on it.
 *
 * useSetSuggestionStatus — dismiss ('not now') or mark converted (started a
 * circle from it), via set_circle_suggestion_status.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { circleKeys } from '../lib/circles/keys';
import type { CircleSuggestion } from '../lib/circles/types';

export function useCircleSuggestions(userId: string | null | undefined) {
  return useQuery({
    queryKey: circleKeys.suggestions(userId ?? ''),
    enabled: !!userId,
    queryFn: async (): Promise<CircleSuggestion[]> => {
      const { data, error } = await supabase.rpc('get_circle_suggestions');
      if (error) throw error;
      return (data ?? []) as CircleSuggestion[];
    },
  });
}

export function useSetSuggestionStatus(userId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string; status: 'dismissed' | 'converted' }) => {
      const { data, error } = await supabase.rpc('set_circle_suggestion_status', {
        p_id: args.id,
        p_status: args.status,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      if (userId) qc.invalidateQueries({ queryKey: circleKeys.suggestions(userId) });
    },
  });
}
