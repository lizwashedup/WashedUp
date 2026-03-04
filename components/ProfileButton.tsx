import { useFocusEffect } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Mail, User } from 'lucide-react-native';
import React from 'react';
import { AppState, AppStateStatus, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Colors from '../constants/Colors';
import { Fonts, FontSizes } from '../constants/Typography';
import { supabase } from '../lib/supabase';

export const PROFILE_PHOTO_KEY = ['profile-photo'] as const;
export const INBOX_COUNT_KEY = ['inbox-count'] as const;

async function fetchProfilePhoto(): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from('profiles')
    .select('profile_photo_url')
    .eq('id', user.id)
    .single();
  return data?.profile_photo_url ?? null;
}

async function fetchInboxCount(): Promise<number> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return 0;

  const [invites, notifs] = await Promise.all([
    supabase
      .from('plan_invites')
      .select('id, events!inner(status)')
      .eq('recipient_id', user.id)
      .eq('status', 'pending')
      .in('events.status', ['forming', 'active', 'full']),
    supabase
      .from('app_notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('status', 'unread'),
  ]);

  const activeInviteCount = (invites.data ?? []).length;
  return activeInviteCount + (notifs.count ?? 0);
}

export default function ProfileButton() {
  const { data: photoUrl, refetch } = useQuery({
    queryKey: PROFILE_PHOTO_KEY,
    queryFn: fetchProfilePhoto,
    staleTime: 30_000,
  });

  const { data: inboxCount = 0 } = useQuery({
    queryKey: INBOX_COUNT_KEY,
    queryFn: fetchInboxCount,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  useFocusEffect(
    React.useCallback(() => {
      refetch();
    }, [refetch])
  );

  React.useEffect(() => {
    const t1 = setTimeout(() => refetch(), 800);
    const t2 = setTimeout(() => refetch(), 2500);
    const t3 = setTimeout(() => refetch(), 6000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [refetch]);

  React.useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') refetch();
    });
    return () => sub.remove();
  }, [refetch]);

  return (
    <View style={styles.wrapper}>
      <TouchableOpacity
        style={styles.envelopeBtn}
        onPress={() => router.push('/(tabs)/friends?openInbox=1' as any)}
        accessibilityLabel="Inbox"
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <Mail size={20} color={Colors.asphalt} />
        {inboxCount > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{inboxCount > 9 ? '9+' : inboxCount}</Text>
          </View>
        )}
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.container}
        onPress={() => router.push('/(tabs)/profile')}
        accessibilityLabel="Profile"
      >
        <View style={styles.circle}>
          {photoUrl ? (
            <Image
              source={{ uri: photoUrl }}
              style={styles.photo}
              contentFit="cover"
            />
          ) : (
            <User size={20} color={Colors.asphalt} strokeWidth={2} />
          )}
        </View>
        <Text style={styles.label}>Profile</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  container: {
    alignItems: 'center',
    gap: 2,
  },
  envelopeBtn: {
    position: 'relative',
    padding: 4,
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -6,
    backgroundColor: Colors.terracotta,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeText: {
    fontFamily: Fonts.sansBold,
    fontSize: 10,
    color: Colors.white,
  },
  circle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  photo: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  label: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.micro,
    color: Colors.textLight,
  },
});
