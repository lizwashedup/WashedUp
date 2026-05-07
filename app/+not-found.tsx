import { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import Colors from '../constants/Colors';
import { unauthedRoute } from '../lib/authRouting';

export default function NotFoundScreen() {
  const router = useRouter();

  useEffect(() => {
    const timer = setTimeout(() => {
      router.replace(unauthedRoute() as never);
    }, 300);
    return () => clearTimeout(timer);
  }, []);

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.parchment }}>
        <ActivityIndicator size="large" color={Colors.terracotta} />
      </View>
    </>
  );
}
