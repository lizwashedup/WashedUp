import { useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { yoursKeys } from '../lib/yours/keys';

export interface BlockOperationScope {
  userId: string;
  isCurrent: () => boolean;
}

/**
 * Apple Guideline 1.2: Blocking must (1) notify the developer of inappropriate content,
 * (2) remove the blocked user from the feed instantly.
 */
export function useBlock() {
  const [blocking, setBlocking] = useState(false);
  const [owner, setOwner] = useState<{ scope?: BlockOperationScope } | null>(null);
  const pending = useRef<{ scope?: BlockOperationScope } | null>(null);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const queryClient = useQueryClient();

  const blockUser = async (
    blockedId: string,
    blockedName: string,
    onSuccess?: () => void,
    scope?: BlockOperationScope,
  ) => {
    const isCurrent = () => !scope || (mounted.current && scope.isCurrent());
    if (!isCurrent()) return;
    Alert.alert(
      `Block ${blockedName}?`,
      `${blockedName} won't appear in your feed or be able to contact you. They won't be notified.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Block',
          style: 'destructive',
          onPress: async () => {
            if (!isCurrent() || (scope && pending.current && (!pending.current.scope || pending.current.scope.isCurrent()))) return;
            const attempt = { scope }; pending.current = attempt; setOwner(attempt);
            setBlocking(true);
            try {
              const { data: { user }, error: authError } = await supabase.auth.getUser();
              if (!isCurrent() || (scope && user?.id !== scope.userId)) return;
              if (scope && authError) throw authError;
              if (!user) return;

              const { data: profile, error: readError } = await supabase
                .from('profiles')
                .select('blocked_users')
                .eq('id', user.id)
                .single();
              if (!isCurrent()) return;
              if (scope && readError) throw readError;

              const current: string[] = profile?.blocked_users ?? [];
              if (!current.includes(blockedId)) {
                const { error: writeError } = await supabase
                  .from('profiles')
                  .update({ blocked_users: [...current, blockedId] })
                  .eq('id', user.id);
                if (!isCurrent()) return;
                if (scope && writeError) throw writeError;

                // Apple 1.2: Notify developer of inappropriate content when user blocks
                try {
                  await supabase.from('reports').insert({
                    reporter_user_id: user.id,
                    reported_user_id: blockedId,
                    reason: 'Blocked by user',
                    reported_event_id: null,
                    details: `User blocked ${blockedName}. They will no longer appear in their feed or be able to contact them.`,
                  });
                } catch {
                  // Report insert is best-effort; block still succeeds
                }
              }
              if (!isCurrent()) return;

              // Apple 1.2: Instant removal from feed — invalidate all relevant queries
              queryClient.invalidateQueries({ queryKey: ['events', 'feed'] });
              queryClient.invalidateQueries({ queryKey: ['events', 'detail'] });
              queryClient.invalidateQueries({ queryKey: ['events', 'members'] });
              queryClient.invalidateQueries({ queryKey: ['event-plans'] });
              queryClient.invalidateQueries({ queryKey: ['my-profile'] });
              queryClient.invalidateQueries({ queryKey: ['my-plans'] });
              queryClient.invalidateQueries({ queryKey: ['feed-member-ids'] });
              queryClient.invalidateQueries({ queryKey: ['profile-blocked'] });
              queryClient.invalidateQueries({ queryKey: ['friends'] });
              queryClient.invalidateQueries({ queryKey: ['profile-search'] });
              queryClient.invalidateQueries({ queryKey: ['scene-events'] });
              queryClient.invalidateQueries({ queryKey: ['explore-wishlists'] });
              queryClient.invalidateQueries({ queryKey: ['wishlists'] });
              queryClient.invalidateQueries({ queryKey: ['saved-plans'] });
              queryClient.invalidateQueries({ queryKey: ['topic-first-message'] });

              // Yours surfaces: sever the blocked person from the grid + their
              // profile/keep caches so access dies on the next read (the block
              // RPC also re-gates server-side; this clears the local cache).
              queryClient.invalidateQueries({ queryKey: yoursKeys.grid(user.id) });
              queryClient.invalidateQueries({ queryKey: yoursKeys.backlog(user.id) });
              queryClient.invalidateQueries({ queryKey: yoursKeys.requests(user.id) });
              queryClient.invalidateQueries({
                queryKey: yoursKeys.profileCard(user.id, blockedId),
              });
              queryClient.invalidateQueries({
                queryKey: yoursKeys.personProfile(user.id, blockedId),
              });

              onSuccess?.();
              setTimeout(() => {
                if (isCurrent()) Alert.alert('Blocked', `${blockedName} has been blocked.`);
              }, 300);
            } catch {
              if (isCurrent()) Alert.alert('Error', 'Could not block user. Please try again.');
            } finally {
              if (!scope || pending.current === attempt) {
                pending.current = null;
                if (isCurrent()) { setBlocking(false); setOwner(null); }
              }
            }
          },
        },
      ],
    );
  };

  return { blockUser, blocking: blocking && (!owner?.scope || (mounted.current && owner.scope.isCurrent())) };
}
