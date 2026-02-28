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
  // Start with (tabs) so we never flash login before auth check completes
  initialRouteName: '(tabs)',
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
  const [authResolved, setAuthResolved] = useState(false);
  const [authedUserId, setAuthedUserId] = useState<string | null>(null);
  usePushNotifications(authedUserId);

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
    let cancelled = false;

    async function checkAuth() {
      try {
        const sessionResult = await Promise.race([
          supabase.auth.getSession(),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 6000)),
        ]);

        if (cancelled) return;

        const session = sessionResult && 'data' in sessionResult
          ? sessionResult.data.session
          : null;

        if (!session?.user) {
          setAuthResolved(true);
          router.replace('/login');
          return;
        }

        // Retry profile fetch once on failure — avoids signing out on a network blip
        let profileData = null;
        for (let attempt = 0; attempt < 2; attempt++) {
          const { data, error: e } = await supabase
            .from('profiles')
            .select('onboarding_status')
            .eq('id', session.user.id)
            .single();
          if (!e && data) { profileData = data; break; }
          if (attempt === 0) await new Promise(r => setTimeout(r, 1500));
        }

        if (cancelled) return;

        if (!profileData) {
          setAuthResolved(true);
          router.replace('/login');
          return;
        }

        setAuthedUserId(session.user.id);
        const dest = profileData.onboarding_status === 'complete' ? '/plans' : '/onboarding/basics';
        setAuthResolved(true);
        router.replace(dest as any);
      } catch {
        if (!cancelled) {
          setAuthResolved(true);
          router.replace('/login');
        }
      }
    }

    checkAuth();

    // Keep listening for sign-in/out after initial load
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event !== 'SIGNED_IN' && event !== 'SIGNED_OUT') return;

      if (!session?.user) {
        setAuthedUserId(null);
        router.replace('/login');
        return;
      }

      const { data } = await supabase
        .from('profiles')
        .select('onboarding_status')
        .eq('id', session.user.id)
        .single();

      setAuthedUserId(session.user.id);
      const dest = data?.onboarding_status === 'complete' ? '/plans' : '/onboarding/basics';
      router.replace(dest as any);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  return (
    <View style={{ flex: 1 }}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="profile" />
        <Stack.Screen name="plan/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="event/[id]" options={{ headerShown: false }} />
      </Stack>
      {!authResolved && (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 999, justifyContent: 'center', alignItems: 'center', backgroundColor: '#FFF8F0' }}>
          <ActivityIndicator size="large" color={Colors.primaryOrange} />
        </View>
      )}
    </View>
  );
}
