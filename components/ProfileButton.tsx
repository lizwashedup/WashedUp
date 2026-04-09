import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Bell, User } from 'lucide-react-native';
import React, { useRef, useState } from 'react';
import { AppState, AppStateStatus, Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Colors from '../constants/Colors';
import { Fonts, FontSizes } from '../constants/Typography';
import { INBOX_COUNT_KEY, PROFILE_PHOTO_KEY } from '../constants/QueryKeys';
import InboxModal from './InboxModal';
import { supabase } from '../lib/supabase';

const PROFILE_PROMPT_KEY = 'has_seen_profile_prompt';

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
      .eq('status', 'unread')
      .neq('type', 'plan_invite')
      .neq('type', 'new_message'),
  ]);

  const activeInviteCount = (invites.data ?? []).length;
  return activeInviteCount + (notifs.count ?? 0);
}

export default function ProfileButton() {
  const [showInbox, setShowInbox] = useState(false);
  const [showProfilePrompt, setShowProfilePrompt] = useState(false);
  const hasCheckedPrompt = useRef(false);

  const handleProfilePress = async () => {
    if (!hasCheckedPrompt.current) {
      const seen = await AsyncStorage.getItem(PROFILE_PROMPT_KEY).catch(() => null);
      hasCheckedPrompt.current = true;
      if (!seen) {
        setShowProfilePrompt(true);
        return;
      }
    }
    router.push('/(tabs)/profile');
  };

  const dismissPrompt = (navigate: boolean) => {
    setShowProfilePrompt(false);
    AsyncStorage.setItem(PROFILE_PROMPT_KEY, 'true').catch(() => {});
    if (navigate) {
      router.push('/(tabs)/profile?openEdit=true' as any);
    }
  };

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

  const { data: userId } = useQuery({
    queryKey: ['auth-user-id'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      return user?.id ?? null;
    },
    staleTime: 60_000,
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
        onPress={() => setShowInbox(true)}
        accessibilityLabel="Inbox"
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <Bell size={20} color={inboxCount > 0 ? '#B5522E' : '#78695C'} strokeWidth={1.5} />
        {inboxCount > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{inboxCount > 9 ? '9+' : inboxCount}</Text>
          </View>
        )}
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.container}
        onPress={handleProfilePress}
        accessibilityLabel="Profile"
        hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
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
      <InboxModal
        visible={showInbox}
        onClose={() => setShowInbox(false)}
        userId={userId ?? null}
      />
      <Modal
        visible={showProfilePrompt}
        transparent
        animationType="fade"
        onRequestClose={() => dismissPrompt(false)}
      >
        <Pressable style={styles.promptOverlay} onPress={() => dismissPrompt(false)}>
          <Pressable style={styles.promptCard} onPress={() => {}}>
            <Text style={styles.promptTitle}>Complete your profile!</Text>
            <Text style={styles.promptBody}>
              Tell people a little about you so they get excited to meet you.
            </Text>
            <TouchableOpacity
              style={styles.promptButton}
              onPress={() => dismissPrompt(true)}
              activeOpacity={0.8}
            >
              <Text style={styles.promptButtonText}>Let's do it</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
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
    fontSize: FontSizes.micro,
    color: Colors.white,
  },
  circle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  photo: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  label: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.micro,
    color: Colors.textLight,
  },
  promptOverlay: {
    flex: 1,
    backgroundColor: Colors.overlayDark,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  promptCard: {
    backgroundColor: Colors.parchment,
    borderRadius: 20,
    padding: 28,
    width: '100%',
    maxWidth: 320,
    alignItems: 'center',
  },
  promptTitle: {
    fontFamily: Fonts.displayBold,
    fontSize: FontSizes.displayMD,
    color: Colors.asphalt,
    textAlign: 'center',
    marginBottom: 10,
  },
  promptBody: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.textMedium,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  promptButton: {
    backgroundColor: Colors.terracotta,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 40,
    alignItems: 'center',
  },
  promptButtonText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyLG,
    color: Colors.white,
  },
});
