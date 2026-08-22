/**
 * A topic thread inside a community (doc 09: the rooms of the house).
 * Messages, composer, live inserts via realtime (community_topic_messages
 * is in the publication from phase 1), notifications toggle per the doc 09
 * defaults (ON once joined, per-topic mutable). Permanent by construction,
 * no expiry. Functionally minimal per decision 15a.
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
import { Image } from 'expo-image';
import { ArrowLeft, Bell, BellOff, ImagePlus } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes, LineHeights } from '../../constants/Typography';
import { BrandedAlert, type BrandedAlertButton } from '../../components/BrandedAlert';
import { ReportModal } from '../../components/modals/ReportModal';
import { useBlock } from '../../hooks/useBlock';
import { friendlyError } from '../../lib/friendlyError';
import { hapticLight } from '../../lib/haptics';
import { supabase } from '../../lib/supabase';
import { getCreatorAccess, isLeaderAccess } from '../../lib/creatorMode';
import { getMyMembership } from '../../lib/communityJoin';
import { setEventChatWelcomeMessage } from '../../lib/creatorEvents';
import { formatEventDateLA, formatTimestampLA } from '../../lib/laDate';
import {
  computeEventRoomExpiry,
  getCommunityChatPayload,
  getTopicMessages,
  hasSaidHiInTopic,
  markTopicRead,
  sendTopicMessage,
  deleteTopicMessage,
  getTopicMeta,
  setTopicNotifications,
  type TopicMessage,
} from '../../lib/communityChat';

export default function CommunityTopicScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const listRef = useRef<FlatList<TopicMessage>>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [myId, setMyId] = useState<string | null>(null);
  const [alertInfo, setAlertInfo] = useState<{ title: string; message?: string; buttons?: BrandedAlertButton[] } | null>(null);
  const [reportTarget, setReportTarget] = useState<{ id: string; name: string } | null>(null);
  const [showReport, setShowReport] = useState(false);
  const { blockUser } = useBlock();

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setMyId(data.user?.id ?? null)).catch(() => {});
  }, []);

  // Is this room still open? An archived topic refuses inserts at the policy
  // level, so the composer must say so rather than let the send come back as
  // a raw RLS error. Unknown (a read that fails) is treated as OPEN: the
  // server still holds the real gate, and guessing closed would silence a
  // room that works.
  const { data: topicMeta } = useQuery({
    queryKey: ['topic-meta', id],
    queryFn: () => getTopicMeta(id!),
    enabled: !!id,
    staleTime: 60_000,
  });
  const archived = topicMeta?.archived === true;

  // SC-07 (2026-08-19): a removed/banned member could still land on this
  // screen and see a live-looking composer with no explanation when the
  // send failed. Checked on the topic's own community, same shape as the
  // archived check above: a failed read is treated as still-a-member, the
  // server RLS is the real gate either way.
  const { data: myMembership } = useQuery({
    queryKey: ['topic-my-membership', topicMeta?.community_id],
    queryFn: () => getMyMembership(topicMeta!.community_id),
    enabled: !!topicMeta?.community_id,
    staleTime: 60_000,
  });
  const removedFromCommunity = myMembership?.status === 'removed' || myMembership?.status === 'banned';

  // inventory C-14: a real creator moderation action, distinct from the
  // report/block every member already has. Gated on this topic's OWN
  // community, not "any" led community -- RLS is the real backstop either
  // way, but the button should not even offer to remove a message in a
  // room this leader does not run.
  const { data: access } = useQuery({ queryKey: ['creator-access'], queryFn: getCreatorAccess });
  const canModerate =
    !!topicMeta && isLeaderAccess(access) &&
    (access?.ledCommunities.some((c) => c.id === topicMeta.community_id) ?? false);

  // SC-09: welcome message. set_event_chat_welcome_message only ever writes
  // while the topic is provably empty, attributed to the caller it just
  // authorized (host_user_id or a community leader) -- so "the first
  // message came from the host" is a reliable, no-extra-query signal once
  // host_user_id rides the topicMeta embed (lib/communityChat.ts). Derived
  // straight off already-fetched data, never a separate read.
  const hostUserId = topicMeta?.explore_events?.host_user_id ?? null;
  const iAmHostOrLeader = !!myId && (myId === hostUserId || canModerate);

  // SC-08 (2026-08-19): none of these three existed anywhere in this room --
  // no exact expiry timestamp, no logistics recap, no ticket/event-state
  // indicator. All three ride topicMeta's own embed, no extra read. The
  // expiry mirrors what the live cron ACTUALLY does today (start + 48h, a
  // known bug -- fix written but unapplied), not the fixed behavior, so this
  // is never wrong about what will really happen.
  const roomExpiry = topicMeta ? computeEventRoomExpiry(topicMeta) : null;
  const eventDateLabel = topicMeta?.explore_events?.event_date
    ? formatEventDateLA(topicMeta.explore_events.event_date)
    : topicMeta?.explore_events?.start_time
      ? formatEventDateLA(topicMeta.explore_events.start_time)
      : '';
  const eventStateLabel =
    topicMeta?.explore_events?.status === 'Cancelled'
      ? 'cancelled'
      : topicMeta?.explore_events?.status === 'Completed'
        ? 'completed'
        : null;
  const logisticsLine = [eventDateLabel, topicMeta?.explore_events?.venue, eventStateLabel]
    .filter(Boolean)
    .join(' · ');

  const [welcomeComposerOpen, setWelcomeComposerOpen] = useState(false);
  const [welcomeDraft, setWelcomeDraft] = useState('');
  const [savingWelcome, setSavingWelcome] = useState(false);

  const { data: payload } = useQuery({
    queryKey: ['community-chat-cards'],
    queryFn: getCommunityChatPayload,
  });
  // members find the room inside their card; attendees find it in their list
  const topic =
    payload?.cards.flatMap((c) => c.topics).find((t) => t.id === id) ??
    payload?.attendee_topics.find((t) => t.id === id) ??
    null;

  // event chats open only after you say something (Liz 7-07): RSVP is untouched,
  // but the room stays veiled until your first message lands. back always works.
  const eventTopic = !!topic?.explore_event_id;
  const [justSaidHi, setJustSaidHi] = useState(false);
  const { data: saidHi } = useQuery({
    queryKey: ['topic-said-hi', id, myId],
    queryFn: () => hasSaidHiInTopic(id!),
    enabled: !!id && !!myId && eventTopic,
  });
  const gated = eventTopic && !justSaidHi && saidHi === false;
  const gateChecking = eventTopic && !justSaidHi && saidHi === undefined;

  const messagesKey = ['topic-messages', id];
  const { data: messages = [], isLoading } = useQuery({
    queryKey: messagesKey,
    queryFn: () => getTopicMessages(id!),
    enabled: !!id,
  });

  // this reads regardless of the "say hi first" gate below -- messages are
  // already fetched either way, the gate only decides whether the FlatList
  // renders. That's the fix: previously a first-time entrant saw only the
  // gate card and never the creator's welcome until AFTER saying hi.
  const welcomeMessage =
    eventTopic && hostUserId && messages.length > 0 && messages[0].sender_id === hostUserId
      ? messages[0]
      : null;
  const visibleMessages = welcomeMessage ? messages.slice(1) : messages;
  // only while the room is genuinely empty -- mirrors the RPC's own guard,
  // so the affordance never implies a second welcome could still be set
  const canSetWelcome = eventTopic && messages.length === 0 && iAmHostOrLeader;

  const handleSaveWelcome = async () => {
    // set_event_chat_welcome_message takes the EVENT id, not this screen's
    // topic id -- it looks the topic up itself via explore_event_id
    const eventId = topic?.explore_event_id;
    if (!eventId || !welcomeDraft.trim() || savingWelcome) return;
    setSavingWelcome(true);
    try {
      await setEventChatWelcomeMessage(eventId, welcomeDraft);
      setWelcomeDraft('');
      setWelcomeComposerOpen(false);
      await queryClient.invalidateQueries({ queryKey: messagesKey });
    } catch (e) {
      setAlertInfo({ title: 'That did not save', message: friendlyError(e, 'Try again in a moment.') });
    } finally {
      setSavingWelcome(false);
    }
  };

  // live inserts (house realtime pattern); read marker on open and on new
  useEffect(() => {
    if (!id) return;
    markTopicRead(id).catch(() => {});
    const channel = supabase
      .channel(`community-topic-${id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'community_topic_messages', filter: `topic_id=eq.${id}` },
        () => {
          queryClient.invalidateQueries({ queryKey: messagesKey });
          markTopicRead(id).catch(() => {});
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

  const handleSend = async () => {
    if (!id || !draft.trim() || sending) return;
    setSending(true);
    try {
      await sendTopicMessage(id, draft);
      setDraft('');
      if (gated || gateChecking) {
        setJustSaidHi(true);
        queryClient.invalidateQueries({ queryKey: ['topic-said-hi', id, myId] });
      }
      await queryClient.invalidateQueries({ queryKey: messagesKey });
      listRef.current?.scrollToEnd({ animated: true });
    } catch (e) {
      setAlertInfo({ title: 'That did not send', message: friendlyError(e, 'Try again in a moment.') });
    } finally {
      setSending(false);
    }
  };

  const handleNotifications = async () => {
    if (!id || !topic) return;
    try {
      await setTopicNotifications(id, !topic.notifications_on);
      hapticLight();
      queryClient.invalidateQueries({ queryKey: ['community-chat-cards'] });
    } catch (e) {
      setAlertInfo({ title: 'That did not save', message: friendlyError(e, 'Try again in a moment.') });
    }
  };

  const handleDeleteMessage = async (messageId: string) => {
    try {
      await deleteTopicMessage(messageId);
      hapticLight();
      queryClient.invalidateQueries({ queryKey: messagesKey });
    } catch (e) {
      setAlertInfo({ title: 'That did not remove', message: friendlyError(e, 'Try again in a moment.') });
    }
  };

  // report / block a member from a long-press on their message (mirrors chat).
  // Blocking refetches so their messages drop out via the block filter.
  // Creator moderation (C-14) adds one more option, only when canModerate.
  const openMemberMenu = (userId: string, name: string, messageId: string) => {
    if (!userId || userId === myId) return;
    hapticLight();
    setAlertInfo({
      title: name,
      buttons: [
        { text: 'report', onPress: () => { setReportTarget({ id: userId, name }); setShowReport(true); } },
        { text: 'block', style: 'destructive', onPress: () => blockUser(userId, name, () => queryClient.invalidateQueries({ queryKey: messagesKey })) },
        ...(canModerate
          ? [{ text: 'remove this message', style: 'destructive' as const, onPress: () => handleDeleteMessage(messageId) }]
          : []),
        { text: 'cancel', style: 'cancel' },
      ],
    });
  };

  const renderMessage = ({ item }: { item: TopicMessage }) => {
    const mine = item.sender_id === myId;
    return (
      <View style={[styles.messageRow, mine && styles.messageRowMine]}>
        {!mine && (item.sender_photo ? (
          <Image source={{ uri: item.sender_photo }} style={styles.face} contentFit="cover" />
        ) : (
          <View style={[styles.face, styles.facePlaceholder]}>
            <Text style={styles.faceInitial}>{(item.sender_name ?? '?').slice(0, 1).toLowerCase()}</Text>
          </View>
        ))}
        <TouchableOpacity
          activeOpacity={0.9}
          onLongPress={() => !mine && openMemberMenu(item.sender_id, item.sender_name ?? 'someone', item.id)}
          style={[styles.bubble, mine && styles.bubbleMine]}
          accessibilityHint={!mine ? 'hold to report or block' : undefined}
        >
          {!mine && <Text style={styles.senderName}>{item.sender_name ?? 'someone'}</Text>}
          <Text style={[styles.messageText, mine && styles.messageTextMine]}>{item.body}</Text>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
            <ArrowLeft size={22} color={Colors.asphalt} strokeWidth={2.5} />
          </TouchableOpacity>
          <Text style={styles.headerTitle} numberOfLines={1}>{topic?.name ?? 'room'}</Text>
          {eventTopic && (
            <TouchableOpacity
              onPress={() => router.push(`/event-album/${id}` as never)}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Photos"
            >
              <ImagePlus size={20} color={Colors.terracotta} strokeWidth={2.25} />
            </TouchableOpacity>
          )}
          <TouchableOpacity
            onPress={handleNotifications}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={topic?.notifications_on ? 'Turn off notifications for this room' : 'Turn on notifications for this room'}
            accessibilityState={{ selected: !!topic?.notifications_on }}
          >
            {topic?.notifications_on ? (
              <Bell size={20} color={Colors.terracotta} strokeWidth={2.5} />
            ) : (
              <BellOff size={20} color={Colors.tertiary} strokeWidth={2.5} />
            )}
          </TouchableOpacity>
        </View>

        {eventTopic && (!!logisticsLine || !!roomExpiry) && (
          /* SC-08: a real logistics recap, event-state indicator, and exact
             expiry timestamp, none of which existed anywhere in this room. */
          <View style={styles.logisticsRow}>
            {!!logisticsLine && (
              <Text style={styles.logisticsText} numberOfLines={1}>{logisticsLine}</Text>
            )}
            {!!roomExpiry && (
              /* copy to the taste gate */
              <Text style={styles.expiryText}>room closes {formatTimestampLA(roomExpiry.toISOString())}</Text>
            )}
          </View>
        )}

        {welcomeMessage && (
          // SC-09: the creator's seeded first message, shown as its own
          // card rather than a normal bubble -- visible on first entering
          // the room (even while gated below), not buried behind "say hi
          // first". Same neutral card language as the gate card; gold stays
          // reserved for the documented tappable-only exceptions.
          <View style={styles.welcomeCard}>
            <Text style={styles.welcomeLabel}>a note from the creator</Text>
            <Text style={styles.welcomeBody}>{welcomeMessage.body}</Text>
          </View>
        )}

        {canSetWelcome && (
          welcomeComposerOpen ? (
            <View style={styles.welcomeComposerCard}>
              {/* copy to the taste gate */}
              <Text style={styles.welcomeLabel}>welcome message</Text>
              <TextInput
                style={styles.welcomeInput}
                value={welcomeDraft}
                onChangeText={setWelcomeDraft}
                placeholder="say hi before anyone else does"
                placeholderTextColor={Colors.inkSoft}
                multiline
                maxLength={4000}
                autoFocus
                accessibilityLabel="Welcome message for this room"
              />
              <View style={styles.welcomeComposerActions}>
                <TouchableOpacity
                  onPress={() => { setWelcomeComposerOpen(false); setWelcomeDraft(''); }}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Cancel"
                >
                  <Text style={styles.welcomeCancelText}>cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.welcomeSaveBtn, (!welcomeDraft.trim() || savingWelcome) && styles.sendBtnOff]}
                  onPress={handleSaveWelcome}
                  disabled={!welcomeDraft.trim() || savingWelcome}
                  accessibilityRole="button"
                  accessibilityLabel="Save welcome message"
                  accessibilityState={{ disabled: !welcomeDraft.trim() || savingWelcome, busy: savingWelcome }}
                >
                  {savingWelcome ? (
                    <ActivityIndicator size="small" color={Colors.white} />
                  ) : (
                    <Text style={styles.sendBtnText}>save</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <TouchableOpacity
              style={styles.welcomePrompt}
              onPress={() => { hapticLight(); setWelcomeComposerOpen(true); }}
              accessibilityRole="button"
              accessibilityLabel="Add a welcome message for this room"
            >
              <Text style={styles.welcomePromptText}>+ add a welcome message for your room</Text>
            </TouchableOpacity>
          )
        )}

        {isLoading || gateChecking ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={Colors.terracotta} />
          </View>
        ) : gated ? (
          <View style={styles.gateWrap}>
            <View style={styles.gateCard}>
              {/* LIZ COPY */}
              <Text style={styles.gateTitle}>say hi first</Text>
              <Text style={styles.gateBody}>
                drop a hi and what area you're from. the chat opens right after.
              </Text>
            </View>
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={visibleMessages}
            keyExtractor={(m) => m.id}
            renderItem={renderMessage}
            contentContainerStyle={styles.listContent}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
            ListEmptyComponent={
              <Text style={styles.emptyLine}>nobody has said anything here yet. go first.</Text>
            }
          />
        )}

        {removedFromCommunity ? (
          <View style={styles.closedNote}>
            {/* SC-07: a real reason, not a silently-broken composer.
                copy to the taste gate */}
            <Text style={styles.closedText}>you were removed from this community.</Text>
          </View>
        ) : archived ? (
          <View style={styles.closedNote}>
            {/* copy to the taste gate */}
            <Text style={styles.closedText}>
              {topicMeta?.explore_events?.status === 'Cancelled'
                ? 'this room is closed. the event was cancelled.'
                : 'this room is closed. the event has passed.'}
            </Text>
          </View>
        ) : (
        <View style={styles.composer}>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder={gated ? "hi, i'm from..." : 'say something'}
            placeholderTextColor={Colors.inkSoft}
            multiline
            maxLength={4000}
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
        )}
      </KeyboardAvoidingView>

      {reportTarget && (
        <ReportModal
          visible={showReport}
          onClose={() => { setShowReport(false); setReportTarget(null); }}
          reportedUserId={reportTarget.id}
          reportedUserName={reportTarget.name}
        />
      )}

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
  flex: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  headerTitle: {
    flex: 1,
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyLG,
    color: Colors.darkWarm,
    textAlign: 'center',
  },
  listContent: { padding: 16, gap: 10, flexGrow: 1 },
  logisticsRow: {
    paddingHorizontal: 16,
    paddingBottom: 8,
    gap: 1,
  },
  logisticsText: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.caption,
    color: Colors.secondary,
    textAlign: 'center',
  },
  expiryText: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.caption,
    color: Colors.tertiary,
    textAlign: 'center',
  },
  welcomeCard: {
    marginHorizontal: 16,
    marginTop: 4,
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 14,
  },
  welcomeLabel: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.caption,
    color: Colors.terracotta,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  welcomeBody: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.darkWarm, lineHeight: LineHeights.bodyMD },
  welcomePrompt: {
    marginHorizontal: 16,
    marginTop: 4,
    borderRadius: 16,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: Colors.border,
    paddingVertical: 12,
    alignItems: 'center',
  },
  welcomePromptText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.terracotta },
  welcomeComposerCard: {
    marginHorizontal: 16,
    marginTop: 4,
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 14,
    gap: 8,
  },
  welcomeInput: {
    minHeight: 60,
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.darkWarm,
    textAlignVertical: 'top',
  },
  welcomeComposerActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 16 },
  welcomeCancelText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.tertiary },
  welcomeSaveBtn: {
    backgroundColor: Colors.terracotta,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  gateWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  gateCard: {
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 20,
    alignItems: 'center',
    gap: 6,
  },
  gateTitle: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyLG,
    color: Colors.darkWarm,
  },
  gateBody: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.secondary,
    lineHeight: LineHeights.bodySM,
    textAlign: 'center',
  },
  emptyLine: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.secondary,
    lineHeight: LineHeights.bodySM,
    textAlign: 'center',
    marginTop: 24,
  },
  messageRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  messageRowMine: { justifyContent: 'flex-end' },
  face: { width: 28, height: 28, borderRadius: 14 },
  facePlaceholder: { backgroundColor: Colors.accentSubtle, alignItems: 'center', justifyContent: 'center' },
  faceInitial: { fontFamily: Fonts.sansBold, fontSize: FontSizes.caption, color: Colors.terracotta },
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
  closedNote: {
    paddingHorizontal: 16,
    paddingVertical: 18,
    alignItems: 'center',
  },
  closedText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Colors.textMedium,
    textAlign: 'center',
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
  sendBtnText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.white },
});
