import { Tabs, useRouter } from 'expo-router';
import { TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '../../constants/Colors';

function HeaderProfileButton() {
  const router = useRouter();
  return (
    <TouchableOpacity
      onPress={() => router.push('/profile')}
      style={{ padding: 8, marginRight: 12 }}
      hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
    >
      <Ionicons name="person-outline" size={24} color={Colors.textDark} />
    </TouchableOpacity>
  );
}

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: true,
        headerTitle: '',
        headerShadowVisible: false,
        headerStyle: { backgroundColor: Colors.backgroundCream },
        headerRight: () => <HeaderProfileButton />,
        tabBarActiveTintColor: Colors.primaryOrange,
        tabBarInactiveTintColor: Colors.textLight,
        tabBarStyle: {
          backgroundColor: '#FFFFFF',
          borderTopColor: Colors.border,
          borderTopWidth: 1,
          height: 84,
          paddingBottom: 28,
          paddingTop: 8,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '500' },
      }}
    >
      {/* Post — far left */}
      <Tabs.Screen
        name="post/index"
        options={{
          title: 'Post',
          tabBarLabel: 'Post',
          tabBarIcon: ({ color }) => <Ionicons name="add-circle-outline" size={24} color={color} />,
        }}
      />
      {/* Scene — discovery */}
      <Tabs.Screen
        name="explore/index"
        options={{
          title: 'Scene',
          tabBarLabel: 'Scene',
          tabBarIcon: ({ color }) => <Ionicons name="compass-outline" size={24} color={color} />,
        }}
      />
      {/* Plans — center */}
      <Tabs.Screen
        name="plans/index"
        options={{
          title: 'Plans',
          tabBarLabel: 'Plans',
          tabBarIcon: ({ color }) => <Ionicons name="map-outline" size={24} color={color} />,
        }}
      />
      {/* Chats */}
      <Tabs.Screen
        name="chats/index"
        options={{
          title: 'Chats',
          tabBarLabel: 'Chats',
          tabBarIcon: ({ color }) => <Ionicons name="chatbubble-outline" size={24} color={color} />,
        }}
      />
      {/* Your People — far right */}
      <Tabs.Screen
        name="friends/index"
        options={{
          title: 'Your People',
          tabBarLabel: 'Your People',
          tabBarIcon: ({ color }) => <Ionicons name="people-outline" size={24} color={color} />,
        }}
      />
      {/* Hide dynamic chat route from tab bar */}
      <Tabs.Screen
        name="chats/[id]"
        options={{
          href: null,
          headerShown: false,
        }}
      />
    </Tabs>
  );
}
