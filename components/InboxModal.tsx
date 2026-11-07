import { InboxPlanInviteActions } from './InboxPlanInviteActions';
import { InboxNotificationRow } from './InboxNotificationRow';
import { useClearInboxNotifications } from '../hooks/useClearInboxNotifications';
import { useInboxNotificationScope } from '../hooks/useInboxNotificationScope';
import { CommunityJoinInboxRow } from './notifications/CommunityJoinInboxRow';
import { isCommunityJoinNotice } from '../lib/communityJoinNotification';
import { CommunityNoticeInboxRow } from './notifications/CommunityNoticeInboxRow';
import { PageInvitationInboxRow } from './notifications/PageInvitationInboxRow';
import { AttendeeMessageInboxRow } from './notifications/AttendeeMessageInboxRow';
import { requestWithDeadline } from '../lib/requestWithDeadline';
import { readInboxInvitations, readInboxNotifications } from '../lib/inboxReads';
import { PageUpdateInboxRow } from './notifications/PageUpdateInboxRow';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { hapticLight } from '../lib/haptics';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Bell, Clock, Send, X } from 'lucide-react-native';
import * as Notifications from 'expo-notifications';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Colors from '../constants/Colors';
import { Fonts, FontSizes } from '../constants/Typography';
import { supabase } from '../lib/supabase';
import { INBOX_COUNT_KEY, WAITLIST_MANAGER_KEY } from '../constants/QueryKeys';
import { YOURS_PAGE_ENABLED, COMMUNITIES_ENABLED, CREATOR_PAGES_ENABLED } from '../constants/FeatureFlags';
import { useInboxWaitlistException } from '../hooks/useInboxWaitlistException';
import { BrandedAlert, BrandedAlertButton } from './BrandedAlert';
import { ParticipationNotice } from './legal/ParticipationNotice';

/**
 * Yours-system notification types that carry no event_id and resolve on
 * the Yours page (single inbox routes you there; the request banner +
 * swipe stack are waiting). people_ping carries an event_id and keeps
 * falling through to the existing plan-detail routing.
 */
const YOURS_NOTIF_TYPES = new Set([
  'people_request',
  'people_request_accepted',
  'referral_joined',
]);

interface InboxModalProps {
  visible: boolean;
  onClose: () => void;
  userId: string | null;
}

export default function InboxModal({ visible, onClose, userId }: InboxModalProps) {
  const notificationScope = useInboxNotificationScope(userId, visible);
  const queryClient = useQueryClient();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width, fontScale } = useWindowDimensions();
  const stacked = width / fontScale < 300;
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const chatAcknowledgements = useRef(new Set<string>());
  const notificationActions = useRef(new Set<string>());
  const visit = useMemo(() => ({}), [visible, userId]);
  const activeVisit = useRef<object | null>(null);
  const afterDismiss = useRef<{ visit: object; complete: () => void } | null>(null);
  useLayoutEffect(() => {
    activeVisit.current = visit;
    closingRef.current = false;
    afterDismiss.current = null;
    notificationActions.current = new Set();
    setClosing(false);
    return () => { activeVisit.current = null; afterDismiss.current = null; };
  }, [visit]);
  const finishDismissal = useCallback(() => {
    const pending = afterDismiss.current;
    if (!pending || pending.visit !== visit || activeVisit.current !== visit) return;
    afterDismiss.current = null;
    pending.complete();
  }, [visit]);
  const requestClose = useCallback((route?: string) => {
    if (!visible || activeVisit.current !== visit || closingRef.current) return;
    if (route && !notificationScope.isCurrent()) return;
    closingRef.current = true;
    afterDismiss.current = { visit, complete: () => {
      onClose();
      if (route && notificationScope.isCurrent()) router.push(route as never);
    } };
    setClosing(true);
    if (Platform.OS !== 'ios') finishDismissal();
  }, [visible, visit, notificationScope, onClose, router, finishDismissal]);
  const navigateAfterDismiss = useCallback((route: string) => requestClose(route), [requestClose]);
  const [alertInfo, setAlertInfo] = useState<{ title: string; message: string; buttons?: BrandedAlertButton[] } | null>(null);
  // Clear the home-screen badge whenever the inbox is opened. The act of
  // viewing the inbox is the user's "I've seen these" signal — even if they
  // don't tap Clear All. The next push from the backend will recompute the
  // correct badge based on remaining unread state.
  useEffect(() => {
    if (visible) {
      Notifications.setBadgeCountAsync(0).catch(() => {});
    }
  }, [visible]);

  const enabled = visible && notificationScope.ready;
  const inviteRead = useQuery({
    queryKey: ['pending-invites', userId, notificationScope.epoch],
    queryFn: () => readInboxInvitations(notificationScope.readOwner),
    enabled, retry: false, staleTime: 0,
  });
  const noticeRead = useQuery({
    queryKey: ['app-notifications', userId, notificationScope.epoch],
    queryFn: () => readInboxNotifications(notificationScope.readOwner),
    enabled, retry: false, staleTime: 0,
  });
  const pendingInvites = enabled ? inviteRead.data ?? [] : [];
  const [expiryRevision, refreshExpiry] = useState(0);
  const now = Date.now();
  const appNotifications = enabled ? (noticeRead.data ?? []).filter(row =>
    !row.expires_at || Date.parse(row.expires_at) > now) : [];
  const nextExpiry = appNotifications.reduce((next, row) =>
    row.expires_at ? Math.min(next, Date.parse(row.expires_at)) : next, Infinity);
  useEffect(() => {
    if (!enabled || !Number.isFinite(nextExpiry)) return;
    const refresh = () => refreshExpiry(value => value + 1);
    const timer = setTimeout(refresh, Math.max(0, Math.min(nextExpiry - Date.now(), 2147483647)));
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') refresh(); });
    return () => { clearTimeout(timer); subscription.remove(); };
  }, [nextExpiry, enabled, expiryRevision]);
  const { refetch: refetchNotifs, isLoading: loadingNotifs } = noticeRead;
  const loadingInvites = inviteRead.isLoading;
  const inviteError = enabled && (inviteRead.isError || inviteRead.data === null);
  const noticeError = enabled && (noticeRead.isError || noticeRead.data === null);
  const identityError = visible && notificationScope.identityUnavailable;
  const readFailed = identityError || inviteError || noticeError;
  const retryInbox = () => {
    if (!visible || activeVisit.current !== visit || closingRef.current) return;
    if (identityError) { void notificationScope.retryIdentity(); return; }
    if (!notificationScope.isCurrent()) return;
    if (inviteError) void inviteRead.refetch({ cancelRefetch: false });
    if (noticeError) void noticeRead.refetch({ cancelRefetch: false });
  };
  const totalInboxCount = pendingInvites.length + appNotifications.length;

  // Opening the inbox runs expire_stale_notifications on the server, which
  // can drop notifications that the badge query was still counting. Invalidate
  // the in-app bell badge once the modal queries have settled so it reflects
  // the post-expire state instead of waiting up to 30s for the next interval.
  useEffect(() => {
    if (!visible) return;
    if (loadingInvites || loadingNotifs) return;
    queryClient.invalidateQueries({ queryKey: INBOX_COUNT_KEY });
  }, [visible, loadingInvites, loadingNotifs, queryClient]);

  const handleNotifAction = useCallback(async (notifId: string, action: 'acted' | 'read', eventId?: string, notifType?: string, actorId?: string) => {
    if (!notificationScope.isCurrent() || closingRef.current) return;
    const actions = notificationActions.current;
    if (actions.has(notifId)) return;
    actions.add(notifId);
    hapticLight();
    try {
      if (action === 'acted' && eventId && userId &&
          (notifType === 'member_joined' || notifType === 'invite_accepted' || notifType === 'event_reminder')) {
        // Opening an existing thread does not depend on clearing its bell entry.
        // Only invalidate this owner's cache; a late receipt never navigates.
        const key = JSON.stringify([userId, notifId]);
        if (!chatAcknowledgements.current.has(key)) {
          chatAcknowledgements.current.add(key);
          void requestWithDeadline(supabase.from('app_notifications').update({ status: 'acted' })
            .eq('id', notifId).eq('user_id', userId).eq('status', 'unread'), 12_000)
            .finally(() => chatAcknowledgements.current.delete(key))
            .then(({ error }) => {
              if (error) return;
              return Promise.all([
                queryClient.invalidateQueries({ queryKey: ['app-notifications', userId, notificationScope.epoch], exact: true }),
                queryClient.invalidateQueries({ queryKey: [...INBOX_COUNT_KEY, userId, notificationScope.epoch], exact: true }),
              ]);
            }).catch(() => { /* The next inbox read reconciles an uncertain receipt. */ });
        }
        navigateAfterDismiss(`/(tabs)/chats/${eventId}`);
        return;
      }
      await supabase.from('app_notifications').update({ status: action }).eq('id', notifId).eq('user_id', userId);
      if (!notificationScope.isCurrent() || closingRef.current) return;
      // Don't delete waitlist row here — let cleanup_waitlist_on_join trigger handle it
      // when the user actually joins on the plan detail page
      refetchNotifs();
      queryClient.invalidateQueries({ queryKey: INBOX_COUNT_KEY });
      if (action === 'acted' && notifType === 'operator_grant') {
        navigateAfterDismiss('/creator/apply'); return;
      }
      if (action === 'acted' && notifType && YOURS_NOTIF_TYPES.has(notifType)) {
        // Single inbox: a people request / acceptance / referral-joined
        // notification routes to the Yours page. No event_id involved.
        // A people_request is directly actionable, so carry a flag that
        // auto-opens the accept card stack instead of leaving the user to
        // hunt for the request banner (or find nothing if it's stale).
        // Only the rebuilt Yours screen handles ?openRequests=1; with the flag
        // off the legacy screen can't, so route plain to avoid a dead-end.
        // Force the People tab (not last-used) and carry the requester id so the
        // list floats THIS person to the top. Opening accepts/declines nothing.
        if (notifType === 'people_request' && YOURS_PAGE_ENABLED) {
          const target = actorId
            ? `/(tabs)/friends?openRequests=1&tab=people&requesterId=${actorId}`
            : '/(tabs)/friends?openRequests=1&tab=people';
          navigateAfterDismiss(target as any);
        } else {
          navigateAfterDismiss((notifType === 'people_request_accepted' || notifType === 'referral_joined' ? '/(tabs)/friends?tab=people' : '/(tabs)/friends') as any);
        }
        return;
      }
      // community_join_request (leader-only "someone wants in") and
      // community_event ("[community] just posted [event]") never carry an
      // event_id -- neither does the app_notifications row (see
      // request_to_join_community / notify_community_event in
      // 20260707200000_intro_blurb.sql + 20260706150000_mvp_batch.sql) nor
      // the OneSignal push payload (app/_layout.tsx's click handler already
      // routes both this same way: community_join_request -> the creator
      // members/requests tab regardless of ids, community_event -> Scene
      // "by design" per its own comment there). Mirrors that here so the
      // in-app tap isn't a silent no-op while the push tap already works.
      if (action === 'acted' && notifType === 'community_join_request') {
        navigateAfterDismiss('/(tabs)/friends/manage/(tools)/members' as any);
        return;
      }
      if (action === 'acted' && notifType === 'community_event' && COMMUNITIES_ENABLED) {
        navigateAfterDismiss('/(tabs)/explore' as any);
        return;
      }
      if (action === 'acted' && eventId) {
        if (notifType === 'waitlist_request' || notifType === 'exception_slot_refunded') {
          // The manager query has a 30s staleTime; force it fresh so the
          // creator doesn't land on a stale counter/list after tapping a
          // "someone wants in" / "slot opened back up" notification.
          queryClient.invalidateQueries({ queryKey: WAITLIST_MANAGER_KEY(eventId) });
          navigateAfterDismiss(`/waitlist/${eventId}` as any);
        } else if (
          notifType === 'album_upload_prompt' ||
          notifType === 'album_upload_reminder' ||
          notifType === 'album_creator_no_uploads_nudge'
        ) {
          navigateAfterDismiss(`/album/upload/${eventId}` as any);
        } else if (
          notifType === 'album_ready' ||
          notifType === 'album_someone_uploaded' ||
          notifType === 'album_more_photos_added' ||
          notifType === 'album_hearts_batched'
        ) {
          navigateAfterDismiss(`/album/${eventId}` as any);
        } else {
          navigateAfterDismiss(`/plan/${eventId}`);
        }
      }
    } catch {
      if (notificationScope.isCurrent() && !closingRef.current) setAlertInfo({ title: 'Something went wrong', message: 'Please try again.' });
    } finally {
      actions.delete(notifId);
    }
  }, [refetchNotifs, queryClient, userId, navigateAfterDismiss, notificationScope]);

  const clearAll = useClearInboxNotifications(notificationScope, visit, () => !closingRef.current && activeVisit.current === visit, 'all');
  const clearBusy = clearAll.phase === 'clearing' || clearAll.phase === 'checking';
  const clearLabel = { idle: 'Clear all', clearing: 'Clearing…', retry: 'Retry clear',
    unknown: 'Check notifications', checking: 'Checking…' }[clearAll.phase];

  const stackHeader = stacked || clearAll.phase === 'unknown';

  const exception = useInboxWaitlistException(notificationScope, visit,
    () => !closingRef.current && activeVisit.current === visit, navigateAfterDismiss,
    message => setAlertInfo({ title: 'Invitation', message }));

  return (
    <Modal
      visible={visible && !closing}
      transparent
      // fade (not slide): with a transparent modal, "slide" animates the dark
      // scrim up *with* the sheet, so until it settles the screen behind
      // (e.g. the Yours Albums grid) shows through undimmed and looks like a
      // broken half-overlap. fade brings the full-screen scrim in at once so
      // the sheet always sits on a cleanly covered screen.
      animationType="fade"
      presentationStyle="overFullScreen"
      statusBarTranslucent
      onRequestClose={() => requestClose()}
      onDismiss={finishDismissal}
    >
      <View style={s.overlay}>
        <Pressable accessible={false} style={StyleSheet.absoluteFill} onPress={() => requestClose()} />
        <View
          accessible={false}
          accessibilityViewIsModal
          style={[
            s.sheet,
            stacked && s.tallSheet,
            // Android edge-to-edge: Modal renders behind the nav/gesture bar;
            // add the bottom inset on top of the base 40px so action buttons
            // stay clear of the system bar. iOS unchanged.
            Platform.OS === 'android' && { paddingBottom: 40 + insets.bottom },
          ]}
        >
          <View style={s.handle} />
          <View style={[s.headerRow, stackHeader && s.stackedHeader]}>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Close inbox"
              onPress={() => requestClose()}
              style={[s.closeBtn, stackHeader && s.flowClose]}
            >
              <X size={22} color={Colors.asphalt} />
            </TouchableOpacity>
            <Text accessibilityRole="header" style={[s.title, stackHeader && s.flowTitle]}>Notifications</Text>
            {(appNotifications.length > 0 || clearAll.phase !== 'idle') && (
              <View pointerEvents="box-none" style={stackHeader ? s.flowClear : s.clearAllBtn}>
                <TouchableOpacity
                  disabled={clearBusy}
                  onPress={() => clearAll.press(appNotifications)}
                  accessibilityRole="button"
                  accessibilityLabel={clearAll.phase === 'idle' ? 'Clear all notifications' : clearLabel}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  style={s.clearAction}
                >
                  <Text style={s.clearAllText}>{clearLabel}</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
          {(clearAll.phase === 'retry' || clearAll.phase === 'unknown') && (
            <Text accessibilityLiveRegion="polite" style={[s.meta, { paddingHorizontal: 16, paddingVertical: 8 }]}>
              {clearAll.phase === 'retry' ? 'Some notifications still need clearing.' : 'Couldn’t confirm whether your notifications cleared.'}
            </Text>
          )}
          {readFailed && (
            <View style={{ paddingHorizontal: 16, paddingVertical: 8 }}>
              <Text accessibilityLiveRegion="polite" style={s.meta}>
                {identityError || (inviteError && noticeError) ? 'Couldn’t refresh your inbox.' :
                  inviteError ? 'Couldn’t refresh your invitations.' : 'Couldn’t refresh your notifications.'}
              </Text>
              <TouchableOpacity accessibilityRole="button" onPress={retryInbox} style={{ paddingVertical: 10 }}>
                <Text style={s.clearAllText}>Retry</Text>
              </TouchableOpacity>
            </View>
          )}
          {totalInboxCount === 0 && !readFailed && (!enabled || loadingInvites || loadingNotifs) ? (
            <ActivityIndicator color={Colors.terracotta} style={{ paddingVertical: 32 }} />
          ) : totalInboxCount === 0 && !readFailed ? (
            <View style={{ alignItems: 'center', paddingVertical: 32 }}>
              <Bell size={36} color={Colors.terracotta} />
              <Text style={[s.meta, { marginTop: 12, textAlign: 'center' }]}>
                {'Invites, waitlist notifications\n& fun updates will show up here'}
              </Text>
            </View>
          ) : (
            <ScrollView decelerationRate="normal" style={s.list} bounces={false}>
              {pendingInvites.map((inv: any) => {
                const sender = inv.profiles;
                const plan = inv.events;
                return (
                  <View key={`inv-${inv.id}`} style={s.inviteCard}>
                    <View style={s.row}>
                      {sender?.profile_photo_url ? (
                        <Image source={{ uri: sender.profile_photo_url }} style={s.avatar} contentFit="cover" />
                      ) : (
                        <View style={[s.avatar, s.avatarFallback]}>
                          <Send size={16} color={Colors.terracotta} />
                        </View>
                      )}
                      <View style={{ flex: 1, marginLeft: 10 }}>
                        <Text style={s.rowTitle} numberOfLines={1}>
                          {sender?.first_name_display ?? 'Someone'} invited you
                        </Text>
                        <Text style={s.planName} numberOfLines={1}>{plan.title}</Text>
                        {plan.start_time && (
                          <Text style={s.meta}>
                            {new Date(plan.start_time).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                          </Text>
                        )}
                      </View>
                    </View>
                    <InboxPlanInviteActions id={inv.id} eventId={inv.event_id} scope={notificationScope} visit={visit}
                      isOpen={() => activeVisit.current === visit && !closingRef.current}
                      onOpen={() => navigateAfterDismiss(`/plan/${inv.event_id}`)} />
                  </View>
                );
              })}

              {appNotifications.map((notif: any) => {
                if (CREATOR_PAGES_ENABLED && isCommunityJoinNotice(notif.type)) return <CommunityJoinInboxRow key={notif.id} notice={notif} userId={userId} visible={visible && !closing} onClose={() => requestClose()} onNavigate={navigateAfterDismiss} onRead={() => { void refetchNotifs(); void queryClient.invalidateQueries({ queryKey: INBOX_COUNT_KEY }); }} />;
                if (notif.type === 'community_broadcast') return <CommunityNoticeInboxRow key={notif.id} notice={notif} userId={userId} visible={visible && !closing} enabled={COMMUNITIES_ENABLED} onClose={() => requestClose()} onNavigate={navigateAfterDismiss} onRead={() => { void refetchNotifs(); void queryClient.invalidateQueries({ queryKey: INBOX_COUNT_KEY }); }} />;
                if (notif.scene_update) return <AttendeeMessageInboxRow key={notif.id} notice={notif} userId={userId} visible={visible && !closing} enabled={COMMUNITIES_ENABLED} onClose={() => requestClose()} onNavigate={navigateAfterDismiss} />;
                if (notif.type === 'page_team_invitation') return <PageInvitationInboxRow key={notif.id} notice={notif} userId={userId} visible={visible && !closing} enabled={CREATOR_PAGES_ENABLED} onClose={() => requestClose()} onNavigate={navigateAfterDismiss} onRead={() => { void refetchNotifs(); void queryClient.invalidateQueries({ queryKey: INBOX_COUNT_KEY }); }} />;
                if (notif.type === 'creator_page_update') return <PageUpdateInboxRow key={notif.id} notice={notif} userId={userId} visible={visible && !closing} enabled={CREATOR_PAGES_ENABLED} onClose={() => requestClose()} onNavigate={navigateAfterDismiss} onRead={() => { void refetchNotifs(); void queryClient.invalidateQueries({ queryKey: INBOX_COUNT_KEY }); }} />;
                const isWaitlist = notif.type === 'waitlist_spot';
                const isExceptionInvite = notif.type === 'exception_invite';
                const decision = isExceptionInvite ? exception.declineState(notif.id) : undefined;
                const completed = decision === 'declined' || decision === 'expired' || decision === 'inactive';
                const goesToYours = YOURS_NOTIF_TYPES.has(notif.type);
                // Full audit against every type in app_notifications_type_check
                // (supabase/migrations, last touched 20260706150000_mvp_batch.sql,
                // 31 values total) found two more that route WITHOUT an event_id,
                // the same way the Yours types above do -- see handleNotifAction.
                const goesToCommunityRequests = notif.type === 'community_join_request';
                const goesToCommunityEvent = COMMUNITIES_ENABLED && notif.type === 'community_event';
                const hasAction = notif.type === 'operator_grant' || goesToYours || goesToCommunityRequests || goesToCommunityEvent || ((
                  notif.type === 'plan_cancelled' ||
                  notif.type === 'waitlist_spot' ||
                  notif.type === 'member_joined' ||
                  notif.type === 'invite_accepted' ||
                  notif.type === 'waitlist_request' ||
                  notif.type === 'exception_slot_refunded' ||
                  notif.type === 'exception_invite' ||
                  // A ping IS the plan: tap must open the plan detail (the
                  // handleNotifAction event_id fallthrough), not just mark read.
                  notif.type === 'people_ping' ||
                  // "X would go next time" always carries the plan's event_id
                  // too; was missing from this list, so tapping it silently
                  // just marked it read instead of opening the plan.
                  notif.type === 'interest_signal' ||
                  // interest_invite ("[Creator] has a new plan" -- sent when a
                  // creator invites someone who'd previously signaled interest,
                  // see act_on_interest_signals) carries the new plan's
                  // event_id the same way and had the same gap: the push-tap
                  // handler in app/_layout.tsx already routes this type to
                  // /plan/:eventId, but this in-app list did not.
                  notif.type === 'interest_invite' ||
                  // "someone just posted a similar plan, join now instead of
                  // waiting" -- carries the NEW plan's event_id
                  // (notify_waitlist_duplicate_plan); push-tap already opens
                  // it, this list did not.
                  notif.type === 'duplicate_plan' ||
                  // create_event_reminders() is dead code today (no cron job,
                  // no app caller -- 20260814170000_lock_down_ban_oracle_and_-
                  // cron_functions.sql), but the row shape already carries
                  // event_id and push-tap already opens the chat for it; wired
                  // here too so a future cron doesn't inherit the same gap.
                  notif.type === 'event_reminder' ||
                  // Album family (albums_v1_schema/albums_v1_cron/
                  // albums_morning_pt_timing): every insert carries event_id.
                  // Push-tap already splits these into upload vs. view targets
                  // (app/_layout.tsx); this list previously routed none of them.
                  notif.type === 'album_ready' ||
                  notif.type === 'album_upload_prompt' ||
                  notif.type === 'album_upload_reminder' ||
                  notif.type === 'album_someone_uploaded' ||
                  notif.type === 'album_more_photos_added' ||
                  notif.type === 'album_creator_no_uploads_nudge' ||
                  notif.type === 'album_hearts_batched'
                ) && notif.event_id);
                const timeLeft = notif.expires_at
                  ? Math.max(0, Math.round((new Date(notif.expires_at).getTime() - Date.now()) / 3600000))
                  : null;
                return (
                  <InboxNotificationRow key={`notif-${notif.id}`} notice={notif}
                    scope={notificationScope} visit={visit} isOpen={() => !closingRef.current && activeVisit.current === visit}
                    stacked={stacked}
                    showDismiss={completed || (!isWaitlist && !isExceptionInvite)}
                    openSpotActions={isWaitlist ? ({ pass, label, busy }) => (
                      <View style={[s.waitlistActions, stacked && s.stackedActions]}>
                        <TouchableOpacity style={s.claimBtn} accessibilityRole="button" accessibilityLabel="Claim Spot"
                          disabled={busy} onPress={() => handleNotifAction(notif.id, 'acted', notif.event_id, notif.type)}>
                          <Text style={s.claimText}>Claim Spot</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={s.cantGoBtn} accessibilityRole="button" accessibilityLabel={label}
                          disabled={busy} onPress={pass}>
                          <Text style={s.cantGoText}>{label}</Text>
                        </TouchableOpacity>
                      </View>
                    ) : undefined}
                    hasOwnActions={isExceptionInvite}
                    onOpen={hasAction
                      ? () => handleNotifAction(notif.id, 'acted', notif.event_id, notif.type, notif.actor_user_id)
                      : undefined}>
                    {(notif.type === 'people_request' || notif.type === 'people_request_accepted') && (
                      <View style={s.peopleAccent} />
                    )}
                    {notif.sender_photo ? (
                      <Image source={{ uri: notif.sender_photo }} style={s.avatar} contentFit="cover" />
                    ) : (
                      <View style={[s.avatar, s.avatarFallback]}>
                        <Bell size={16} color="#B5522E" />
                      </View>
                    )}
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <Text style={s.rowTitle} numberOfLines={stacked ? undefined : 1}>{notif.title}</Text>
                      {notif.body && <Text style={s.notifBody} numberOfLines={stacked ? undefined : 2}>{notif.body}</Text>}
                      {timeLeft !== null && timeLeft > 0 && (
                        <Text style={s.expiry}>{timeLeft < 1 ? 'Expires soon' : `${timeLeft}h left to respond`}</Text>
                      )}
                      {completed && <Text style={s.notifBody} accessibilityLiveRegion="polite">
                        {decision === 'declined' ? 'You declined this invitation.' : decision === 'expired'
                          ? 'This invitation expired.' : 'This invitation is no longer active.'}
                      </Text>}
                      {decision === 'unavailable' && <View>
                        <Text style={s.notifBody} accessibilityLiveRegion="polite">We couldn’t confirm the invitation status.</Text>
                        <TouchableOpacity accessibilityRole="button" style={s.cantGoBtn} accessibilityLabel="Check invitation" disabled={!!exception.pendingId}
                          onPress={() => exception.start(notif.id, notif.event_id, { createdAt: notif.created_at, checkOnly: true })}>
                          <Text style={s.cantGoText}>Check invitation</Text>
                        </TouchableOpacity>
                      </View>}
                      {isExceptionInvite && !decision && (
                        <View style={[s.waitlistActions, stacked && s.stackedActions]}>
                          <TouchableOpacity style={s.claimBtn} accessibilityRole="button" accessibilityLabel="Join the plan" disabled={!!exception.pendingId} onPress={() => exception.start(notif.id, notif.event_id)} activeOpacity={0.7}>
                            <Text style={s.claimText}>{exception.pendingId === notif.id ? 'Please wait…' : 'Join the plan'}</Text>
                          </TouchableOpacity>
                          <TouchableOpacity style={s.cantGoBtn} accessibilityRole="button" accessibilityLabel="Not this time" disabled={!!exception.pendingId} onPress={() => exception.start(notif.id, notif.event_id, { createdAt: notif.created_at })} activeOpacity={0.7}>
                            <Text style={s.cantGoText}>Not this time</Text>
                          </TouchableOpacity>
                        </View>
                      )}
                    </View>
                  </InboxNotificationRow>
                );
              })}

            </ScrollView>
          )}
        </View>
      </View>
      <BrandedAlert
        visible={!!alertInfo}
        title={alertInfo?.title ?? ''}
        message={alertInfo?.message}
        buttons={alertInfo?.buttons}
        onClose={() => setAlertInfo(null)}
      />
      <ParticipationNotice
        visible={!!exception.notice}
        organizerName={exception.notice?.organizerName ?? 'Someone'}
        onAgree={exception.agree}
        onClose={exception.closeNotice}
        onDismiss={exception.noticeDismissed}
      />
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: Colors.overlayDark, justifyContent: 'flex-end' },
  sheet: { backgroundColor: Colors.white, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 20, paddingBottom: 40, height: '70%' },
  tallSheet: { height: '90%' },
  stackedHeader: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-start', paddingHorizontal: 0, marginBottom: 6 },
  flowClose: { position: 'relative' },
  flowTitle: { flex: 1, textAlign: 'left' },
  flowClear: { width: '100%', alignItems: 'flex-end' },
  clearAction: { minHeight: 44, maxWidth: '100%', justifyContent: 'center' },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#D5CCC2', alignSelf: 'center', marginTop: 10, marginBottom: 12 },
  headerRow: { position: 'relative', justifyContent: 'center', marginBottom: 16, minHeight: 44, paddingHorizontal: 64 },
  closeBtn: { position: 'absolute', left: 0, top: 0, minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: FontSizes.bodyLG, fontFamily: Fonts.sansBold, color: Colors.asphalt, textAlign: 'center' },
  clearAllBtn: { position: 'absolute', right: 0, top: 0, bottom: 0, justifyContent: 'center' },
  clearAllText: { fontSize: 13, fontFamily: Fonts.sansMedium, color: Colors.textLight },
  list: { flex: 1 },
  inviteCard: { borderBottomWidth: 1, borderBottomColor: Colors.border },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
  avatar: { width: 36, height: 36, borderRadius: 18 },
  avatarFallback: { backgroundColor: Colors.inputBg, alignItems: 'center' as const, justifyContent: 'center' as const },
  rowTitle: { fontSize: FontSizes.bodyMD, fontFamily: Fonts.sansMedium, color: Colors.asphalt },
  meta: { fontSize: FontSizes.caption, fontFamily: Fonts.sans, color: Colors.textLight, marginTop: 2 },
  planName: { fontSize: FontSizes.bodySM, fontFamily: Fonts.sansBold, color: Colors.terracotta, marginTop: 1 },
  viewBtn: { backgroundColor: Colors.terracotta, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 14 },
  viewBtnText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodySM, color: Colors.white },
  expiry: { fontSize: FontSizes.caption, fontFamily: Fonts.sansMedium, color: Colors.errorRed, marginTop: 2 },
  stackedActions: { flexDirection: 'column', alignItems: 'stretch' },
  waitlistActions: { flexDirection: 'row' as const, flexWrap: 'wrap', gap: 10, marginTop: 10 },
  claimBtn: { backgroundColor: Colors.terracotta, borderRadius: 14, paddingVertical: 8, paddingHorizontal: 16 },
  claimText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodySM, color: Colors.white },
  cantGoBtn: { borderRadius: 14, paddingVertical: 8, paddingHorizontal: 12, justifyContent: 'center' as const },
  cantGoText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.textLight },
  // Warm gold left-accent so people-request rows read as the "someone wants to
  // add you" loop (gold, never red), matching the requests banner.
  peopleAccent: { width: 3, alignSelf: 'stretch', backgroundColor: Colors.goldenAmber, borderRadius: 2, marginRight: 8 },
  notifBody: { fontSize: 13, color: '#78695C', marginTop: 1, lineHeight: 18 },
});
