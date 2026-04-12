import { Tabs } from 'expo-router';
import { View, StyleSheet, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';
import { Image } from 'expo-image';
import { supabase } from '../../lib/supabase';
import { UNREAD_CHATS_KEY } from '../../constants/QueryKeys';

function PostTabIcon() {
  return (
    <View style={styles.postButton}>
      <Ionicons name="add" size={28} color={Colors.white} />
    </View>
  );
}

async function fetchHasPendingInvites(): Promise<boolean> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { count } = await supabase
    .from('plan_invites')
    .select('id', { count: 'exact', head: true })
    .eq('recipient_id', user.id)
    .eq('status', 'pending');
  return (count ?? 0) > 0;
}

async function fetchUnreadChatCount(): Promise<number> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return 0;
  const { data } = await supabase
    .from('app_notifications')
    .select('event_id')
    .eq('user_id', user.id)
    .eq('type', 'new_message')
    .eq('status', 'unread');
  // Count distinct chats (event_ids) with unread messages
  const uniqueChats = new Set((data ?? []).map((r: any) => r.event_id));
  return uniqueChats.size;
}

export default function TabLayout() {
  const [userId, setUserId] = useState<string | null>(null);
  const insets = useSafeAreaInsets();
  const isAndroid = Platform.OS === 'android';
  const androidBottomInset = Math.max(insets.bottom, 12);
  const tabBarHeight = isAndroid ? 64 + androidBottomInset : 84;
  const tabBarPaddingBottom = isAndroid ? androidBottomInset : 28;

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUserId(session?.user?.id ?? null);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user?.id ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  const { data: unreadChats = 0 } = useQuery({
    queryKey: UNREAD_CHATS_KEY,
    queryFn: fetchUnreadChatCount,
    enabled: !!userId,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const { data: hasPendingInvites = false } = useQuery({
    queryKey: ['pending-invites-badge'],
    queryFn: fetchHasPendingInvites,
    enabled: !!userId,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        lazy: true,
        tabBarActiveTintColor: '#2C1810',
        tabBarInactiveTintColor: '#A09385',
        tabBarStyle: {
          backgroundColor: Colors.parchment,
          borderTopWidth: 0.5,
          borderTopColor: '#E5DDD1',
          height: tabBarHeight,
          paddingBottom: tabBarPaddingBottom,
          paddingTop: 8,
        },
        tabBarVariant: 'uikit',
        tabBarLabelStyle: {
          fontFamily: Fonts.sansMedium,
          fontSize: FontSizes.caption,
        },
      }}
    >
      <Tabs.Screen
        name="plans/index"
        options={{
          title: 'Plans',
          tabBarLabel: 'Plans',
          tabBarIcon: ({ color }) => (
            <Image
              source={require('../../assets/wave-icon.png')}
              style={{ width: 32, height: 18, opacity: 0.7 }}
              contentFit="contain"
              tintColor={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="explore/index"
        options={{
          title: 'Scene',
          tabBarLabel: 'Scene',
          tabBarIcon: ({ color }) => <Ionicons name="compass-outline" size={26} color={color} />,
        }}
      />
      <Tabs.Screen
        name="post/index"
        options={{
          title: 'Post',
          tabBarLabel: '',
          tabBarIcon: () => <PostTabIcon />,
        }}
      />
      <Tabs.Screen
        name="chats/index"
        options={{
          title: 'Chats',
          tabBarLabel: 'Chats',
          tabBarIcon: ({ color }) => <Ionicons name="chatbubble-outline" size={24} color={color} />,
          tabBarBadge: unreadChats > 0 ? (unreadChats > 9 ? '9+' : unreadChats) : undefined,
          tabBarBadgeStyle: { backgroundColor: '#B5522E' },
        }}
      />
      <Tabs.Screen
        name="friends/index"
        options={{
          title: 'Your People',
          tabBarLabel: 'People',
          tabBarIcon: ({ color }) => (
            <View>
              <Ionicons name="people-outline" size={24} color={color} />
              {hasPendingInvites && <View style={styles.inviteDot} />}
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          href: null,
          tabBarItemStyle: { display: 'none' },
        }}
      />
      <Tabs.Screen
        name="chats/[id]"
        options={{ href: null, tabBarStyle: { display: 'none' } }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  inviteDot: {
    position: 'absolute',
    top: -2,
    right: -4,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.terracotta,
  },
  postButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.terracotta,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -20,
    overflow: 'hidden',
    shadowColor: Colors.asphalt,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
  },
});
