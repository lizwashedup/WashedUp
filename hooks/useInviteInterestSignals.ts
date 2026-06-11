/**
 * useInviteInterestSignals - want-in suggestions for the composer's INVITE
 * PEOPLE section. Wraps get_invite_interest_signals() (dismissal-aware: hides a
 * person once dismissed, re-shows them only on a newer want-in). Distinct from
 * the legacy get_creator_interest_signals (no dismissal filter), which the old
 * composer section used.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { yoursKeys } from '../lib/yours/keys';

export interface InviteInterestSignal {
  signal_id: string;
  interested_user_id: string;
  interested_name: string | null;
  interested_photo_url: string | null;
  origin_event_id: string;
  origin_event_title: string | null;
  created_at: string;
}

export function useInviteInterestSignals(userId: string | null | undefined) {
  return useQuery({
    queryKey: yoursKeys.inviteSignals(userId ?? ''),
    enabled: !!userId,
    queryFn: async (): Promise<InviteInterestSignal[]> => {
      const { data, error } = await supabase.rpc('get_invite_interest_signals');
      if (error) throw error;
      return (data ?? []) as InviteInterestSignal[];
    },
  });
}
