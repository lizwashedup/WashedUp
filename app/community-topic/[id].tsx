/**
 * A topic thread inside a community (doc 09: the rooms of the house).
 * Messages, composer, live inserts via realtime (community_topic_messages
 * is in the publication from phase 1), notifications toggle per the doc 09
 * defaults (ON once joined, per-topic mutable). Permanent by construction,
 * no expiry. Uses its own topic-table chat hook so existing room history stays
 * in place while the UI reaches plan/circle-chat parity.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, Stack } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { ArrowLeft, Bell, BellOff, ChevronDown, Image as ImageIcon, ImagePlus, X } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes, LineHeights } from '../../constants/Typography';
import { BrandedAlert, type BrandedAlertButton } from '../../components/BrandedAlert';
import { ReportModal } from '../../components/modals/ReportModal';
import { useBlock } from '../../hooks/useBlock';
import { useTopicChat } from '../../hooks/useTopicChat';
import { useTypingIndicator } from '../../hooks/useTypingIndicator';
import LinkifiedText from '../../components/LinkifiedText';
import LinkPreviewCard from '../../components/chat/LinkPreviewCard';
import MiniProfileCard from '../../components/MiniProfileCard';
import ReactionEmojiPicker from '../../components/chat/ReactionEmojiPicker';
import { friendlyError } from '../../lib/friendlyError';
import { hapticLight } from '../../lib/haptics';
import { getCreatorAccess, isLeaderAccess } from '../../lib/creatorMode';
import { getMyMembership } from '../../lib/communityJoin';
import { setEventChatWelcomeMessage } from '../../lib/creatorEvents';
import { formatEventDateLA, formatTimestampLA } from '../../lib/laDate';
import { extractFirstUrl, openUrl, soleUrlIn } from '../../lib/url';
import { formatChatDay, insertMentionAt, isSameChatDay, mentionQueryAt } from '../../lib/communityChatUi';
import { pickAndUploadChatPhoto } from '../../lib/pickChatPhoto';
import {
  computeEventRoomExpiry,
  getCommunityChatPayload,
  getTopicChatMembers,
  hasSaidHiInTopic,
  markTopicRead,
  deleteTopicMessage,
  getTopicMeta,
  setTopicNotifications,
  type TopicMessage,
} from '../../lib/communityChat';

const REACTION_SET = ['❤️', '🔥', '👏'];
const MENTION_LIMIT = 6;

export default function CommunityTopicScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const listRef = useRef<FlatList<TopicMessage>>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [replyingTo, setReplyingTo] = useState<TopicMessage | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [unreadWhileScrolled, setUnreadWhileScrolled] = useState(0);
  const selectionRef = useRef({ start: 0, end: 0 });
  const draftRef = useRef('');
  const previousMessageCountRef = useRef(0);
  const [alertInfo, setAlertInfo] = useState<{ title: string; message?: string; buttons?: BrandedAlertButton[] } | null>(null);
  const [reportTarget, setReportTarget] = useState<{ id: string; name: string } | null>(null);
  const [showReport, setShowReport] = useState(false);
  const [reactionPickerMsgId, setReactionPickerMsgId] = useState<string | null>(null);
  const { blockUser } = useBlock();

  const {
    messages,
    loading: messagesLoading,
    currentUserId: myId,
    currentUserName,
    sendMessage,
    editMessage,
    deleteMessage,
    toggleReaction,
    refresh: refreshMessages,
  } = useTopicChat(id);

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
  // authorized (the event creator or a community leader) -- so "the first
  // message came from the creator" is a reliable, no-extra-query signal once
  // the creator id rides the topicMeta embed (lib/communityChat.ts). Derived
  // straight off already-fetched data, never a separate read.
  const creatorUserId = topicMeta?.explore_events?.host_user_id ?? null;
  const iAmCreatorOrLeader = !!myId && (myId === creatorUserId || canModerate);

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

  const { data: members = [] } = useQuery({
    queryKey: ['topic-chat-members', id],
    queryFn: () => getTopicChatMembers(id!),
    enabled: !!id,
    staleTime: 60_000,
  });
  const mentionNames = useMemo(() => new Set(
    members.flatMap((member) => member.first_name ? [member.first_name.toLowerCase()] : []),
  ), [members]);
  const mentionCandidates = useMemo(() => {
    if (mentionQuery === null) return [];
    const query = mentionQuery.toLowerCase();
    return members
      .filter((member) => member.id !== myId && member.first_name && (!query || member.first_name.toLowerCase().startsWith(query)))
      .slice(0, MENTION_LIMIT);
  }, [members, mentionQuery, myId]);
  const { typingUsers, broadcastTyping, stopTyping } = useTypingIndicator(
    id,
    myId,
    currentUserName,
    'community-topic',
  );
  const typingLabel = useMemo(() => {
    if (typingUsers.length === 0) return null;
    if (typingUsers.length === 1) return `${typingUsers[0].name} is typing...`;
    if (typingUsers.length === 2) return `${typingUsers[0].name} and ${typingUsers[1].name} are typing...`;
    return 'several people are typing...';
  }, [typingUsers]);

  // this reads regardless of the "say hi first" gate below -- messages are
  // already fetched either way, the gate only decides whether the FlatList
  // renders. That's the fix: previously a first-time entrant saw only the
  // gate card and never the creator's welcome until AFTER saying hi.
  const welcomeMessage =
    eventTopic && creatorUserId && messages.length > 0 && messages[0].sender_id === creatorUserId
      ? messages[0]
      : null;
  const visibleMessages = welcomeMessage ? messages.slice(1) : messages;
  // only while the room is genuinely empty -- mirrors the RPC's own guard,
  // so the affordance never implies a second welcome could still be set
  const canSetWelcome = eventTopic && messages.length === 0 && iAmCreatorOrLeader;

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
      await refreshMessages();
    } catch (e) {
      setAlertInfo({ title: 'That did not save', message: friendlyError(e, 'Try again in a moment.') });
    } finally {
      setSavingWelcome(false);
    }
  };

  // The hook owns live message/reaction refresh. This screen owns read markers
  // and chat-list invalidation because those are navigation concerns.
  useEffect(() => {
    if (!id) return;
    markTopicRead(id).catch(() => {});
    return () => {
      queryClient.invalidateQueries({ queryKey: ['community-chat-cards'] });
      queryClient.invalidateQueries({ queryKey: ['community-chat-rows'] });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const handleSend = async () => {
    if (!id || !draft.trim() || sending) return;
    setSending(true);
    try {
      if (editingMessageId) {
        await editMessage(editingMessageId, draft);
      } else {
        await sendMessage(draft, undefined, replyingTo?.id);
      }
      setDraft('');
      draftRef.current = '';
      setEditingMessageId(null);
      setReplyingTo(null);
      setMentionQuery(null);
      stopTyping();
      if (!editingMessageId && (gated || gateChecking)) {
        setJustSaidHi(true);
        queryClient.invalidateQueries({ queryKey: ['topic-said-hi', id, myId] });
      }
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

  const handleDeleteMessage = async (messageId: string, ownMessage = false) => {
    try {
      if (ownMessage) await deleteMessage(messageId);
      else {
        await deleteTopicMessage(messageId);
        await refreshMessages();
      }
      hapticLight();
    } catch (e) {
      setAlertInfo({ title: 'That did not remove', message: friendlyError(e, 'Try again in a moment.') });
    }
  };

  // report / block a member from a long-press on their message (mirrors chat).
  // Blocking refetches so their messages drop out via the block filter.
  // Creator moderation (C-14) adds one more option, only when canModerate.
  const beginReply = (message: TopicMessage) => {
    setReplyingTo(message);
    setEditingMessageId(null);
  };

  const beginEdit = (message: TopicMessage) => {
    setDraft(message.body);
    draftRef.current = message.body;
    setEditingMessageId(message.id);
    setReplyingTo(null);
  };

  const openMemberMenu = (message: TopicMessage) => {
    const userId = message.sender_id;
    const name = message.sender_name ?? 'someone';
    if (!userId || userId === myId) return;
    hapticLight();
    setAlertInfo({
      title: name,
      buttons: [
        { text: 'react', onPress: () => setReactionPickerMsgId(message.id) },
        { text: 'reply', onPress: () => beginReply(message) },
        { text: 'report', onPress: () => { setReportTarget({ id: userId, name }); setShowReport(true); } },
        { text: 'block', style: 'destructive', onPress: () => blockUser(userId, name, () => refreshMessages()) },
        ...(canModerate
          ? [{ text: 'remove this message', style: 'destructive' as const, onPress: () => handleDeleteMessage(message.id) }]
          : []),
        { text: 'cancel', style: 'cancel' },
      ],
    });
  };

  // Own-message actions stay separate from member moderation actions.
  const openOwnMessageMenu = (message: TopicMessage) => {
    hapticLight();
    setAlertInfo({
      title: 'Your message',
      buttons: [
        { text: 'react', onPress: () => setReactionPickerMsgId(message.id) },
        { text: 'reply', onPress: () => beginReply(message) },
        ...(message.body ? [{ text: 'edit', onPress: () => beginEdit(message) }] : []),
        { text: 'delete this message', style: 'destructive', onPress: () => handleDeleteMessage(message.id, true) },
        { text: 'cancel', style: 'cancel' },
      ],
    });
  };

  const handlePickPhoto = async () => {
    if (!myId || uploadingPhoto || gated || editingMessageId) return;
    setUploadingPhoto(true);
    try {
      const imageUrl = await pickAndUploadChatPhoto(myId);
      if (!imageUrl) return;
      await sendMessage(draft, imageUrl, replyingTo?.id);
      setDraft('');
      draftRef.current = '';
      setReplyingTo(null);
      setMentionQuery(null);
      stopTyping();
      listRef.current?.scrollToEnd({ animated: true });
    } catch (e) {
      setAlertInfo({ title: 'That photo did not send', message: friendlyError(e, 'Try again in a moment.') });
    } finally {
      setUploadingPhoto(false);
    }
  };

  const insertMention = (firstName: string) => {
    const inserted = insertMentionAt(draftRef.current, selectionRef.current.start, firstName);
    setDraft(inserted.text);
    draftRef.current = inserted.text;
    selectionRef.current = { start: inserted.caret, end: inserted.caret };
    setMentionQuery(null);
  };

  useEffect(() => {
    const previous = previousMessageCountRef.current;
    if (previous > 0 && visibleMessages.length > previous && !isAtBottom) {
      setUnreadWhileScrolled((count) => count + visibleMessages.length - previous);
    }
    previousMessageCountRef.current = visibleMessages.length;
  }, [isAtBottom, visibleMessages.length]);

  // Review finding 2026-08-29: keying off messages.length stops detecting new
  // arrivals once the room hits the 300-message query cap, since an insert
  // just replaces the oldest row instead of growing the array. The newest
  // message's own id always changes on a real arrival, capped or not.
  const lastMessageId = messages.length > 0 ? messages[messages.length - 1].id : null;
  useEffect(() => {
    if (id && lastMessageId) markTopicRead(id).catch(() => {});
  }, [id, lastMessageId]);

  const renderMessage = ({ item, index }: { item: TopicMessage; index: number }) => {
    const mine = item.sender_id === myId;
    const previous = index > 0 ? visibleMessages[index - 1] : null;
    const grouped = !!previous && previous.sender_id === item.sender_id && isSameChatDay(previous.created_at, item.created_at);
    const showDay = !previous || !isSameChatDay(previous.created_at, item.created_at);
    const firstUrl = extractFirstUrl(item.body);
    // Mirrors the Community chat / ChatThread bubbleUrl fix (8-02, restated
    // live 2026-08-27): the bubble's own onLongPress claims the touch
    // responder, which can swallow a nested LinkifiedText <Text onPress>
    // before it fires. A message with exactly one link makes the whole
    // bubble a second, ancestor-proof way into that link.
    const bubbleUrl = soleUrlIn(item.body);
    return (
      <View>
        {showDay && <Text style={styles.daySeparator}>{formatChatDay(item.created_at)}</Text>}
        <View style={[styles.messageRow, grouped && styles.messageRowGrouped, mine && styles.messageRowMine]}>
          {!mine && (!grouped ? (
            <TouchableOpacity onPress={() => setProfileUserId(item.sender_id)} accessibilityLabel={`View ${item.sender_name ?? 'member'} profile`}>
              {item.sender_photo ? (
                <Image source={{ uri: item.sender_photo }} style={styles.face} contentFit="cover" />
              ) : (
                <View style={[styles.face, styles.facePlaceholder]}>
                  <Text style={styles.faceInitial}>{(item.sender_name ?? '?').slice(0, 1).toLowerCase()}</Text>
                </View>
              )}
            </TouchableOpacity>
          ) : <View style={styles.faceSpacer} />)}
          <View style={styles.bubbleWrap}>
            <TouchableOpacity
              activeOpacity={0.9}
              onPress={bubbleUrl ? () => openUrl(bubbleUrl) : undefined}
              onLongPress={() => (mine ? openOwnMessageMenu(item) : openMemberMenu(item))}
              style={[styles.bubble, mine && styles.bubbleMine]}
              accessibilityHint={mine ? 'hold for message actions' : 'hold for message actions'}
            >
              {!mine && !grouped && <Text style={styles.senderName}>{item.sender_name ?? 'someone'}</Text>}
              {!!item.reply_to && (
                <View style={[styles.quote, mine && styles.quoteMine]}>
                  <Text style={[styles.quoteName, mine && styles.messageTextMine]}>{item.reply_to.sender_name ?? 'someone'}</Text>
                  <Text style={[styles.quoteBody, mine && styles.messageTextMine]} numberOfLines={2}>{item.reply_to.body || 'photo'}</Text>
                </View>
              )}
              {!!item.image_url && <Image source={{ uri: item.image_url }} style={styles.messageImage} contentFit="cover" />}
              {!!item.body && (
                <LinkifiedText
                  text={item.body}
                  style={[styles.messageText, mine && styles.messageTextMine]}
                  linkStyle={mine && styles.messageTextMine}
                  mentionNames={mentionNames}
                  mentionStyle={mine && styles.messageTextMine}
                />
              )}
              {!!firstUrl && <LinkPreviewCard url={firstUrl} isOwn={mine} />}
              {!!item.edited_at && <Text style={[styles.editedText, mine && styles.editedTextMine]}>edited</Text>}
            </TouchableOpacity>
            <View style={[styles.reactionRow, mine && styles.reactionRowMine]}>
              {REACTION_SET.map((emoji) => {
                const reactions = item.reactions.filter((reaction) => reaction.reaction === emoji);
                const mineReaction = reactions.some((reaction) => reaction.user_id === myId);
                return (
                  <TouchableOpacity
                    key={emoji}
                    style={[styles.reactionChip, mineReaction && styles.reactionChipMine]}
                    onPress={() => toggleReaction(item.id, emoji).catch((e) => setAlertInfo({ title: 'That did not land', message: friendlyError(e, 'Try again in a moment.') }))}
                    accessibilityLabel={`React ${emoji}`}
                  >
                    <Text style={styles.reactionText}>{emoji}{reactions.length ? ` ${reactions.length}` : ''}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </View>
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
          <Text style={styles.headerTitle} numberOfLines={1}>{topic?.name ?? 'chat space'}</Text>
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
            accessibilityLabel={topic?.notifications_on ? 'Turn off notifications for this chat space' : 'Turn on notifications for this chat space'}
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
              <Text style={styles.expiryText}>chat space closes {formatTimestampLA(roomExpiry.toISOString())}</Text>
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
                accessibilityLabel="Welcome message for this chat space"
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
              accessibilityLabel="Add a welcome message for this chat space"
            >
              <Text style={styles.welcomePromptText}>+ add a welcome message for your chat space</Text>
            </TouchableOpacity>
          )
        )}

        {messagesLoading || gateChecking ? (
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
          <View style={styles.listWrap}>
            <FlatList
              ref={listRef}
              data={visibleMessages}
              keyExtractor={(m) => m.id}
              renderItem={renderMessage}
              contentContainerStyle={styles.listContent}
              onScroll={(event) => {
                const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
                const atBottom = contentOffset.y + layoutMeasurement.height >= contentSize.height - 80;
                setIsAtBottom(atBottom);
                if (atBottom) setUnreadWhileScrolled(0);
              }}
              scrollEventThrottle={100}
              onContentSizeChange={() => {
                if (isAtBottom) listRef.current?.scrollToEnd({ animated: false });
              }}
              ListEmptyComponent={
                <Text style={styles.emptyLine}>nobody has said anything here yet. go first.</Text>
              }
            />
            {!isAtBottom && (
              <TouchableOpacity
                style={styles.scrollLatestBtn}
                onPress={() => {
                  listRef.current?.scrollToEnd({ animated: true });
                  setUnreadWhileScrolled(0);
                }}
                accessibilityRole="button"
                accessibilityLabel="Scroll to latest messages"
              >
                <ChevronDown size={17} color={Colors.white} strokeWidth={2.5} />
                {unreadWhileScrolled > 0 && <Text style={styles.scrollLatestText}>{unreadWhileScrolled}</Text>}
              </TouchableOpacity>
            )}
          </View>
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
                ? 'this chat space is closed. the event was cancelled.'
                : 'this chat space is closed. the event has passed.'}
            </Text>
          </View>
        ) : (
        <View>
          {!!typingLabel && <Text style={styles.typingText}>{typingLabel}</Text>}
          {mentionQuery !== null && mentionCandidates.length > 0 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.mentionBar}
            >
              {mentionCandidates.map((member) => (
                <TouchableOpacity
                  key={member.id}
                  style={styles.mentionChip}
                  onPress={() => insertMention(member.first_name!)}
                  accessibilityRole="button"
                  accessibilityLabel={`Mention ${member.first_name}`}
                >
                  {member.avatar_url ? (
                    <Image source={{ uri: member.avatar_url }} style={styles.mentionAvatar} contentFit="cover" />
                  ) : (
                    <View style={[styles.mentionAvatar, styles.facePlaceholder]}>
                      <Text style={styles.faceInitial}>{member.first_name?.slice(0, 1).toLowerCase()}</Text>
                    </View>
                  )}
                  <Text style={styles.mentionName} numberOfLines={1}>{member.first_name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
          {(replyingTo || editingMessageId) && (
            <View style={styles.composerContext}>
              <View style={styles.composerContextText}>
                <Text style={styles.composerContextLabel}>{editingMessageId ? 'editing' : `replying to ${replyingTo?.sender_name ?? 'someone'}`}</Text>
                <Text style={styles.composerContextBody} numberOfLines={1}>{editingMessageId ? draft : (replyingTo?.body || 'photo')}</Text>
              </View>
              <TouchableOpacity
                onPress={() => {
                  setReplyingTo(null);
                  if (editingMessageId) {
                    setDraft('');
                    draftRef.current = '';
                  }
                  setEditingMessageId(null);
                }}
                hitSlop={8}
                accessibilityLabel="Cancel message action"
              >
                <X size={18} color={Colors.tertiary} />
              </TouchableOpacity>
            </View>
          )}
          <View style={styles.composer}>
            <TouchableOpacity
              style={styles.photoBtn}
              onPress={handlePickPhoto}
              disabled={!myId || uploadingPhoto || gated || !!editingMessageId}
              accessibilityRole="button"
              accessibilityLabel="Add photo"
            >
              {uploadingPhoto
                ? <ActivityIndicator size="small" color={Colors.terracotta} />
                : <ImageIcon size={22} color={Colors.terracotta} strokeWidth={2.25} />}
            </TouchableOpacity>
            <TextInput
              style={styles.input}
              value={draft}
              onChangeText={(text) => {
                const previousLength = draftRef.current.length;
                const caret = selectionRef.current.start >= previousLength ? text.length : selectionRef.current.start;
                selectionRef.current = { start: caret, end: caret };
                draftRef.current = text;
                setDraft(text);
                setMentionQuery(mentionQueryAt(text, caret));
                if (text.trim()) broadcastTyping();
                else stopTyping();
              }}
              onSelectionChange={(event) => {
                selectionRef.current = event.nativeEvent.selection;
                setMentionQuery(mentionQueryAt(draftRef.current, event.nativeEvent.selection.start));
              }}
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
      <MiniProfileCard
        visible={!!profileUserId}
        userId={profileUserId}
        onClose={() => setProfileUserId(null)}
        onReport={(userId, userName) => {
          setProfileUserId(null);
          setReportTarget({ id: userId, name: userName });
          setShowReport(true);
        }}
        onBlock={(userId, userName) => {
          setProfileUserId(null);
          blockUser(userId, userName, () => refreshMessages());
        }}
      />
      <ReactionEmojiPicker
        visible={!!reactionPickerMsgId}
        onSelect={(emoji) => {
          const reactionKey = emoji === '❤️' ? 'heart' : emoji;
          if (reactionPickerMsgId) toggleReaction(reactionPickerMsgId, reactionKey);
          setReactionPickerMsgId(null);
        }}
        onClose={() => setReactionPickerMsgId(null)}
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
  listWrap: { flex: 1 },
  listContent: { padding: 16, gap: 8, flexGrow: 1 },
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
  messageRowGrouped: { marginTop: -5 },
  messageRowMine: { justifyContent: 'flex-end' },
  face: { width: 28, height: 28, borderRadius: 14 },
  faceSpacer: { width: 28 },
  facePlaceholder: { backgroundColor: Colors.accentSubtle, alignItems: 'center', justifyContent: 'center' },
  faceInitial: { fontFamily: Fonts.sansBold, fontSize: FontSizes.caption, color: Colors.terracotta },
  bubble: {
    maxWidth: 300,
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  bubbleWrap: { maxWidth: '78%' },
  bubbleMine: { backgroundColor: Colors.terracotta, borderColor: Colors.terracotta },
  senderName: { fontFamily: Fonts.sansBold, fontSize: FontSizes.caption, color: Colors.terracotta, marginBottom: 2 },
  messageText: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.darkWarm },
  messageTextMine: { color: Colors.white },
  messageImage: { width: 220, height: 180, borderRadius: 12, backgroundColor: Colors.inputBg, marginBottom: 6 },
  quote: {
    borderLeftWidth: 2,
    borderLeftColor: Colors.goldAccent,
    paddingLeft: 8,
    marginBottom: 6,
  },
  quoteMine: { borderLeftColor: Colors.white },
  quoteName: { fontFamily: Fonts.sansBold, fontSize: FontSizes.caption, color: Colors.terracotta },
  quoteBody: { fontFamily: Fonts.sans, fontSize: FontSizes.caption, color: Colors.secondary },
  editedText: { fontFamily: Fonts.sans, fontSize: FontSizes.micro, color: Colors.tertiary, marginTop: 3 },
  editedTextMine: { color: Colors.white },
  daySeparator: {
    alignSelf: 'center',
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.caption,
    color: Colors.tertiary,
    backgroundColor: Colors.inputBg,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
    marginVertical: 6,
  },
  reactionRow: { flexDirection: 'row', gap: 4, marginTop: 4 },
  reactionRowMine: { justifyContent: 'flex-end' },
  reactionChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.cardBg,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  reactionChipMine: { borderColor: Colors.terracotta, backgroundColor: Colors.accentSubtle },
  reactionText: { fontFamily: Fonts.sans, fontSize: FontSizes.caption },
  scrollLatestBtn: {
    position: 'absolute',
    right: 18,
    bottom: 10,
    minWidth: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.terracotta,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingHorizontal: 9,
  },
  scrollLatestText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.caption, color: Colors.white },
  typingText: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.caption,
    color: Colors.tertiary,
    paddingHorizontal: 16,
    paddingTop: 4,
  },
  mentionBar: { paddingHorizontal: 12, paddingVertical: 8, gap: 8, alignItems: 'center' },
  mentionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    backgroundColor: Colors.inputBg,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  mentionAvatar: { width: 26, height: 26, borderRadius: 13 },
  mentionName: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.darkWarm, maxWidth: 120 },
  composerContext: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  composerContextText: { flex: 1 },
  composerContextLabel: { fontFamily: Fonts.sansBold, fontSize: FontSizes.caption, color: Colors.terracotta },
  composerContextBody: { fontFamily: Fonts.sans, fontSize: FontSizes.caption, color: Colors.secondary },
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
  photoBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.inputBg,
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
