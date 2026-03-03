import '../global.css';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useFonts } from 'expo-font';
import {
  CormorantGaramond_400Regular,
  CormorantGaramond_700Bold,
  CormorantGaramond_400Regular_Italic,
} from '@expo-google-fonts/cormorant-garamond';
import {
  DMSans_400Regular,
  DMSans_500Medium,
  DMSans_700Bold,
} from '@expo-google-fonts/dm-sans';
import { Stack, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import * as Notifications from 'expo-notifications';
import { useEffect, useState } from 'react';
import { Linking } from 'react-native';
import 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { View, Text, ActivityIndicator } from 'react-native';
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
    CormorantGaramond_400Regular,
    CormorantGaramond_700Bold,
    CormorantGaramond_400Regular_Italic,
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_700Bold,
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

  // Handle auth callback deep link (password recovery)
  useEffect(() => {
    const parseSessionFromUrl = async (url: string) => {
      if (!url || !url.includes('auth/callback')) return;
      const hashPart = url.split('#')[1] || url.split('?')[1] || '';
      const params = new URLSearchParams(hashPart);
      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token');
      const type = params.get('type');
      if (accessToken && refreshToken && type === 'recovery') {
        const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
        if (!error) {
          setAuthResolved(true);
          router.replace('/reset-password');
        }
      }
    };

    Linking.getInitialURL().then((url) => { if (url) parseSessionFromUrl(url); });
    const sub = Linking.addEventListener('url', ({ url }) => { if (url) parseSessionFromUrl(url); });
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
          router.replace('/login');
          // Delay overlay hide so router.replace completes before we reveal the stack
          // (avoids flash of (tabs) before login mounts)
          setTimeout(() => setAuthResolved(true), 80);
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
          router.replace('/login');
          setTimeout(() => setAuthResolved(true), 80);
          return;
        }

        setAuthedUserId(session.user.id);
        const dest = profileData.onboarding_status === 'complete' ? '/plans' : '/onboarding/basics';
        setAuthResolved(true);
        router.replace(dest as any);
      } catch {
        if (!cancelled) {
          router.replace('/login');
          setTimeout(() => setAuthResolved(true), 80);
        }
      }
    }

    checkAuth();

    // Keep listening for sign-in/out and password recovery after initial load
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        setAuthResolved(true);
        router.replace('/reset-password');
        return;
      }
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
        <Stack.Screen name="reset-password" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="plan/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="event/[id]" options={{ headerShown: false }} />
      </Stack>
      {!authResolved && (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 999, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.parchment }}>
          <ActivityIndicator size="large" color={Colors.terracotta} />
        </View>
      )}
    </View>
  );
}
