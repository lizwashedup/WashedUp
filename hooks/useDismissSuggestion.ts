/**
 * useDismissSuggestion - dismiss / undo a want-in suggestion (the anti-rot rule).
 *
 * dismiss_suggestion hides a person from the creator's future composer sessions
 * until they raise a hand again; undo_dismiss_suggestion restores them. Both
 * invalidate the invite-signals query so the list reflects the change. The
 * composer also keeps optimistic local state so the row vanishes/returns instantly
 * with the undo toast.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { yoursKeys } from '../lib/yours/keys';

export function useDismissSuggestion(userId: string | null | undefined) {
  const qc = useQueryClient();
  const invalidate = () => {
    if (userId) qc.invalidateQueries({ queryKey: yoursKeys.inviteSignals(userId) });
  };

  const dismiss = useMutation({
    mutationFn: async (suggestedUserId: string): Promise<void> => {
      const { error } = await supabase.rpc('dismiss_suggestion', {
        p_suggested_user_id: suggestedUserId,
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const undo = useMutation({
    mutationFn: async (suggestedUserId: string): Promise<void> => {
      const { error } = await supabase.rpc('undo_dismiss_suggestion', {
        p_suggested_user_id: suggestedUserId,
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  return { dismiss, undo };
}
