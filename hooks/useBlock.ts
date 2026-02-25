import { useState } from 'react';
import { Alert } from 'react-native';
import { supabase } from '../lib/supabase';

export function useBlock() {
  const [blocking, setBlocking] = useState(false);

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
              }

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
