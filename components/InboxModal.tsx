import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Bell, Check, ChevronDown, ChevronRight, Clock, Megaphone, Send, UserPlus, XCircle } from 'lucide-react-native';
import React, { useCallback, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Colors from '../constants/Colors';
import { Fonts, FontSizes } from '../constants/Typography';
import { supabase } from '../lib/supabase';
import { INBOX_COUNT_KEY } from '../constants/QueryKeys';
import { BrandedAlert, BrandedAlertButton } from './BrandedAlert';

interface InboxModalProps {
  visible: boolean;
  onClose: () => void;
  userId: string | null;
}

export default function InboxModal({ visible, onClose, userId }: InboxModalProps) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [oldExpanded, setOldExpanded] = useState(false);
  const [alertInfo, setAlertInfo] = useState<{ title: string; message: string; buttons?: BrandedAlertButton[] } | null>(null);

  const { data: pendingInvites = [], refetch: refetchInvites } = useQuery({
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
    staleTime: 15_000,
  });

  const { data: appNotifications = [], refetch: refetchNotifs } = useQuery({
    queryKey: ['app-notifications', userId],
    queryFn: async () => {
      if (!userId) return [];
      try {
        try { await supabase.rpc('expire_stale_notifications'); } catch {}
        const { data } = await supabase
          .from('app_notifications')
          .select('id, type, title, body, event_id, status, expires_at, created_at')
          .eq('user_id', userId)
          .eq('status', 'unread')
          .neq('type', 'plan_invite')
          .order('created_at', { ascending: false })
          .limit(30);
        return data ?? [];
      } catch { return []; }
    },
    enabled: !!userId && visible,
    staleTime: 15_000,
  });

  const { data: oldInvites = [], refetch: refetchOldInvites } = useQuery({
    queryKey: ['old-invites', userId],
    queryFn: async () => {
      if (!userId) return [];
      try {
        const { data: inviteRows } = await supabase
          .from('plan_invites')
          .select('id, event_id, sender_id, status, created_at, updated_at, events (id, title, start_time, status)')
          .eq('recipient_id', userId)
          .in('status', ['accepted', 'declined'])
          .order('updated_at', { ascending: false })
          .limit(20);

        if (!inviteRows || inviteRows.length === 0) return [];

        const senderIds = [...new Set(inviteRows.map((inv: any) => inv.sender_id).filter(Boolean))];
        const { data: profiles } = await supabase
          .from('profiles_public')
          .select('id, first_name_display, profile_photo_url')
          .in('id', senderIds);

        const profileMap: Record<string, any> = {};
        (profiles ?? []).forEach((p: any) => { profileMap[p.id] = p; });

        return inviteRows.map((inv: any) => ({ ...inv, profiles: profileMap[inv.sender_id] ?? null }));
      } catch { return []; }
    },
    enabled: !!userId && visible,
    staleTime: 30_000,
  });

  const { data: oldNotifications = [], refetch: refetchOldNotifs } = useQuery({
    queryKey: ['old-notifications', userId],
    queryFn: async () => {
      if (!userId) return [];
      try {
        const { data } = await supabase
          .from('app_notifications')
          .select('id, type, title, body, event_id, status, created_at')
          .eq('user_id', userId)
          .neq('type', 'plan_invite')
          .in('status', ['read', 'acted', 'expired'])
          .order('created_at', { ascending: false })
          .limit(20);
        return data ?? [];
      } catch { return []; }
    },
    enabled: !!userId && visible,
    staleTime: 30_000,
  });

  const totalInboxCount = pendingInvites.length + appNotifications.length;
  const totalOldCount = oldInvites.length + oldNotifications.length;

  const handleNotifAction = useCallback(async (notifId: string, action: 'acted' | 'read', eventId?: string, notifType?: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await supabase.from('app_notifications').update({ status: action }).eq('id', notifId);
      if (notifType === 'waitlist_spot' && eventId && userId) {
        try { await supabase.from('event_waitlist').delete().eq('event_id', eventId).eq('user_id', userId); } catch {}
      }
      refetchNotifs();
      refetchOldNotifs();
      queryClient.invalidateQueries({ queryKey: INBOX_COUNT_KEY });
      if (action === 'acted' && eventId) {
        onClose();
        if (notifType === 'member_joined' || notifType === 'invite_accepted') {
          router.push(`/(tabs)/chats/${eventId}` as any);
        } else {
          router.push(`/plan/${eventId}`);
        }
      }
    } catch {
      setAlertInfo({ title: 'Something went wrong', message: 'Please try again.' });
    }
  }, [refetchNotifs, refetchOldNotifs, router, queryClient, userId, onClose]);

  if (!visible) return null;

  return (
    <Modal visible transparent animationType="fade">
      <Pressable style={s.overlay} onPress={onClose}>
        <Pressable style={s.sheet} onPress={(e) => e.stopPropagation()}>
          <Text style={s.title}>Invites and Fun Stuff</Text>
          {totalInboxCount === 0 && totalOldCount === 0 ? (
            <View style={{ alignItems: 'center', paddingVertical: 32 }}>
              <Bell size={36} color={Colors.textLight} />
              <Text style={[s.meta, { marginTop: 12, textAlign: 'center' }]}>
                {'Invites, waitlist notifications\n& fun updates will show up here'}
              </Text>
            </View>
          ) : (
            <ScrollView style={s.list} bounces={false}>
              {totalInboxCount === 0 && (
                <View style={{ alignItems: 'center', paddingVertical: 16 }}>
                  <Text style={[s.meta, { textAlign: 'center' }]}>Nothing new right now</Text>
                </View>
              )}
              {pendingInvites.map((inv: any) => {
                const sender = inv.profiles;
                const plan = inv.events;
                return (
                  <TouchableOpacity
                    key={`inv-${inv.id}`}
                    style={s.row}
                    activeOpacity={0.7}
                    onPress={() => { onClose(); router.push(`/plan/${inv.event_id}` as any); }}
                  >
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
                    <View style={s.viewBtn}>
                      <Text style={s.viewBtnText}>View</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}

              {appNotifications.map((notif: any) => {
                const icon = notif.type === 'waitlist_spot' ? <Clock size={16} color={Colors.terracotta} />
                  : notif.type === 'broadcast' ? <Megaphone size={16} color={Colors.terracotta} />
                  : notif.type === 'member_joined' ? <UserPlus size={16} color={Colors.terracotta} />
                  : notif.type === 'invite_accepted' ? <Check size={16} color={Colors.terracotta} />
                  : <Bell size={16} color={Colors.terracotta} />;
                const hasAction = (notif.type === 'waitlist_spot' || notif.type === 'member_joined' || notif.type === 'invite_accepted') && notif.event_id;
                const isWaitlist = notif.type === 'waitlist_spot';
                const timeLeft = notif.expires_at
                  ? Math.max(0, Math.round((new Date(notif.expires_at).getTime() - Date.now()) / 3600000))
                  : null;
                return (
                  <View key={`notif-${notif.id}`} style={s.row}>
                    <View style={[s.avatar, s.avatarFallback]}>{icon}</View>
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <Text style={s.rowTitle} numberOfLines={1}>{notif.title}</Text>
                      {notif.body && <Text style={s.planName} numberOfLines={2}>{notif.body}</Text>}
                      {timeLeft !== null && timeLeft > 0 && (
                        <Text style={s.expiry}>{timeLeft < 1 ? 'Expires soon' : `${timeLeft}h left to respond`}</Text>
                      )}
                      {isWaitlist && (
                        <View style={s.waitlistActions}>
                          <TouchableOpacity style={s.claimBtn} onPress={() => handleNotifAction(notif.id, 'acted', notif.event_id, notif.type)} activeOpacity={0.7}>
                            <Text style={s.claimText}>Claim Spot</Text>
                          </TouchableOpacity>
                          <TouchableOpacity style={s.cantGoBtn} onPress={() => handleNotifAction(notif.id, 'read', undefined, notif.type)} activeOpacity={0.7}>
                            <Text style={s.cantGoText}>Can't go, maybe next time</Text>
                          </TouchableOpacity>
                        </View>
                      )}
                    </View>
                    {!isWaitlist && (
                      <View style={s.actions}>
                        {hasAction && (
                          <TouchableOpacity style={s.acceptBtn} onPress={() => handleNotifAction(notif.id, 'acted', notif.event_id, notif.type)}>
                            <Check size={16} color={Colors.white} />
                          </TouchableOpacity>
                        )}
                        <TouchableOpacity style={s.declineBtn} onPress={() => handleNotifAction(notif.id, 'read', undefined, notif.type)}>
                          <XCircle size={16} color={Colors.textLight} />
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                );
              })}

              {totalOldCount > 0 && (
                <>
                  <TouchableOpacity style={s.oldHeader} onPress={() => setOldExpanded((v) => !v)} activeOpacity={0.7}>
                    {oldExpanded ? <ChevronDown size={16} color={Colors.textLight} /> : <ChevronRight size={16} color={Colors.textLight} />}
                    <Text style={s.oldTitle}>Old messages ({totalOldCount})</Text>
                  </TouchableOpacity>
                  {oldExpanded && (
                    <>
                      {oldInvites.map((inv: any) => {
                        const sender = inv.profiles;
                        const plan = inv.events;
                        return (
                          <View key={`old-inv-${inv.id}`} style={[s.row, { opacity: 0.6 }]}>
                            {sender?.profile_photo_url ? (
                              <Image source={{ uri: sender.profile_photo_url }} style={s.avatar} contentFit="cover" />
                            ) : (
                              <View style={[s.avatar, s.avatarFallback]}><Send size={16} color={Colors.textLight} /></View>
                            )}
                            <View style={{ flex: 1, marginLeft: 10 }}>
                              <Text style={s.rowTitle} numberOfLines={1}>{sender?.first_name_display ?? 'Someone'} invited you</Text>
                              <Text style={s.planName} numberOfLines={1}>{plan?.title ?? 'a plan'}</Text>
                            </View>
                            <Text style={[s.statusLabel, inv.status === 'accepted' ? s.statusAccepted : s.statusDeclined]}>
                              {inv.status === 'accepted' ? 'Accepted' : 'Declined'}
                            </Text>
                          </View>
                        );
                      })}
                      {oldNotifications.map((notif: any) => {
                        const oldIcon = notif.type === 'invite_accepted' ? <Check size={16} color={Colors.textLight} />
                          : notif.type === 'member_joined' ? <UserPlus size={16} color={Colors.textLight} />
                          : notif.type === 'waitlist_spot' ? <Clock size={16} color={Colors.textLight} />
                          : notif.type === 'broadcast' ? <Megaphone size={16} color={Colors.textLight} />
                          : <Bell size={16} color={Colors.textLight} />;
                        return (
                          <View key={`old-notif-${notif.id}`} style={[s.row, { opacity: 0.6 }]}>
                            <View style={[s.avatar, s.avatarFallback]}>{oldIcon}</View>
                            <View style={{ flex: 1, marginLeft: 10 }}>
                              <Text style={s.rowTitle} numberOfLines={1}>{notif.title}</Text>
                              {notif.body && <Text style={s.planName} numberOfLines={2}>{notif.body}</Text>}
                            </View>
                            <Text style={[s.statusLabel, notif.status === 'expired' ? s.statusDeclined : s.statusRead]}>
                              {notif.status === 'expired' ? 'Expired' : 'Read'}
                            </Text>
                          </View>
                        );
                      })}
                    </>
                  )}
                </>
              )}
            </ScrollView>
          )}
          <TouchableOpacity style={s.doneBtn} onPress={onClose}>
            <Text style={s.doneBtnText}>Done</Text>
          </TouchableOpacity>
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
  overlay: { flex: 1, backgroundColor: Colors.overlayDark, justifyContent: 'center', alignItems: 'center' },
  sheet: { backgroundColor: Colors.white, borderRadius: 20, padding: 20, width: '85%', maxHeight: '60%' },
  title: { fontSize: FontSizes.bodyLG, fontFamily: Fonts.sansBold, color: Colors.asphalt, marginBottom: 16, textAlign: 'center' },
  list: { maxHeight: 300 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Colors.border },
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
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8, marginLeft: 8 },
  acceptBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: Colors.terracotta, alignItems: 'center', justifyContent: 'center' },
  declineBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: Colors.inputBg, alignItems: 'center', justifyContent: 'center' },
  oldHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 14, marginTop: 8, borderTopWidth: 1, borderTopColor: Colors.border },
  oldTitle: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.textLight },
  statusLabel: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.caption, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, overflow: 'hidden' },
  statusAccepted: { backgroundColor: `${Colors.terracotta}18`, color: Colors.terracotta },
  statusDeclined: { backgroundColor: `${Colors.textLight}18`, color: Colors.textLight },
  statusRead: { backgroundColor: `${Colors.textMedium}14`, color: Colors.textMedium },
  doneBtn: { marginTop: 12, paddingVertical: 10, alignItems: 'center' },
  doneBtnText: { fontSize: FontSizes.bodyLG, fontFamily: Fonts.sansMedium, color: Colors.terracotta },
});
