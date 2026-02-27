import { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { Stack, useRouter } from 'expo-router';

export default function NotFoundScreen() {
  const router = useRouter();

  useEffect(() => {
    const timer = setTimeout(() => {
      router.replace('/login');
    }, 300);
    return () => clearTimeout(timer);
  }, []);

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f1e4d4' }}>
        <ActivityIndicator size="large" color="#C4652A" />
      </View>
    </>
  );
}
