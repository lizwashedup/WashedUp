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
import { useEffect, useRef, useState } from 'react';
import { Alert, Linking } from 'react-native';
import 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { View, ActivityIndicator } from 'react-native';
import { supabase } from '../lib/supabase';
import Colors from '../constants/Colors';
import { usePushNotifications } from '../hooks/usePushNotifications';
import { useSessionLogger } from '../hooks/useSessionLogger';

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

  if (!loaded) {
    return null;
  }

  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <RootLayoutNav onReady={() => SplashScreen.hideAsync()} />
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}

function onboardingDest(status: string | null | undefined): string {
  switch (status) {
    case 'complete': return '/(tabs)/plans';
    case 'vibes': return '/onboarding/vibes';
    case 'photo': return '/onboarding/photo';
    case 'la_check': return '/onboarding/la-check';
    case 'waitlisted': return '/onboarding/waitlisted';
    default: return '/onboarding/basics';
  }
}

function RootLayoutNav({ onReady }: { onReady: () => void }) {
  const router = useRouter();
  const [authResolved, setAuthResolved] = useState(false);
  const [authedUserId, setAuthedUserId] = useState<string | null>(null);
  const isRecoveryRef = useRef(false);
  const splashHiddenRef = useRef(false);
  const lastNavRef = useRef({ dest: '', ts: 0 });
  usePushNotifications(authedUserId);
  useSessionLogger(authedUserId);

  useEffect(() => {
    if (authResolved && !splashHiddenRef.current) {
      splashHiddenRef.current = true;
      try { onReady(); } catch {}
    }
  }, [authResolved, onReady]);

  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as Record<string, any>;
      const type = data?.type as string | undefined;

      if (type === 'plan_invite' && data?.eventId) {
        router.push(`/plan/${data.eventId}` as any);
      } else if (data?.chatId) {
        router.push(`/(tabs)/chats/${data.chatId}` as any);
      } else if (data?.eventId) {
        router.push(`/(tabs)/chats/${data.eventId}` as any);
      }
    });
    return () => sub.remove();
  }, []);

  // Handle auth callback deep link (password recovery)
  useEffect(() => {
    const parseSessionFromUrl = async (url: string) => {
      if (!url || !url.includes('auth/callback')) return;

      // Tokens may arrive in fragment (#) or query string (?) depending on email client
      const hashPart = url.split('#')[1] || '';
      const queryPart = url.split('?')[1]?.split('#')[0] || '';
      const combined = [hashPart, queryPart].filter(Boolean).join('&');
      const params = new URLSearchParams(combined);
      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token');
      const type = params.get('type');

      if (!accessToken || !refreshToken || type !== 'recovery') {
        // Link was tapped but tokens are missing (expired link or fragment stripped)
        isRecoveryRef.current = false;
        setAuthResolved(true);
        router.replace('/login');
        setTimeout(() => {
          Alert.alert('Link expired', 'This password reset link has expired or is invalid. Please request a new one from the login screen.');
        }, 500);
        return;
      }

      isRecoveryRef.current = true;
      const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
      if (!error) {
        setAuthResolved(true);
        router.replace('/reset-password');
      } else {
        isRecoveryRef.current = false;
        setAuthResolved(true);
        router.replace('/login');
        setTimeout(() => {
          Alert.alert('Link expired', 'This password reset link has expired. Please request a new one from the login screen.');
        }, 500);
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
        // If a password recovery deep link is being handled, don't interfere
        if (isRecoveryRef.current) return;

        const sessionResult = await Promise.race([
          supabase.auth.getSession(),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 6000)),
        ]);

        if (cancelled || isRecoveryRef.current) return;

        const session = sessionResult && 'data' in sessionResult
          ? sessionResult.data.session
          : null;

        if (!session?.user) {
          lastNavRef.current = { dest: '/login', ts: Date.now() };
          router.replace('/login');
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

        if (cancelled || isRecoveryRef.current) return;

        if (!profileData) {
          lastNavRef.current = { dest: '/login', ts: Date.now() };
          router.replace('/login');
          setTimeout(() => setAuthResolved(true), 80);
          return;
        }

        setAuthedUserId(session.user.id);
        const dest = onboardingDest(profileData.onboarding_status);
        lastNavRef.current = { dest, ts: Date.now() };
        // Navigate first, then lift the overlay — prevents a 1-frame flash
        // where the splash is gone but the destination hasn't rendered yet.
        router.replace(dest as any);
        setTimeout(() => setAuthResolved(true), 80);
      } catch {
        if (!cancelled) {
          lastNavRef.current = { dest: '/login', ts: Date.now() };
          router.replace('/login');
          setTimeout(() => setAuthResolved(true), 80);
        }
      }
    }

    checkAuth();

    // Keep listening for sign-in/out and password recovery after initial load
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        isRecoveryRef.current = true;
        setAuthResolved(true);
        router.replace('/reset-password');
        return;
      }
      if (event === 'SIGNED_IN' && isRecoveryRef.current) return;
      if (event !== 'SIGNED_IN' && event !== 'SIGNED_OUT') return;

      if (!session?.user) {
        setAuthedUserId(null);
        lastNavRef.current = { dest: '/login', ts: Date.now() };
        router.replace('/login');
        return;
      }

      try {
        const { data } = await supabase
          .from('profiles')
          .select('onboarding_status')
          .eq('id', session.user.id)
          .single();

        const dest = onboardingDest(data?.onboarding_status);
        const now = Date.now();
        if (dest === lastNavRef.current.dest && now - lastNavRef.current.ts < 5000) return;
        lastNavRef.current = { dest, ts: now };
        setAuthedUserId(session.user.id);
        router.replace(dest as any);
      } catch {
        // Profile fetch failed (network error, etc.) — don't navigate the user
        // away from where they are. Just mark auth as resolved with their userId.
        setAuthedUserId(session.user.id);
        setAuthResolved(true);
      }
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
        <Stack.Screen name="admin/events" options={{ headerShown: false }} />
      </Stack>
      {!authResolved && (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 999, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.parchment }}>
          <ActivityIndicator size="large" color={Colors.terracotta} />
        </View>
      )}
    </View>
  );
}
