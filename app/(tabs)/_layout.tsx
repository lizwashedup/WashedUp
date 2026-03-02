import { Tabs } from 'expo-router';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '../../constants/Colors';
import { Fonts } from '../../constants/Typography';
import { Image } from 'expo-image';

function PostTabIcon() {
  return (
    <View style={styles.postButton}>
      <Ionicons name="add" size={28} color={Colors.white} />
    </View>
  );
}

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: Colors.asphalt,
        tabBarInactiveTintColor: Colors.textLight,
        tabBarStyle: {
          backgroundColor: Colors.parchment,
          borderTopWidth: 0,
          height: 84,
          paddingBottom: 28,
          paddingTop: 8,
        },
        tabBarLabelStyle: {
          fontFamily: Fonts.sansMedium,
          fontSize: 11,
        },
      }}
    >
      <Tabs.Screen
        name="plans/index"
        options={{
          title: 'Plans',
          tabBarLabel: 'Plans',
          tabBarIcon: ({ focused }) => (
            <Image
              source={require('../../assets/w-icon.png')}
              style={{ width: 28, height: 28, opacity: focused ? 1 : 0.4 }}
              contentFit="contain"
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
        }}
      />
      <Tabs.Screen
        name="friends/index"
        options={{
          title: 'Your People',
          tabBarLabel: 'Your People',
          tabBarIcon: ({ color }) => <Ionicons name="person-outline" size={24} color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{ href: null }}
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
    shadowColor: Colors.asphalt,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
  },
});
