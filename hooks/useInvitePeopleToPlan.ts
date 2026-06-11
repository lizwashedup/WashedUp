/**
 * useInvitePeopleToPlan - the standard invite delivery, called on post for every
 * person the creator added in the composer's INVITE PEOPLE section. Wraps
 * invite_people_to_plan(p_event_id, p_recipient_ids); each recipient gets a
 * notification + a plan card in the DM, deduped server-side.
 *
 * The returned number is the RPC's row count, which OVER-reports: a re-invite of
 * someone already invited is a server-side no-op but is still counted. So this
 * value is NOT an accurate "delivered N" and must NOT be surfaced as "Invited N"
 * in the UI. Callers treat the call as fire-and-forget (a delivery hiccup must
 * not roll back the post) and only react to the error, not the count.
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
      // Over-reports (counts no-op re-invites); do not surface as "Invited N".
      return (data as number) ?? 0;
    },
  });
}
