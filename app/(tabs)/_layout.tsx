import { Tabs, useRouter } from 'expo-router';
import { TouchableOpacity } from 'react-native';
import {
  Compass, Sparkles, PlusCircle, MessageCircle, Users, User,
} from 'lucide-react-native';
import Colors from '../../constants/Colors';

function HeaderProfileButton() {
  const router = useRouter();
  return (
    <TouchableOpacity
      onPress={() => router.push('/profile')}
      style={{ padding: 8, marginRight: 12 }}
      hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
    >
      <User size={24} color={Colors.textDark} />
    </TouchableOpacity>
  );
}

export default function TabLayout() {
  return (
    <Tabs
      initialRouteName="plans"
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
          height: 60,
          paddingBottom: 8,
          paddingTop: 4,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '500' },
      }}
    >
      <Tabs.Screen
        name="post"
        options={{
          tabBarLabel: 'Post',
          tabBarIcon: ({ color }) => <PlusCircle size={24} color={color} />,
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{
          tabBarLabel: 'Scene',
          tabBarIcon: ({ color }) => <Sparkles size={24} color={color} />,
        }}
      />
      <Tabs.Screen
        name="plans"
        options={{
          tabBarLabel: 'Plans',
          tabBarIcon: ({ color }) => <Compass size={24} color={color} />,
        }}
      />
      <Tabs.Screen
        name="chats"
        options={{
          tabBarLabel: 'Chats',
          tabBarIcon: ({ color }) => <MessageCircle size={24} color={color} />,
        }}
      />
      <Tabs.Screen
        name="friends"
        options={{
          tabBarLabel: 'Friends',
          tabBarIcon: ({ color }) => <Users size={24} color={color} />,
        }}
      />
      <Tabs.Screen name="profile" options={{ href: null }} />
    </Tabs>
  );
}
