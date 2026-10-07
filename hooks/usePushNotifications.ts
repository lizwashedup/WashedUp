import { LOCAL_DEVELOPMENT_ONLY } from '../constants/LocalDevelopment';
import { useEffect, useRef, useState } from 'react';
import { OneSignal, OSNotificationPermission } from '../lib/oneSignalShim';
import { AppState, Platform } from 'react-native';
import Constants from 'expo-constants';
import { supabase } from '../lib/supabase';
import { requestWithDeadline } from '../lib/requestWithDeadline';

// Native status/registration transport must release failed attempts for retry.
// The OS permission decision itself stays open for the person to answer.
const pushRead = <T,>(request: PromiseLike<T>) => requestWithDeadline(request, 12_000);

// Singleton ready promise. Resolves true once OneSignal.initialize has been
// called and the native bridge has had a tick to settle. Resolves false if
// the app id is missing or initialize threw. All OneSignal access in this
// module (and the click listener in app/_layout.tsx) gates on this promise
// so we never call into the native SDK before initWithContext has run on
// Android.
//
// OneSignal App ID. Prefer the build-time env var (EAS Secret / .env), but fall
// back to the known production App ID so a missing OR BLANK env var can NEVER
// silently disable push again. (2026-06: an env-var drop shipped appId='' in
// build 27 and every OTA after it, so OneSignal.initialize never ran -> ~0%
// push registration fleet-wide for 9 days. This mirrors the URL/anon-key
// fallback in lib/supabase.ts.) The App ID is a PUBLIC identifier (it ships in
// the client and rides in every notification payload), not a secret.
const DEFAULT_ONESIGNAL_APP_ID = 'fc98cc7c-b325-4a45-b3d2-19527c280fca';

let readyPromise: Promise<boolean> | null = null;

export type PushRegistrationResult =
  | { status: 'registered'; subscriptionId: string }
  | { status: 'permission-denied' | 'permission-required' | 'opted-out' | 'pending' | 'failed' | 'obsolete' | 'unavailable' };

export type PushRegistrationOptions = {
  prompt?: boolean;
  userId?: string | null;
  // Caller-owned visit guard, checked immediately before opening/joining an
  // OS request. It does not cancel permission that has already been requested.
  canPrompt?: () => boolean;
};

type PushIdentity = {
  userId: string | null;
  isCurrent: () => boolean;
  registrations: Map<string | (() => boolean), Promise<PushRegistrationResult>>;
  writes: Map<string, Promise<boolean>>;
  subscription: { id: string | null; optedIn: boolean } | null;
  subscriptionWaiters: Set<(subscription: { id: string | null; optedIn: boolean }) => void>;
  reconciliation: Promise<void> | null;
};

// The root is the single identity owner. Object identity also distinguishes
// A → B → A: an old callback can never become current merely by matching A.
let currentIdentity: PushIdentity | null = null;
let identityRevision = 0;
let sdkUserId: string | null | undefined;
let permissionRequest: Promise<boolean | null> | null = null;

export function initOneSignal(): Promise<boolean> {
  // Master web guard: OneSignal's RN SDK is native-only. Resolving false here
  // means every path that funnels through ensureOneSignalReady() (the hook,
  // registerForPushNotifications, getPushPermissionStatus, the chat banner,
  // profile settings) becomes a guaranteed no-op on web with zero SDK calls.
  if (LOCAL_DEVELOPMENT_ONLY || Platform.OS === 'web') {
    readyPromise = Promise.resolve(false);
    return readyPromise;
  }
  if (readyPromise) return readyPromise;
  // Use || (NOT ??) so a present-but-BLANK env var ('') also falls through to
  // the hardcoded default. '' ?? DEFAULT returns '', which is the silent
  // empty-appId failure this fallback exists to prevent.
  const envAppId =
    Constants.expoConfig?.extra?.oneSignalAppId ||
    process.env.EXPO_PUBLIC_ONESIGNAL_APP_ID ||
    null;
  const appId = envAppId || DEFAULT_ONESIGNAL_APP_ID;
  if (!envAppId && __DEV__) {
    console.warn(
      '[PushNotifications] EXPO_PUBLIC_ONESIGNAL_APP_ID missing or blank; using hardcoded fallback App ID.',
    );
  }
  if (!appId) {
    readyPromise = Promise.resolve(false);
    return readyPromise;
  }
  const attempt = Promise.resolve().then(async () => {
    try {
      OneSignal.initialize(appId);
      // Yield to the native bridge before any caller touches the SDK.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      return true;
    } catch (err) {
      if (__DEV__) console.warn('[PushNotifications] OneSignal.initialize failed:', err);
      return false;
    }
  });
  readyPromise = attempt;
  void attempt.then((ready) => {
    // A synchronous bridge failure must not disable push for this entire
    // runtime. Retry only on a later caller; no background retry/prompt loop.
    if (!ready && readyPromise === attempt) readyPromise = null;
  });
  return attempt;
}

export function ensureOneSignalReady(): Promise<boolean> {
  return readyPromise ?? initOneSignal();
}

function devicePlatform(): 'ios' | 'android' | 'web' | null {
  if (Platform.OS === 'ios') return 'ios';
  if (Platform.OS === 'android') return 'android';
  if (Platform.OS === 'web') return 'web';
  return null;
}

async function bindIdentity(identity: PushIdentity): Promise<boolean> {
  if (!identity.isCurrent() || !(await ensureOneSignalReady()) || !identity.isCurrent()) return false;
  try {
    if (sdkUserId !== identity.userId) {
      if (identity.userId) OneSignal.login(identity.userId);
      else OneSignal.logout();
      sdkUserId = identity.userId;
    }
    return identity.isCurrent();
  } catch (err) {
    if (__DEV__) console.warn('[PushNotifications] OneSignal identity update failed:', err);
    return false;
  }
}

function unlinkRetiredIdentity(revision: number) {
  // No auth reads or awaited work in the auth callback itself. A new root
  // identity supersedes this queued logout before it can unlink that user.
  void ensureOneSignalReady().then((ready) => {
    if (!ready || identityRevision !== revision || currentIdentity) return;
    try {
      if (sdkUserId !== null) OneSignal.logout();
      sdkUserId = null;
    } catch (err) {
      if (__DEV__) console.warn('[PushNotifications] OneSignal.logout failed:', err);
    }
  });
}

function upsertDeviceToken(identity: PushIdentity, playerId: string): Promise<boolean> {
  const platform = devicePlatform();
  const canWrite = () => identity.isCurrent() && (!identity.subscription || (identity.subscription.optedIn && identity.subscription.id === playerId));
  if (!canWrite() || !identity.userId || !platform || platform === 'web') return Promise.resolve(false);
  const existing = identity.writes.get(playerId);
  if (existing) return existing;
  const task = Promise.resolve().then(async () => {
    if (!canWrite()) return false;
    try {
      const { error } = await requestWithDeadline(supabase.from('device_tokens').upsert(
        {
          user_id: identity.userId,
          platform,
          onesignal_player_id: playerId,
          last_seen_at: new Date().toISOString(),
          // This write only runs after the native SDK reports both OS
          // permission and an opted-in subscription for this exact ID. Clear a
          // stale provider-disabled snapshot immediately after a user repairs
          // permission in Settings instead of waiting for the next sync job.
          push_enabled: true,
          enabled_synced_at: new Date().toISOString(),
        },
        { onConflict: 'onesignal_player_id' },
      ), 12_000);
      if (!canWrite()) return false;
      if (error) {
        // The same physical installation can move from account A to B after a
        // OneSignal login. RLS correctly prevents B from overwriting A's row,
        // so let the authenticated edge function verify OneSignal's current
        // external_id before atomically transferring ownership. Never loosen
        // the owner-only device_tokens policies in the client.
        const { data, error: claimError } = await requestWithDeadline(
          supabase.functions.invoke('claim-push-subscription', {
            body: { subscriptionId: playerId, platform },
          }),
          12_000,
        );
        if (!canWrite()) return false;
        if (claimError || data?.status !== 'claimed') {
          console.error(
            '[PushNotifications] Failed to claim device token:',
            claimError?.message ?? data?.status ?? error.message,
            error.code ?? '',
          );
          return false;
        }
      }
      return true;
    } catch (err) {
      if (identity.isCurrent() && __DEV__) console.warn('[PushNotifications] Token registration failed:', err);
      return false;
    }
  });
  identity.writes.set(playerId, task);
  void task.then(() => { if (identity.writes.get(playerId) === task) identity.writes.delete(playerId); });
  return task;
}

function publishSubscription(
  identity: PushIdentity,
  subscription: { id: string | null; optedIn: boolean },
) {
  if (!identity.isCurrent()) return;
  identity.subscription = subscription;
  for (const resolve of [...identity.subscriptionWaiters]) resolve(subscription);
}

function reconcileSubscription(identity: PushIdentity): Promise<void> {
  if (!identity.isCurrent() || !identity.userId) return Promise.resolve();
  if (identity.reconciliation) return identity.reconciliation;
  const task = Promise.resolve().then(async () => {
    if (!(await bindIdentity(identity)) || !identity.isCurrent()) return;
    try {
      const observed = identity.subscription;
      const [hasPermission, id, optedIn] = await Promise.all([
        pushRead(OneSignal.Notifications.getPermissionAsync()),
        pushRead(OneSignal.User.pushSubscription.getIdAsync()),
        pushRead(OneSignal.User.pushSubscription.getOptedInAsync()),
      ]);
      if (!identity.isCurrent() || identity.subscription !== observed) return;
      if (typeof hasPermission !== 'boolean' || typeof optedIn !== 'boolean') return;
      if (id !== null && typeof id !== 'string') return;
      const next = { id: id || null, optedIn: hasPermission && optedIn };
      publishSubscription(identity, next);
      if (next.id && next.optedIn) await upsertDeviceToken(identity, next.id);
    } catch {
      // A later SDK observer, foreground transition, or manual action retries.
    }
  });
  identity.reconciliation = task;
  void task.finally(() => {
    if (identity.reconciliation === task) identity.reconciliation = null;
  });
  return task;
}

async function waitForSubscription(
  identity: PushIdentity,
  observed: PushIdentity['subscription'],
  timeoutMs = 6_000,
): Promise<{ id: string | null; optedIn: boolean } | null> {
  if (!identity.isCurrent()) return null;
  if (identity.subscription !== observed) return identity.subscription;
  return new Promise((resolve) => {
    let finished = false;
    const finish = (value: { id: string | null; optedIn: boolean } | null) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      identity.subscriptionWaiters.delete(onChange);
      resolve(value);
    };
    const onChange = (value: { id: string | null; optedIn: boolean }) => finish(value);
    identity.subscriptionWaiters.add(onChange);
    const timer = setTimeout(
      () => finish(identity.isCurrent() && identity.subscription !== observed ? identity.subscription : null),
      timeoutMs,
    );
    if (identity.subscription !== observed || !identity.isCurrent()) finish(identity.subscription);
  });
}

export function usePushNotifications(
  userId?: string | null,
  options: { identityResolved?: boolean } = {},
) {
  const identityResolved = options.identityResolved ?? userId !== undefined;
  const latest = useRef({ userId, identityResolved });
  latest.current = { userId, identityResolved };
  const owned = useRef<PushIdentity | null>(null);
  const observedAuth = useRef<{ userId: string | null } | null>(null);
  const [authRevision, setAuthRevision] = useState(0);

  useEffect(() => {
    if (LOCAL_DEVELOPMENT_ONLY || Platform.OS === 'web') return;
    let active = true;
    // Keep this observer alive after retiring a binding. Auth can go
    // A → B → A before React commits either new root identity; that still
    // requires a fresh A visit, not revival of the first A's callbacks.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      const nextId = session?.user.id ?? null;
      if (observedAuth.current?.userId === nextId) return;
      observedAuth.current = { userId: nextId };
      const identity = owned.current;
      if (identity?.userId === nextId && identity.isCurrent()) return;
      owned.current = null;
      if (identity && currentIdentity === identity) {
        currentIdentity = null;
        unlinkRetiredIdentity(++identityRevision);
      }
      setAuthRevision((revision) => revision + 1);
    });
    return () => { active = false; subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (LOCAL_DEVELOPMENT_ONLY || Platform.OS === 'web' || !identityResolved) return;
    // A resolved root prop must not reclaim a departed account while the
    // root resolver is still awaiting the replacement account's profile.
    if (observedAuth.current && observedAuth.current.userId !== (userId ?? null)) return;
    let cancelled = false;
    let attached: ((event: any) => void) | null = null;
    let permissionAttached: ((granted: boolean) => void) | null = null;
    let userAttached: ((event: any) => void) | null = null;
    let appStateSubscription: { remove: () => void } | null = null;
    const identity: PushIdentity = {
      userId: userId ?? null,
      isCurrent: () => !cancelled && owned.current === identity && currentIdentity === identity && latest.current.identityResolved && latest.current.userId === userId,
      registrations: new Map(),
      writes: new Map(),
      subscription: null,
      subscriptionWaiters: new Set(),
      reconciliation: null,
    };
    owned.current = identity;
    currentIdentity = identity;
    identityRevision++;

    const onSubscriptionChange = (event: any) => {
      if (!identity.isCurrent() || typeof event?.current?.optedIn !== 'boolean') return;
      const id = event?.current?.id;
      const optedIn = event?.current?.optedIn;
      publishSubscription(identity, { id: typeof id === 'string' && id ? id : null, optedIn });
      if (typeof id === 'string' && id && optedIn === true) {
        void upsertDeviceToken(identity, id);
      }
    };

    const onPermissionChange = (_granted: boolean) => {
      if (identity.isCurrent()) void reconcileSubscription(identity);
    };

    const onUserChange = (event: any) => {
      if (!identity.isCurrent()) return;
      const externalId = event?.current?.externalId;
      if (!externalId || externalId === identity.userId) void reconcileSubscription(identity);
    };

    void bindIdentity(identity).then(async (bound) => {
      if (!bound || !identity.isCurrent() || !identity.userId) return;
      try {
        OneSignal.User.pushSubscription.addEventListener('change', onSubscriptionChange);
        attached = onSubscriptionChange;
      } catch (err) {
        if (__DEV__) console.warn('[PushNotifications] addEventListener failed:', err);
      }
      try {
        OneSignal.Notifications.addEventListener('permissionChange', onPermissionChange);
        permissionAttached = onPermissionChange;
      } catch (err) {
        if (__DEV__) console.warn('[PushNotifications] permission observer failed:', err);
      }
      try {
        OneSignal.User.addEventListener('change', onUserChange);
        userAttached = onUserChange;
      } catch (err) {
        if (__DEV__) console.warn('[PushNotifications] user observer failed:', err);
      }
      if (AppState?.addEventListener) {
        appStateSubscription = AppState.addEventListener('change', (state) => {
          if (state === 'active' && identity.isCurrent()) void reconcileSubscription(identity);
        });
      }
      try {
        const observed = identity.subscription;
        const [id, optedIn] = await Promise.all([
          pushRead(OneSignal.User.pushSubscription.getIdAsync()),
          pushRead(OneSignal.User.pushSubscription.getOptedInAsync()),
        ]);
        // A subscription event is newer than this initial read, including an
        // opt-out or token rotation while the bridge response was pending.
        if (!identity.isCurrent() || identity.subscription !== observed) return;
        publishSubscription(identity, { id, optedIn });
        if (id && optedIn) await upsertDeviceToken(identity, id);
      } catch { /* Subscription changes and explicit registration can retry. */ }
    });

    return () => {
      cancelled = true;
      if (owned.current === identity) owned.current = null;
      if (currentIdentity === identity) {
        currentIdentity = null;
        identityRevision++;
      }
      if (attached) {
        try {
          OneSignal.User.pushSubscription.removeEventListener('change', attached);
        } catch {}
      }
      if (permissionAttached) {
        try { OneSignal.Notifications.removeEventListener('permissionChange', permissionAttached); } catch {}
      }
      if (userAttached) {
        try { OneSignal.User.removeEventListener('change', userAttached); } catch {}
      }
      appStateSubscription?.remove();
      identity.subscriptionWaiters.clear();
    };
  }, [userId, identityResolved, authRevision]);

  return {};
}

// Status helper for entry points that branch on 'granted'/'denied'/'undetermined'
// (e.g. profile settings showing "open Settings" only on hard denial). Maps
// OneSignal's permissionNative values to the legacy three-state shape.
export type PushPermissionStatus = 'granted' | 'provisional' | 'denied' | 'undetermined';

export async function getPushPermissionStatus(): Promise<PushPermissionStatus> {
  if (!(await ensureOneSignalReady())) return 'undetermined';
  try {
    const native = await pushRead(OneSignal.Notifications.permissionNative());
    if (
      native === OSNotificationPermission.Authorized ||
      native === OSNotificationPermission.Ephemeral
    ) {
      return 'granted';
    }
    if (native === OSNotificationPermission.Provisional) return 'provisional';
    if (native === OSNotificationPermission.Denied) return 'denied';
    return 'undetermined';
  } catch {
    return 'undetermined';
  }
}

export type PushPromptPermission = 'requestable' | 'granted' | 'provisional' | 'denied' | 'unavailable';

// Read permission only. A contextual invitation may offer Settings after a
// confirmed denial, while the cold-launch primer remains first-request only.
export async function getPushPromptPermission(): Promise<PushPromptPermission> {
  const platform = devicePlatform();
  if (LOCAL_DEVELOPMENT_ONLY || (platform !== 'ios' && platform !== 'android')) return 'unavailable';
  try {
    if (!(await ensureOneSignalReady())) return 'unavailable';
    if (platform === 'android') {
      // Android's native Denied enum also represents an unasked permission.
      const hasPermission = await pushRead(OneSignal.Notifications.getPermissionAsync());
      if (hasPermission === true) return 'granted';
      if (hasPermission !== false) return 'unavailable';
      const canRequest = await pushRead(OneSignal.Notifications.canRequestPermission());
      if (canRequest === true) return 'requestable';
      if (canRequest === false) return 'denied';
      return 'unavailable';
    }
    const native = await pushRead(OneSignal.Notifications.permissionNative());
    if (typeof native !== 'number') return 'unavailable';
    if (native === OSNotificationPermission.NotDetermined) return 'requestable';
    if (native === OSNotificationPermission.Denied) return 'denied';
    if (
      native === OSNotificationPermission.Authorized ||
      native === OSNotificationPermission.Ephemeral
    ) return 'granted';
    if (native === OSNotificationPermission.Provisional) return 'provisional';
    return 'unavailable';
  } catch {
    return 'unavailable';
  }
}

export type PushPrimerEligibility = 'requestable' | 'answered' | 'unavailable';

// Preserve the existing cold-launch policy and its public contract.
export async function getPushPrimerEligibility(): Promise<PushPrimerEligibility> {
  const status = await getPushPromptPermission();
  return status === 'granted' || status === 'provisional' || status === 'denied' ? 'answered' : status;
}

// Structured feedback distinguishes accepting OS permission from completing
// this account's subscription registration. It never changes prompt timing.
export function registerPushNotificationsWithResult(
  options: PushRegistrationOptions = {},
): Promise<PushRegistrationResult> {
  const identity = currentIdentity;
  if (LOCAL_DEVELOPMENT_ONLY || Platform.OS === 'web' || !identity?.userId) return Promise.resolve({ status: 'unavailable' });
  if (!identity.isCurrent() || (options.userId && options.userId !== identity.userId)) return Promise.resolve({ status: 'obsolete' });
  // Separate visits must not inherit another caller's cancelled prompt work.
  const key = options.prompt && options.canPrompt
    ? options.canPrompt
    : `${options.prompt ? 'prompt' : 'passive'}:${options.userId ? 'save' : 'probe'}`;
  const existing = identity.registrations.get(key);
  if (existing) return existing;
  const task = Promise.resolve().then(async (): Promise<PushRegistrationResult> => {
    if (!(await bindIdentity(identity))) return { status: identity.isCurrent() ? 'failed' : 'obsolete' };
    if (!identity.isCurrent()) return { status: 'obsolete' };
    try {
      // Installed SDK's synchronous hasPermission is an initially-false
      // cache; initialization's bridge tick does not await its population.
      const hasPermission = await pushRead(OneSignal.Notifications.getPermissionAsync());
      if (!identity.isCurrent()) return { status: 'obsolete' };
      if (typeof hasPermission !== 'boolean') return { status: 'failed' };
      if (!hasPermission) {
        if (!options.prompt) {
          // Android's installed bridge maps every false permission to
          // Denied, including an unasked prompt. Check prompt availability
          // there before treating permissionNative as confirmed denial.
          if (Platform.OS === 'android') {
            const canRequest = await pushRead(OneSignal.Notifications.canRequestPermission());
            if (!identity.isCurrent()) return { status: 'obsolete' };
            if (canRequest === true) return { status: 'permission-required' };
            if (canRequest !== false) return { status: 'failed' };
          }
          const native = await pushRead(OneSignal.Notifications.permissionNative());
          if (!identity.isCurrent()) return { status: 'obsolete' };
          if (native === OSNotificationPermission.Denied) return { status: 'permission-denied' };
          if (native === OSNotificationPermission.NotDetermined) return { status: 'permission-required' };
          // Inconsistent or unavailable permission reads require retry, not
          // a claim that the person declined or must change Settings.
          return { status: 'failed' };
        }
        // Preserve the queued request boundary, then check both lifetimes
        // without another await before invoking the native prompt. A modal
        // can be dismissed while bindIdentity/permission reads are pending.
        await Promise.resolve();
        if (!identity.isCurrent() || (options.canPrompt && options.canPrompt() !== true)) return { status: 'obsolete' };
        if (!permissionRequest) {
          const request = Promise.resolve(OneSignal.Notifications.requestPermission(true));
          permissionRequest = request;
          void request.then(
            () => { if (permissionRequest === request) permissionRequest = null; },
            () => { if (permissionRequest === request) permissionRequest = null; },
          );
        }
        const granted = await permissionRequest;
        if (!identity.isCurrent()) return { status: 'obsolete' };
        if (granted === false) return { status: 'permission-denied' };
        if (granted !== true) return { status: 'failed' };
      }
      // Honor subscription opt-out independently of OS permission. This
      // path never calls optIn/optOut or changes a user's saved preference.
      const observed = identity.subscription;
      const optedIn = await pushRead(OneSignal.User.pushSubscription.getOptedInAsync());
      if (!identity.isCurrent()) return { status: 'obsolete' };
      if (typeof optedIn !== 'boolean') return { status: 'failed' };
      if (identity.subscription !== observed && identity.subscription?.optedIn !== optedIn) {
        return { status: identity.subscription?.optedIn ? 'pending' : 'opted-out' };
      }
      if (!optedIn) return { status: 'opted-out' };
      let playerId = await pushRead(OneSignal.User.pushSubscription.getIdAsync());
      if (!identity.isCurrent()) return { status: 'obsolete' };
      if (playerId !== null && typeof playerId !== 'string') return { status: 'failed' };
      if (!playerId) {
        const observedSubscription = await waitForSubscription(identity, identity.subscription);
        if (!identity.isCurrent()) return { status: 'obsolete' };
        if (observedSubscription?.optedIn === false) return { status: 'opted-out' };
        playerId = observedSubscription?.id ?? await pushRead(OneSignal.User.pushSubscription.getIdAsync());
      }
      if (!identity.isCurrent()) return { status: 'obsolete' };
      if (playerId !== null && typeof playerId !== 'string') return { status: 'failed' };
      if (!playerId) return { status: 'pending' };
      if (identity.subscription === observed) identity.subscription = { id: playerId, optedIn };
      if (!identity.subscription?.optedIn) return { status: 'opted-out' };
      if (identity.subscription.id !== playerId) return { status: 'pending' };
      if (options.userId && !(await upsertDeviceToken(identity, playerId))) {
        if (!identity.isCurrent()) return { status: 'obsolete' };
        if (!identity.subscription?.optedIn) return { status: 'opted-out' };
        if (identity.subscription.id !== playerId) return { status: 'pending' };
        return { status: 'failed' };
      }
      return identity.isCurrent() ? { status: 'registered', subscriptionId: playerId } : { status: 'obsolete' };
    } catch (err) {
      if (identity.isCurrent() && __DEV__) console.warn('[PushNotifications] Registration failed:', err);
      return { status: identity.isCurrent() ? 'failed' : 'obsolete' };
    }
  });
  identity.registrations.set(key, task);
  void task.then(() => { if (identity.registrations.get(key) === task) identity.registrations.delete(key); });
  return task;
}

// Compatibility for existing callers (including root's primer). New feedback
// should use the structured result: null alone does not establish denial.
export async function registerForPushNotifications(
  options: PushRegistrationOptions = {},
): Promise<string | null> {
  const result = await registerPushNotificationsWithResult(options);
  return result.status === 'registered' ? result.subscriptionId : null;
}
