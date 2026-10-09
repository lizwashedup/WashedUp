import { useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { yoursKeys } from '../lib/yours/keys';
import { removeBlockedPrivateChatPreviews } from '../lib/chatListCache';
import { requestWithDeadline } from '../lib/requestWithDeadline';

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
    const isCurrent = () => mounted.current && (!scope || scope.isCurrent());
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
            if (!isCurrent() || (pending.current && (!pending.current.scope || pending.current.scope.isCurrent()))) return;
            const attempt = { scope }; pending.current = attempt; setOwner(attempt);
            setBlocking(true);
            try {
              const { data: { user }, error: authError } = await requestWithDeadline(supabase.auth.getUser(), 12_000);
              if (!isCurrent() || (scope && user?.id !== scope.userId)) return;
              if (authError) throw authError;
              if (!user) throw new Error('Could not confirm this account.');

              const { data: profile, error: readError } = await requestWithDeadline(supabase
                .from('profiles')
                .select('blocked_users')
                .eq('id', user.id)
                .single(), 12_000);
              if (!isCurrent()) return;
              if (readError) throw readError;
              if (!profile) throw new Error('Could not read blocked people.');

              const current: string[] = profile?.blocked_users ?? [];
              if (!current.includes(blockedId)) {
                let write = supabase
                  .from('profiles')
                  .update({ blocked_users: [...current, blockedId] })
                  .eq('id', user.id);
                // Compare against the array actually read. Another device or
                // sheet changing it must never have its newer blocks replaced.
                write = profile.blocked_users === null
                  ? write.is('blocked_users', null)
                  : write.eq('blocked_users', `{${current.join(',')}}`);
                const { data: receipt, error: writeError } = await requestWithDeadline(
                  write.select('id, blocked_users').maybeSingle(), 12_000);
                if (!isCurrent()) return;
                if (writeError) throw writeError;
                if (receipt?.id !== user.id || !Array.isArray(receipt.blocked_users) ||
                    ![...current, blockedId].every(id => receipt.blocked_users.includes(id))) {
                  throw new Error('The block could not be confirmed. Please try again.');
                }

                // Apple 1.2: Notify developer of inappropriate content when user blocks
                try {
                  void Promise.resolve(supabase.from('reports').insert({
                    reporter_user_id: user.id,
                    reported_user_id: blockedId,
                    reason: 'Blocked by user',
                    reported_event_id: null,
                    details: `User blocked ${blockedName}. They will no longer appear in their feed or be able to contact them.`,
                  })).catch(() => {});
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
              // profile/keep caches so access dies on the next read.
              queryClient.invalidateQueries({ queryKey: yoursKeys.grid(user.id) });
              queryClient.invalidateQueries({ queryKey: yoursKeys.backlog(user.id) });
              queryClient.invalidateQueries({ queryKey: yoursKeys.requests(user.id) });
              queryClient.invalidateQueries({
                queryKey: yoursKeys.profileCard(user.id, blockedId),
              });
              queryClient.invalidateQueries({
                queryKey: yoursKeys.personProfile(user.id, blockedId),
              });

              // Notify privacy observers after the account's invalidations:
              // closing a blocked DM can retire this component's own scope.
              removeBlockedPrivateChatPreviews(user.id, blockedId);
              if (isCurrent()) onSuccess?.();
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
