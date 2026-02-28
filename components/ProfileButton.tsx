import React from 'react';
import { TouchableOpacity, Text, View, StyleSheet, AppState, AppStateStatus } from 'react-native';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { User } from 'lucide-react-native';
import { supabase } from '../lib/supabase';

export const PROFILE_PHOTO_KEY = ['profile-photo'] as const;

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

export default function ProfileButton() {
  const { data: photoUrl, refetch } = useQuery({
    queryKey: PROFILE_PHOTO_KEY,
    queryFn: fetchProfilePhoto,
    staleTime: 0,
    refetchOnMount: 'always', // Always refetch when ProfileButton mounts (post-onboarding, etc.)
  });

  // Refetch when screen gains focus (e.g. after editing profile)
  useFocusEffect(
    React.useCallback(() => {
      refetch();
    }, [refetch])
  );

  // Delayed refetches — handles DB replication lag and post-onboarding race
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

  // Refetch when app comes to foreground (e.g. after picking photo from system UI)
  React.useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') refetch();
    });
    return () => sub.remove();
  }, [refetch]);

  return (
    <TouchableOpacity
      style={styles.container}
      onPress={() => router.push('/profile')}
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
          <User size={20} color="#1A1A1A" strokeWidth={2} />
        )}
      </View>
      <Text style={styles.label}>Profile</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: 2,
  },
  circle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#F0E6D3',
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
    fontSize: 9,
    fontWeight: '600',
    color: '#999999',
  },
});
