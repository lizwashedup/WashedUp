/**
 * useInvitePeopleToPlan - the standard invite delivery, called on post for every
 * person the creator added in the composer's INVITE PEOPLE section. Wraps
 * invite_people_to_plan(p_event_id, p_recipient_ids) -> count delivered; each
 * recipient gets a notification + a plan card in the DM, deduped server-side.
 */
import { useMutation } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export function useInvitePeopleToPlan() {
  return useMutation({
    mutationFn: async (args: { eventId: string; recipientIds: string[] }): Promise<number> => {
      if (args.recipientIds.length === 0) return 0;
      const { data, error } = await supabase.rpc('invite_people_to_plan', {
        p_event_id: args.eventId,
        p_recipient_ids: args.recipientIds,
      });
      if (error) throw error;
      return (data as number) ?? 0;
    },
  });
}
