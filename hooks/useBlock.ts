import { useState } from 'react';
import { Alert } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

/**
 * Apple Guideline 1.2: Blocking must (1) notify the developer of inappropriate content,
 * (2) remove the blocked user from the feed instantly.
 */
export function useBlock() {
  const [blocking, setBlocking] = useState(false);
  const queryClient = useQueryClient();

  const blockUser = async (
    blockedId: string,
    blockedName: string,
    onSuccess?: () => void,
  ) => {
    Alert.alert(
      `Block ${blockedName}?`,
      `${blockedName} won't appear in your feed or be able to contact you. They won't be notified.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Block',
          style: 'destructive',
          onPress: async () => {
            setBlocking(true);
            try {
              const { data: { user } } = await supabase.auth.getUser();
              if (!user) return;

              const { data: profile } = await supabase
                .from('profiles')
                .select('blocked_users')
                .eq('id', user.id)
                .single();

              const current: string[] = profile?.blocked_users ?? [];
              if (!current.includes(blockedId)) {
                await supabase
                  .from('profiles')
                  .update({ blocked_users: [...current, blockedId] })
                  .eq('id', user.id);

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

              // Apple 1.2: Instant removal from feed — invalidate all relevant queries
              queryClient.invalidateQueries({ queryKey: ['events', 'feed'] });
              queryClient.invalidateQueries({ queryKey: ['events', 'detail'] });
              queryClient.invalidateQueries({ queryKey: ['events', 'members'] });
              queryClient.invalidateQueries({ queryKey: ['event-plans'] });
              queryClient.invalidateQueries({ queryKey: ['my-profile'] });
              queryClient.invalidateQueries({ queryKey: ['my-plans'] });
              queryClient.invalidateQueries({ queryKey: ['profile-blocked'] });
              queryClient.invalidateQueries({ queryKey: ['friends'] });
              queryClient.invalidateQueries({ queryKey: ['profile-search'] });
              queryClient.invalidateQueries({ queryKey: ['scene-events'] });
              queryClient.invalidateQueries({ queryKey: ['explore-wishlists'] });
              queryClient.invalidateQueries({ queryKey: ['wishlists'] });

              onSuccess?.();
              setTimeout(() => {
                Alert.alert('Blocked', `${blockedName} has been blocked.`);
              }, 300);
            } catch {
              Alert.alert('Error', 'Could not block user. Please try again.');
            } finally {
              setBlocking(false);
            }
          },
        },
      ],
    );
  };

  return { blockUser, blocking };
}
