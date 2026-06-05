/**
 * useCreateCircle — create a circle and apply its invite policy.
 *
 * create_circle seeds the caller as admin and the picked people as members
 * (the 'only_me' default). For 'everyone' / 'chosen' we follow up with
 * update_circle (set-all-admins / promote), which is admin-gated and the caller
 * is the fresh creator-admin, so it's authorized. Returns the new circle id.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { logError } from '../lib/logger';
import { circleKeys } from '../lib/circles/keys';
import type { CreateCircleArgs } from '../lib/circles/types';

export function useCreateCircle(userId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: CreateCircleArgs): Promise<string> => {
      const { data, error } = await supabase.rpc('create_circle', {
        p_name: args.name,
        p_description: args.description,
        p_member_user_ids: args.memberUserIds,
      });
      if (error) throw error;
      const circleId = data as string;

      // Permissions are a refinement on an already-created circle. If this step
      // fails we must NOT throw: throwing would report "create failed" while the
      // circle exists, and a retry would make a duplicate. Best-effort instead;
      // the circle keeps the safe default (creator-only admin) and the policy
      // can be set later in circle settings.
      try {
        if (args.invitePolicy === 'everyone') {
          const { error: e } = await supabase.rpc('update_circle', {
            p_circle_id: circleId,
            p_set_all_admins: true,
          });
          if (e) throw e;
        } else if (args.invitePolicy === 'chosen' && args.adminUserIds.length > 0) {
          const { error: e } = await supabase.rpc('update_circle', {
            p_circle_id: circleId,
            p_promote_user_ids: args.adminUserIds,
          });
          if (e) throw e;
        }
      } catch (e) {
        logError(e, 'useCreateCircle.applyPolicy');
      }

      return circleId;
    },
    onSuccess: () => {
      if (userId) qc.invalidateQueries({ queryKey: circleKeys.mine(userId) });
    },
  });
}
