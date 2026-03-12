import { Tabs } from 'expo-router';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
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
  const { data: unreadChats = 0 } = useQuery({
    queryKey: UNREAD_CHATS_KEY,
    queryFn: fetchUnreadChatCount,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        lazy: true,
        tabBarActiveTintColor: Colors.asphalt,
        tabBarInactiveTintColor: Colors.textLight,
        tabBarStyle: {
          backgroundColor: Colors.parchment,
          borderTopWidth: 0,
          height: 84,
          paddingBottom: 28,
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
              style={{ width: 36, height: 36 }}
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
          tabBarIcon: ({ color }) => <Ionicons name="compass-outline" size={24} color={color} />,
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
        }}
      />
      <Tabs.Screen
        name="friends/index"
        options={{
          title: 'Your People',
          tabBarLabel: 'People',
          tabBarIcon: ({ color }) => <Ionicons name="person-outline" size={24} color={color} />,
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
        options={{ href: null }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
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
