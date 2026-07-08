/**
 * The community's conversation (doc 09 final shape + batch 21): a fully open
 * member chat. Everyone talks freely through the composer; broadcasts and
 * intro cards are special highlighted rows INSIDE the same stream (one
 * table, one ordering, one unread count). Rooms remain the focused side
 * spaces. Mute-not-leave in the header, unreads clear on open, realtime on
 * the whole stream.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, Stack } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Bell, BellOff, CalendarDays } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes, LineHeights } from '../../constants/Typography';
import { BrandedAlert, type BrandedAlertButton } from '../../components/BrandedAlert';
import { BroadcastCard } from '../../components/communities/BroadcastCard';
import { friendlyError } from '../../lib/friendlyError';
import { hapticLight } from '../../lib/haptics';
import {
  getCommunityBroadcasts,
  getCommunityChatPayload,
  getMyBroadcastMute,
  getPinnedCommunityEvent,
  markBroadcastsRead,
  sendCommunityMessage,
  setBroadcastMute,
  type CommunityBroadcast,
} from '../../lib/communityChat';
import { getJoinGate } from '../../lib/communityJoin';
import { KEYBOARD_DONE_ACCESSORY_ID } from '../../components/keyboard/KeyboardDoneBar';
import { supabase } from '../../lib/supabase';

export default function CommunityThreadScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const listRef = useRef<FlatList<CommunityBroadcast>>(null);
  const [alertInfo, setAlertInfo] = React.useState<{ title: string; message?: string; buttons?: BrandedAlertButton[] } | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [myId, setMyId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setMyId(data.user?.id ?? null));
  }, []);

  const { data: payload } = useQuery({
    queryKey: ['community-chat-cards'],
    queryFn: getCommunityChatPayload,
  });
  const card = payload?.cards.find((c) => c.community_id === id) ?? null;

  const { data: broadcasts = [], isLoading } = useQuery({
    queryKey: ['community-broadcasts', id],
    queryFn: () => getCommunityBroadcasts(id!),
    enabled: !!id,
  });
  // chat order: oldest at the top, newest at the bottom
  const thread = [...broadcasts].reverse();

  const { data: muted = false } = useQuery({
    queryKey: ['community-mute', id],
    queryFn: () => getMyBroadcastMute(id!),
    enabled: !!id,
  });

  // chat model 7-07: the soonest upcoming Live event sits pinned at the top
  const { data: pinnedEvent = null } = useQuery({
    queryKey: ['community-pinned-event', id],
    queryFn: () => getPinnedCommunityEvent(id!),
    enabled: !!id,
  });

  // a joined thread never looks dead (correction 4): since migration 19 the
  // system-composed intro card IS in the thread, so a new member's room is
  // never truly empty; the welcome note covers the remaining edge
  const emptyThread = !isLoading && thread.length === 0;
  const { data: gate } = useQuery({
    queryKey: ['community-gate', id],
    queryFn: () => getJoinGate(id!),
    enabled: !!id && emptyThread,
  });

  useEffect(() => {
    if (!id) return;
    markBroadcastsRead(id)
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ['community-chat-cards'] });
        queryClient.invalidateQueries({ queryKey: ['community-chat-rows'] });
      })
      .catch(() => {});
    // one stream, live: messages, broadcasts, and intro cards all arrive here
    const channel = supabase
      .channel(`community-thread-${id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'community_broadcasts', filter: `community_id=eq.${id}` },
        () => {
          queryClient.invalidateQueries({ queryKey: ['community-broadcasts', id] });
          markBroadcastsRead(id).catch(() => {});
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
      queryClient.invalidateQueries({ queryKey: ['community-chat-cards'] });
      queryClient.invalidateQueries({ queryKey: ['community-chat-rows'] });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const showError = (title: string, message: string) => setAlertInfo({ title, message });

  const handleSend = async () => {
    if (!id || !draft.trim() || sending) return;
    setSending(true);
    try {
      await sendCommunityMessage(id, draft);
      setDraft('');
      await queryClient.invalidateQueries({ queryKey: ['community-broadcasts', id] });
      listRef.current?.scrollToEnd({ animated: true });
    } catch (e) {
      setAlertInfo({ title: 'That did not send', message: friendlyError(e, 'Try again in a moment.') });
    } finally {
      setSending(false);
    }
  };

  const handleMute = async () => {
    if (!id) return;
    try {
      await setBroadcastMute(id, !muted);
      hapticLight();
      queryClient.invalidateQueries({ queryKey: ['community-mute', id] });
    } catch (e) {
      showError('That did not save', friendlyError(e, 'Try again in a moment.'));
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
          <ArrowLeft size={22} color={Colors.asphalt} strokeWidth={2.5} />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.headerTitleTap}
          onPress={() => router.push(`/community/${id}` as never)}
          hitSlop={6}
        >
          <Text style={styles.headerTitle} numberOfLines={1}>{card?.name ?? 'community'}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={handleMute} hitSlop={12}>
          {muted ? (
            <BellOff size={20} color={Colors.tertiary} strokeWidth={2.5} />
          ) : (
            <Bell size={20} color={Colors.terracotta} strokeWidth={2.5} />
          )}
        </TouchableOpacity>
      </View>
      {muted && (
        <Text style={styles.mutedLine}>muted. you still see everything here, it just stays quiet.</Text>
      )}
      {!!pinnedEvent && (
        <TouchableOpacity
          style={styles.pinnedCard}
          onPress={() => router.push(`/event/${pinnedEvent.id}` as never)}
          activeOpacity={0.85}
        >
          <CalendarDays size={18} color={Colors.terracotta} strokeWidth={2.5} />
          <View style={styles.pinnedBody}>
            {/* LIZ COPY */}
            <Text style={styles.pinnedLabel}>up next</Text>
            <Text style={styles.pinnedTitle} numberOfLines={1}>{pinnedEvent.title}</Text>
            <Text style={styles.pinnedMeta} numberOfLines={1}>
              {[
                pinnedEvent.event_date
                  ? new Date(`${pinnedEvent.event_date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
                  : null,
                pinnedEvent.venue || null,
              ].filter(Boolean).join(' at ')}
            </Text>
          </View>
        </TouchableOpacity>
      )}

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.terracotta} />
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={thread}
          keyExtractor={(b) => b.id}
          renderItem={({ item }) =>
            item.kind === 'message' ? (
              <View style={[styles.messageRow, item.sender_id === myId && styles.messageRowMine]}>
                <View style={[styles.bubble, item.sender_id === myId && styles.bubbleMine]}>
                  {item.sender_id !== myId && (
                    <Text style={styles.senderName}>{item.sender_name ?? 'someone'}</Text>
                  )}
                  <Text style={[styles.messageText, item.sender_id === myId && styles.messageTextMine]}>
                    {item.body}
                  </Text>
                </View>
              </View>
            ) : (
              <BroadcastCard broadcast={item} communityName={card?.name ?? ''} onError={showError} />
            )
          }
          contentContainerStyle={styles.listContent}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          ListEmptyComponent={
            <View>
              {!!gate?.welcomeMessage && (
                <View style={styles.welcomeCard}>
                  <Text style={styles.welcomeFrom}>{card?.name ?? gate.name}</Text>
                  <Text style={styles.welcomeBody}>{gate.welcomeMessage}</Text>
                </View>
              )}
              {!gate?.welcomeMessage && (
                <Text style={styles.emptyLine}>it starts here.</Text>
              )}
            </View>
          }
        />
      )}

      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder="say something"
          placeholderTextColor={Colors.inkSoft}
          multiline
          maxLength={4000}
          inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
        />
        <TouchableOpacity
          style={[styles.sendBtn, (!draft.trim() || sending) && styles.sendBtnOff]}
          onPress={handleSend}
          disabled={!draft.trim() || sending}
        >
          {sending ? (
            <ActivityIndicator size="small" color={Colors.white} />
          ) : (
            <Text style={styles.sendBtnText}>send</Text>
          )}
        </TouchableOpacity>
      </View>

      </KeyboardAvoidingView>
      <BrandedAlert
        visible={!!alertInfo}
        title={alertInfo?.title ?? ''}
        message={alertInfo?.message}
        buttons={alertInfo?.buttons}
        onClose={() => setAlertInfo(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.parchment },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  headerTitleTap: { flex: 1 },
  headerTitle: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyLG,
    color: Colors.darkWarm,
    textAlign: 'center',
  },
  mutedLine: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.caption,
    color: Colors.tertiary,
    textAlign: 'center',
    marginBottom: 4,
  },
  pinnedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.cardBg,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginHorizontal: 16,
    marginBottom: 6,
  },
  pinnedBody: { flex: 1 },
  pinnedLabel: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.caption,
    color: Colors.terracotta,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  pinnedTitle: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.darkWarm, marginTop: 1 },
  pinnedMeta: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.secondary, marginTop: 1 },
  listContent: { padding: 16, paddingBottom: 40, flexGrow: 1 },
  emptyLine: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.secondary,
    lineHeight: LineHeights.bodyMD,
    textAlign: 'center',
    marginTop: 24,
  },
  welcomeCard: {
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    borderLeftWidth: 3,
    borderLeftColor: Colors.gold,
    padding: 14,
    marginBottom: 10,
  },
  welcomeFrom: { fontFamily: Fonts.sansBold, fontSize: FontSizes.caption, color: Colors.terracotta, marginBottom: 4 },
  welcomeBody: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.darkWarm, lineHeight: LineHeights.bodyMD },
  flex: { flex: 1 },
  messageRow: { flexDirection: 'row', marginBottom: 10 },
  messageRowMine: { justifyContent: 'flex-end' },
  bubble: {
    maxWidth: '78%',
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  bubbleMine: { backgroundColor: Colors.terracotta, borderColor: Colors.terracotta },
  senderName: { fontFamily: Fonts.sansBold, fontSize: FontSizes.caption, color: Colors.terracotta, marginBottom: 2 },
  messageText: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.darkWarm },
  messageTextMine: { color: Colors.white },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: Colors.parchment,
  },
  input: {
    flex: 1,
    maxHeight: 120,
    backgroundColor: Colors.inputBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.darkWarm,
  },
  sendBtn: {
    backgroundColor: Colors.terracotta,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  sendBtnOff: { opacity: 0.4 },
  sendBtnText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodySM, color: Colors.white },
});
