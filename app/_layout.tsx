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
import { Alert, AppState, Linking, LogBox } from 'react-native';
import 'react-native-reanimated';

// Suppress push notification entitlement error on simulators
LogBox.ignoreLogs(['getRegistrationInfoAsync']);
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { View, ActivityIndicator } from 'react-native';
import { supabase } from '../lib/supabase';
import Colors from '../constants/Colors';
import { usePushNotifications } from '../hooks/usePushNotifications';
import { useSessionLogger } from '../hooks/useSessionLogger';
import AsyncStorage from '@react-native-async-storage/async-storage';
import PostPlanSurvey, { SurveyPlan, SurveyMember } from '../components/PostPlanSurvey';
import AppStoreReviewAsk from '../components/AppStoreReviewAsk';
import MarkEarnedModal from '../components/marks/MarkEarnedModal';
import VideoSplash from '../components/VideoSplash';

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

  const [showVideoSplash, setShowVideoSplash] = useState(true);

  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    // Once fonts are loaded, hide the native splash so the video can play
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
        <RootLayoutNav onReady={() => {}} />
        {showVideoSplash && (
          <VideoSplash onFinish={() => setShowVideoSplash(false)} />
        )}
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}

function onboardingDest(status: string | null | undefined): string {
  switch (status) {
    case 'complete': return '/(tabs)/plans';
    case 'vibes': return '/onboarding/vibes';
    case 'photo': return '/onboarding/photo';
    case 'referral': return '/onboarding/referral';
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

  // ── Post-plan survey ────────────────────────────────────────────────────
  const [surveyPlan, setSurveyPlan] = useState<SurveyPlan | null>(null);
  const [surveyMembers, setSurveyMembers] = useState<SurveyMember[]>([]);
  const surveyCheckedRef = useRef(false);
  const [surveyCheckDone, setSurveyCheckDone] = useState(false);
  const prevUserIdRef = useRef<string | null>(null);

  // Reset survey/review state when user changes (sign out + sign in as different user)
  useEffect(() => {
    if (authedUserId && authedUserId !== prevUserIdRef.current) {
      if (prevUserIdRef.current !== null) {
        surveyCheckedRef.current = false;
        setSurveyCheckDone(false);
        setSurveyPlan(null);
        setShowReviewAsk(false);
      }
      prevUserIdRef.current = authedUserId;
    }
  }, [authedUserId]);

  useEffect(() => {
    if (!authedUserId || !authResolved || surveyCheckedRef.current) return;
    surveyCheckedRef.current = true;

    (async () => {
      try {
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        const { data: plans } = await supabase
          .from('event_members')
          .select('event_id, events!inner(id, title, image_url, status, start_time)')
          .eq('user_id', authedUserId)
          .eq('status', 'joined')
          .eq('events.status', 'completed')
          .gte('events.start_time', sevenDaysAgo.toISOString())
          .order('events(start_time)', { ascending: false })
          .limit(5);

        if (!plans || plans.length === 0) return;

        const eventIds = plans.map((p: any) => p.event_id);
        const { data: existing } = await supabase
          .from('plan_feedback')
          .select('event_id')
          .eq('user_id', authedUserId)
          .in('event_id', eventIds);

        const feedbackSet = new Set((existing ?? []).map((r: any) => r.event_id));
        const needsSurvey = plans.find((p: any) => !feedbackSet.has(p.event_id));
        if (!needsSurvey) return;

        const event = (needsSurvey as any).events;
        setSurveyPlan({
          id: event.id,
          title: event.title,
          image_url: event.image_url ?? null,
        });

        const { data: memberData } = await supabase
          .from('event_members')
          .select('user_id, profiles_public!inner(id, first_name_display, profile_photo_url)')
          .eq('event_id', event.id)
          .eq('status', 'joined');

        if (memberData) {
          setSurveyMembers(
            memberData.map((m: any) => ({
              id: m.profiles_public.id,
              first_name_display: m.profiles_public.first_name_display,
              profile_photo_url: m.profiles_public.profile_photo_url,
            }))
          );
        }
      } catch (e) { console.warn('[WashedUp] Survey check failed:', e); }
      finally { setSurveyCheckDone(true); }
    })();
  }, [authedUserId, authResolved]);

  // ── App Store review ask ────────────────────────────────────────────────
  const [showReviewAsk, setShowReviewAsk] = useState(false);

  useEffect(() => {
    if (!authedUserId || !surveyCheckDone || surveyPlan) return;

    (async () => {
      try {
        const already = await AsyncStorage.getItem('hasRequestedReview');
        if (already === 'true') return;

        // Need 2+ completed plans as a joined member
        const { count } = await supabase
          .from('event_members')
          .select('id, events!inner(status)', { count: 'exact', head: true })
          .eq('user_id', authedUserId)
          .eq('status', 'joined')
          .eq('events.status', 'completed');

        if ((count ?? 0) < 2) return;

        // Check feedback: at least one thumbs_up OR zero rows at all
        const { data: feedback } = await supabase
          .from('plan_feedback')
          .select('rating')
          .eq('user_id', authedUserId)
          .limit(10);

        const rows = feedback ?? [];
        const hasThumbsUp = rows.some((r: any) => r.rating === 'thumbs_up');
        const hasNoFeedback = rows.length === 0;

        if (hasThumbsUp || hasNoFeedback) {
          setShowReviewAsk(true);
        }
      } catch (e) { console.warn('[WashedUp] Review check failed:', e); }
    })();
  }, [authedUserId, surveyCheckDone, surveyPlan]);

  useEffect(() => {
    if (authResolved && !splashHiddenRef.current) {
      splashHiddenRef.current = true;
      try { onReady(); } catch (e) { console.warn('[WashedUp] onReady failed:', e); }
    }
  }, [authResolved, onReady]);

  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as Record<string, any>;
      const type = data?.type as string | undefined;

      if ((type === 'plan_invite' || type === 'waitlist_spot') && data?.eventId) {
        router.push(`/plan/${data.eventId}` as any);
      } else if (data?.chatId) {
        router.push(`/(tabs)/chats/${data.chatId}` as any);
      } else if (data?.eventId) {
        router.push(`/(tabs)/chats/${data.eventId}` as any);
      }
    });
    return () => sub.remove();
  }, []);

  // Clear app icon badge when app comes to foreground
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        Notifications.setBadgeCountAsync(0).catch(() => {});
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
        if (dest === lastNavRef.current.dest && now - lastNavRef.current.ts < 5000) {
          setAuthedUserId(session.user.id);
          setAuthResolved(true);
          return;
        }
        lastNavRef.current = { dest, ts: now };
        setAuthedUserId(session.user.id);
        router.replace(dest as any);
        setTimeout(() => setAuthResolved(true), 80);
      } catch {
        // Profile fetch failed — navigate to plans as fallback so user isn't stuck
        setAuthedUserId(session.user.id);
        lastNavRef.current = { dest: '/(tabs)/plans', ts: Date.now() };
        router.replace('/(tabs)/plans' as any);
        setTimeout(() => setAuthResolved(true), 80);
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
        <Stack.Screen name="plan/[id]" options={{ headerShown: false, gestureEnabled: true }} />
        <Stack.Screen name="event/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="admin/events" options={{ headerShown: false }} />
      </Stack>
      {!authResolved && (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 999, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.parchment }}>
          <ActivityIndicator size="large" color={Colors.terracotta} />
        </View>
      )}
      {surveyPlan && authedUserId && (
        <PostPlanSurvey
          visible={!!surveyPlan}
          plan={surveyPlan}
          members={surveyMembers}
          userId={authedUserId}
          onComplete={() => setSurveyPlan(null)}
        />
      )}
      {showReviewAsk && !surveyPlan && (
        <AppStoreReviewAsk
          visible={showReviewAsk && !surveyPlan}
          onClose={() => setShowReviewAsk(false)}
        />
      )}
      {authedUserId && surveyCheckDone && !surveyPlan && !showReviewAsk && (
        <MarkEarnedModal userId={authedUserId} />
      )}
    </View>
  );
}
