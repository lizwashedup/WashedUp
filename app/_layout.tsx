import '../global.css';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useFonts } from 'expo-font';
import { DMSerifDisplay_400Regular } from '@expo-google-fonts/dm-serif-display';
import { Stack, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import * as Notifications from 'expo-notifications';
import { useEffect, useState } from 'react';
import 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { View, ActivityIndicator } from 'react-native';
import { supabase } from '../lib/supabase';
import Colors from '../constants/Colors';
import { usePushNotifications } from '../hooks/usePushNotifications';

export { ErrorBoundary } from 'expo-router';

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

export const unstable_settings = {
  initialRouteName: '(auth)',
};

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
    DMSerifDisplay_400Regular,
    ...FontAwesome.font,
    ...Ionicons.font,
  });

  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  if (!loaded) {
    return null;
  }

  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <RootLayoutNav />
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}

function RootLayoutNav() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);

  // Register for push notifications on every launch — saves token to profiles table
  usePushNotifications();

  // Notification tap handler — deep-links into the relevant chat when user taps a notification
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as Record<string, any>;
      if (data?.chatId) {
        router.push(`/(tabs)/chats/${data.chatId}` as any);
      }
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    // onAuthStateChange fires INITIAL_SESSION on mount — use that as the single source of truth
    // so we don't double-fetch (avoids the getSession + onAuthStateChange race)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      // Only react to initial load and explicit sign-in/out events
      if (event !== 'INITIAL_SESSION' && event !== 'SIGNED_IN' && event !== 'SIGNED_OUT') return;

      if (!session?.user) {
        // Navigate BEFORE setLoading so the destination is queued when the Stack mounts
        router.replace('/login');
        setLoading(false);
        return;
      }

      try {
        const { data, error: e } = await supabase
          .from('profiles')
          .select('onboarding_status')
          .eq('id', session.user.id)
          .single();

        if (e || !data) {
          await supabase.auth.signOut();
          router.replace('/login');
          setLoading(false);
          return;
        }

        const dest = data.onboarding_status === 'complete' ? '/plans' : '/onboarding/basics';
        // Queue the navigation before the Stack mounts — eliminates the auth screen flash
        router.replace(dest as any);
      } catch {
        await supabase.auth.signOut();
        router.replace('/login');
      } finally {
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  if (loading) {
    return (
      <View className="flex-1 justify-center items-center bg-washedup-cream">
        <ActivityIndicator size="large" color={Colors.primaryOrange} />
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="profile" />
      <Stack.Screen name="plan/[id]" options={{ headerShown: false }} />
    </Stack>
  );
}
