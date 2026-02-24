import { Tabs, useRouter } from 'expo-router';
import { TouchableOpacity, View } from 'react-native';
import { Compass, Sparkles, PlusCircle, MessageCircle, Users, User } from 'lucide-react-native';

export const unstable_settings = {
  initialRouteName: 'plans',
};

function HeaderProfileButton() {
  const router = useRouter();
  return (
    <TouchableOpacity
      onPress={() => router.push('/profile')}
      style={{ padding: 8, marginRight: 8 }}
      hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
    >
      <User size={24} color="#1A1A1A" />
    </TouchableOpacity>
  );
}

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: true,
        headerRight: () => <HeaderProfileButton />,
        headerTitle: '',
        headerShadowVisible: false,
        headerStyle: { backgroundColor: '#FFF8F0' },
        headerLeft: () => <View style={{ width: 40 }} />,
        tabBarActiveTintColor: '#C4652A',
        tabBarInactiveTintColor: '#999999',
        tabBarLabelPosition: 'below-icon',
        tabBarStyle: { backgroundColor: '#FFFFFF' },
      }}
    >
      <Tabs.Screen name="post" options={{ title: 'Post', tabBarLabel: 'Post', tabBarIcon: ({ color }) => <PlusCircle size={24} color={color} /> }} />
      <Tabs.Screen name="explore" options={{ title: 'Scene', tabBarLabel: 'Scene', tabBarIcon: ({ color }) => <Sparkles size={24} color={color} /> }} />
      <Tabs.Screen name="plans" options={{ title: 'Plans', tabBarLabel: 'Plans', tabBarIcon: ({ color }) => <Compass size={24} color={color} /> }} />
      <Tabs.Screen name="chats" options={{ title: 'Chats', tabBarLabel: 'Chats', tabBarIcon: ({ color }) => <MessageCircle size={24} color={color} /> }} />
      <Tabs.Screen name="friends" options={{ title: 'Friends', tabBarLabel: 'Friends', tabBarIcon: ({ color }) => <Users size={24} color={color} /> }} />
      <Tabs.Screen name="profile" options={{ href: null }} />
    </Tabs>
  );
}
