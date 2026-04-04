import { useQuery, useQueryClient } from '@tanstack/react-query';
import { hapticLight } from '../lib/haptics';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Bell, Clock, Send } from 'lucide-react-native';
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
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
  const [alertInfo, setAlertInfo] = useState<{ title: string; message: string; buttons?: BrandedAlertButton[] } | null>(null);

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
        const { data } = await supabase
          .from('app_notifications')
          .select('id, type, title, body, event_id, status, expires_at, created_at')
          .eq('user_id', userId)
          .eq('status', 'unread')
          .neq('type', 'plan_invite')
          .neq('type', 'new_message')
          .order('created_at', { ascending: false })
          .limit(30);

        if (!data || data.length === 0) return [];

        // Try to extract sender name from title (e.g. "Hello joined your plan!" → "Hello")
        // and look up their profile photo
        const nameMatches = data
          .filter((n: any) => n.type === 'member_joined' || n.type === 'invite_accepted')
          .map((n: any) => {
            const match = n.title?.match(/^(\S+)\s/);
            return match?.[1] ?? null;
          })
          .filter(Boolean);

        let photoMap: Record<string, string> = {};
        if (nameMatches.length > 0) {
          const { data: profiles } = await supabase
            .from('profiles_public')
            .select('first_name_display, profile_photo_url')
            .in('first_name_display', nameMatches);
          (profiles ?? []).forEach((p: any) => {
            if (p.profile_photo_url && p.first_name_display) {
              photoMap[p.first_name_display] = p.profile_photo_url;
            }
          });
        }

        return data.map((n: any) => {
          const match = n.title?.match(/^(\S+)\s/);
          const senderName = match?.[1] ?? null;
          return { ...n, sender_photo: senderName ? (photoMap[senderName] ?? null) : null };
        });
      } catch { return []; }
    },
    enabled: !!userId && visible,
    staleTime: 0,
  });

  const totalInboxCount = pendingInvites.length + appNotifications.length;

  const handleNotifAction = useCallback(async (notifId: string, action: 'acted' | 'read', eventId?: string, notifType?: string) => {
    hapticLight();
    try {
      await supabase.from('app_notifications').update({ status: action }).eq('id', notifId);
      if (notifType === 'waitlist_spot' && eventId && userId) {
        try { await supabase.from('event_waitlist').delete().eq('event_id', eventId).eq('user_id', userId); } catch {}
      }
      refetchNotifs();
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
  }, [refetchNotifs, router, queryClient, userId, onClose]);

  if (!visible) return null;

  return (
    <Modal visible transparent animationType="slide">
      <Pressable style={s.overlay} onPress={onClose}>
        <Pressable style={s.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={s.handle} />
          <Text style={s.title}>Notifications</Text>
          {loadingInvites || loadingNotifs ? (
            <ActivityIndicator color={Colors.terracotta} style={{ paddingVertical: 32 }} />
          ) : totalInboxCount === 0 ? (
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
                const hasAction = (notif.type === 'waitlist_spot' || notif.type === 'member_joined' || notif.type === 'invite_accepted') && notif.event_id;
                const timeLeft = notif.expires_at
                  ? Math.max(0, Math.round((new Date(notif.expires_at).getTime() - Date.now()) / 3600000))
                  : null;
                return (
                  <TouchableOpacity
                    key={`notif-${notif.id}`}
                    style={s.notifRow}
                    activeOpacity={0.7}
                    onPress={() => hasAction ? handleNotifAction(notif.id, 'acted', notif.event_id, notif.type) : handleNotifAction(notif.id, 'read')}
                  >
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
                    </View>
                    {!isWaitlist && (
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
  title: { fontSize: 17, fontWeight: '700' as const, color: '#2C1810', marginBottom: 16, textAlign: 'center' },
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
  notifBody: { fontSize: 13, color: '#78695C', marginTop: 1, lineHeight: 18 },
  dismissText: { fontSize: 12, color: '#A09385', marginLeft: 8 },
  inviteActions: { flexDirection: 'row' as const, gap: 10, paddingBottom: 12, justifyContent: 'center' as const },
  letsGoBtn: { backgroundColor: Colors.terracotta, paddingHorizontal: 24, paddingVertical: 10, borderRadius: 999 },
  letsGoBtnText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.white },
  notThisTimeBtn: { paddingHorizontal: 16, paddingVertical: 10, justifyContent: 'center' as const },
  notThisTimeBtnText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Colors.textLight },
});
