/**
 * useLeaveCircle - leave a circle (spec section 3). Plan history is untouched;
 * the row just flips to status 'left'. Invalidates the directory so the circle
 * drops out of Yours > Circles on success.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { circleKeys } from '../lib/circles/keys';
import { markChatListDirty } from '../lib/chatListSignal';
import { UNREAD_CHATS_KEY } from '../constants/QueryKeys';

export function useLeaveCircle(userId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (circleId: string): Promise<string> => {
      const { data, error } = await supabase.rpc('leave_circle', {
        p_circle_id: circleId,
      });
      if (error) throw error;
      // 'not_member' means the membership row was already gone server-side;
      // callers treat it the same as 'left' (the chat is gone either way).
      return data as string; // 'left' | 'not_member'
    },
    onSuccess: () => {
      if (userId) qc.invalidateQueries({ queryKey: circleKeys.mine(userId) });
      // The Chats list is not a react-query cache and its focus refetch is
      // throttled ~30s; the dirty flag makes the left chat drop on the next
      // focus instead of lingering. The unread badge rides a query key.
      markChatListDirty();
      qc.invalidateQueries({ queryKey: UNREAD_CHATS_KEY });
    },
  });
}
