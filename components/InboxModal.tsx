import { useQuery, useQueryClient } from '@tanstack/react-query';
import { hapticLight } from '../lib/haptics';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Bell, Clock, Send } from 'lucide-react-native';
import * as Notifications from 'expo-notifications';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Colors from '../constants/Colors';
import { Fonts, FontSizes } from '../constants/Typography';
import { supabase } from '../lib/supabase';
import { INBOX_COUNT_KEY, WAITLIST_MANAGER_KEY } from '../constants/QueryKeys';
import { YOURS_PAGE_ENABLED } from '../constants/FeatureFlags';
import {
  acceptWaitlistException,
  declineWaitlistException,
  waitlistAlertMessage,
} from '../lib/waitlistExceptions';
import { BrandedAlert, BrandedAlertButton } from './BrandedAlert';

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
  const queryClient = useQueryClient();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [alertInfo, setAlertInfo] = useState<{ title: string; message: string; buttons?: BrandedAlertButton[] } | null>(null);
  // Guards against a rapid double-tap firing the exception accept/decline RPC
  // twice (the 2nd call would error not_on_waitlist / no_active_invite and
  // surface a spurious branded alert). Keyed by notification id.
  const exceptionInFlightRef = useRef<Set<string>>(new Set());

  // Clear the home-screen badge whenever the inbox is opened. The act of
  // viewing the inbox is the user's "I've seen these" signal — even if they
  // don't tap Clear All. The next push from the backend will recompute the
  // correct badge based on remaining unread state.
  useEffect(() => {
    if (visible) {
      Notifications.setBadgeCountAsync(0).catch(() => {});
    }
  }, [visible]);

  const { data: pendingInvites = [], refetch: refetchInvites, isLoading: loadingInvites } = useQuery({
    queryKey: ['pending-invites', userId],
    queryFn: async () => {
      if (!userId) return [];
      try {
        const { data: inviteRows } = await supabase
          .from('plan_invites')
          .select('id, event_id, sender_id, status, created_at, events (id, title, start_time, status, member_count, max_invites)')
          .eq('recipient_id', userId)
          .eq('status', 'pending')
          .order('created_at', { ascending: false });

        const active = (inviteRows ?? []).filter((inv: any) => inv.events && ['forming', 'active', 'full'].includes(inv.events.status));
        if (active.length === 0) return [];

        const senderIds = [...new Set(active.map((inv: any) => inv.sender_id).filter(Boolean))];
        const { data: profiles } = await supabase
          .from('profiles_public')
          .select('id, first_name_display, profile_photo_url')
          .in('id', senderIds);

        const profileMap: Record<string, any> = {};
        (profiles ?? []).forEach((p: any) => { profileMap[p.id] = p; });

        return active.map((inv: any) => ({ ...inv, profiles: profileMap[inv.sender_id] ?? null }));
      } catch { return []; }
    },
    enabled: !!userId && visible,
    staleTime: 0,
  });

  const { data: appNotifications = [], refetch: refetchNotifs, isLoading: loadingNotifs } = useQuery({
    queryKey: ['app-notifications', userId],
    queryFn: async () => {
      if (!userId) return [];
      try {
        try { await supabase.rpc('expire_stale_notifications'); } catch {}
        // Filter expired-but-still-unread rows directly so the display
        // doesn't depend on the RPC above succeeding. Mirrors the same
        // filter on the bell-count query in ProfileButton so the two
        // always agree.
        const { data } = await supabase
          .from('app_notifications')
          .select('id, type, title, body, event_id, actor_user_id, status, expires_at, created_at')
          .eq('user_id', userId)
          .eq('status', 'unread')
          .neq('type', 'plan_invite')
          .neq('type', 'new_message')
          .or('expires_at.is.null,expires_at.gt.now()')
          .order('created_at', { ascending: false })
          .limit(30);

        if (!data || data.length === 0) return [];

        // Resolve avatars by structured actor_user_id (set by the relevant
        // notification triggers). Old rows pre-migration carry NULL and fall
        // through to the Bell fallback in the renderer.
        const actorIds = Array.from(
          new Set((data as any[]).map((n) => n.actor_user_id).filter(Boolean))
        );
        let photoMap: Record<string, string> = {};
        if (actorIds.length > 0) {
          const { data: profiles } = await supabase
            .from('profiles_public')
            .select('id, profile_photo_url')
            .in('id', actorIds);
          (profiles ?? []).forEach((p: any) => {
            if (p.id && p.profile_photo_url) photoMap[p.id] = p.profile_photo_url;
          });
        }

        return (data as any[]).map((n) => ({
          ...n,
          sender_photo: n.actor_user_id ? (photoMap[n.actor_user_id] ?? null) : null,
        }));
      } catch { return []; }
    },
    enabled: !!userId && visible,
    staleTime: 0,
  });

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
    hapticLight();
    try {
      await supabase.from('app_notifications').update({ status: action }).eq('id', notifId);
      // Don't delete waitlist row here — let cleanup_waitlist_on_join trigger handle it
      // when the user actually joins on the plan detail page
      refetchNotifs();
      queryClient.invalidateQueries({ queryKey: INBOX_COUNT_KEY });
      if (action === 'acted' && notifType && YOURS_NOTIF_TYPES.has(notifType)) {
        // Single inbox: a people request / acceptance / referral-joined
        // notification routes to the Yours page. No event_id involved.
        // A people_request is directly actionable, so carry a flag that
        // auto-opens the accept card stack instead of leaving the user to
        // hunt for the request banner (or find nothing if it's stale).
        onClose();
        // Only the rebuilt Yours screen handles ?openRequests=1; with the flag
        // off the legacy screen can't, so route plain to avoid a dead-end.
        // Force the People tab (not last-used) and carry the requester id so the
        // list floats THIS person to the top. Opening accepts/declines nothing.
        if (notifType === 'people_request' && YOURS_PAGE_ENABLED) {
          const target = actorId
            ? `/(tabs)/friends?openRequests=1&tab=people&requesterId=${actorId}`
            : '/(tabs)/friends?openRequests=1&tab=people';
          router.push(target as any);
        } else {
          router.push('/(tabs)/friends' as any);
        }
        return;
      }
      if (action === 'acted' && eventId) {
        onClose();
        if (notifType === 'member_joined' || notifType === 'invite_accepted') {
          router.push(`/(tabs)/chats/${eventId}` as any);
        } else if (notifType === 'waitlist_request' || notifType === 'exception_slot_refunded') {
          // The manager query has a 30s staleTime; force it fresh so the
          // creator doesn't land on a stale counter/list after tapping a
          // "someone wants in" / "slot opened back up" notification.
          queryClient.invalidateQueries({ queryKey: WAITLIST_MANAGER_KEY(eventId) });
          router.push(`/waitlist/${eventId}` as any);
        } else {
          router.push(`/plan/${eventId}`);
        }
      }
    } catch {
      setAlertInfo({ title: 'Something went wrong', message: 'Please try again.' });
    }
  }, [refetchNotifs, router, queryClient, userId, onClose]);

  const handleClearAll = useCallback(async () => {
    if (!userId || appNotifications.length === 0) return;
    hapticLight();
    try {
      // Mark every visible app_notification as read in one query.
      // Mirrors the query filter above so we never touch invites or chat pings.
      await supabase
        .from('app_notifications')
        .update({ status: 'read' })
        .eq('user_id', userId)
        .eq('status', 'unread')
        .neq('type', 'plan_invite')
        .neq('type', 'new_message');
      refetchNotifs();
      queryClient.invalidateQueries({ queryKey: INBOX_COUNT_KEY });
    } catch {
      setAlertInfo({ title: 'Something went wrong', message: 'Please try again.' });
    }
  }, [userId, appNotifications.length, refetchNotifs, queryClient]);

  // exception_invite inline Accept. Mirrors the waitlist_spot Claim flow:
  // act on the RPC, mark the notification consumed, then route to the chat
  // (the accept trigger adds the user as a member).
  const handleAcceptException = useCallback(async (notifId: string, eventId?: string) => {
    if (!eventId) return;
    if (exceptionInFlightRef.current.has(notifId)) return;
    exceptionInFlightRef.current.add(notifId);
    hapticLight();
    try {
      await acceptWaitlistException(eventId);
      await supabase.from('app_notifications').update({ status: 'acted' }).eq('id', notifId);
      refetchNotifs();
      queryClient.invalidateQueries({ queryKey: INBOX_COUNT_KEY });
      queryClient.invalidateQueries({ queryKey: ['events', 'members', eventId] });
      queryClient.invalidateQueries({ queryKey: ['events', 'detail', eventId] });
      queryClient.invalidateQueries({ queryKey: ['my-plans'] });
      queryClient.invalidateQueries({ queryKey: ['feed-member-ids'] });
      queryClient.invalidateQueries({ queryKey: ['waitlisted-plans'] });
      queryClient.invalidateQueries({ queryKey: WAITLIST_MANAGER_KEY(eventId) });
      onClose();
      router.push(`/(tabs)/chats/${eventId}` as any);
    } catch (e) {
      setAlertInfo({
        title: 'Hmm',
        message: waitlistAlertMessage(e, "We couldn't add you to the plan. Try again."),
      });
    } finally {
      exceptionInFlightRef.current.delete(notifId);
    }
  }, [refetchNotifs, queryClient, router, onClose]);

  const handleDeclineException = useCallback(async (notifId: string, eventId?: string) => {
    if (!eventId) return;
    if (exceptionInFlightRef.current.has(notifId)) return;
    exceptionInFlightRef.current.add(notifId);
    hapticLight();
    try {
      await declineWaitlistException(eventId);
      await supabase.from('app_notifications').update({ status: 'read' }).eq('id', notifId);
      refetchNotifs();
      queryClient.invalidateQueries({ queryKey: INBOX_COUNT_KEY });
      queryClient.invalidateQueries({ queryKey: WAITLIST_MANAGER_KEY(eventId) });
    } catch (e) {
      setAlertInfo({
        title: 'Hmm',
        message: waitlistAlertMessage(e),
      });
    } finally {
      exceptionInFlightRef.current.delete(notifId);
    }
  }, [refetchNotifs, queryClient]);

  if (!visible) return null;

  return (
    <Modal
      visible
      transparent
      // fade (not slide): with a transparent modal, "slide" animates the dark
      // scrim up *with* the sheet, so until it settles the screen behind
      // (e.g. the Yours Albums grid) shows through undimmed and looks like a
      // broken half-overlap. fade brings the full-screen scrim in at once so
      // the sheet always sits on a cleanly covered screen.
      animationType="fade"
      presentationStyle="overFullScreen"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <Pressable style={s.overlay} onPress={onClose}>
        <Pressable
          style={[
            s.sheet,
            // Android edge-to-edge: Modal renders behind the nav/gesture bar;
            // add the bottom inset on top of the base 40px so action buttons
            // stay clear of the system bar. iOS unchanged.
            Platform.OS === 'android' && { paddingBottom: 40 + insets.bottom },
          ]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={s.handle} />
          <View style={s.headerRow}>
            <Text style={s.title}>Notifications</Text>
            {appNotifications.length > 0 && (
              <TouchableOpacity
                onPress={handleClearAll}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                style={s.clearAllBtn}
              >
                <Text style={s.clearAllText}>Clear all</Text>
              </TouchableOpacity>
            )}
          </View>
          {loadingInvites || loadingNotifs ? (
            <ActivityIndicator color={Colors.terracotta} style={{ paddingVertical: 32 }} />
          ) : totalInboxCount === 0 ? (
            <View style={{ alignItems: 'center', paddingVertical: 32 }}>
              <Bell size={36} color={Colors.terracotta} />
              <Text style={[s.meta, { marginTop: 12, textAlign: 'center' }]}>
                {'Invites, waitlist notifications\n& fun updates will show up here'}
              </Text>
            </View>
          ) : (
            <ScrollView decelerationRate="normal" style={s.list} bounces={false}>
              {totalInboxCount === 0 && (
                <View style={{ alignItems: 'center', paddingVertical: 16 }}>
                  <Text style={[s.meta, { textAlign: 'center' }]}>Nothing new right now</Text>
                </View>
              )}
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
                    <View style={s.inviteActions}>
                      <TouchableOpacity
                        style={s.letsGoBtn}
                        activeOpacity={0.85}
                        onPress={async () => {
                          hapticLight();
                          try {
                            await supabase.from('plan_invites').update({ status: 'accepted' }).eq('id', inv.id);
                            refetchInvites();
                            queryClient.invalidateQueries({ queryKey: INBOX_COUNT_KEY });
                          } catch {}
                          onClose();
                          router.push(`/plan/${inv.event_id}` as any);
                        }}
                      >
                        <Text style={s.letsGoBtnText}>{`Let's Go \u2192`}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={s.notThisTimeBtn}
                        activeOpacity={0.7}
                        onPress={async () => {
                          hapticLight();
                          try {
                            await supabase.from('plan_invites').update({ status: 'declined' }).eq('id', inv.id);
                            refetchInvites();
                            queryClient.invalidateQueries({ queryKey: INBOX_COUNT_KEY });
                          } catch {}
                        }}
                      >
                        <Text style={s.notThisTimeBtnText}>Not This Time</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })}

              {appNotifications.map((notif: any) => {
                const isWaitlist = notif.type === 'waitlist_spot';
                const isExceptionInvite = notif.type === 'exception_invite';
                const goesToYours = YOURS_NOTIF_TYPES.has(notif.type);
                const hasAction = goesToYours || ((
                  notif.type === 'waitlist_spot' ||
                  notif.type === 'member_joined' ||
                  notif.type === 'invite_accepted' ||
                  notif.type === 'waitlist_request' ||
                  notif.type === 'exception_slot_refunded' ||
                  notif.type === 'exception_invite'
                ) && notif.event_id);
                const timeLeft = notif.expires_at
                  ? Math.max(0, Math.round((new Date(notif.expires_at).getTime() - Date.now()) / 3600000))
                  : null;
                return (
                  <TouchableOpacity
                    key={`notif-${notif.id}`}
                    style={s.notifRow}
                    activeOpacity={0.7}
                    onPress={() => {
                      // exception_invite is decided only via its inline
                      // Accept/Decline buttons; a stray row tap must not
                      // consume it.
                      if (isExceptionInvite) return;
                      return hasAction
                        ? handleNotifAction(notif.id, 'acted', notif.event_id, notif.type, notif.actor_user_id)
                        : handleNotifAction(notif.id, 'read');
                    }}
                  >
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
                      <Text style={s.rowTitle} numberOfLines={1}>{notif.title}</Text>
                      {notif.body && <Text style={s.notifBody} numberOfLines={2}>{notif.body}</Text>}
                      {timeLeft !== null && timeLeft > 0 && (
                        <Text style={s.expiry}>{timeLeft < 1 ? 'Expires soon' : `${timeLeft}h left to respond`}</Text>
                      )}
                      {isWaitlist && (
                        <View style={s.waitlistActions}>
                          <TouchableOpacity style={s.claimBtn} onPress={() => handleNotifAction(notif.id, 'acted', notif.event_id, notif.type)} activeOpacity={0.7}>
                            <Text style={s.claimText}>Claim Spot</Text>
                          </TouchableOpacity>
                          <TouchableOpacity style={s.cantGoBtn} onPress={() => handleNotifAction(notif.id, 'read', undefined, notif.type)} activeOpacity={0.7}>
                            <Text style={s.cantGoText}>Pass</Text>
                          </TouchableOpacity>
                        </View>
                      )}
                      {isExceptionInvite && (
                        <View style={s.waitlistActions}>
                          <TouchableOpacity style={s.claimBtn} onPress={() => handleAcceptException(notif.id, notif.event_id)} activeOpacity={0.7}>
                            <Text style={s.claimText}>Join the plan</Text>
                          </TouchableOpacity>
                          <TouchableOpacity style={s.cantGoBtn} onPress={() => handleDeclineException(notif.id, notif.event_id)} activeOpacity={0.7}>
                            <Text style={s.cantGoText}>Not this time</Text>
                          </TouchableOpacity>
                        </View>
                      )}
                    </View>
                    {!isWaitlist && !isExceptionInvite && (
                      <TouchableOpacity
                        onPress={() => handleNotifAction(notif.id, 'read')}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Text style={s.dismissText}>Dismiss</Text>
                      </TouchableOpacity>
                    )}
                  </TouchableOpacity>
                );
              })}

            </ScrollView>
          )}
        </Pressable>
      </Pressable>
      <BrandedAlert
        visible={!!alertInfo}
        title={alertInfo?.title ?? ''}
        message={alertInfo?.message}
        buttons={alertInfo?.buttons}
        onClose={() => setAlertInfo(null)}
      />
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: Colors.overlayDark, justifyContent: 'flex-end' },
  sheet: { backgroundColor: Colors.white, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 20, paddingBottom: 40, height: '70%' },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#D5CCC2', alignSelf: 'center', marginTop: 10, marginBottom: 12 },
  headerRow: { position: 'relative', justifyContent: 'center', marginBottom: 16, minHeight: 22 },
  title: { fontSize: 17, fontWeight: '700' as const, color: '#2C1810', textAlign: 'center' },
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
  waitlistActions: { flexDirection: 'row' as const, gap: 10, marginTop: 10 },
  claimBtn: { backgroundColor: Colors.terracotta, borderRadius: 14, paddingVertical: 8, paddingHorizontal: 16 },
  claimText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodySM, color: Colors.white },
  cantGoBtn: { borderRadius: 14, paddingVertical: 8, paddingHorizontal: 12, justifyContent: 'center' as const },
  cantGoText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.textLight },
  notifRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#F5EDE0' },
  // Warm gold left-accent so people-request rows read as the "someone wants to
  // add you" loop (gold, never red), matching the requests banner.
  peopleAccent: { width: 3, alignSelf: 'stretch', backgroundColor: Colors.goldenAmber, borderRadius: 2, marginRight: 8 },
  notifBody: { fontSize: 13, color: '#78695C', marginTop: 1, lineHeight: 18 },
  dismissText: { fontSize: 12, color: '#A09385', marginLeft: 8 },
  inviteActions: { flexDirection: 'row' as const, gap: 10, paddingBottom: 12, justifyContent: 'center' as const },
  letsGoBtn: { backgroundColor: Colors.terracotta, paddingHorizontal: 24, paddingVertical: 10, borderRadius: 999 },
  letsGoBtnText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.white },
  notThisTimeBtn: { paddingHorizontal: 16, paddingVertical: 10, justifyContent: 'center' as const },
  notThisTimeBtnText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Colors.textLight },
});
