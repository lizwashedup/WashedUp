import { communityJoinPushRoute } from '../lib/communityJoinNotification';
import { subscribePlanNotificationPrompts, planNotificationPromptCopy, type PlanNotificationPromptRequest, type PlanNotificationPromptReason } from '../lib/planNotificationPrompt';
import { subscribeExpoNotificationResponses } from '../lib/expoNotificationResponses';
import { communityChatPushRoute } from '../lib/communityChatPushRoute';
import { memberReactionPushRoute } from '../lib/memberReactionPushRoute';
import { pageInvitationPushRoute } from '../lib/pageInvitationNotification';
import { attendeeMessagePushRoute } from '../lib/attendeeMessageNotification';
import { organizationPageUpdatePushRoute } from '../lib/organizationPageUpdate';
import { LOCAL_DEVELOPMENT_ONLY } from '../constants/LocalDevelopment';
import '../global.css';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useFonts } from 'expo-font';
import {
  CormorantGaramond_400Regular,
  CormorantGaramond_700Bold,
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
import { Stack, useRouter, usePathname, useRootNavigationState } from 'expo-router';
import { setAudioModeAsync } from 'expo-audio';
import * as SplashScreen from 'expo-splash-screen';
import { OneSignal } from '../lib/oneSignalShim';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, LogBox, Platform } from 'react-native';
import 'react-native-reanimated';

// Silence the dev-only expo-notifications redbox caused by simulators having
// no APNs entitlement. Real device registration failures must stay visible.
LogBox.ignoreLogs([
  'getRegistrationInfoAsync',
]);
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PostHogProvider, usePostHog } from 'posthog-react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import { View, Text, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import { supabase } from '../lib/supabase';
import { isBannedAppleUser } from '../lib/socialAuth';
import { authedDest, unauthedRoute } from '../lib/authRouting';
import { fetchNeedsPhoneMigration } from '../lib/authGate';
import { seedAuthProfile, getAuthProfile } from '../hooks/useProfile';
import { verifyCodeSelfRoutingRef, lastUnauthRedirectAt, authedUserIdRef, deliberateSignOutAt, subscribeVerificationDestination, getVerificationDestination, observeVerificationAccount, approveVerificationDestination, cancelVerificationDestination, type VerificationDestinationHandoff } from '../lib/navState';
import Colors from '../constants/Colors';
import {
  usePushNotifications,
  initOneSignal,
  ensureOneSignalReady,
  getPushPromptPermission, getPushPrimerEligibility,
  registerPushNotificationsWithResult,
} from '../hooks/usePushNotifications';
import { registerAlbumUploadResume, resumeAllPendingAlbumBatches } from '../lib/uploadAlbumMedia';
import { AlbumUploadPromptModal } from '../components/albums/AlbumUploadPromptModal';
import { KeyboardDoneBar } from '../components/keyboard/KeyboardDoneBar';
import { ChatKeyboardProvider } from '../components/keyboard/ChatKeyboard';
import { logError } from '../lib/logger';
import { queryClient } from '../lib/queryClient';
import { withTimeout } from '../lib/withTimeout';
import { useSessionLogger } from '../hooks/useSessionLogger';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { COMMUNITIES_ENABLED, YOURS_PAGE_ENABLED, COMMUNITY_CHAT_GROUPING_ENABLED, CREATOR_PAGES_ENABLED } from '../constants/FeatureFlags';
import { useAfterglowFonts } from '../hooks/useAfterglowFonts';
import { pushRegistrationFeedback } from '../components/notifications/pushRegistrationFeedback';
import { handleReferralUrl, consumePendingReferral } from '../lib/yours/referralLink';
import { pendingTransferRoute } from '../lib/ticketTransfer';
import { clearPendingDestination, consumePendingDestination, peekPendingCheckout, parseAppDestination, stashPendingDestination } from '../lib/pendingLink';
import { getOrder } from '../lib/ticketing';
import { forgetAccount, rememberAccount } from '../lib/knownAccount';
import PostPlanSurvey, { SurveyPlan, SurveyMember, isPostPlanSurveyHandled } from '../components/PostPlanSurvey';
import { maybeRequestReviewAfterTopRating } from '../lib/reviewAsk';
import MarkEarnedModal from '../components/marks/MarkEarnedModal';
import PushPrimerModal from '../components/PushPrimerModal';
import VideoSplash from '../components/VideoSplash';
import { BrandedAlert } from '../components/BrandedAlert';
import * as Sentry from '@sentry/react-native';
import { initGiphySDK } from '../lib/giphyInit';

initGiphySDK();

Sentry.init({
  dsn: 'https://fb9ffdb4b5f0fb3ea5191274a258f266@o4511311419604992.ingest.us.sentry.io/4511311773827072',
  // Do NOT report in development (Metro/simulator/dev-client). Dev hot-reload
  // of a half-finished edit (e.g. the "Property 'TC' doesn't exist" transient)
  // fires false-alarm crash emails that never reach users. __DEV__ is false in
  // all EAS release builds (preview + production), so prod/preview reporting is
  // unchanged; only dev/sim goes quiet.
  enabled: !LOCAL_DEVELOPMENT_ONLY && !__DEV__,
  tracesSampleRate: 0,
  enableAutoSessionTracking: true,
  ignoreErrors: [/getRegistrationInfoAsync/],
  // RN-14 (iOS) / RN-13 (Android) scoped guard. ProcessLockAcquireTimeoutError is
  // thrown INSIDE @supabase/auth-js's processLock (no app-level promise to wrap,
  // which is why the getSession().then() .catch sweep missed it). It is non-fatal:
  // the abort-timeout fetch already releases the lock, so this is reporting noise,
  // not a freeze. DOWNSAMPLE only this error class to ~1-in-10 so the escalation
  // noise stops but a trend signal survives in Sentry for the processLock
  // root-cause follow-up (returning null would drop it entirely, and console logs
  // are device-only = fully blind). Every other event reports untouched.
  beforeSend(event, hint) {
    const err = hint?.originalException;
    const name = err instanceof Error ? err.name : '';
    const message = err instanceof Error ? err.message : String(err ?? '');
    if (name === 'ProcessLockAcquireTimeoutError' || /Acquiring process lock .* timed out/.test(message)) {
      // Keep ~10% as handled events for the trend; drop the rest.
      return Math.random() < 0.1 ? event : null;
    }
    return event;
  },
});

export { ErrorBoundary } from 'expo-router';

SplashScreen.preventAutoHideAsync();
SplashScreen.setOptions({ duration: 300, fade: true });

// Let the user's own audio (music, podcasts) keep playing when the app opens.
// Set at MODULE LOAD, before the component tree (and VideoSplash's video
// player) mounts, so the non-interrupting mode is applied before anything can
// seize the iOS audio session and clip background music on cold open. A mount
// effect would be too late: React flushes child effects before parent effects,
// so the splash player could activate the session first.
//
// The .catch handles async rejection; the try/catch guards a synchronous throw
// in case the native audio bridge isn't ready at import time (harmless: the OS
// default applies, and the first audio interaction re-asserts the mode). JS-only.
try {
  setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'mixWithOthers' }).catch(
    () => {},
  );
} catch {
  // native module not ready at module load; ignore.
}

export const unstable_settings = {
  // Start with (tabs) so we never flash login before auth check completes
  initialRouteName: '(tabs)',
};

function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
    CormorantGaramond_400Regular,
    CormorantGaramond_700Bold,
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
    <GestureHandlerRootView style={styles.root}>
      <PostHogProvider
        apiKey={posthogApiKey || 'placeholder'}
        options={{
          host: 'https://us.i.posthog.com',
          disabled: LOCAL_DEVELOPMENT_ONLY || !posthogApiKey,
        }}
      >
        <QueryClientProvider client={queryClient}>
          <SafeAreaProvider>
            <ChatKeyboardProvider>
            <BottomSheetModalProvider>
              <RootLayoutNav onReady={() => setAuthReady(true)} />
              {showVideoSplash && (
                <VideoSplash onFinish={() => setShowVideoSplash(false)} />
              )}
            </BottomSheetModalProvider>
            </ChatKeyboardProvider>
          </SafeAreaProvider>
        </QueryClientProvider>
      </PostHogProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});

export default Sentry.wrap(RootLayout);

// Keep the generic launch reminder and the higher-intent post/join invitation
// on separate cooldowns. Dismissing an out-of-context reminder must not hide
// the more relevant invitation after someone actually creates or joins a plan.
// Preserve the original key for the launch reminder so existing choices carry
// forward across the OTA.
const PUSH_PRIMER_SNOOZE_KEY = 'push_primer_snoozed_at';
const PLAN_PUSH_PRIMER_SNOOZE_KEY = 'plan_push_primer_snoozed_at';
const PUSH_PRIMER_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

function RootLayoutNav({ onReady }: { onReady: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  useEffect(() => { pathnameRef.current = pathname; }, [pathname]);

  // Cold-start push tap race guard. OneSignal buffers a cold-start click and
  // replays it the instant our JS listener attaches, but Expo Router's root
  // navigation state hydrates a beat later AND the auth gate's own redirect
  // resolves seconds later still. We hold the destination in pendingDeepLinkRef
  // and navigate to it only AFTER auth resolves to an in-app route (see
  // honorPendingDeepLink below), so the auth redirect can never clobber it and
  // a gated/unauthed user can never deep-link past the gate. Applies to every
  // notification type, not just album_ready.
  const rootNavState = useRootNavigationState();
  const navReady = !!rootNavState?.key;
  const navReadyRef = useRef(navReady);
  useEffect(() => { navReadyRef.current = navReady; }, [navReady]);
  const pendingDeepLinkRef = useRef<string | null>(null);

  const [authResolved, setAuthResolved] = useState(false);
  const [authCheckFailed, setAuthCheckFailed] = useState(false);
  const retryAuthCheckRef = useRef<(() => void) | null>(null);
  const [authedUserId, setAuthedUserId] = useState<string | null>(null);
  const [layoutAlert, setLayoutAlert] = useState<{ title: string; message: string } | null>(null);
  const [verificationRevision, setVerificationRevision] = useState(0);
  const verificationResumeRef = useRef<VerificationDestinationHandoff | null>(null);
  const authIdentityRef = useRef({ userId: null as string | null, revision: 0 });
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cancelVerificationDestination();
    };
  }, []);
  useEffect(() => subscribeVerificationDestination(() => setVerificationRevision((n) => n + 1)), []);
  const isRecoveryRef = useRef(false);
  const splashHiddenRef = useRef(false);
  const lastNavRef = useRef({ dest: '', ts: 0 });

  // Deep-link honor (pairs with the cold-start guard above). Navigate to a
  // buffered push destination ONLY after auth has resolved to an in-app
  // /(tabs)/* route, i.e. authedDest cleared ban + phone-migration +
  // onboarding. The gate reads authedDestRef, a dedicated value stamped
  // synchronously by the auth resolver right before it flips authResolved, so
  // it can't be skewed by an unrelated re-emit overwriting lastNavRef in the
  // ~80ms window (which would silently hold a valid cold tap). Because
  // authResolved flips AFTER the auth redirect, the honor always runs last and
  // becomes the single final destination, never clobbered. Fail-closed: a
  // login / onboarding / migration-gate dest holds the link rather than
  // bypassing the gate (authedUserId alone is NOT sufficient; it is set even on
  // the migration-gate path). Consume-once: cleared the instant it is honored so
  // a TOKEN_REFRESHED / re-emit can't replay a stale link.
  const authResolvedRef = useRef(authResolved);
  useEffect(() => { authResolvedRef.current = authResolved; }, [authResolved]);
  const authedDestRef = useRef('');
  const honorPendingDeepLink = useCallback(() => {
    if (!navReadyRef.current || !authResolvedRef.current || isRecoveryRef.current || getVerificationDestination()) return;
    if (!authedUserIdRef.current) return;
    if (!authedDestRef.current.startsWith('/(tabs)')) return;
    const href = pendingDeepLinkRef.current;
    if (!href) return;
    pendingDeepLinkRef.current = null;
    // it is being honored now, so the durable copy must not fire again
    clearPendingDestination();
    router.push(href as any);
  }, [router]);
  const safePush = (href: string) => {
    pendingDeepLinkRef.current = href;
    honorPendingDeepLink();
  };
  useEffect(() => {
    honorPendingDeepLink();
  }, [navReady, authResolved, authedUserId, honorPendingDeepLink]);

  useEffect(() => {
    const visit = getVerificationDestination();
    if (!visit?.approved || !visit.destination || !visit.userId
      || !navReady || !authResolved || isRecoveryRef.current || authedUserIdRef.current !== visit.userId
      || verificationResumeRef.current === visit) return;
    // Verification proposes its destination after the success hold. The ban
    // check must approve it before even the base screen can be entered.
    if (!visit.routeCommitted) {
      visit.routeCommitted = true;
      router.replace(visit.destination as never);
      return;
    }
    if (!visit.entryApproved || !visit.destination.startsWith('/(tabs)')) return;
    verificationResumeRef.current = visit;
    const isCurrent = () => mountedRef.current && getVerificationDestination() === visit && visit.approved && visit.entryApproved
      && authedUserIdRef.current === visit.userId && !isRecoveryRef.current;
    void (async () => {
      // Same priority as the Tabs consumer this visit replaces: a completed
      // checkout first, then its saved link, then the buffered notification.
      const orderId = await peekPendingCheckout();
      if (!isCurrent()) return;
      if (orderId) {
        const order = await getOrder(orderId).catch(() => null);
        if (!isCurrent()) return;
        if (order && order.status !== 'pending') {
          pendingDeepLinkRef.current = null;
          await clearPendingDestination(isCurrent);
          if (!isCurrent()) return;
          authedDestRef.current = visit.destination!;
          cancelVerificationDestination(visit);
          router.replace(`/tickets/order/${orderId}` as never);
          return;
        }
      }
      const saved = await consumePendingDestination(isCurrent);
      if (!isCurrent()) return;
      const href = saved ?? pendingDeepLinkRef.current ?? await pendingTransferRoute().catch(() => null);
      if (!isCurrent()) return;
      pendingDeepLinkRef.current = null;
      authedDestRef.current = visit.destination!;
      cancelVerificationDestination(visit);
      if (href) router.push(href as never);
    })().catch((error) => {
      // Storage and order helpers are best-effort. An unexpected rejection
      // must not leave this visit permanently owning the consumer.
      if (!isCurrent()) return;
      logError(error, 'layout.verificationDestination');
      authedDestRef.current = visit.destination!;
      cancelVerificationDestination(visit);
      honorPendingDeepLink();
    });
  }, [navReady, authResolved, authedUserId, verificationRevision, router, honorPendingDeepLink]);

  usePushNotifications(authedUserId, { identityResolved: authResolved });
  useSessionLogger(authedUserId);

  // PostHog: identify on login, reset on logout. Hook returns null when the
  // provider is in disabled mode (no key configured), so the optional chaining
  // keeps this safe in misconfigured environments.
  const posthog = usePostHog();
  const capturePushEvent = useCallback((event: string, properties: Record<string, string | null>) => {
    // Analytics is observability only. A disabled or unhealthy analytics SDK
    // must never block a permission choice, registration repair, or dismissal.
    try { posthog?.capture(event, properties); } catch {}
  }, [posthog]);
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
  const [showPushPrimer, setShowPushPrimer] = useState(false);
  const pushPrimerCheckedRef = useRef(false);
  const [pushPrimerPending, setPushPrimerPending] = useState(false);
  const [pushPrimerFeedback, setPushPrimerFeedback] = useState<string | null>(null);
  const pushPrimerCheckRef = useRef<object | null>(null);
  const pushPrimerVisitRef = useRef<{ identity: typeof authIdentityRef.current; reason?: PlanNotificationPromptReason; settings?: boolean } | null>(null);
  const planPrimerShownRef = useRef(false);
  const [planPrimerRequest, setPlanPrimerRequest] = useState<(PlanNotificationPromptRequest & { identity: typeof authIdentityRef.current }) | null>(null);
  const pushPrimerAttemptRef = useRef<object | null>(null);
  const pushPrimerAnalyticsVisitRef = useRef<typeof pushPrimerVisitRef.current>(null);
  const primerIdentity = authIdentityRef.current;
  const { fonts: primerFonts } = useAfterglowFonts(COMMUNITY_CHAT_GROUPING_ENABLED);

  const retirePushPrimer = () => {
    pushPrimerCheckRef.current = null;
    pushPrimerVisitRef.current = null;
    pushPrimerAttemptRef.current = null;
    setShowPushPrimer(false);
    setPushPrimerPending(false);
    setPushPrimerFeedback(null);
  };
  // An account epoch also changes on sign-out/recovery, including A → B → A.
  // Never let a check or an enable result from that old visit own this modal.
  useEffect(() => {
    pushPrimerCheckedRef.current = false;
    planPrimerShownRef.current = false;
    setPlanPrimerRequest(null);
    retirePushPrimer();
  }, [primerIdentity]);

  // ── Root-modal sequencer ──────────────────────────────────────────────────
  // RN can only safely present ONE modal at a time. Closing one modal used to
  // let the next mount in the same beat (survey close -> review-ask mount),
  // presenting a modal while the previous was still dismissing, the iOS "present
  // while a presentation is in progress" crash. It armed exactly when a user
  // went on 2+ plans (the review-ask threshold), so multiple pending surveys
  // surfaced it. modalLocked holds every lower-precedence modal off for one
  // handoff window after a close, so the closing modal fully unmounts before
  // the next mounts. Precedence (explicit): survey > review > album > mark >
  // pushPrimer, enforced by the render gates below. One modal at a time, ever.
  const MODAL_HANDOFF_MS = 400;
  const [modalLocked, setModalLocked] = useState(false);
  const handoffModal = (close: () => void) => {
    close();
    setModalLocked(true);
    setTimeout(() => setModalLocked(false), MODAL_HANDOFF_MS);
  };

  // Reset survey/review state when user changes (sign out + sign in as different user)
  useEffect(() => {
    if (authedUserId && authedUserId !== prevUserIdRef.current) {
      if (prevUserIdRef.current !== null) {
        surveyCheckedRef.current = false;
        setSurveyCheckDone(false);
        setReviewCheckDone(false);
        setSurveyPlan(null);
        setReviewSheetPending(false);
        pushPrimerCheckedRef.current = false;
        setShowPushPrimer(false);
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
          plan: {
            id: string;
            title: string;
            image_url: string | null;
            circle_id: string | null;
            is_featured: boolean;
            any_stranger_joined: boolean;
            creator_user_id: string | null;
          };
          members: Array<{
            id: string;
            first_name_display: string | null;
            profile_photo_url: string | null;
            is_stranger: boolean;
            is_creator: boolean;
            keep_state: SurveyMember['keep_state'];
          }>;
        };

        // On-device suppression backstop. The RPC only stops returning a
        // plan once a plan_feedback row exists; if that insert ever failed
        // or the user skipped offline, this guarantees the survey can never
        // re-block them on a later cold start (incident 2026-05-18).
        if (await isPostPlanSurveyHandled(payload.plan.id)) return;

        setSurveyPlan({
          id: payload.plan.id,
          title: payload.plan.title,
          image_url: payload.plan.image_url ?? null,
          circle_id: payload.plan.circle_id ?? null,
          is_featured: !!payload.plan.is_featured,
          any_stranger_joined: !!payload.plan.any_stranger_joined,
          creator_user_id: payload.plan.creator_user_id ?? null,
        });
        setSurveyMembers(
          (payload.members ?? []).map((m) => ({
            id: m.id,
            first_name_display: m.first_name_display,
            profile_photo_url: m.profile_photo_url,
            is_stranger: !!m.is_stranger,
            is_creator: !!m.is_creator,
            keep_state: m.keep_state ?? 'none',
          })),
        );
      } catch (e) { logError(e, 'layout.surveyCheck'); }
      finally { setSurveyCheckDone(true); }
    })();
  }, [authedUserId, authResolved]);

  // ── App Store review ask ────────────────────────────────────────────────
  // The review ask is no longer a competing root modal. It is the native OS
  // review sheet, fired from the survey's onComplete (a TOP rating) AFTER the
  // survey Modal has fully dismissed (see lib/reviewAsk). While that sheet is
  // pending we hold the lower-precedence modals off, exactly like the old
  // review modal did. reviewCheckDone stays as the gate the push primer and the
  // album/mark modals wait on; it now resolves as soon as the survey decision
  // is made (there is no separate review pre-check to await).
  const [reviewCheckDone, setReviewCheckDone] = useState(false);
  const [reviewSheetPending, setReviewSheetPending] = useState(false);

  useEffect(() => {
    if (surveyCheckDone) setReviewCheckDone(true);
  }, [surveyCheckDone]);

  // Called from the survey owner after a TOP-rating completion. Defers the push
  // primer to a later launch (the review sheet owns this beat) and fires the
  // native ask once the survey Modal has unmounted (the handoff window).
  const fireReviewAfterSurvey = () => {
    planPrimerShownRef.current = true;
    setPlanPrimerRequest(null);
    pushPrimerCheckedRef.current = true;
    retirePushPrimer();
    setReviewSheetPending(true);
    setTimeout(() => {
      void maybeRequestReviewAfterTopRating().finally(() =>
        setReviewSheetPending(false),
      );
    }, MODAL_HANDOFF_MS + 60);
  };

  // Pre-permission primer gate. Native only. Fires once per cold launch
  // (ref resets on account epoch change) while the user is authed, auth is
  // resolved, push permission is still undetermined, and the 7-day snooze
  // is not active. Never cold-fires the OS prompt: the modal CTA does.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    if (!authedUserId || !authResolved) return;
    if (primerIdentity.userId !== authedUserId || isRecoveryRef.current) return;
    // Wait for the App Store review decision before evaluating, so the primer
    // never flashes on screen a beat ahead of a review ask that takes
    // precedence (the review check is network-bound and resolves later).
    if (!reviewCheckDone) return;
    if (pushPrimerCheckedRef.current) return;
    pushPrimerCheckedRef.current = true;
    const check = {};
    pushPrimerCheckRef.current = check;
    const isCurrent = () => mountedRef.current && pushPrimerCheckRef.current === check
      && authIdentityRef.current === primerIdentity && !isRecoveryRef.current;
    // A TOP-rating survey completion defers the primer to a later launch via
    // fireReviewAfterSurvey (it sets pushPrimerCheckedRef + hides the primer),
    // so the native review sheet is never stacked under the primer.
    (async () => {
      try {
        const snoozedAt = await AsyncStorage.getItem(PUSH_PRIMER_SNOOZE_KEY);
        if (!isCurrent()) return;
        if (snoozedAt && Date.now() - Number(snoozedAt) < PUSH_PRIMER_COOLDOWN_MS) return;
        const status = await getPushPrimerEligibility();
        // This read never registers a device or requests OS permission. A
        // failed/unknown lookup is not evidence that permission is unasked.
        if (!isCurrent() || status !== 'requestable') return;
        pushPrimerVisitRef.current = { identity: primerIdentity };
        setPushPrimerFeedback(null);
        setPushPrimerPending(false);
        setShowPushPrimer(true);
      } catch (e) {
        logError(e, 'layout.pushPrimerCheck');
      }
    })();
    return () => {
      if (pushPrimerCheckRef.current !== check) return;
      pushPrimerCheckRef.current = null;
      // Account switching resets the survey/review decision after this
      // render. A check cancelled before showing is still eligible once
      // that new decision completes; an already shown visit is consumed.
      if (!pushPrimerVisitRef.current) pushPrimerCheckedRef.current = false;
    };
  }, [authedUserId, authResolved, reviewCheckDone, primerIdentity]);

  // Confirmed plan flows hand off only after their local sheets finish. The
  // existing root primer remains the single modal/permission owner.
  useEffect(() => subscribePlanNotificationPrompts((request) => {
    if (Platform.OS === 'web' || !mountedRef.current || !authResolved || !authedUserId || request.userId !== authedUserId
      || authIdentityRef.current !== primerIdentity || isRecoveryRef.current || planPrimerShownRef.current) return;
    setPlanPrimerRequest((queued) => queued ?? { ...request, identity: primerIdentity });
  }), [authedUserId, authResolved, primerIdentity]);

  useEffect(() => {
    if (!planPrimerRequest) return;
    if (planPrimerShownRef.current || planPrimerRequest.identity !== primerIdentity) {
      setPlanPrimerRequest(null); return;
    }
    if (!authResolved || !authedUserId || !reviewCheckDone || surveyPlan || reviewSheetPending
      || modalLocked || layoutAlert || showPushPrimer || isRecoveryRef.current) return;
    // Retire an unfinished cold-launch check before checking this context.
    pushPrimerCheckedRef.current = true;
    const check = {}; pushPrimerCheckRef.current = check;
    const isCurrent = () => mountedRef.current && pushPrimerCheckRef.current === check
      && authIdentityRef.current === planPrimerRequest.identity && !isRecoveryRef.current;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const snoozedAt = await AsyncStorage.getItem(PLAN_PUSH_PRIMER_SNOOZE_KEY);
          if (!isCurrent()) return;
          if (snoozedAt && Date.now() - Number(snoozedAt) < PUSH_PRIMER_COOLDOWN_MS) return;
          const permission = await getPushPromptPermission();
          if (!isCurrent() || (permission !== 'requestable' && permission !== 'denied')) return;
          pushPrimerVisitRef.current = { identity: planPrimerRequest.identity,
            reason: planPrimerRequest.reason, settings: permission === 'denied' };
          setPushPrimerFeedback(null); setPushPrimerPending(false); setShowPushPrimer(true);
        } catch (error) { if (isCurrent()) logError(error, 'layout.planPushPrimerCheck'); }
        finally { if (isCurrent()) setPlanPrimerRequest(null); }
      })();
    }, MODAL_HANDOFF_MS);
    return () => {
      clearTimeout(timer);
      if (pushPrimerCheckRef.current === check) pushPrimerCheckRef.current = null;
    };
  }, [planPrimerRequest, primerIdentity, authedUserId, authResolved, reviewCheckDone, surveyPlan,
    reviewSheetPending, modalLocked, layoutAlert, showPushPrimer]);

  const pushPrimerVisible = showPushPrimer && !!authedUserId && authResolved
    && pushPrimerVisitRef.current?.identity === primerIdentity && !isRecoveryRef.current
    && !surveyPlan && !reviewSheetPending && !modalLocked && !layoutAlert;
  const renderedPushPrimerVisit = pushPrimerVisitRef.current;
  const pushPrimerVisibleRef = useRef(pushPrimerVisible);
  pushPrimerVisibleRef.current = pushPrimerVisible;
  useEffect(() => {
    if (!pushPrimerVisible || !renderedPushPrimerVisit) return;
    // Only a contextual visit consumes the contextual once-per-launch guard.
    // A generic reminder can therefore be followed by one meaningful post/join
    // invitation later in the same session.
    if (renderedPushPrimerVisit.reason) planPrimerShownRef.current = true;
    if (pushPrimerAnalyticsVisitRef.current === renderedPushPrimerVisit) return;
    pushPrimerAnalyticsVisitRef.current = renderedPushPrimerVisit;
    capturePushEvent('push_primer_viewed', {
      source: renderedPushPrimerVisit.reason ? 'plan_action' : 'cold_launch',
      reason: renderedPushPrimerVisit.reason ?? null,
      destination: renderedPushPrimerVisit.settings ? 'settings' : 'native_prompt',
    });
  }, [pushPrimerVisible, renderedPushPrimerVisit, capturePushEvent]);
  useEffect(() => {
    // A higher-priority modal taking over retires an in-flight enable. Never
    // open the OS sheet later underneath a survey or an account alert.
    if (!pushPrimerVisible && pushPrimerAttemptRef.current) retirePushPrimer();
  }, [pushPrimerVisible]);

  const enablePushPrimer = async () => {
    const visit = renderedPushPrimerVisit;
    if (!mountedRef.current || !visit || visit.identity !== authIdentityRef.current || isRecoveryRef.current
      || pushPrimerVisitRef.current !== visit || !pushPrimerVisibleRef.current || pushPrimerAttemptRef.current || !authedUserId) return;
    const attempt = {};
    pushPrimerAttemptRef.current = attempt;
    const isCurrent = () => mountedRef.current && pushPrimerAttemptRef.current === attempt
      && pushPrimerVisitRef.current === visit && authIdentityRef.current === visit.identity
      && pushPrimerVisibleRef.current && !isRecoveryRef.current;
    setPushPrimerPending(true);
    setPushPrimerFeedback(null);
    capturePushEvent('push_primer_cta_tapped', {
      source: visit.reason ? 'plan_action' : 'cold_launch',
      reason: visit.reason ?? null,
      destination: visit.settings ? 'settings' : 'native_prompt',
    });
    try {
      if (visit.settings) {
        await Linking.openSettings();
        if (isCurrent()) retirePushPrimer();
        return;
      }
      let result = await registerPushNotificationsWithResult({ prompt: false, userId: authedUserId });
      if (!isCurrent()) return;
      // A retry after OS permission was granted only repairs registration;
      // it must not request permission again or silently reverse an opt-out.
      if (result.status === 'permission-required') {
        result = await registerPushNotificationsWithResult({ prompt: true, userId: authedUserId, canPrompt: isCurrent });
        if (!isCurrent()) return;
      }
      if (result.status === 'permission-denied' && visit.reason) {
        visit.settings = true;
        setPushPrimerFeedback(pushRegistrationFeedback(result).message);
      } else if (result.status === 'registered' || result.status === 'permission-denied' || result.status === 'obsolete') {
        retirePushPrimer();
      } else {
        setPushPrimerFeedback(pushRegistrationFeedback(result).message);
      }
      capturePushEvent('push_registration_result', {
        source: visit.reason ? 'plan_action' : 'cold_launch',
        reason: visit.reason ?? null,
        status: result.status,
      });
    } catch (error) {
      if (!isCurrent()) return;
      logError(error, 'layout.pushPrimerEnable');
      setPushPrimerFeedback(visit.settings ? 'Couldn’t open Settings. Try again.' : pushRegistrationFeedback({ status: 'failed' }).message);
    } finally {
      if (isCurrent()) {
        pushPrimerAttemptRef.current = null;
        setPushPrimerPending(false);
      }
    }
  };

  const dismissPushPrimer = () => {
    if (!mountedRef.current || !pushPrimerVisibleRef.current || !renderedPushPrimerVisit
      || pushPrimerVisitRef.current !== renderedPushPrimerVisit || renderedPushPrimerVisit.identity !== authIdentityRef.current) return;
    const visit = renderedPushPrimerVisit;
    capturePushEvent('push_primer_dismissed', {
      source: visit.reason ? 'plan_action' : 'cold_launch',
      reason: visit.reason ?? null,
    });
    retirePushPrimer();
    // Preserve the existing device-level seven-day Not now choice. A
    // registration failure alone never writes this suppression timestamp.
    void AsyncStorage.setItem(
      visit.reason ? PLAN_PUSH_PRIMER_SNOOZE_KEY : PUSH_PRIMER_SNOOZE_KEY,
      String(Date.now()),
    ).catch(() => {});
  };

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
      if (type === 'operator_grant') { safePush('/creator/apply'); return; }
      const joinRoute = communityJoinPushRoute(data, CREATOR_PAGES_ENABLED);
      if (joinRoute) { safePush(joinRoute); return; }
      const attendeeRoute = attendeeMessagePushRoute(data, COMMUNITIES_ENABLED);
      if (attendeeRoute) { safePush(attendeeRoute); return; }
      const invitationRoute = pageInvitationPushRoute(data, CREATOR_PAGES_ENABLED);
      if (invitationRoute) { safePush(invitationRoute); return; }
      const pageUpdateRoute = organizationPageUpdatePushRoute(data, CREATOR_PAGES_ENABLED);
      if (pageUpdateRoute) { safePush(pageUpdateRoute); return; }
      const communityRoute = communityChatPushRoute(data, COMMUNITIES_ENABLED);
      if (communityRoute) { safePush(communityRoute); return; }
      const memberReactionRoute = memberReactionPushRoute(data);
      if (memberReactionRoute) { safePush(memberReactionRoute); return; }

      // Album notifications: prompt/reminder/no-uploads-nudge open the upload
      // flow; ready/someone-uploaded/more-photos-added/hearts-batched open the
      // album detail view. eventId now lives in the same outer condition as
      // every other type-specific branch below (waitlist/plan/etc.), not a
      // nested check inside the branch body: previously a type match with no
      // eventId (malformed payload, future shape change) fell into the `if`
      // with nothing to push, which ended the whole if/else-if chain right
      // there -- the tap did literally nothing, instead of falling through
      // to the generic id-based fallback chain like every other type
      // already does. Consistency fix so no notification type can silently
      // no-op on tap.
      if (
        (type === 'album_upload_prompt' || type === 'album_upload_reminder' || type === 'album_creator_no_uploads_nudge') &&
        data?.eventId
      ) {
        safePush(`/album/upload/${data.eventId}`);
      } else if (
        (type === 'album_ready' || type === 'album_someone_uploaded' || type === 'album_more_photos_added' || type === 'album_hearts_batched') &&
        data?.eventId
      ) {
        safePush(`/album/${data.eventId}`);
      } else if (
        (type === 'waitlist_request' || type === 'exception_slot_refunded') &&
        data?.eventId
      ) {
        // Creator-side waitlist-exception pushes open the manager screen
        // (creator-only server-side; non-creators get the auth screen there).
        safePush(`/waitlist/${data.eventId}`);
      } else if (
        (type === 'plan_invite' ||
          type === 'plan_cancelled' ||
          type === 'waitlist_spot' ||
          type === 'duplicate_plan' ||
          type === 'interest_signal' ||
          type === 'interest_invite' ||
          type === 'exception_invite') &&
        data?.eventId
      ) {
        // Tag the URL when the push is the creator-side "someone signaled
        // interest" notification, so the plan detail can surface the
        // "Would go next time" section explicitly. Receiver may currently
        // no-op on the param; it's a marker for future scroll/analytics.
        const focusParam = type === 'interest_signal' ? '?focus=interest' : '';
        safePush(`/plan/${data.eventId}${focusParam}`);
      } else if (type === 'people_request') {
        // An incoming add-request: route to People and OPEN the requests LIST
        // (YoursScreen consumes ?openRequests=1). The notification is a pointer
        // ONLY; it never accepts/declines/destroys anything. If the push payload
        // carries the requester id, float that person to the top of the list;
        // otherwise the full pending list (each row individually actionable)
        // already makes wrong-target impossible.
        const requester =
          data?.actorUserId ?? data?.actor_user_id ?? data?.requesterId ?? null;
        safePush(
          requester
            ? `/(tabs)/friends?openRequests=1&tab=people&requesterId=${requester}`
            : '/(tabs)/friends?openRequests=1&tab=people',
        );
      } else if (
        type === 'people_request_accepted' ||
        type === 'referral_joined'
      ) {
        // Yours system: the request banner + swipe stack live on the
        // Yours page. Single inbox routes people notifications there.
        safePush('/(tabs)/friends?tab=people');
      } else if (type === 'people_ping' && data?.eventId) {
        // A ping IS the plan, open the plan detail, not the chat.
        safePush(`/plan/${data.eventId}`);
      } else if (type === 'community_join_request') {
        // A join request is the leader's to answer: the wants-in list lives
        // on the creator members tab. No flag guard: only grant-holders get
        // this push, and the creator shell itself admits by grant, so a
        // non-creator tapping a stale push still gets redirected out of the
        // shell safely while the flag keeps the surface dark to the public.
        safePush('/(creator)/members');
      } else if (COMMUNITIES_ENABLED && type === 'community_event') {
        // "just posted <event>" lands on Scene, where the event lives. The
        // payload carries no event id by design (event_id is the plans FK).
        safePush('/(tabs)/explore');
        // Source-less join decisions retain the generic chats-list fallback.
      } else if (data?.circleId) {
        // Circle chat push (20260605000200_circle_message_push.sql +
        // 20260827223000_claim_rpc_add_circle_topic_ids.sql):
        // circle chat lives at a different route than plan chat, not the
        // generic eventId fallback below.
        safePush(`/(tabs)/chats/circle/${data.circleId}`);
      } else if (data?.topicId) {
        // Community room push (20260827220000_community_topic_message_push.sql
        // + 20260827223000_claim_rpc_add_circle_topic_ids.sql). The database
        // contract suite proves both migrations remain present and wired.
        safePush(`/community-topic/${data.topicId}`);
      } else if (data?.chatId) {
        safePush(`/(tabs)/chats/${data.chatId}`);
      } else if (data?.eventId) {
        safePush(`/(tabs)/chats/${data.eventId}`);
      } else {
        // Final fallback for notification types that carry neither eventId
        // nor chatId (e.g. broadcast, future admin pings). Drop the user on
        // the chats list rather than no-op'ing the tap.
        safePush('/(tabs)/chats');
      }
    };

    let cancelled = false;
    let attached: ((event: any) => void) | null = null;
    const stopExpoResponses = subscribeExpoNotificationResponses(data => {
      if (!cancelled) onClick({ notification: { additionalData: data } });
    });

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
      stopExpoResponses();
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

    // washedup.app/r/<code> (QR / referral) is disjoint from the
    // auth/callback recovery URLs handled above; handle it additively so
    // it never interferes with recovery or the phone gate.
    // audit finding 5: a shared link opened while signed out used to be
    // destroyed by the auth bounce below (it replaces the route without
    // ever looking at the URL). Write the destination down the moment it
    // arrives; the tabs layout consumes it once the person is actually
    // inside the app, so the gate is respected and the link is not lost.
    const captureDestination = (url: string) => {
      const dest = parseAppDestination(url);
      if (!dest) return;
      stashPendingDestination(dest);
      safePush(dest);
    };
    Linking.getInitialURL()
      .then((url) => {
        if (!url) return;
        parseSessionFromUrl(url);
        if (YOURS_PAGE_ENABLED) handleReferralUrl(url);
        captureDestination(url);
      })
      .catch((e) => logError(e, 'layout.getInitialURL'));
    const sub = Linking.addEventListener('url', ({ url }) => {
      if (!url) return;
      parseSessionFromUrl(url);
      if (YOURS_PAGE_ENABLED) handleReferralUrl(url);
      captureDestination(url);
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const deferredAuthTimers = new Set<ReturnType<typeof setTimeout>>();

    // Hard watchdog: no matter what any auth/network call below does
    // (hang on a stale/expired refresh token, slow/offline network), the
    // full-screen auth overlay must never stay up forever. If auth hasn't
    // resolved in 10s, lift the gate anyway — the onAuthStateChange
    // listener and the (tabs) guard correct routing once calls resolve.
    // 10s > the summed bounded timeouts below, so healthy-but-slow
    // networks still get correct routing and this only trips on a true
    // pathological hang (incident 2026-05-18, thread 3).
    const authWatchdog = setTimeout(() => {
      if (!cancelled) setAuthResolved(true);
    }, 10000);

    let initialAttempt = 0;
    let initialAccountCheckPending = true;
    async function checkAuth(suppliedSession?: Awaited<ReturnType<typeof supabase.auth.getSession>>) {
      const attempt = ++initialAttempt;
      const initialRevision = authIdentityRef.current.revision;
      const isCurrent = () => !cancelled && !isRecoveryRef.current && attempt === initialAttempt
        && authIdentityRef.current.revision === initialRevision;
      try {
        // If a password recovery deep link is being handled, don't interfere
        if (isRecoveryRef.current) return;

        // A missing session is definitive; a delayed/failed storage or token
        // read is not. Keep the original read alive so it can recover without
        // forcing a valid returning member to sign in again.
        const pendingSession = suppliedSession ? Promise.resolve(suppliedSession) : supabase.auth.getSession();
        const unresolved = Symbol('session-check-unresolved');
        let sessionResult = await withTimeout(pendingSession, 6000, unresolved as any);
        if (!isCurrent()) return;
        if (sessionResult === unresolved) {
          clearTimeout(authWatchdog);
          setAuthCheckFailed(true);
          setAuthResolved(true);
          sessionResult = await pendingSession;
          if (!isCurrent()) return;
        }
        if (sessionResult?.error) throw sessionResult.error;
        initialAccountCheckPending = false;
        setAuthCheckFailed(false);

        const session = sessionResult && 'data' in sessionResult
          ? sessionResult.data.session
          : null;

        if (!session?.user) {
          const unauth = unauthedRoute();
          lastNavRef.current = { dest: unauth, ts: Date.now() };
          authedDestRef.current = unauth;
          router.replace(unauth as any);
          setTimeout(() => setAuthResolved(true), 80);
          return;
        }

        // Claim the auth identity now, before the awaited fetches below.
        // supabase-js can fire a racing SIGNED_IN during cold start; the
        // root listener's identity guard reads this ref to recognize that
        // re-emit as "already in app" instead of treating it as a fresh
        // login and double-routing. Cleared again if the user turns out
        // banned / profile-less below.
        authedUserIdRef.current = session.user.id;
        authIdentityRef.current.userId = session.user.id;

        // Apple ban check + profile fetch run in parallel — both are
        // independent of each other and the ban check is a single RPC,
        // so we save one network RTT vs sequential awaits. If the user
        // is banned we still sign them out before honoring the profile.
        const fetchProfileWithRetry = async (): Promise<{ profile: any | null; transient: boolean }> => {
          let transient = false;
          for (let attempt = 0; attempt < 2; attempt++) {
            const { data, error: e } = await withTimeout(
              supabase
                .from('profiles')
                .select('onboarding_status, referral_source')
                .eq('id', session.user.id)
                .single(),
              4000,
              { data: null, error: { message: 'timeout' } } as any,
            );
            if (!e && data) return { profile: data as any, transient: false };
            // PGRST116 = no row: a genuinely missing profile (not transient).
            // Anything else (timeout / network) is transient and must NOT be
            // treated as a signed-out user.
            if (e && (e as any).code === 'PGRST116') return { profile: null, transient: false };
            transient = true;
            if (attempt === 0) await new Promise(r => setTimeout(r, 1500));
          }
          return { profile: null, transient };
        };
        const [isBanned, profileResult, needsPhone] = await Promise.all([
          // Fail-open on timeout: a flaky network must not freeze or log
          // out legit returning users. Bans stay enforced server-side
          // (check_banned_at_signup trigger + admin_ban_user RPC).
          withTimeout(isBannedAppleUser(session.user), 4000, false),
          fetchProfileWithRetry(),
          // Definite server-truthed gate signal. Fails CLOSED (false) on any
          // error/timeout, so a stale/slow session never gates a verified user.
          fetchNeedsPhoneMigration(),
        ]);
        const profileData = profileResult.profile;

        if (!isCurrent()) return;

        if (isBanned) {
          await withTimeout(supabase.auth.signOut(), 3000, undefined as any);
          if (!isCurrent()) return;
          authedUserIdRef.current = null;
          setAuthedUserId(null);
          const unauth = unauthedRoute();
          lastNavRef.current = { dest: unauth, ts: Date.now() };
          router.replace(unauth as any);
          setTimeout(() => setAuthResolved(true), 80);
          return;
        }

        if (!profileData) {
          if (profileResult.transient) {
            // Transient profile read failure (timeout/network), NOT a missing
            // account. The session is valid: keep the user authed and route by
            // the definite gate signal instead of bouncing them to the login
            // screen (a false logout). The profile hydrates on the next fetch.
            setAuthedUserId(session.user.id);
            const dest = needsPhone ? '/migration-gate' : '/(tabs)/plans';
            lastNavRef.current = { dest, ts: Date.now() };
            authedDestRef.current = dest;
            router.replace(dest as any);
            setTimeout(() => setAuthResolved(true), 80);
            return;
          }
          // Genuinely no profile row: treat as unauthed.
          authedUserIdRef.current = null;
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
          needs_phone_migration: needsPhone,
        });
        lastNavRef.current = { dest, ts: Date.now() };
        authedDestRef.current = dest;
        // Navigate first, then lift the overlay (prevents a 1-frame flash
        // where the splash is gone but the destination hasn't rendered yet).
        router.replace(dest as any);
        setTimeout(() => setAuthResolved(true), 80);
      } catch {
        if (isCurrent()) {
          clearTimeout(authWatchdog);
          setAuthCheckFailed(true);
          setAuthResolved(true);
        }
      }
    }

    retryAuthCheckRef.current = () => {
      if (cancelled) return;
      initialAccountCheckPending = true;
      setAuthCheckFailed(false);
      setAuthResolved(false);
      void checkAuth();
    };
    void checkAuth();

    // Keep listening for sign-in/out and password recovery after initial load
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      // The independent cold-start check owns INITIAL_SESSION. Treating it
      // as an account change would cancel that check before either can route.
      if (cancelled || event === 'INITIAL_SESSION') return;
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'PASSWORD_RECOVERY') setAuthCheckFailed(false);
      // A refresh can finish the unresolved cold-start read. Defer the same
      // startup gates until Supabase releases its auth callback lock.
      if (event === 'TOKEN_REFRESHED' && session?.user && initialAccountCheckPending) {
        const timer = setTimeout(() => {
          deferredAuthTimers.delete(timer);
          if (!cancelled && initialAccountCheckPending) void checkAuth({ data: { session }, error: null });
        }, 0);
        deferredAuthTimers.add(timer);
        return;
      }
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'PASSWORD_RECOVERY') initialAccountCheckPending = false;
      const userId = session?.user.id ?? null;
      if (event === 'SIGNED_OUT' || event === 'PASSWORD_RECOVERY'
        || authIdentityRef.current.userId !== userId) {
        authIdentityRef.current = { userId, revision: authIdentityRef.current.revision + 1 };
        authedDestRef.current = '';
      }
      const identity = authIdentityRef.current;
      const isCurrent = () => !cancelled && !isRecoveryRef.current && authIdentityRef.current === identity;
      const previousVerification = getVerificationDestination();
      if (event === 'PASSWORD_RECOVERY') cancelVerificationDestination();
      const verificationVisit = event === 'PASSWORD_RECOVERY' ? null : observeVerificationAccount(userId);
      if (previousVerification && !getVerificationDestination()) pendingDeepLinkRef.current = null;
      if (event === 'PASSWORD_RECOVERY') {
        isRecoveryRef.current = true;
        setAuthResolved(true);
        router.replace('/reset-password');
        return;
      }
      if (isRecoveryRef.current && event !== 'SIGNED_OUT') return;
      if (event !== 'SIGNED_IN' && event !== 'SIGNED_OUT'
        && event !== 'TOKEN_REFRESHED' && event !== 'USER_UPDATED' && !verificationVisit) return;
      if (!session?.user) {
        if ((event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') && !verificationVisit) return;
        // Did they choose this? A deliberate exit stamps navState immediately
        // before signOut(); anything else is a session that died on its own.
        const deliberate = Date.now() - deliberateSignOutAt.ts < 1500;

        if (deliberate) {
          // chosen exit: forget the device and land cold, as before
          forgetAccount();
          pendingDeepLinkRef.current = null;
        } else {
          // The session died under them. Two things must survive it.
          //
          // 1. Where they were going. This used to be nulled here, which is
          //    why a buyer coming back from Stripe lost the order screen on
          //    top of losing the session.
          const href = pendingDeepLinkRef.current;
          if (href) stashPendingDestination(href);
          pendingDeepLinkRef.current = null;
          // 2. The fact that an account exists on this device, so
          //    /phone-entry can offer to sign back in instead of offering to
          //    make a second account (the duplicate-account defect).
          Sentry.captureMessage('auth: involuntary sign out', {
            level: 'warning',
            tags: { area: 'auth' },
            extra: {
              app_state: AppState.currentState,
              had_pending_destination: !!href,
              last_known_user: authedUserIdRef.current ?? null,
            },
          });
        }

        authedUserIdRef.current = null;
        setAuthedUserId(null);
        const unauth = unauthedRoute();
        authedDestRef.current = unauth;
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


      // Auth listeners run while Supabase holds its session lock. Return
      // synchronously before any profile/RPC/ban read can re-enter getSession.
      const timer = setTimeout(() => {
        deferredAuthTimers.delete(timer);
        if (!isCurrent()) return;
        void (async () => {
          // Auto-correct anyone TRANSIENTLY gated: when a fresh token or updated
          // user arrives and they are sitting on the migration gate but no longer
          // need it, route them out. Never NEWLY gate on a refresh.
          if ((event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') && !verificationVisit) {
            if (session?.user && pathnameRef.current === '/migration-gate') {
              const stillNeeds = await fetchNeedsPhoneMigration();
              if (!isCurrent()) return;
              if (!stillNeeds) {
                const data = await withTimeout(getAuthProfile(queryClient, session.user.id), 4000, null);
                if (!isCurrent()) return;
                const dest = authedDest({
                  onboarding_status: data?.onboarding_status,
                  referral_source: data?.referral_source,
                  needs_phone_migration: false,
                });
                lastNavRef.current = { dest, ts: Date.now() };
                authedDestRef.current = dest;
                router.replace(dest as any);
              }
            }
            return;
          }
          if (event !== 'SIGNED_IN' && event !== 'SIGNED_OUT' && !verificationVisit) return;

          // Best-effort: consume a referral code captured while signed out
          // (QR/link scanned before auth). Fire-and-forget; fully self-
          // contained and error-swallowed so it cannot affect routing below.
          if (YOURS_PAGE_ENABLED && event === 'SIGNED_IN') {
            consumePendingReferral();
          }

          // A ticket-transfer code stashed while signed out (item 15, draft,
          // not yet backed by an applied migration) cannot resolve itself like
          // a referral -- claiming needs the recipient's fresh answers first --
          // so this only routes back to the claim screen, it does not push()
          // the primary auth-destination replace() above. NOT verified against
          // a real device: this touches the same auth-routing file responsible
          // for the 2026-08-31 signup regression, so treat this block as
          // needing its own real sign-in walkthrough before it ships, same bar
          // as everything else in this function.
          if (event === 'SIGNED_IN') {
            pendingTransferRoute().then((route) => {
              if (route && isCurrent() && !getVerificationDestination()) router.push(route as never);
            }).catch(() => {});
          }

          // Remember that an account lives on this device (never a token, just
          // the number), so a session that dies later can offer to sign back in
          // rather than offering to make a second account.
          if (event === 'SIGNED_IN' && session?.user?.phone) {
            rememberAccount(session.user.phone);
          }


          // Apple ban check — same safety net as checkAuth. Belt-and-suspenders
          // against the tiny window where SIGNED_IN fires after a fresh Apple
          // sign-in but before signInWithApple's own ban check has a chance to
          // run. Also catches any reauthentication flow that bypasses socialAuth.
          const isBanned = await withTimeout(isBannedAppleUser(session.user), 4000, false);
          if (!isCurrent()) return;
          if (isBanned) {
            if (verificationVisit) cancelVerificationDestination(verificationVisit);
            await withTimeout(supabase.auth.signOut(), 3000, undefined as any);
            if (!isCurrent()) return;
            authedUserIdRef.current = null;
            setAuthedUserId(null);
            const unauth = unauthedRoute();
            lastNavRef.current = { dest: unauth, ts: Date.now() };
            authedDestRef.current = unauth;
            router.replace(unauth as any);
            return;
          }

          // Verify-code owns its 600ms success hold and destination proposal.
          // Approve this visit's ban check without preempting that hold; the
          // root handoff above commits the proposal and waits for the tabs gate.
          approveVerificationDestination(verificationVisit, session.user.id);
          if (verificationVisit || verifyCodeSelfRoutingRef.current || pathnameRef.current === '/verify-code') {
            // Claim the identity while verification finishes, so
            // the post-verify SIGNED_IN re-emits are recognized as re-emits
            // and don't bounce the user back through authedDest.
            authedUserIdRef.current = session.user.id;
            setAuthedUserId(session.user.id);
            setAuthResolved(true);
            return;
          }

          // Re-emitted SIGNED_IN for the user already in the app (foreground /
          // session recovery), NOT a deliberate login. Do not re-run the phone
          // gate / re-route mid-session. The 5s lastNavRef dedup below is too
          // short to catch a refire minutes into a session.
          if (authedUserIdRef.current === session.user.id) {
            setAuthedUserId(session.user.id);
            setAuthResolved(true);
            return;
          }

          try {
            // Reuse the shared auth-profile cache (seeded by cold-start checkAuth)
            // so SIGNED_IN doesn't fire a duplicate select within the 60s stale
            // window. Falls back to a network fetch if the cache is empty/stale.
            const [data, needsPhone] = await Promise.all([
              withTimeout(getAuthProfile(queryClient, session.user.id), 4000, null),
              fetchNeedsPhoneMigration(),
            ]);
            if (!isCurrent()) return;
            const dest = authedDest({
              onboarding_status: data?.onboarding_status,
              referral_source: data?.referral_source,
              needs_phone_migration: needsPhone,
            });
            const now = Date.now();
            // Genuine fresh login committed — claim the identity so any
            // SIGNED_IN re-emit later this session is treated as a re-emit.
            authedUserIdRef.current = session.user.id;
            if (dest === lastNavRef.current.dest && now - lastNavRef.current.ts < 5000) {
              authedDestRef.current = dest;
              setAuthedUserId(session.user.id);
              setAuthResolved(true);
              return;
            }
            lastNavRef.current = { dest, ts: now };
            authedDestRef.current = dest;
            setAuthedUserId(session.user.id);
            router.replace(dest as any);
            setTimeout(() => { if (isCurrent()) setAuthResolved(true); }, 80);
          } catch {
            if (!isCurrent()) return;
            // Profile fetch failed — navigate to plans as fallback so user isn't stuck
            authedUserIdRef.current = session.user.id;
            setAuthedUserId(session.user.id);
            lastNavRef.current = { dest: '/(tabs)/plans', ts: Date.now() };
            authedDestRef.current = '/(tabs)/plans';
            router.replace('/(tabs)/plans' as any);
            setTimeout(() => { if (isCurrent()) setAuthResolved(true); }, 80);
          }
        })().catch((error) => {
          if (isCurrent()) logError(error, 'layout.authStateHandoff');
        });
      }, 0);
      deferredAuthTimers.add(timer);
    });

    return () => {
      cancelled = true;
      retryAuthCheckRef.current = null;
      clearTimeout(authWatchdog);
      deferredAuthTimers.forEach(clearTimeout);
      deferredAuthTimers.clear();
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
        <Stack.Screen name="waitlist/[id]" options={{ headerShown: false, gestureEnabled: true }} />
        <Stack.Screen name="event/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="album/[eventId]" options={{ headerShown: false, gestureEnabled: true, fullScreenGestureEnabled: true }} />
        <Stack.Screen name="album/upload/[eventId]" options={{ headerShown: false, gestureEnabled: true, fullScreenGestureEnabled: true }} />
        <Stack.Screen name="admin/events" options={{ headerShown: false }} />
        <Stack.Screen name="admin/applications" options={{ headerShown: false }} />
        <Stack.Screen name="(creator)" options={{ headerShown: false }} />
        <Stack.Screen name="creator/apply" options={{ headerShown: false, gestureEnabled: true }} />
        <Stack.Screen name="creator/apply-events" options={{ headerShown: false, gestureEnabled: true }} />
        <Stack.Screen name="creator/apply-community" options={{ headerShown: false, gestureEnabled: true }} />
        <Stack.Screen name="creator/edit-page" options={{ headerShown: false, gestureEnabled: true }} />
        <Stack.Screen name="creator/join-gate" options={{ headerShown: false, gestureEnabled: true }} />
        <Stack.Screen name="creator/event-form" options={{ headerShown: false, gestureEnabled: true }} />
        <Stack.Screen name="creator/tickets" options={{ headerShown: false, gestureEnabled: true }} />
        <Stack.Screen name="creator/attendees" options={{ headerShown: false, gestureEnabled: true }} />
        {/* O-09: was "creator/door" -- renamed, this route is reachable by producers */}
        <Stack.Screen name="creator/check-in" options={{ headerShown: false, gestureEnabled: true }} />
        <Stack.Screen name="creator/member/[id]" options={{ headerShown: false, gestureEnabled: true }} />
        <Stack.Screen name="event-album/[topicId]" options={{ headerShown: false, gestureEnabled: true }} />
        <Stack.Screen name="tickets/index" options={{ headerShown: false, gestureEnabled: true }} />
        <Stack.Screen name="tickets/order/[id]" options={{ headerShown: false, gestureEnabled: true }} />
        <Stack.Screen name="community" options={{ headerShown: false, gestureEnabled: true }} />
        <Stack.Screen name="organization/[id]" options={{ headerShown: false, gestureEnabled: true }} />
        <Stack.Screen name="community-thread" options={{ headerShown: false, gestureEnabled: true }} />
        <Stack.Screen name="community-topic" options={{ headerShown: false, gestureEnabled: true }} />
      </Stack>
      {(!authResolved || authCheckFailed) && (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 999, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.parchment }}>
          {authCheckFailed ? <View style={{ padding: 24, alignItems: 'center', gap: 16 }}>
            <Text accessibilityRole="alert" style={{ color: Colors.terracotta, fontSize: 18, textAlign: 'center' }}>We couldn’t check your account.</Text>
            <Text style={{ fontSize: 16, textAlign: 'center' }}>Check your connection and try again.</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Retry account check" onPress={() => retryAuthCheckRef.current?.()}
              style={{ minHeight: 48, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 24, backgroundColor: Colors.terracotta }}>
              <Text style={{ color: '#fff', fontSize: 16 }}>Try again</Text>
            </Pressable>
          </View> : <ActivityIndicator size="large" color={Colors.terracotta} />}
        </View>
      )}
      {/* Root modals, in precedence order, mutually exclusive and serialized by
          the sequencer (modalLocked) so exactly one is ever mounted. survey is
          top precedence; each lower one waits for the higher decisions
          (reviewCheckDone) and for the one-frame handoff after a close. */}
      {surveyPlan && authedUserId && (
        <PostPlanSurvey
          visible={!!surveyPlan}
          plan={surveyPlan}
          members={surveyMembers}
          userId={authedUserId}
          onComplete={(topRated) => {
            handoffModal(() => setSurveyPlan(null));
            // TOP rating: fire the native review ask after this modal unmounts.
            if (topRated) fireReviewAfterSurvey();
          }}
        />
      )}
      {authedUserId && reviewCheckDone && !surveyPlan && !reviewSheetPending && !modalLocked && (
        <AlbumUploadPromptModal userId={authedUserId} />
      )}
      <KeyboardDoneBar />
      {authedUserId && surveyCheckDone && reviewCheckDone && !surveyPlan && !reviewSheetPending && !modalLocked && (
        <MarkEarnedModal userId={authedUserId} />
      )}
      {pushPrimerVisible && (
        <PushPrimerModal
          visible
          {...(renderedPushPrimerVisit?.reason ? {
            ...planNotificationPromptCopy(renderedPushPrimerVisit.reason),
            enableLabel: renderedPushPrimerVisit.settings ? 'Open settings' : 'Turn on notifications',
            enableAccessibilityLabel: renderedPushPrimerVisit.settings ? 'Open settings' : 'Turn on notifications',
            pendingLabel: renderedPushPrimerVisit.settings ? 'Opening…' : 'Turning on…',
            pendingAccessibilityLabel: renderedPushPrimerVisit.settings ? 'Opening settings' : 'Turning on notifications',
          } : {})}
          pending={pushPrimerPending}
          feedback={pushPrimerFeedback}
          appearance={COMMUNITY_CHAT_GROUPING_ENABLED ? { fonts: primerFonts } : undefined}
          onEnable={enablePushPrimer}
          onDismiss={dismissPushPrimer}
        />
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
