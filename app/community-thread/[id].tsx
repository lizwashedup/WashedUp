/**
 * The community's conversation (doc 09 final shape + batch 21): a fully open
 * member chat. Everyone talks freely through the composer; broadcasts and
 * intro cards are special highlighted rows INSIDE the same stream (one
 * table, one ordering, one unread count). Rooms remain the focused side
 * spaces. Mute-not-leave in the header, unreads clear on open, realtime on
 * the whole stream.
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
import { Image } from 'expo-image';
import { useRouter, useLocalSearchParams, Stack } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Bell, BellOff, CalendarDays, Image as ImageIcon, X } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes, LineHeights } from '../../constants/Typography';
import { BrandedAlert, type BrandedAlertButton } from '../../components/BrandedAlert';
import { ReportModal } from '../../components/modals/ReportModal';
import { useBlock } from '../../hooks/useBlock';
import { BroadcastCard } from '../../components/communities/BroadcastCard';
import { OfflineBanner, PermissionState } from '../../components/state/StateViews';
import LinkifiedText from '../../components/LinkifiedText';
import LinkPreviewCard from '../../components/chat/LinkPreviewCard';
import MiniProfileCard from '../../components/MiniProfileCard';
import ReactionEmojiPicker from '../../components/chat/ReactionEmojiPicker';
import { friendlyError } from '../../lib/friendlyError';
import { hapticLight } from '../../lib/haptics';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import {
  getCommunityBroadcasts,
  getCommunityChatMembers,
  getCommunityChatPayload,
  getMyBroadcastMute,
  getPinnedCommunityEvent,
  markBroadcastsRead,
  deleteCommunityMessage,
  editCommunityMessage,
  sendCommunityMessage,
  setBroadcastMute,
  toggleBroadcastReaction,
  type CommunityBroadcast,
} from '../../lib/communityChat';
import { getJoinGate, getMyMembership } from '../../lib/communityJoin';
import { formatEventDateLA } from '../../lib/laDate';
import { extractFirstUrl, openUrl, soleUrlIn } from '../../lib/url';
import { formatChatDay, insertMentionAt, isSameChatDay, mentionQueryAt } from '../../lib/communityChatUi';
import { pickAndUploadChatPhoto } from '../../lib/pickChatPhoto';
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
  const [reportTarget, setReportTarget] = useState<{ id: string; name: string } | null>(null);
  const [showReport, setShowReport] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [reactionPickerMsgId, setReactionPickerMsgId] = useState<string | null>(null);
  const selectionRef = useRef({ start: 0, end: 0 });
  const draftRef = useRef('');
  const { blockUser } = useBlock();

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setMyId(data.user?.id ?? null)).catch(() => {});
  }, []);

  // report / block a member from a long-press on their message (mirrors chat).
  // Blocking refetches so their messages drop out via the block filter.
  const openMemberMenu = (userId: string, name: string, messageId: string) => {
    if (!userId || userId === myId) return;
    hapticLight();
    setAlertInfo({
      title: name,
      buttons: [
        { text: 'react', onPress: () => setReactionPickerMsgId(messageId) },
        { text: 'report', onPress: () => { setReportTarget({ id: userId, name }); setShowReport(true); } },
        { text: 'block', style: 'destructive', onPress: () => blockUser(userId, name, () => queryClient.invalidateQueries({ queryKey: ['community-broadcasts', id] })) },
        { text: 'cancel', style: 'cancel' },
      ],
    });
  };

  // SC-07 (2026-08-19): the persistent room had no removed/banned state and
  // no offline state at all -- both existed already on the neighboring
  // event/topic room, never here. Same shape as the topic room's own fix: a
  // failed/unknown membership read is treated as still-a-member, the server
  // RLS is the real gate either way.
  const { data: myMembership } = useQuery({
    queryKey: ['community-my-membership', id],
    queryFn: () => getMyMembership(id!),
    enabled: !!id,
    staleTime: 60_000,
  });
  const removedFromCommunity = myMembership?.status === 'removed' || myMembership?.status === 'banned';
  const { online } = useNetworkStatus();

  const { data: payload } = useQuery({
    queryKey: ['community-chat-cards'],
    queryFn: getCommunityChatPayload,
  });
  const card = payload?.cards.find((c) => c.community_id === id) ?? null;

  const { data: members = [] } = useQuery({
    queryKey: ['community-chat-members', id],
    queryFn: () => getCommunityChatMembers(id!),
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
      .slice(0, 6);
  }, [members, mentionQuery, myId]);

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
        { event: '*', schema: 'public', table: 'community_broadcasts', filter: `community_id=eq.${id}` },
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
      if (editingMessageId) await editCommunityMessage(editingMessageId, draft);
      else await sendCommunityMessage(id, draft);
      setDraft('');
      draftRef.current = '';
      setEditingMessageId(null);
      setMentionQuery(null);
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

  const handleDeleteMessage = async (messageId: string) => {
    try {
      await deleteCommunityMessage(messageId);
      hapticLight();
      await queryClient.invalidateQueries({ queryKey: ['community-broadcasts', id] });
    } catch (e) {
      showError('That did not remove', friendlyError(e, 'Try again in a moment.'));
    }
  };

  const openOwnMessageMenu = (message: CommunityBroadcast) => {
    hapticLight();
    setAlertInfo({
      title: 'Your message',
      buttons: [
        { text: 'react', onPress: () => setReactionPickerMsgId(message.id) },
        ...(message.body ? [{ text: 'edit', onPress: () => { setDraft(message.body); draftRef.current = message.body; setEditingMessageId(message.id); } }] : []),
        { text: 'delete this message', style: 'destructive', onPress: () => handleDeleteMessage(message.id) },
        { text: 'cancel', style: 'cancel' },
      ],
    });
  };

  // Reactions live in community_broadcast_reactions, keyed (broadcast_id,
  // user_id, emoji) -- unlike community_topic_message_reactions (UNIQUE
  // message_id, user_id), the table itself does not stop one user holding
  // several different emoji on the same message. useTopicChat's toggleReaction
  // enforces one-reaction-per-user by replacing whatever row is already
  // there; mirrored here at the call-site instead, so both screens read the
  // same to a member: picking a new emoji clears any other reaction this user
  // already has on the message first, and re-picking the one they have turns
  // it off. Raw emoji characters are used as the stored value throughout (no
  // 'heart' string substitution) to stay consistent with how BroadcastCard's
  // existing quick-react chips already write to this same table.
  const handleSelectReaction = async (messageId: string, emoji: string) => {
    const message = broadcasts.find((b) => b.id === messageId);
    const mineReaction = message?.reactions.find((r) => r.mine);
    try {
      hapticLight();
      if (mineReaction?.emoji === emoji) {
        await toggleBroadcastReaction(messageId, emoji, false);
      } else {
        if (mineReaction) await toggleBroadcastReaction(messageId, mineReaction.emoji, false);
        await toggleBroadcastReaction(messageId, emoji, true);
      }
      await queryClient.invalidateQueries({ queryKey: ['community-broadcasts', id] });
    } catch (e) {
      showError('That did not land', friendlyError(e, 'Try again in a moment.'));
    }
  };

  const handlePickPhoto = async () => {
    if (!myId || !id || uploadingPhoto || editingMessageId) return;
    setUploadingPhoto(true);
    try {
      const imageUrl = await pickAndUploadChatPhoto(myId);
      if (!imageUrl) return;
      await sendCommunityMessage(id, draft, imageUrl);
      setDraft('');
      draftRef.current = '';
      setMentionQuery(null);
      await queryClient.invalidateQueries({ queryKey: ['community-broadcasts', id] });
      listRef.current?.scrollToEnd({ animated: true });
    } catch (e) {
      showError('That photo did not send', friendlyError(e, 'Try again in a moment.'));
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
                  ? formatEventDateLA(pinnedEvent.event_date)
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
          renderItem={({ item, index }) => {
            const previous = index > 0 ? thread[index - 1] : null;
            const showDay = !previous || !isSameChatDay(previous.created_at, item.created_at);
            const grouped = item.kind === 'message'
              && previous?.kind === 'message'
              && previous.sender_id === item.sender_id
              && isSameChatDay(previous.created_at, item.created_at);
            const mine = item.sender_id === myId;
            const firstUrl = extractFirstUrl(item.body);
            // A message carrying exactly one link makes the whole bubble a second
            // way into that link (mirrors ChatThread's bubbleUrl fix, 8-02): the
            // bubble TouchableOpacity claims the touch responder for onLongPress,
            // which can swallow the nested LinkifiedText <Text onPress> before it
            // ever fires (reported live 2026-08-27, links posted in Community
            // chat not opening). The inline link Text stays the primary target;
            // this is the path no ancestor can intercept.
            const bubbleUrl = item.kind === 'message' ? soleUrlIn(item.body) : null;
            return (
              <View>
                {showDay && <Text style={styles.daySeparator}>{formatChatDay(item.created_at)}</Text>}
                {item.kind === 'message' ? (
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
                    <TouchableOpacity
                      activeOpacity={0.9}
                      onPress={bubbleUrl ? () => openUrl(bubbleUrl) : undefined}
                      onLongPress={() => {
                        if (mine) openOwnMessageMenu(item);
                        else if (item.sender_id) openMemberMenu(item.sender_id, item.sender_name ?? 'someone', item.id);
                      }}
                      style={[styles.bubble, mine && styles.bubbleMine]}
                      accessibilityHint="hold for message actions"
                    >
                      {!mine && !grouped && <Text style={styles.senderName}>{item.sender_name ?? 'someone'}</Text>}
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
                      {!!item.edited_at && <Text style={[styles.editedText, mine && styles.messageTextMine]}>edited</Text>}
                    </TouchableOpacity>
                  </View>
                ) : (
                  <BroadcastCard
                    broadcast={item}
                    communityName={card?.name ?? ''}
                    onError={showError}
                    mentionNames={mentionNames}
                  />
                )}
              </View>
            );
          }}
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

      {removedFromCommunity ? (
        /* SC-07: a real reason, not a silently-broken composer. */
        <PermissionState message="you were removed from this community." />
      ) : (
        <>
          {!online && <OfflineBanner label="you're offline. messages will send once you're back." />}
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
          {!!editingMessageId && (
            <View style={styles.editingBar}>
              <Text style={styles.editingText}>editing</Text>
              <TouchableOpacity onPress={() => { setEditingMessageId(null); setDraft(''); draftRef.current = ''; }} hitSlop={8} accessibilityLabel="Cancel edit">
                <X size={18} color={Colors.tertiary} />
              </TouchableOpacity>
            </View>
          )}
          <View style={styles.composer}>
            <TouchableOpacity
              style={styles.photoBtn}
              onPress={handlePickPhoto}
              disabled={!myId || uploadingPhoto || !!editingMessageId}
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
              }}
              onSelectionChange={(event) => {
                selectionRef.current = event.nativeEvent.selection;
                setMentionQuery(mentionQueryAt(draftRef.current, event.nativeEvent.selection.start));
              }}
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
        </>
      )}

      </KeyboardAvoidingView>
      <BrandedAlert
        visible={!!alertInfo}
        title={alertInfo?.title ?? ''}
        message={alertInfo?.message}
        buttons={alertInfo?.buttons}
        onClose={() => setAlertInfo(null)}
      />

      {reportTarget && (
        <ReportModal
          visible={showReport}
          onClose={() => { setShowReport(false); setReportTarget(null); }}
          reportedUserId={reportTarget.id}
          reportedUserName={reportTarget.name}
        />
      )}
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
          blockUser(userId, userName, () => queryClient.invalidateQueries({ queryKey: ['community-broadcasts', id] }));
        }}
      />
      <ReactionEmojiPicker
        visible={!!reactionPickerMsgId}
        onSelect={(emoji) => {
          if (reactionPickerMsgId) handleSelectReaction(reactionPickerMsgId, emoji);
          setReactionPickerMsgId(null);
        }}
        onClose={() => setReactionPickerMsgId(null)}
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
  messageRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginBottom: 10 },
  messageRowGrouped: { marginTop: -7 },
  messageRowMine: { justifyContent: 'flex-end' },
  face: { width: 28, height: 28, borderRadius: 14 },
  faceSpacer: { width: 28 },
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
  messageImage: { width: 220, height: 180, borderRadius: 12, backgroundColor: Colors.inputBg, marginBottom: 6 },
  editedText: { fontFamily: Fonts.sans, fontSize: FontSizes.micro, color: Colors.tertiary, marginTop: 3 },
  daySeparator: {
    alignSelf: 'center',
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.caption,
    color: Colors.tertiary,
    backgroundColor: Colors.inputBg,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
    marginVertical: 8,
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
  editingBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  editingText: { flex: 1, fontFamily: Fonts.sansBold, fontSize: FontSizes.caption, color: Colors.terracotta },
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
