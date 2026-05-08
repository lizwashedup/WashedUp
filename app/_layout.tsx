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
  DMSans_600SemiBold,
  DMSans_700Bold,
} from '@expo-google-fonts/dm-sans';
import {
  PlusJakartaSans_500Medium,
  PlusJakartaSans_700Bold,
} from '@expo-google-fonts/plus-jakarta-sans';
import { Stack, useRouter, usePathname } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { OneSignal } from 'react-native-onesignal';
import { useEffect, useRef, useState } from 'react';
import { Linking, LogBox } from 'react-native';
import 'react-native-reanimated';

// Silence dev-only redboxes that aren't real bugs:
// 1. expo-notifications trying to read APNs registration from the keychain
//    on simulators (no push entitlement). Harmless on real devices.
// 2. device_tokens upsert failing because the table only exists in the
//    OneSignal migration file, not yet applied to prod. Will be removed
//    once the migration ships in §8 Step 8 of the OneSignal plan.
LogBox.ignoreLogs([
  'getRegistrationInfoAsync',
  'Failed to upsert device_tokens',
]);
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PostHogProvider, usePostHog } from 'posthog-react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { View, ActivityIndicator } from 'react-native';
import { supabase } from '../lib/supabase';
import { isBannedAppleUser } from '../lib/socialAuth';
import { authedDest, unauthedRoute } from '../lib/authRouting';
import { seedAuthProfile, getAuthProfile } from '../hooks/useProfile';
import { verifyCodeSelfRoutingRef, lastUnauthRedirectAt } from '../lib/navState';
import { resetMigrationGateSnooze } from '../lib/migrationGateSnooze';
import Colors from '../constants/Colors';
import { usePushNotifications, initOneSignal } from '../hooks/usePushNotifications';
import { registerAlbumUploadResume, resumeAllPendingAlbumBatches } from '../lib/uploadAlbumMedia';
import { AlbumUploadPromptModal } from '../components/albums/AlbumUploadPromptModal';
import { KeyboardDoneBar } from '../components/keyboard/KeyboardDoneBar';
import { logError } from '../lib/logger';
import { useSessionLogger } from '../hooks/useSessionLogger';
import AsyncStorage from '@react-native-async-storage/async-storage';
import PostPlanSurvey, { SurveyPlan, SurveyMember } from '../components/PostPlanSurvey';
import AppStoreReviewAsk, {
  REVIEW_ASK_COUNT_KEY,
  REVIEW_ASK_COMPLETED_KEY,
  REVIEW_ASK_LEGACY_KEY,
  REVIEW_ASK_MAX,
} from '../components/AppStoreReviewAsk';
import MarkEarnedModal from '../components/marks/MarkEarnedModal';
import VideoSplash from '../components/VideoSplash';
import { BrandedAlert } from '../components/BrandedAlert';
import * as Sentry from '@sentry/react-native';

Sentry.init({
  dsn: 'https://fb9ffdb4b5f0fb3ea5191274a258f266@o4511311419604992.ingest.us.sentry.io/4511311773827072',
  tracesSampleRate: 0,
  enableAutoSessionTracking: true,
  ignoreErrors: [/getRegistrationInfoAsync/],
});

export { ErrorBoundary } from 'expo-router';

SplashScreen.preventAutoHideAsync();
SplashScreen.setOptions({ duration: 300, fade: true });

const queryClient = new QueryClient();

export const unstable_settings = {
  // Start with (tabs) so we never flash login before auth check completes
  initialRouteName: '(tabs)',
};

function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
    CormorantGaramond_400Regular,
    CormorantGaramond_700Bold,
    CormorantGaramond_400Regular_Italic,
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_600SemiBold,
    DMSans_700Bold,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_700Bold,
    ...FontAwesome.font,
    ...Ionicons.font,
  });

  const [showVideoSplash, setShowVideoSplash] = useState(true);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    // Hold the native splash until both fonts are loaded AND auth has resolved.
    // On Android, expo-video may be unavailable and VideoSplash finishes
    // immediately, so without this gate the (tabs) initial route paints
    // before router.replace lands and the user sees a 1-frame login flash.
    if (loaded && authReady) {
      SplashScreen.hideAsync();
    }
  }, [loaded, authReady]);

  if (!loaded) {
    return null;
  }

  // PostHogProvider throws if apiKey is empty. When the env var is missing
  // (fresh checkout, misconfigured env), disable the SDK client instead of
  // crashing the app.
  const posthogApiKey = process.env.EXPO_PUBLIC_POSTHOG_API_KEY;

  return (
    <PostHogProvider
      apiKey={posthogApiKey || 'placeholder'}
      options={{
        host: 'https://us.i.posthog.com',
        disabled: !posthogApiKey,
      }}
    >
      <QueryClientProvider client={queryClient}>
        <SafeAreaProvider>
          <RootLayoutNav onReady={() => setAuthReady(true)} />
          {showVideoSplash && (
            <VideoSplash onFinish={() => setShowVideoSplash(false)} />
          )}
        </SafeAreaProvider>
      </QueryClientProvider>
    </PostHogProvider>
  );
}

export default Sentry.wrap(RootLayout);

function RootLayoutNav({ onReady }: { onReady: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  useEffect(() => { pathnameRef.current = pathname; }, [pathname]);
  const [authResolved, setAuthResolved] = useState(false);
  const [authedUserId, setAuthedUserId] = useState<string | null>(null);
  const [layoutAlert, setLayoutAlert] = useState<{ title: string; message: string } | null>(null);
  const isRecoveryRef = useRef(false);
  const splashHiddenRef = useRef(false);
  const lastNavRef = useRef({ dest: '', ts: 0 });
  usePushNotifications(authedUserId);
  useSessionLogger(authedUserId);

  // PostHog: identify on login, reset on logout. Hook returns null when the
  // provider is in disabled mode (no key configured), so the optional chaining
  // keeps this safe in misconfigured environments.
  const posthog = usePostHog();
  useEffect(() => {
    if (!posthog) return;
    if (authedUserId) {
      posthog.identify(authedUserId);
    } else {
      posthog.reset();
    }
  }, [authedUserId, posthog]);

  // Resume any in-flight album upload batches once on mount, and re-nudge on
  // app foreground. Worker is idempotent — safe to call repeatedly.
  useEffect(() => {
    void resumeAllPendingAlbumBatches();
    return registerAlbumUploadResume();
  }, []);

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
        // Single round-trip RPC. Eligibility is enforced server-side with
        // AT TIME ZONE 'America/Los_Angeles' so a plan that happened earlier
        // today PT does NOT trigger the modal — only plans on a strictly
        // earlier PT calendar day do. Returns null when nothing is eligible.
        const { data, error } = await supabase.rpc('get_pending_post_plan_survey');
        if (error) {
          console.warn('[WashedUp] Survey RPC failed:', error.message);
          return;
        }
        if (!data) return;

        const payload = data as {
          plan: { id: string; title: string; image_url: string | null };
          members: Array<{ id: string; first_name_display: string | null; profile_photo_url: string | null }>;
        };

        setSurveyPlan({
          id: payload.plan.id,
          title: payload.plan.title,
          image_url: payload.plan.image_url ?? null,
        });
        setSurveyMembers(payload.members ?? []);
      } catch (e) { logError(e, 'layout.surveyCheck'); }
      finally { setSurveyCheckDone(true); }
    })();
  }, [authedUserId, authResolved]);

  // ── App Store review ask ────────────────────────────────────────────────
  const [showReviewAsk, setShowReviewAsk] = useState(false);

  useEffect(() => {
    if (!authedUserId || !surveyCheckDone || surveyPlan) return;

    (async () => {
      try {
        // Hard stops: completed flag (clicked Write a Review) or legacy key
        // (already saw it in the pre-counter version of the app).
        const completed = await AsyncStorage.getItem(REVIEW_ASK_COMPLETED_KEY);
        if (completed === 'true') return;
        const legacy = await AsyncStorage.getItem(REVIEW_ASK_LEGACY_KEY);
        if (legacy === 'true') return;

        // Soft stop: max ask count reached.
        const askCountRaw = await AsyncStorage.getItem(REVIEW_ASK_COUNT_KEY);
        const askCount = parseInt(askCountRaw ?? '0', 10) || 0;
        if (askCount >= REVIEW_ASK_MAX) return;

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
      } catch (e) { logError(e, 'layout.reviewCheck'); }
    })();
  }, [authedUserId, surveyCheckDone, surveyPlan]);

  useEffect(() => {
    if (authResolved && !splashHiddenRef.current) {
      splashHiddenRef.current = true;
      try { onReady(); } catch (e) { console.warn('[WashedUp] onReady failed:', e); }
    }
  }, [authResolved, onReady]);

  useEffect(() => {
    // OneSignal click handler. Buffers cold-start taps until a listener
    // attaches, so this catches both warm-foreground taps and taps that
    // launched the app from terminated state.
    const onClick = (event: any) => {
      const data = (event?.notification?.additionalData ?? {}) as Record<string, any>;
      const type = data?.type as string | undefined;

      // Album notifications: prompt/reminder/no-uploads-nudge open the upload
      // flow; ready/someone-uploaded/more-photos-added/hearts-batched open the
      // album detail view.
      if (type === 'album_upload_prompt' || type === 'album_upload_reminder' || type === 'album_creator_no_uploads_nudge') {
        if (data?.eventId) router.push(`/album/upload/${data.eventId}` as any);
      } else if (type === 'album_ready' || type === 'album_someone_uploaded' || type === 'album_more_photos_added' || type === 'album_hearts_batched') {
        if (data?.eventId) router.push(`/album/${data.eventId}` as any);
      } else if (
        (type === 'plan_invite' ||
          type === 'waitlist_spot' ||
          type === 'duplicate_plan' ||
          type === 'interest_signal' ||
          type === 'interest_invite') &&
        data?.eventId
      ) {
        // Tag the URL when the push is the creator-side "someone signaled
        // interest" notification, so the plan detail can surface the
        // "Would go next time" section explicitly. Receiver may currently
        // no-op on the param; it's a marker for future scroll/analytics.
        const focusParam = type === 'interest_signal' ? '?focus=interest' : '';
        router.push(`/plan/${data.eventId}${focusParam}` as any);
      } else if (data?.chatId) {
        router.push(`/(tabs)/chats/${data.chatId}` as any);
      } else if (data?.eventId) {
        router.push(`/(tabs)/chats/${data.eventId}` as any);
      } else {
        // Final fallback for notification types that carry neither eventId
        // nor chatId (e.g. broadcast, future admin pings). Drop the user on
        // the chats list rather than no-op'ing the tap.
        router.push('/(tabs)/chats' as any);
      }
    };

    let cancelled = false;
    let attached: ((event: any) => void) | null = null;

    initOneSignal().then((ready) => {
      if (cancelled || !ready) return;
      try {
        OneSignal.Notifications.addEventListener('click', onClick);
        attached = onClick;
      } catch (err) {
        if (__DEV__) console.warn('[PushNotifications] click listener attach failed:', err);
      }
    });

    return () => {
      cancelled = true;
      if (attached) {
        try {
          OneSignal.Notifications.removeEventListener('click', attached);
        } catch {}
      }
    };
  }, []);

  // Badge clearing moved to the specific surfaces where the user is
  // actually looking at messages: the Chats tab (chats/index.tsx), any
  // individual chat (chats/[id].tsx), and the Inbox modal. Previously
  // we cleared on every app foreground, which wiped the badge even
  // when the user reopened the app for an unrelated reason and hadn't
  // looked at their messages yet.

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
          setLayoutAlert({ title: 'Link expired', message: 'This password reset link has expired or is invalid. Please request a new one from the login screen.' });
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
          setLayoutAlert({ title: 'Link expired', message: 'This password reset link has expired. Please request a new one from the login screen.' });
        }, 500);
      }
    };

    Linking.getInitialURL()
      .then((url) => { if (url) parseSessionFromUrl(url); })
      .catch((e) => logError(e, 'layout.getInitialURL'));
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
          const unauth = unauthedRoute();
          lastNavRef.current = { dest: unauth, ts: Date.now() };
          router.replace(unauth as any);
          setTimeout(() => setAuthResolved(true), 80);
          return;
        }

        // Apple ban check + profile fetch run in parallel — both are
        // independent of each other and the ban check is a single RPC,
        // so we save one network RTT vs sequential awaits. If the user
        // is banned we still sign them out before honoring the profile.
        const fetchProfileWithRetry = async () => {
          for (let attempt = 0; attempt < 2; attempt++) {
            const { data, error: e } = await supabase
              .from('profiles')
              .select('onboarding_status, referral_source, phone_number')
              .eq('id', session.user.id)
              .single();
            if (!e && data) return data as any;
            if (attempt === 0) await new Promise(r => setTimeout(r, 1500));
          }
          return null;
        };
        const [isBanned, profileData] = await Promise.all([
          isBannedAppleUser(session.user),
          fetchProfileWithRetry(),
        ]);

        if (cancelled || isRecoveryRef.current) return;

        if (isBanned) {
          await supabase.auth.signOut();
          if (cancelled || isRecoveryRef.current) return;
          setAuthedUserId(null);
          const unauth = unauthedRoute();
          lastNavRef.current = { dest: unauth, ts: Date.now() };
          router.replace(unauth as any);
          setTimeout(() => setAuthResolved(true), 80);
          return;
        }

        if (!profileData) {
          const unauth = unauthedRoute();
          lastNavRef.current = { dest: unauth, ts: Date.now() };
          router.replace(unauth as any);
          setTimeout(() => setAuthResolved(true), 80);
          return;
        }

        // Seed the React Query cache so the (tabs) onboarding guard can
        // read the same profile without firing a duplicate Supabase select.
        seedAuthProfile(queryClient, session.user.id, profileData);
        setAuthedUserId(session.user.id);
        const dest = authedDest({
          onboarding_status: profileData.onboarding_status,
          referral_source: profileData.referral_source,
          phone_number: profileData.phone_number,
        });
        lastNavRef.current = { dest, ts: Date.now() };
        // Navigate first, then lift the overlay — prevents a 1-frame flash
        // where the splash is gone but the destination hasn't rendered yet.
        router.replace(dest as any);
        setTimeout(() => setAuthResolved(true), 80);
      } catch {
        if (!cancelled) {
          const unauth = unauthedRoute();
          lastNavRef.current = { dest: unauth, ts: Date.now() };
          router.replace(unauth as any);
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
        resetMigrationGateSnooze();
        setAuthedUserId(null);
        const unauth = unauthedRoute();
        // Skip the redirect if either (a) the pathname already matches
        // the unauthed route, or (b) a caller (e.g. delete-account flow)
        // synchronously stamped lastUnauthRedirectAt.ts before this
        // listener could fire. (a) catches the steady state; (b) catches
        // the race where pathnameRef hasn't been updated yet by its own
        // useEffect — without (b) the listener fires a second
        // router.replace and the user sees a brief bounce.
        const externallyRedirected = Date.now() - lastUnauthRedirectAt.ts < 1500;
        if (externallyRedirected || pathnameRef.current === unauth) {
          lastNavRef.current = { dest: unauth, ts: Date.now() };
          return;
        }
        lastNavRef.current = { dest: unauth, ts: Date.now() };
        router.replace(unauth as any);
        return;
      }

      // Apple ban check — same safety net as checkAuth. Belt-and-suspenders
      // against the tiny window where SIGNED_IN fires after a fresh Apple
      // sign-in but before signInWithApple's own ban check has a chance to
      // run. Also catches any reauthentication flow that bypasses socialAuth.
      if (await isBannedAppleUser(session.user)) {
        await supabase.auth.signOut();
        setAuthedUserId(null);
        const unauth = unauthedRoute();
        lastNavRef.current = { dest: unauth, ts: Date.now() };
        router.replace(unauth as any);
        return;
      }

      // Verify-code is self-routing: it shows a 600ms success animation
      // before navigating itself via the same authedDest helper. Skip the
      // root-level redirect so we don't preempt that animation by yanking
      // the user away the moment SIGNED_IN fires. Pathname-agnostic via
      // a shared ref — survives deep-link entry to /verify-code.
      if (verifyCodeSelfRoutingRef.current || pathnameRef.current === '/verify-code') {
        setAuthedUserId(session.user.id);
        setAuthResolved(true);
        return;
      }

      try {
        // Reuse the shared auth-profile cache (seeded by cold-start checkAuth)
        // so SIGNED_IN doesn't fire a duplicate select within the 60s stale
        // window. Falls back to a network fetch if the cache is empty/stale.
        const data = await getAuthProfile(queryClient, session.user.id);
        const dest = authedDest({
          onboarding_status: data?.onboarding_status,
          referral_source: data?.referral_source,
          phone_number: data?.phone_number,
        });
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
      {authedUserId && !surveyPlan && !showReviewAsk && (
        <AlbumUploadPromptModal userId={authedUserId} />
      )}
      <KeyboardDoneBar />
      {authedUserId && surveyCheckDone && !surveyPlan && !showReviewAsk && (
        <MarkEarnedModal userId={authedUserId} />
      )}
      {layoutAlert && (
        <BrandedAlert
          visible
          title={layoutAlert.title}
          message={layoutAlert.message}
          onClose={() => setLayoutAlert(null)}
        />
      )}
    </View>
  );
}
