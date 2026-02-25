import '../global.css';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useFonts } from 'expo-font';
import { DMSerifDisplay_400Regular } from '@expo-google-fonts/dm-serif-display';
import { Stack, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Session } from '@supabase/supabase-js';
import { View, ActivityIndicator } from 'react-native';
import { supabase } from '../lib/supabase';
import Colors from '../constants/Colors';

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
  const [session, setSession] = useState<Session | null>(null);
  const [onboardingComplete, setOnboardingComplete] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      if (s?.user) {
        fetchOnboardingStatus(s.user.id);
      } else {
        setOnboardingComplete(false);
        setLoading(false);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      if (s?.user) {
        fetchOnboardingStatus(s.user.id);
      } else {
        setOnboardingComplete(false);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  async function fetchOnboardingStatus(userId: string) {
    try {
      const { data, error: e } = await supabase
        .from('profiles')
        .select('onboarding_status')
        .eq('id', userId)
        .single();
      if (e || !data) {
        await supabase.auth.signOut();
        return;
      }
      setOnboardingComplete(data.onboarding_status === 'complete');
    } catch {
      await supabase.auth.signOut();
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!loading) {
      if (!session) {
        router.replace('/login');
      } else if (onboardingComplete === true) {
        router.replace('/plans');
      } else if (onboardingComplete === false && session) {
        router.replace('/onboarding/basics');
      }
    }
  }, [session, onboardingComplete, loading]);

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
