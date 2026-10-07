import { useChatMessageAnchor, useChatAnchorScroll } from '../../hooks/useChatMessageAnchor';
import { ChatMessageAnchorNotice } from '../../components/chat/ChatMessageAnchorNotice';
import { addChatMentionReference, rebaseChatMentions, readChatMentionDocument } from '../../lib/chatMentionIdentity';
import { ChatOptionsButton } from '../../components/chat/ChatOptionsButton';
import { useChatMentionFocus } from '../../hooks/useChatMentionFocus';
import { ChatMentionPicker } from '../../components/chat/ChatMentionPicker';
import { findMentionMembers } from '../../lib/chatMentions';
import { ChatBubbleFill } from '../../components/chat/ChatBubbleFill';
import ProfileButton from '../../components/ProfileButton';
import { requestWithDeadline } from '../../lib/requestWithDeadline';
import { MessageActionsMenu, type MessageMenu } from '../../components/chat/MessageActionsMenu';
import { messageActionAccess, messageActionWeb } from '../../components/chat/messageActionAccess';
import { CreatorActionFill } from '../../components/creator/CreatorActionFill';
import { memberPresentationFonts } from '../../constants/MemberAppearance';
/**
 * A topic thread inside a community (doc 09: the rooms of the house).
 * Messages, composer, live inserts via realtime (community_topic_messages
 * is in the publication from phase 1), notifications toggle per the doc 09
 * defaults (ON once joined, per-topic mutable). Permanent by construction,
 * no expiry. Uses its own topic-table chat hook so existing room history stays
 * in place while the UI reaches plan/circle-chat parity.
 */

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as Crypto from 'expo-crypto';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  AppState,
  useWindowDimensions,
  Platform,
  ScrollView,
  type ViewToken,
} from 'react-native';
import { ChatKeyboardAvoidingView as KeyboardAvoidingView, IOSKeyboardDock, IOSKeyboardViewport } from '../../components/keyboard/ChatKeyboard';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, useFocusEffect, Stack } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { ArrowLeft, Bell, BellOff, CalendarDays, ChevronDown, CircleHelp, Image as ImageIcon, ImagePlus, MapPin, X } from 'lucide-react-native';
import Colors, { AfterglowColors } from '../../constants/Colors';
import { COMMUNITY_CHAT_GROUPING_ENABLED, CREATOR_PAGES_ENABLED } from '../../constants/FeatureFlags';
import { AfterglowType, Fonts, FontSizes, LineHeights } from '../../constants/Typography';
import { BrandedAlert, type BrandedAlertButton } from '../../components/BrandedAlert';
import { ReportModal } from '../../components/modals/ReportModal';
import { useBlock } from '../../hooks/useBlock';
import { isObsoleteTopicOperation, isUnconfirmedTopicReaction, useTopicChat } from '../../hooks/useTopicChat';
import { useObservedUser } from '../../hooks/useObservedUser';
import { useAfterglowFonts } from '../../hooks/useAfterglowFonts';
import { CommunityChatPreferenceControl } from '../../components/chats/CommunityChatPreferenceControl';
import { useCommunityConversationNotifications } from '../../hooks/useCommunityConversationNotifications';
import { useCommunityTopicMute } from '../../hooks/useCommunityTopicMute';
import { compareCommunityRoomSequence } from '../../lib/communityRoomWindow';
import { getCommunityIntroRoom, type CommunityRoomMessage, type CommunityReadTargets } from '../../lib/communityRoomHistory';
import { useCommunityCoreReadAcknowledgement } from '../../hooks/useCommunityCoreReadAcknowledgement';
import { BroadcastCard } from '../../components/communities/BroadcastCard';
import { useTypingIndicator } from '../../hooks/useTypingIndicator';
import LinkifiedText from '../../components/LinkifiedText';
import LinkPreviewCard from '../../components/chat/LinkPreviewCard';
import LocationPickerModal from '../../components/chat/LocationPickerModal';
import PhotoPreviewModal from '../../components/chat/PhotoPreviewModal';
import MiniProfileCard from '../../components/MiniProfileCard';
import ReactionEmojiPicker from '../../components/chat/ReactionEmojiPicker';
import { ReactionDetailsSheet, type ReactionDetailsRequest } from '../../components/chat/ReactionDetailsSheet';
import { ReactionChips } from '../../components/chat/ReactionChips';
import { ChatContextHeader, chatHeaderActionStyle } from '../../components/chat/ChatContextHeader';
import { CommunityChatComposer } from '../../components/chat/CommunityChatComposer';
import { createChatMessageAppearance } from '../../components/chat/chatMessageAppearance';
import { ChatPhotoAttachment } from '../../components/chat/ChatPhotoAttachment';
import { ChatLocationPreview } from '../../components/chat/ChatLocationPreview';
import { chatLocationLabel, readChatLocation } from '../../lib/chatLocation';
import { ChatPhotoViewer, useChatPhotoSelection } from '../../components/chat/ChatPhotoViewer';
import { reactionEmoji, reactionKeyForEmoji, topicReactionCounts } from '../../lib/communityReactionChips';
import { friendlyError } from '../../lib/friendlyError';
import { logError } from '../../lib/logger';
import { hapticLight } from '../../lib/haptics';
import { getCreatorAccess, isLeaderAccess } from '../../lib/creatorMode';
import { getMyMembership } from '../../lib/communityJoin';
import { TopicWelcomeEditor } from '../../components/chat/TopicWelcomeEditor';
import { formatEventDateLA, formatTimestampLA } from '../../lib/laDate';
import { showAddToCalendar } from '../../lib/addToCalendar';
import { extractFirstUrl, openUrl, soleUrlIn } from '../../lib/url';
import { formatChatTime, formatChatDay, insertMentionAt, isSameChatDay, mentionQueryAt } from '../../lib/communityChatUi';
import { uploadBase64ToStorage } from '../../lib/uploadPhoto';
import { checkContent } from '../../lib/contentFilter';
import { PhotoSendSession } from '../../lib/photoSendSession';
import { TextSendSession } from '../../lib/textSendSession';
import { useTopicComposerDraft } from '../../hooks/useTopicComposerDraft';
import { checkTopicComposerAttempt, verifyTopicComposerTarget } from '../../lib/topicComposerDraft';
import {
  computeEventRoomExpiry,
  isEventRoomClosed,
  getCommunityChatPayload,
  getTopicChatMembers,
  getCommunityChatMembers,
  getTopicFirstMessage,
  hasSaidHiInTopic,
  markTopicRead,
  deleteTopicMessage,
  getTopicMeta,
  type TopicMessage,
} from '../../lib/communityChat';


export default function CommunityTopicScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // Keep context fixed while history and the composer share native iOS motion.
  // Android/web keep their existing keyboard-avoiding layout and view tree.
  const KeyboardLayout = Platform.OS === 'ios' ? View : KeyboardAvoidingView;
  const MessageViewport = Platform.OS === 'ios' ? IOSKeyboardViewport : React.Fragment;
  const ComposerDock = Platform.OS === 'ios' ? IOSKeyboardDock : React.Fragment;
  const { width: windowWidth } = useWindowDimensions();
  const queryClient = useQueryClient();
  const { fonts: loadedConversationFonts } = useAfterglowFonts(COMMUNITY_CHAT_GROUPING_ENABLED);
  const conversationFonts = memberPresentationFonts(loadedConversationFonts);
  const messageAppearance = useMemo(() => COMMUNITY_CHAT_GROUPING_ENABLED ? createChatMessageAppearance(conversationFonts) : null, [conversationFonts]);
  const { id, reactionMessageId, reactionMessageSource } = useLocalSearchParams<{ id: string; reactionMessageId?: string; reactionMessageSource?: string }>();
  const { anchor, anchorKey, clearAnchor } = useChatMessageAnchor(id, reactionMessageId, reactionMessageSource);
  const muteViewer = useObservedUser();
  const individualNotifications = useCommunityTopicMute(id, muteViewer);
  const notifications = useCommunityConversationNotifications(CREATOR_PAGES_ENABLED && COMMUNITY_CHAT_GROUPING_ENABLED && id ? { kind: 'topic', topicId: id } : { kind: 'legacy' }, muteViewer, individualNotifications);
  const { muted, ready: muteReady, isChecking: muteChecking, toggle: toggleMute, isCurrent: muteScopeCurrent } = notifications;
  const listRef = useRef<FlatList<TopicMessage | CommunityRoomMessage>>(null);
  const coreFocused = useRef(false);
  const [sending, setSending] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [pendingPhoto, setPendingPhoto] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [photoPreviewOpen, setPhotoPreviewOpen] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const photoReplyRef = useRef<{ id?: string } | null>(null);
  const photoSendSessionRef = useRef(new PhotoSendSession(() => Crypto.randomUUID()));
  const locationSendSessionRef = useRef(new TextSendSession(() => Crypto.randomUUID()));
  const locationAttemptRef = useRef<object | null>(null);
  const [locationPickerOpen, setLocationPickerOpen] = useState(false);
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [unreadWhileScrolled, setUnreadWhileScrolled] = useState(0);
  const selectionRef = useRef({ start: 0, end: 0 });
  const composerInputRef = useRef<TextInput>(null);
  const [composerFocusRequest, setComposerFocusRequest] = useState(0);
  const draftRef = useRef('');
  const entryRevisionRef = useRef(0);
  const sendAttemptRef = useRef<object | null>(null);
  const photoAttemptRef = useRef<object | null>(null);
  const pickerAttemptRef = useRef<object | null>(null);
  const previousTopicMessagesRef = useRef<{ ids: Set<string>; newest: number } | null>(null);
  const previousNewestRoomItemRef = useRef<CommunityRoomMessage | null>(null);
  const [reactionDetails, setReactionDetails] = useState<ReactionDetailsRequest | null>(null);
  const [messageMenu, setMessageMenu] = useState<MessageMenu | null>(null);
  const [alertInfo, setAlertInfo] = useState<{ title: string; message?: string; buttons?: BrandedAlertButton[] } | null>(null);
  const [reportTarget, setReportTarget] = useState<{ id: string; name: string } | null>(null);
  const [showReport, setShowReport] = useState(false);
  const [reactionPickerMsgId, setReactionPickerMsgId] = useState<string | null>(null);
  const { blockUser } = useBlock();

  const needsCoreIdentity = COMMUNITY_CHAT_GROUPING_ENABLED && CREATOR_PAGES_ENABLED;
  const identityVisit = useMemo(() => ({}), [id, muteViewer.viewerId, muteViewer.epoch]);
  const activeIdentityVisit = useRef<object | null>(null);
  useLayoutEffect(() => {
    activeIdentityVisit.current = identityVisit;
    return () => { if (activeIdentityVisit.current === identityVisit) activeIdentityVisit.current = null; };
  }, [identityVisit]);
  const identityScope = useMemo(() => ({ userId: muteViewer.viewerId ?? '',
    isCurrent: () => activeIdentityVisit.current === identityVisit && muteViewer.isCurrent(),
  }), [identityVisit, muteViewer.viewerId, muteViewer.isCurrent]);
  const scopedKey = (key: readonly unknown[]) => needsCoreIdentity ? [...key, muteViewer.viewerId, muteViewer.epoch] : key;
  const readEntry = async <T,>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> => {
    if (needsCoreIdentity && (!identityScope.userId || !identityScope.isCurrent() || signal?.aborted)) throw Error('This chat visit changed.');
    const result = await requestWithDeadline(operation(), 12_000);
    if (needsCoreIdentity && (!identityScope.isCurrent() || signal?.aborted)) throw Error('This chat visit changed.');
    return result;
  };
  const introIdentity = useQuery({
    queryKey: ['community-intro-topic', id, muteViewer.viewerId, muteViewer.epoch],
    queryFn: ({ signal }) => readEntry(() => getCommunityIntroRoom(id!, { userId: identityScope.userId, isCurrent: () => !signal.aborted && identityScope.isCurrent() }), signal),
    enabled: !!id && !!muteViewer.viewerId && needsCoreIdentity && !muteViewer.isLoading && !muteViewer.error,
    retry: false,
  });
  const introLayout = needsCoreIdentity && introIdentity.isSuccess ? introIdentity.data : null;
  const usesLegacyHistory = !needsCoreIdentity || (introIdentity.isSuccess && !introLayout);

  const {
    messages,
    anchorUnavailable = false,
    roomItems = [],
    loading: messagesLoading,
    loadError: messagesLoadError,
    hasOlder,
    loadingOlder,
    olderLoadError,
    currentUserId: myId,
    currentUserName,
    sendMessage,
    sendLocation,
    editMessage,
    deleteMessage,
    toggleReaction,
    refresh: refreshTopicMessages,
    loadOlder,
    isCurrent: topicScopeCurrent,
  } = useTopicChat(id, !needsCoreIdentity ? undefined : !introIdentity.isSuccess
    ? { kind: 'waiting', error: introIdentity.isError }
    : introLayout ? { kind: 'intros', communityId: introLayout.communityId } : undefined, anchor);
  const refreshMessages = useCallback(async (silent = false) => {
    if (needsCoreIdentity && !introIdentity.isSuccess) { await introIdentity.refetch(); return; }
    await refreshTopicMessages(silent);
  }, [needsCoreIdentity, introIdentity.isSuccess, introIdentity.refetch, refreshTopicMessages]);

  // Is this room still open? An archived topic refuses inserts at the policy
  // level, so the composer must say so rather than let the send come back as
  // a raw RLS error. Unknown (a read that fails) is treated as OPEN: the
  // server still holds the real gate, and guessing closed would silence a
  // room that works.
  const { data: topicMeta } = useQuery({
    queryKey: scopedKey(['topic-meta', id]),
    queryFn: ({ signal }) => readEntry(() => getTopicMeta(id!), signal),
    enabled: !!id,
    staleTime: 60_000,
  });
  const [clockNow, setClockNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setClockNow(Date.now()), 30_000);
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') setClockNow(Date.now());
    });
    return () => { clearInterval(timer); subscription.remove(); };
  }, []);

  // SC-07 (2026-08-19): a removed/banned member could still land on this
  // screen and see a live-looking composer with no explanation when the
  // send failed. Checked on the topic's own community, same shape as the
  // archived check above: a failed read is treated as still-a-member, the
  // server RLS is the real gate either way.
  const { data: myMembership } = useQuery({
    queryKey: scopedKey(['topic-my-membership', topicMeta?.community_id]),
    queryFn: ({ signal }) => readEntry(() => getMyMembership(topicMeta!.community_id), signal),
    enabled: !!topicMeta?.community_id,
    staleTime: 60_000,
  });
  const removedFromCommunity = myMembership?.status === 'removed' || myMembership?.status === 'banned';

  // inventory C-14: a real creator moderation action, distinct from the
  // report/block every member already has. Gated on this topic's OWN
  // community, not "any" led community -- RLS is the real backstop either
  // way, but the button should not even offer to remove a message in a
  // room this leader does not run.
  const { data: access } = useQuery({ queryKey: scopedKey(['creator-access']), queryFn: ({ signal }) => readEntry(() => getCreatorAccess(), signal) });
  const canModerate =
    !!topicMeta && isLeaderAccess(access) &&
    (access?.ledCommunities.some((c) => c.id === topicMeta.community_id) ?? false);

  // The newest chat page may no longer contain the first message. Read that
  // one row separately so a long event room retains its welcome card.
  const creatorUserId = topicMeta?.explore_events?.host_user_id ?? null;
  const iAmCreatorOrLeader = !!myId && (myId === creatorUserId || canModerate);

  // The event relationship and logistics ride the existing topic-meta read.
  // The displayed deadline follows the end-time-first client calculation;
  // release verification must compare it with the deployed archive job.
  const roomExpiry = topicMeta ? computeEventRoomExpiry(topicMeta) : null;
  const archived = topicMeta ? isEventRoomClosed(topicMeta, clockNow) : false;
  const eventDateLabel = topicMeta?.explore_events?.start_time
    ? formatEventDateLA(topicMeta.explore_events.start_time)
    : topicMeta?.explore_events?.event_date
      ? formatEventDateLA(topicMeta.explore_events.event_date)
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
  const calendarStart = topicMeta?.explore_events?.start_time;
  const canAddEventCalendar = !!calendarStart &&
    !Number.isNaN(new Date(calendarStart).getTime()) &&
    topicMeta?.explore_events?.status !== 'Cancelled';


  const { data: payload } = useQuery({
    queryKey: scopedKey(['community-chat-cards']),
    queryFn: ({ signal }) => readEntry(() => getCommunityChatPayload(needsCoreIdentity ? identityScope : undefined), signal),
  });
  // members find the room inside their card; attendees find it in their list
  const topic =
    payload?.cards.flatMap((c) => c.topics).find((t) => t.id === id) ??
    payload?.attendee_topics.find((t) => t.id === id) ??
    null;

  // event chats open only after you say something (Liz 7-07): RSVP is untouched,
  // but the room stays veiled until your first message lands. back always works.
  const eventTopic = !!topic?.explore_event_id;
  const { data: firstMessage, isSuccess: firstMessageLoaded } = useQuery({
    queryKey: scopedKey(['topic-first-message', id]),
    queryFn: ({ signal }) => readEntry(() => getTopicFirstMessage(id!), signal),
    enabled: !!id && eventTopic,
  });
  const [justSaidHi, setJustSaidHi] = useState(false);
  const introRetryAttempt = useRef<object | null>(null);
  const [introRetrying, setIntroRetrying] = useState(false);
  const { data: saidHi, isError: introStatusError, isFetching: introStatusFetching, refetch: refetchIntroStatus } = useQuery({
    queryKey: ['topic-said-hi', id, myId, muteViewer.viewerId, muteViewer.epoch],
    queryFn: async ({ signal }) => {
      if (!identityScope.userId || !identityScope.isCurrent() || signal.aborted) throw Error('This chat visit changed.');
      const result = await readEntry(() => hasSaidHiInTopic(id!), signal);
      if (!identityScope.isCurrent() || signal.aborted) throw Error('This chat visit changed.');
      return result;
    },
    enabled: !!id && !!myId && myId === muteViewer.viewerId && eventTopic,
    retry: false,
  });
  const gated = eventTopic && !justSaidHi && saidHi === false;
  const gateChecking = eventTopic && !justSaidHi && saidHi === undefined;
  const introReadFailed = gateChecking && (introStatusError || introRetrying);

  const { data: members = [], isLoading: membersLoading, isError: membersError, refetch: retryMembers } = useQuery({
    queryKey: scopedKey(['topic-chat-members', id, introLayout?.communityId ?? null]),
    queryFn: ({ signal }) => readEntry(() => introLayout ? getCommunityChatMembers(introLayout.communityId, identityScope) : getTopicChatMembers(id!), signal),
    enabled: !!id && (!needsCoreIdentity || introIdentity.isSuccess),
    staleTime: 60_000,
  });
  const mentionNames = useMemo(() => new Set(
    members.flatMap((member) => member.first_name ? [member.first_name.toLowerCase()] : []),
  ), [members]);
  const mentionCandidates = useMemo(() => findMentionMembers(members, mentionQuery, myId), [members, mentionQuery, myId]);
  // Drafts, pickers and admission feedback belong to one room/account visit.
  // Reset local entry state without allowing an old finally/catch to reset the
  // new visit again. The hook also rejects retired transport completions.
  const entryVisit = useMemo(() => ({}), [id, muteViewer.viewerId, muteViewer.epoch]);
  const activeEntryVisit = useRef<object | null>(null);
  useLayoutEffect(() => {
    activeEntryVisit.current = entryVisit;
    setComposerFocusRequest(0);
    draftRef.current = '';
    selectionRef.current = { start: 0, end: 0 };
    entryRevisionRef.current = 0;
    sendAttemptRef.current = null; photoAttemptRef.current = null; pickerAttemptRef.current = null; locationAttemptRef.current = null;
    photoReplyRef.current = null;
    photoSendSessionRef.current = new PhotoSendSession(() => Crypto.randomUUID());
    locationSendSessionRef.current = new TextSendSession(() => Crypto.randomUUID());
    setSending(false);
    setMentionQuery(null); setUploadingPhoto(false); setPendingPhoto(null);
    setPhotoPreviewOpen(false); setPhotoError(null); setLocationPickerOpen(false);
    introRetryAttempt.current = null; setIntroRetrying(false);
    setJustSaidHi(false); setAlertInfo(null); setMessageMenu(null); setReportTarget(null); setShowReport(false);
    setProfileUserId(null); setReactionDetails(null); setReactionPickerMsgId(null); setIsAtBottom(true);
    setUnreadWhileScrolled(0); previousTopicMessagesRef.current = null; previousNewestRoomItemRef.current = null;
    return () => { if (activeEntryVisit.current === entryVisit) activeEntryVisit.current = null; };
  }, [entryVisit]);
  const entryIsCurrent = useCallback(() => activeEntryVisit.current === entryVisit && topicScopeCurrent() && (!introLayout || (coreFocused.current && AppState.currentState === 'active')), [entryVisit, topicScopeCurrent, !!introLayout]);
  useFocusEffect(useCallback(() => {
    coreFocused.current = true;
    if (introLayout) void refreshMessages(true);
    return () => { coreFocused.current = false; };
  }, [!!introLayout, refreshMessages]));
  useEffect(() => {
    if (!introLayout) return;
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active' && coreFocused.current) void refreshMessages(true);
    });
    return () => subscription.remove();
  }, [!!introLayout, refreshMessages]);
  const retryIntroStatus = () => {
    if (!entryIsCurrent() || !coreFocused.current || !gateChecking || introRetryAttempt.current || introStatusFetching) return;
    const attempt = {};
    introRetryAttempt.current = attempt;
    setIntroRetrying(true);
    void refetchIntroStatus().catch(() => undefined).finally(() => {
      if (introRetryAttempt.current !== attempt) return;
      introRetryAttempt.current = null;
      if (entryIsCurrent()) setIntroRetrying(false);
    });
  };
  const readableScope = useMemo(() => myId ? { userId: myId, isCurrent: entryIsCurrent } : null, [myId, entryIsCurrent]);
  const composerDraft = useTopicComposerDraft(id, readableScope);
  const draft = composerDraft.draft.text, replyingTo = composerDraft.draft.reply, editingMessageId = composerDraft.draft.edit?.id ?? null;
  const setDraft = (text: string) => composerDraft.change({ text, mentions: composerDraft.draft.mentions ? rebaseChatMentions(composerDraft.draft.mentions, text) : null });
  const setReplyingTo = (reply: typeof replyingTo) => composerDraft.change({ reply });
  const setEditingMessageId = (_id: null) => composerDraft.change({ edit: null });
  useEffect(() => { draftRef.current = draft; }, [draft]);
  const draftBlocked = !composerDraft.ready || composerDraft.error || !!composerDraft.draft.attempt;
  const { typingUsers, broadcastTyping, stopTyping } = useTypingIndicator(
    id,
    myId,
    currentUserName,
    'community-topic',
    readableScope,
  );
  const typingLabel = useMemo(() => {
    if (typingUsers.length === 0) return null;
    if (typingUsers.length === 1) return `${typingUsers[0].name} is typing...`;
    if (typingUsers.length === 2) return `${typingUsers[0].name} and ${typingUsers[1].name} are typing...`;
    return 'several people are typing...';
  }, [typingUsers]);

  const attachmentAllowed = !draftBlocked && !!myId && !removedFromCommunity && !archived && !gated && !gateChecking && !editingMessageId;
  const attachmentVisit = useMemo(() => ({ allowed: attachmentAllowed }), [entryVisit, attachmentAllowed]);
  const activeAttachmentVisit = useRef<typeof attachmentVisit | null>(null);
  useLayoutEffect(() => {
    activeAttachmentVisit.current = attachmentVisit;
    if (!attachmentVisit.allowed) {
      setPhotoPreviewOpen(false); setPendingPhoto(null); setPhotoError(null); setLocationPickerOpen(false);
    }
    return () => { if (activeAttachmentVisit.current === attachmentVisit) activeAttachmentVisit.current = null; };
  }, [attachmentVisit]);
  const attachmentIsCurrent = () => entryIsCurrent() && attachmentVisit.allowed &&
    activeAttachmentVisit.current === attachmentVisit;
  const clearSubmittedEntry = (revision: number) => {
    if (!entryIsCurrent() || entryRevisionRef.current !== revision) return;
    setDraft(''); draftRef.current = ''; setEditingMessageId(null);
    setReplyingTo(null); setMentionQuery(null); stopTyping();
  };
  const menuContext = useRef({ messages, archived, allowed: !removedFromCommunity && !gated && !gateChecking });
  menuContext.current = { messages, archived, allowed: !removedFromCommunity && !gated && !gateChecking };
  const selectedMessageCurrent = (messageId: string) => entryIsCurrent() && menuContext.current.allowed && menuContext.current.messages.some(message => message.id === messageId);
  useEffect(() => { if (messageMenu && !messageMenu.isCurrent()) setMessageMenu(null); }, [messageMenu, messages, removedFromCommunity, archived, gated, gateChecking]);
  useEffect(() => {
    if (!composerFocusRequest) return;
    const frame = requestAnimationFrame(() => { if (entryIsCurrent()) composerInputRef.current?.focus(); });
    return () => cancelAnimationFrame(frame);
  }, [composerFocusRequest, entryIsCurrent]);
  const reactionRoomItems = useRef(roomItems); reactionRoomItems.current = roomItems;
  const reactionTopicMessages = useRef(messages); reactionTopicMessages.current = messages;
  const reactionReadable = useRef(false); reactionReadable.current = !removedFromCommunity && !gated && !gateChecking;
  const reactionCanRemove = useRef(false); reactionCanRemove.current = !archived && !removedFromCommunity && !gated && !gateChecking;
  const openReactionDetails = (messageId: string, source: 'topic' | 'broadcast' = 'topic') => {
    const isCurrent = () => entryIsCurrent() && reactionReadable.current && (source === 'topic'
      ? reactionTopicMessages.current.some(message => message.id === messageId)
      : reactionRoomItems.current.some(item => item.source === 'broadcast' && item.message.id === messageId));
    if (!isCurrent() || !myId) return;
    setReactionDetails({ source, messageId, scope: { userId: myId, isCurrent }, canRemove: () => entryIsCurrent() && reactionCanRemove.current,
      onChanged: () => { if (isCurrent()) void refreshMessages(true); } });
  };
  useEffect(() => { if (reactionDetails && !reactionDetails.scope.isCurrent()) setReactionDetails(null); }, [reactionDetails, messages, roomItems, removedFromCommunity, entryVisit]);
  const currentAction = (action: () => void) => () => { if (entryIsCurrent()) action(); };
  const reactToMessage = async (messageId: string, key: string, retry?: () => Promise<void>) => {
    if (!entryIsCurrent() || (retry && (!selectedMessageCurrent(messageId) || menuContext.current.archived))) return;
    try { await (retry ? retry() : toggleReaction(messageId, key)); }
    catch (error) {
      if (!entryIsCurrent() || isObsoleteTopicOperation(error)) return;
      setAlertInfo(isUnconfirmedTopicReaction(error) ? {
        title: 'Reaction not confirmed', message: error.message,
        buttons: [
          { text: 'Close', style: 'cancel' },
          { text: 'Retry', onPress: currentAction(() => { void reactToMessage(messageId, key, error.retry); }) },
        ],
      } : { title: 'That did not land', message: friendlyError(error, 'Try again in a moment.') });
    }
  };

  // this reads regardless of the "say hi first" gate below -- messages are
  // already fetched either way, the gate only decides whether the FlatList
  // renders. That's the fix: previously a first-time entrant saw only the
  // gate card and never the creator's welcome until AFTER saying hi.
  const welcomeMessage = eventTopic && creatorUserId && !firstMessage?.hidden && firstMessage?.sender_id === creatorUserId
    ? firstMessage : null;
  const visibleMessages = useMemo(() => welcomeMessage ? messages.filter((message) => message.id !== welcomeMessage.id) : messages, [messages, welcomeMessage?.id]);
  const chronologicalMessages: (TopicMessage | CommunityRoomMessage)[] = introLayout ? roomItems : anchor ? messages : visibleMessages;
  // Inverted lists start at the latest message, without an estimated end jump.
  const listMessages = useMemo(() => chronologicalMessages.slice().reverse(), [chronologicalMessages]);
  const anchorScroll = useChatAnchorScroll(listRef, anchorKey, anchor ? listMessages.findIndex(message => 'source' in message ? message.key === anchorKey : message.id === anchor.id) : -1);
  const coreReadScope = useMemo(() => ({ userId: myId ?? '', isCurrent: entryIsCurrent }), [myId, entryIsCurrent]);
  const readAcknowledgement = useCommunityCoreReadAcknowledgement(introLayout?.communityId, 'intros', coreReadScope, !!introLayout);
  const visibleRead = useRef<(items: ViewToken<TopicMessage | CommunityRoomMessage>[]) => void>(() => {});
  visibleRead.current = items => {
    if (!introLayout || !entryIsCurrent()) return;
    const keys = new Set(items.flatMap(item => item.isViewable && 'source' in item.item ? [item.item.key] : []));
    const targets: CommunityReadTargets = {};
    for (const item of roomItems.slice().reverse()) {
      if (!keys.has(item.key) || (item.source === 'topic' && item.message.delivery_state === 'sending')) continue;
      if (!targets[item.source]) targets[item.source] = item.message;
    }
    readAcknowledgement.acknowledge(targets);
  };
  const onViewableItemsChanged = useCallback(({ viewableItems }: { viewableItems: ViewToken<TopicMessage | CommunityRoomMessage>[] }) => {
    if (introLayout && identityScope.isCurrent()) visibleRead.current(viewableItems);
  }, [identityScope, !!introLayout]);
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 50, minimumViewTime: 300 }).current;
  const photos = useMemo(() => messages.flatMap(message =>
    message.id !== welcomeMessage?.id && message.image_url
      ? [{ id: message.id, uri: message.image_url, senderName: message.sender_name, caption: message.body }] : []), [messages, welcomeMessage?.id]);
  const photoSelection = useChatPhotoSelection(`topic:${id}:${muteViewer.viewerId}`, removedFromCommunity || gated || gateChecking ? [] : photos);

  // only while the room is genuinely empty -- mirrors the RPC's own guard,
  // so the affordance never implies a second welcome could still be set
  const canSetWelcome = eventTopic && firstMessageLoaded && firstMessage === null && !archived && messages.length === 0 && iAmCreatorOrLeader;

  const refreshWelcome = async () => {
    if (!entryIsCurrent()) return;
    await queryClient.invalidateQueries({ queryKey: ['topic-first-message', id] });
    if (entryIsCurrent()) await refreshMessages();
  };

  // The hook owns live message/reaction refresh. This screen owns read markers
  // and chat-list invalidation because those are navigation concerns.
  useEffect(() => {
    if (!id || !usesLegacyHistory || anchor) return;
    markTopicRead(id).catch(() => {});
    return () => {
      queryClient.invalidateQueries({ queryKey: ['community-chat-cards'] });
      queryClient.invalidateQueries({ queryKey: ['community-chat-rows'] });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, usesLegacyHistory, anchorKey]);

  const checkPendingDraft = async () => {
    const pending = composerDraft.draft.attempt;
    if (!pending || !id || !readableScope || !entryIsCurrent() || sendAttemptRef.current) return;
    const token = {}; sendAttemptRef.current = token; setSending(true);
    try {
      if (await checkTopicComposerAttempt(id, pending, readableScope)) {
        await composerDraft.finish(pending); await refreshMessages(true);
      } else if (entryIsCurrent()) setAlertInfo({ title: 'Not confirmed yet', message: 'Your original message is kept. Check again or retry the original when you’re ready.' });
    } catch (error) { if (entryIsCurrent()) setAlertInfo({ title: 'Could not check your message', message: friendlyError(error, 'Your original message is kept.') }); }
    finally { if (entryIsCurrent() && sendAttemptRef.current === token) { sendAttemptRef.current = null; setSending(false); } }
  };
  const handleSend = async () => {
    if (!entryIsCurrent() || !id || !readableScope || (!draft.trim() && !composerDraft.draft.attempt) || sendAttemptRef.current || (topicMeta && isEventRoomClosed(topicMeta))) return;
    const token = {}; sendAttemptRef.current = token; setSending(true);
    const resumingOriginal = !!composerDraft.draft.attempt;
    let preparedOriginal = false;
    try {
      const original = await composerDraft.prepare();
      preparedOriginal = true;
      if (!entryIsCurrent()) return;
      if (!await checkTopicComposerAttempt(id, original, readableScope)) {
        if (resumingOriginal) await verifyTopicComposerTarget(id, original, readableScope);
        if (original.kind === 'edit') await editMessage(original.id, original.text, original.mentions, original.edit ?? undefined);
        else await sendMessage(original.text, undefined, original.replyId ?? undefined, undefined, original.id, original.mentions);
        if (!await checkTopicComposerAttempt(id, original, readableScope)) throw Error('Your original message has not been confirmed yet.');
      }
      if (!entryIsCurrent()) return;
      await composerDraft.finish(original);
      if (!entryIsCurrent()) return;
      setMentionQuery(null); stopTyping();
      if (original.kind === 'send' && (gated || gateChecking)) { setJustSaidHi(true); queryClient.invalidateQueries({ queryKey: ['topic-said-hi', id, myId] }); }
      if (anchor && original.kind === 'send') { setIsAtBottom(true); clearAnchor(); }
      else {
        await refreshMessages(true);
        if (entryIsCurrent() && !anchor) { setIsAtBottom(true); listRef.current?.scrollToOffset({ offset: 0, animated: false }); }
      }
    } catch (error) {
      if (entryIsCurrent() && !isObsoleteTopicOperation(error)) setAlertInfo({ title: preparedOriginal || resumingOriginal ? 'Message not confirmed' : editingMessageId ? 'Changes not saved' : 'Message not sent', message: friendlyError(error, 'Your original message is kept. Check it before trying again.') });
    } finally { if (entryIsCurrent() && sendAttemptRef.current === token) { sendAttemptRef.current = null; setSending(false); } }
  };

  const handleNotifications = async () => {
    const result = await toggleMute();
    if (!result || !muteScopeCurrent()) return;
    if (result.matched) hapticLight();
    else setAlertInfo({ title: 'Check notification setting', message: result.value === null
      ? 'We couldn’t confirm this change. Open chat options to check before trying again.'
      : 'The requested change wasn’t confirmed. Chat options shows the current saved setting.' });
  };

  const handleDeleteMessage = async (messageId: string, ownMessage = false) => {
    if (!entryIsCurrent()) return;
    try {
      if (ownMessage) await deleteMessage(messageId);
      else {
        await deleteTopicMessage(messageId);
        if (!entryIsCurrent()) return;
        await refreshMessages();
      }
      if (entryIsCurrent()) hapticLight();
    } catch (e) {
      if (!entryIsCurrent() || isObsoleteTopicOperation(e)) return;
      setAlertInfo({ title: 'That did not remove', message: friendlyError(e, 'Try again in a moment.') });
    }
  };

  // report / block a member from a long-press on their message (mirrors chat).
  // Blocking refetches so their messages drop out via the block filter.
  // Creator moderation (C-14) adds one more option, only when canModerate.
  const beginReply = (message: TopicMessage) => {
    if (!entryIsCurrent()) return;
    entryRevisionRef.current += 1;
    composerDraft.change({ reply: { id: message.id, body: message.body, sender_name: message.sender_name }, edit: null });
    setComposerFocusRequest(request => request + 1);
  };

  const beginEdit = (message: TopicMessage) => {
    if (!entryIsCurrent()) return;
    entryRevisionRef.current += 1;
    const mentions = readChatMentionDocument(message.body, message.mention_data);
    composerDraft.change({ text: message.body, mentions, edit: { id: message.id, body: message.body, edited_at: message.edited_at ?? null, mentions }, reply: null });
    draftRef.current = message.body;
    setComposerFocusRequest(request => request + 1);
  };

  const openMemberMenu = (message: TopicMessage) => {
    if (!selectedMessageCurrent(message.id)) return;
    const userId = message.sender_id;
    const name = message.sender_name ?? 'someone';
    if (!userId || userId === myId) return;
    hapticLight();
    setMessageMenu({
      preview: message.image_url ? 'Photo' : readChatLocation(message.location_lat, message.location_lng, message.body) ? 'Shared place' : message.body,
      own: message.sender_id === myId,
      selectedReaction: reactionEmoji(message.reactions.find(reaction => reaction.user_id === myId)?.reaction ?? ''),
      isCurrent: () => selectedMessageCurrent(message.id) && menuContext.current.archived === archived,
      onReact: archived ? undefined : emoji => {
        if (!selectedMessageCurrent(message.id) || menuContext.current.archived) return;
        const current = menuContext.current.messages.find(row => row.id === message.id)!;
        void reactToMessage(message.id, reactionKeyForEmoji(emoji, topicReactionCounts(current.reactions, myId), 'heart'));
      },
      title: name,
      buttons: [
        ...(!archived ? [
          { text: 'react', onPress: currentAction(() => setReactionPickerMsgId(message.id)) },
          { text: 'reply', onPress: () => beginReply(message) },
        ] : []),
        { text: 'report', onPress: currentAction(() => { setReportTarget({ id: userId, name }); setShowReport(true); }) },
        { text: 'block', style: 'destructive', onPress: currentAction(() => blockUser(userId, name, currentAction(() => { void refreshMessages(); }))) },
        ...(canModerate
          ? [{ text: 'remove this message', style: 'destructive' as const, onPress: () => handleDeleteMessage(message.id) }]
          : []),
        { text: 'cancel', style: 'cancel' },
      ],
    });
  };

  // Own-message actions stay separate from member moderation actions.
  const openOwnMessageMenu = (message: TopicMessage) => {
    if (!selectedMessageCurrent(message.id)) return;
    hapticLight();
    setMessageMenu({
      preview: message.image_url ? 'Photo' : readChatLocation(message.location_lat, message.location_lng, message.body) ? 'Shared place' : message.body,
      own: message.sender_id === myId,
      selectedReaction: reactionEmoji(message.reactions.find(reaction => reaction.user_id === myId)?.reaction ?? ''),
      isCurrent: () => selectedMessageCurrent(message.id) && menuContext.current.archived === archived,
      onReact: archived ? undefined : emoji => {
        if (!selectedMessageCurrent(message.id) || menuContext.current.archived) return;
        const current = menuContext.current.messages.find(row => row.id === message.id)!;
        void reactToMessage(message.id, reactionKeyForEmoji(emoji, topicReactionCounts(current.reactions, myId), 'heart'));
      },
      title: 'Your message',
      buttons: [
        ...(!archived ? [
          { text: 'react', onPress: currentAction(() => setReactionPickerMsgId(message.id)) },
          { text: 'reply', onPress: () => beginReply(message) },
        ] : []),
        ...(!archived && message.body ? [{ text: 'edit', onPress: () => beginEdit(message) }] : []),
        { text: 'delete this message', style: 'destructive', onPress: () => handleDeleteMessage(message.id, true) },
        { text: 'cancel', style: 'cancel' },
      ],
    });
  };

  const handlePickPhoto = async (source: 'library' | 'camera' = 'library') => {
    if (!attachmentIsCurrent() || photoAttemptRef.current || pickerAttemptRef.current) return;
    const attempt = {};
    pickerAttemptRef.current = attempt;
    try {
      if (source === 'camera') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!attachmentIsCurrent()) return;
        if (permission.status !== 'granted') throw new Error('Camera access is needed to take a picture.');
      }
      // The images-only system picker grants access to the selected photo.
      const result = source === 'camera' ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 }) : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
      if (!attachmentIsCurrent() || result.canceled || !result.assets[0]) return;
      photoSendSessionRef.current.clear(); photoReplyRef.current = null;
      setPendingPhoto(result.assets[0]);
      setPhotoError(null);
      setPhotoPreviewOpen(true);
    } catch (e) {
      if (!attachmentIsCurrent()) return;
      setAlertInfo({ title: source === 'camera' ? 'Could not open camera' : 'Could not open photos', message: friendlyError(e, 'Try again in a moment.') });
    } finally {
      if (entryIsCurrent() && pickerAttemptRef.current === attempt) pickerAttemptRef.current = null;
    }
  };

  const handleSendPhoto = async (caption: string) => {
    const asset = pendingPhoto;
    if (!attachmentIsCurrent() || !myId || !asset || photoAttemptRef.current) return;
    if (!photoSendSessionRef.current.hasCaption(asset.uri)) {
      const checked = checkContent(caption.trim().slice(0, 4000));
      if (!checked.ok) { setPhotoError(checked.reason ?? 'Please revise your caption.'); return; }
    }
    const entryRevision = entryRevisionRef.current;
    const attempt = {};
    photoAttemptRef.current = attempt;
    setUploadingPhoto(true);
    setPhotoError(null);
    const session = photoSendSessionRef.current;
    const isCurrent = () => attachmentIsCurrent() && photoAttemptRef.current === attempt;
    const sendScope = { userId: myId, isCurrent };
    try {
      let imageUrl = session.uploadedUrl(asset.uri);
      if (!imageUrl) {
        const manipulated = await requestWithDeadline(ImageManipulator.manipulateAsync(
          asset.uri, [{ resize: { width: 1200 } }],
          { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG, base64: true },
        ), 12_000);
        if (!isCurrent()) return;
        if (!manipulated.base64) throw new Error('That photo could not be prepared.');
        imageUrl = await requestWithDeadline(uploadBase64ToStorage(
          'chat-images', `${myId}/community-${session.idFor(asset.uri)}.jpg`, manipulated.base64,
          { existingIsSuccess: true },
        ), 30_000);
        if (!isCurrent()) return;
        session.rememberUploadedUrl(asset.uri, imageUrl);
      }
      photoReplyRef.current ??= { id: replyingTo?.id };
      await requestWithDeadline(sendMessage(session.captionFor(asset.uri, caption), imageUrl, photoReplyRef.current.id, undefined, session.idFor(asset.uri), undefined, sendScope), 35_000);
      if (!isCurrent()) return;
      clearSubmittedEntry(entryRevision);
      setPhotoPreviewOpen(false);
      setPendingPhoto(null);
      session.clear(); photoReplyRef.current = null;
      if (anchor) { setIsAtBottom(true); clearAnchor(); }
      else { setIsAtBottom(true); listRef.current?.scrollToOffset({ offset: 0, animated: false }); }
    } catch (e) {
      if (!isCurrent() || isObsoleteTopicOperation(e)) return;
      setPhotoError(session.hasCaption(asset.uri) ? 'Couldn’t confirm delivery. Retry keeps the same photo and caption.' : friendlyError(e, 'Your photo is kept. Try again.'));
    } finally {
      if (entryIsCurrent() && photoAttemptRef.current === attempt) {
        photoAttemptRef.current = null;
        setUploadingPhoto(false);
      }
    }
  };

  const handleShareLocation = async (latitude: number, longitude: number, address: string) => {
    if (!attachmentIsCurrent() || !myId || locationAttemptRef.current) return false;
    const attempt = {}; locationAttemptRef.current = attempt;
    const session = locationSendSessionRef.current;
    const isCurrent = () => attachmentIsCurrent() && locationAttemptRef.current === attempt;
    try {
      const sendId = session.idFor(JSON.stringify({ latitude, longitude, address }), null);
      await requestWithDeadline(sendLocation(latitude, longitude, address, sendId, { userId: myId, isCurrent }), 25_000);
      if (!isCurrent()) return false;
      session.clear();
      setLocationPickerOpen(false);
      if (anchor) { setIsAtBottom(true); clearAnchor(); }
      else { setIsAtBottom(true); listRef.current?.scrollToOffset({ offset: 0, animated: false }); }
      return true;
    } catch (error) {
      if (isCurrent() && !isObsoleteTopicOperation(error)) logError(error, 'communityTopic.sendLocation');
      return false;
    } finally {
      if (entryIsCurrent() && locationAttemptRef.current === attempt) locationAttemptRef.current = null;
    }
  };

  const focusMention = useChatMentionFocus(composerInputRef, entryIsCurrent);
  const insertMention = (member: { id: string; first_name: string | null }) => {
    if (!entryIsCurrent() || !member.first_name || !members.some(row => row.id === member.id && row.first_name === member.first_name)) return;
    const before = draftRef.current, caret = selectionRef.current.start;
    if (mentionQueryAt(before, caret) === null) return;
    const inserted = insertMentionAt(before, caret, member.first_name);
    let mentions;
    try { mentions = addChatMentionReference(inserted.text, composerDraft.draft.mentions ?? null, member.id, member.first_name, before.lastIndexOf('@', caret - 1)); } catch { return; }
    entryRevisionRef.current += 1;
    composerDraft.change({ text: inserted.text, mentions });
    draftRef.current = inserted.text;
    selectionRef.current = { start: inserted.caret, end: inserted.caret };
    setMentionQuery(null);
    focusMention(inserted.caret);
  };

  useEffect(() => {
    if (introLayout) {
      const previous = previousNewestRoomItemRef.current;
      if (previous && !isAtBottom) {
        const arrived = roomItems.filter(item => item.message.sender_id !== myId && compareCommunityRoomSequence(
          { ...item.message, source: item.source }, { ...previous.message, source: previous.source },
        ) > 0).length;
        if (arrived) setUnreadWhileScrolled(count => count + arrived);
      }
      previousNewestRoomItemRef.current = roomItems[roomItems.length - 1] ?? null;
      return;
    }
    const newest = visibleMessages.reduce((latest, message) => {
      const timestamp = Date.parse(message.created_at);
      return Number.isFinite(timestamp) ? Math.max(latest, timestamp) : latest;
    }, -Infinity);
    const previous = previousTopicMessagesRef.current;
    if (!previous) {
      previousTopicMessagesRef.current = { ids: new Set(visibleMessages.map(message => message.id)), newest };
      return;
    }
    let arrived = 0;
    for (const message of visibleMessages) {
      if (!previous.ids.has(message.id) && Date.parse(message.created_at) >= previous.newest && message.sender_id !== myId) arrived++;
      previous.ids.add(message.id);
    }
    previous.newest = Math.max(previous.newest, newest);
    if (!isAtBottom && arrived > 0) setUnreadWhileScrolled(count => count + arrived);
  }, [isAtBottom, visibleMessages, !!introLayout, introLayout ? roomItems : null, myId]);

  // Review finding 2026-08-29: keying off messages.length stops detecting new
  // arrivals once the room hits the 300-message query cap, since an insert
  // just replaces the oldest row instead of growing the array. The newest
  // message's own id always changes on a real arrival, capped or not.
  const lastMessageId = messages.length > 0 ? messages[messages.length - 1].id : null;
  useEffect(() => {
    if (!anchor && id && lastMessageId && usesLegacyHistory) markTopicRead(id).catch(() => {});
  }, [id, lastMessageId, usesLegacyHistory, anchorKey]);

  const renderMessage = ({ item, index, previousMessage, showDayOverride }: { item: TopicMessage; index: number; previousMessage?: TopicMessage | null; showDayOverride?: boolean }) => {
    const mine = item.sender_id === myId;
    const previous = previousMessage === undefined ? (index > 0 ? visibleMessages[index - 1] : null) : previousMessage;
    const grouped = !!previous && previous.sender_id === item.sender_id && isSameChatDay(previous.created_at, item.created_at) &&
              Math.abs(new Date(previous.created_at).getTime() - new Date(item.created_at).getTime()) <= 5 * 60 * 1000;
    const showDay = showDayOverride ?? (!previous || !isSameChatDay(previous.created_at, item.created_at));
    const firstUrl = extractFirstUrl(item.body);
    // Mirrors the Community chat / ChatThread bubbleUrl fix (8-02, restated
    // live 2026-08-27): the bubble's own onLongPress claims the touch
    // responder, which can swallow a nested LinkifiedText <Text onPress>
    // before it fires. A message with exactly one link makes the whole
    // bubble a second, ancestor-proof way into that link.
    const bubbleUrl = soleUrlIn(item.body);
    const sharedLocation = readChatLocation(item.location_lat, item.location_lng, item.body);
    const locationUrl = sharedLocation
      ? `https://www.google.com/maps/search/?api=1&query=${sharedLocation.latitude},${sharedLocation.longitude}`
      : null;
    return (
      <View>
        {showDay && <Text style={[styles.daySeparator, messageAppearance?.day]}>{formatChatDay(item.created_at)}</Text>}
        <View style={[styles.messageRow, grouped && styles.messageRowGrouped, mine && styles.messageRowMine]}>
          {!mine && (!grouped ? (
            <TouchableOpacity onPress={() => setProfileUserId(item.sender_id)} accessibilityLabel={`View ${item.sender_name ?? 'member'} profile`}>
              {item.sender_photo ? (
                <Image source={{ uri: item.sender_photo }} style={styles.face} contentFit="cover" />
              ) : (
                <View style={[styles.face, styles.facePlaceholder, messageAppearance?.avatar]}>
                  <Text style={[styles.faceInitial, messageAppearance?.avatarInitial]}>{(item.sender_name ?? '?').slice(0, 1).toLowerCase()}</Text>
                </View>
              )}
            </TouchableOpacity>
          ) : <View style={styles.faceSpacer} />)}
          <View style={styles.bubbleWrap} {...messageActionWeb(() => mine ? openOwnMessageMenu(item) : openMemberMenu(item))}>
            <TouchableOpacity
              activeOpacity={0.9}
              onPress={COMMUNITY_CHAT_GROUPING_ENABLED && item.image_url ? () => photoSelection.onSelect(item.id) : locationUrl ? () => openUrl(locationUrl) : bubbleUrl ? () => openUrl(bubbleUrl) : undefined}
              onLongPress={() => (mine ? openOwnMessageMenu(item) : openMemberMenu(item))}
              {...messageActionAccess(() => mine ? openOwnMessageMenu(item) : openMemberMenu(item))}
              style={[styles.bubble, mine && styles.bubbleMine, messageAppearance?.bubble, mine && messageAppearance?.bubbleOwn]}
              accessibilityHint={mine ? 'hold for message actions' : 'hold for message actions'}
              accessibilityRole={sharedLocation ? 'button' : undefined}
              accessibilityLabel={sharedLocation ? `Open map for ${chatLocationLabel(sharedLocation)}` : undefined}
            >
              {mine && COMMUNITY_CHAT_GROUPING_ENABLED && <ChatBubbleFill/>}
              {!mine && !grouped && <Text style={[styles.senderName, messageAppearance?.sender]}>{item.sender_name ?? 'someone'}</Text>}
              {!!item.reply_to && (
                <View style={[styles.quote, mine && styles.quoteMine, messageAppearance?.quote, mine && messageAppearance?.quoteOwn]}>
                  <Text style={[styles.quoteName, mine && styles.messageTextMine, messageAppearance?.quoteName, mine && messageAppearance?.bodyOwn]}>{item.reply_to.sender_name ?? 'someone'}</Text>
                  <Text style={[styles.quoteBody, mine && styles.messageTextMine, messageAppearance?.quoteBody, mine && messageAppearance?.bodyOwn]} numberOfLines={2}>{item.reply_to.body || 'photo'}</Text>
                </View>
              )}
              {!!item.image_url && (COMMUNITY_CHAT_GROUPING_ENABLED ? <ChatPhotoAttachment
                uri={item.image_url} senderName={item.sender_name} fonts={conversationFonts}
                maxWidth={Math.min(240, (windowWidth - 32) * 0.78 - 26)}
                onOpen={() => photoSelection.onSelect(item.id)}
                onLongPress={() => (mine ? openOwnMessageMenu(item) : openMemberMenu(item))}
              /> : <Image source={{ uri: item.image_url }} style={styles.messageImage} contentFit="cover" />)}
              {!!locationUrl && (COMMUNITY_CHAT_GROUPING_ENABLED ? <ChatLocationPreview location={sharedLocation} fonts={conversationFonts} isOwn={mine} /> : (
                <View style={styles.locationLabelRow}>
                  <MapPin size={15} color={mine ? Colors.white : Colors.terracotta} />
                  <Text style={[styles.locationLabel, mine && styles.messageTextMine]}>Shared location · open map</Text>
                </View>
              ))}
              {!!item.body && !(sharedLocation && COMMUNITY_CHAT_GROUPING_ENABLED) && (
                <LinkifiedText
                  text={item.body}
                  mentionDocument={item.mention_data}
                  onMentionPress={userId => { if (entryIsCurrent()) setProfileUserId(userId); }}
                  style={[styles.messageText, mine && styles.messageTextMine, messageAppearance?.body, mine && messageAppearance?.bodyOwn]}
                  linkStyle={messageAppearance ? mine ? messageAppearance.linkOwn : messageAppearance.link : mine && styles.messageTextMine}
                  mentionNames={mentionNames}
                  mentionStyle={messageAppearance ? mine ? messageAppearance.mentionOwn : messageAppearance.mention : mine && styles.messageTextMine}
                />
              )}
              {!!firstUrl && <LinkPreviewCard url={firstUrl} isOwn={mine} />}
              {mine && item.delivery_state === 'sending' && (
                <Text style={[styles.editedText, styles.messageTextMine, messageAppearance?.metadata, messageAppearance?.metadataOwn]} accessibilityLabel="Sending message">sending…</Text>
              )}
              <Text style={[styles.editedText, messageAppearance?.metadata, mine && messageAppearance?.metadataOwn, { alignSelf: 'flex-end', marginTop: 2 }]}>{item.edited_at ? 'edited · ' : ''}{formatChatTime(item.created_at)}</Text>
            </TouchableOpacity>
            <ReactionChips attached
              appearance={COMMUNITY_CHAT_GROUPING_ENABLED ? { fonts: conversationFonts } : undefined}
              reactions={topicReactionCounts(item.reactions, myId)}
              onViewReactions={() => openReactionDetails(item.id)}
              disabled={archived}
              onReact={(key) => { void reactToMessage(item.id, key); }}
              onAddReaction={() => setReactionPickerMsgId(item.id)}
              style={[styles.reactionRow, mine && styles.reactionRowMine]}
            />
          </View>
        </View>
      </View>
    );
  };

  const renderRoomItem = ({ item, index }: { item: TopicMessage | CommunityRoomMessage; index: number }) => {
    if (!('source' in item)) {
      const previous = listMessages[index + 1] ?? null;
      return renderMessage({ item, index, previousMessage: previous && !('source' in previous) ? previous : null });
    }
    const older = listMessages[index + 1];
    const previous = older && 'source' in older ? older : null;
    if (item.source === 'topic') return renderMessage({ item: item.message, index, previousMessage: previous?.source === 'topic' ? previous.message : null, showDayOverride: !previous || !isSameChatDay(previous.message.created_at, item.message.created_at) });
    const showDay = !previous || !isSameChatDay(previous.message.created_at, item.message.created_at);
    return <View>
      {showDay && <Text style={[styles.daySeparator, messageAppearance?.day]}>{formatChatDay(item.message.created_at)}</Text>}
      <BroadcastCard onViewMember={userId => { if (entryIsCurrent()) setProfileUserId(userId); }} onViewReactions={() => openReactionDetails(item.message.id, 'broadcast')} broadcast={item.message} communityName={introLayout?.name ?? ''}
        scope={readableScope ?? undefined} appearance={{ fonts: conversationFonts }} mentionNames={mentionNames}
        onError={(title, message) => { if (entryIsCurrent()) setAlertInfo({ title, message }); }} />
    </View>;
  };

  const owningCommunityName = introLayout?.name ?? (topicMeta?.explore_event_id === null
    ? payload?.cards.find(card => card.community_id === topicMeta.community_id)?.name
    : undefined);
  const composerInputProps: React.ComponentProps<typeof TextInput> = {
    value: draft,
    editable: composerDraft.ready && !composerDraft.error,
    onChangeText: (text) => {
      if (!entryIsCurrent()) return;
      entryRevisionRef.current += 1;
        const previousLength = draftRef.current.length;
      const caret = selectionRef.current.start >= previousLength ? text.length : selectionRef.current.start;
      selectionRef.current = { start: caret, end: caret };
      draftRef.current = text;
      setDraft(text);
      setMentionQuery(mentionQueryAt(text, caret));
      if (text.trim()) broadcastTyping();
      else stopTyping();
    },
    onSelectionChange: (event) => {
      if (!entryIsCurrent()) return;
      selectionRef.current = event.nativeEvent.selection;
      setMentionQuery(mentionQueryAt(draftRef.current, event.nativeEvent.selection.start));
    },
    placeholder: gated ? "hi, i'm from..." : 'say something',
    placeholderTextColor: Colors.inkSoft, multiline: true, maxLength: 4000,
  };

  // The same notification controller and feedback are used by both presentations.
  const notificationButton = (
    <TouchableOpacity
      onPress={handleNotifications}
      hitSlop={COMMUNITY_CHAT_GROUPING_ENABLED ? undefined : 12}
      style={COMMUNITY_CHAT_GROUPING_ENABLED ? chatHeaderActionStyle : undefined}
      disabled={muteChecking}
      accessibilityRole="button"
      accessibilityLabel={notifications.label ?? (muteChecking ? 'Checking chat notifications' : !muteReady ? 'Check chat notification setting' : muted ? 'Unmute chat' : 'Mute chat')}
      accessibilityHint={!muteChecking && !muteReady ? 'Couldn’t check notifications. Tap to retry.' : muted ? 'Unread messages stay in this chat.' : undefined}
      accessibilityState={{ disabled: muteChecking, busy: muteChecking }}
      aria-disabled={muteChecking}
      aria-busy={muteChecking}
    >
      {muteChecking ? <ActivityIndicator size="small" color={COMMUNITY_CHAT_GROUPING_ENABLED ? AfterglowColors.muted : Colors.tertiary} /> : !muteReady ? (
        <CircleHelp size={20} color={COMMUNITY_CHAT_GROUPING_ENABLED ? AfterglowColors.muted : Colors.tertiary} strokeWidth={2.5} />
      ) : muted ? (
        <BellOff size={20} color={COMMUNITY_CHAT_GROUPING_ENABLED ? AfterglowColors.muted : Colors.tertiary} strokeWidth={2.5} />
      ) : (
        <Bell size={20} color={COMMUNITY_CHAT_GROUPING_ENABLED ? AfterglowColors.clay : Colors.terracotta} strokeWidth={2.5} />
      )}
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container} edges={Platform.OS === 'ios' ? ['top'] : ['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardLayout style={styles.flex} {...(Platform.OS === 'ios' ? {} : { behavior: 'height' as const })}>
        {COMMUNITY_CHAT_GROUPING_ENABLED ? <>
          <ChatContextHeader
            title={eventTopic ? topicMeta?.explore_events?.title ?? topic?.name ?? 'Event' : introLayout?.rooms[0].name ?? topic?.name ?? 'chat space'}
            subtitle={eventTopic ? eventDateLabel || 'people going to this event' : owningCommunityName || 'members who joined this chat space'}
            location={eventTopic ? topicMeta?.explore_events?.venue : undefined}
            contextLabel={eventTopic ? 'View event' : 'View community'}
            fonts={conversationFonts}
            backLabel="Back"
            onBack={() => router.back()}
            onViewContext={eventTopic && topic?.explore_event_id
              ? () => router.push(`/event/${topic.explore_event_id}` as never)
              : topicMeta?.explore_event_id === null && topicMeta.community_id
                ? () => router.push(`/community/${topicMeta.community_id}` as never)
                : undefined}
            wrapActionsOnNarrow={!!(eventTopic && canAddEventCalendar)}
            actions={<>
              {eventTopic && canAddEventCalendar && <TouchableOpacity
                onPress={() => showAddToCalendar(
                  topicMeta?.explore_events?.title ?? topic?.name ?? 'Event',
                  calendarStart!,
                  topicMeta?.explore_events?.end_time,
                  topicMeta?.explore_events?.venue ?? undefined,
                )}
                accessibilityRole="button"
                accessibilityLabel="Add event to calendar"
                style={chatHeaderActionStyle}
              ><CalendarDays size={21} color={AfterglowColors.clay} strokeWidth={2} /></TouchableOpacity>}
              <ChatOptionsButton key={`${id}:${myId}:${muteViewer.epoch}`} fonts={conversationFonts} isCurrent={entryIsCurrent}
                contextLabel={eventTopic ? 'View event' : 'View community'}
                onViewContext={eventTopic && topic?.explore_event_id ? currentAction(() => router.push(`/event/${topic.explore_event_id}` as never))
                  : topicMeta?.community_id ? currentAction(() => router.push(`/community/${topicMeta.community_id}` as never)) : undefined}
                notificationLabel={notifications.label ?? (muteChecking ? 'Checking notifications…' : !muteReady ? 'Check notification setting' : muted ? 'Unmute chat' : 'Mute chat')}
                notificationBusy={!!muteChecking} onNotifications={handleNotifications}>
                {notifications.parent && <CommunityChatPreferenceControl control={notifications.parent} fonts={conversationFonts} compact/>}
              </ChatOptionsButton>
            </>}
          />

          {eventTopic && <View style={styles.compactContextStrip}>
            <View style={styles.compactContextCopy}>
              {!!eventDateLabel && <Text style={[styles.compactContextText, { fontFamily: conversationFonts.regular }]}>people going to this event</Text>}
              {!!eventStateLabel && <Text style={[styles.compactContextText, { fontFamily: conversationFonts.medium }]}>{eventStateLabel}</Text>}
              {!!roomExpiry && <Text style={[styles.compactContextText, { fontFamily: conversationFonts.regular }]}>Chat closes {formatTimestampLA(roomExpiry.toISOString())}</Text>}
            </View>
            <TouchableOpacity
              onPress={() => router.push(`/event-album/${id}` as never)}
              accessibilityRole="button"
              accessibilityLabel="Photos"
              style={styles.compactPhotos}
            >
              <ImagePlus size={18} color={AfterglowColors.clay} strokeWidth={2.25} />
              <Text style={[styles.compactPhotosText, { fontFamily: conversationFonts.medium }]}>Photos</Text>
            </TouchableOpacity>
          </View>}
        </> : <>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
            <ArrowLeft size={22} color={Colors.asphalt} strokeWidth={2.5} />
          </TouchableOpacity>
          <View style={styles.headerTitleWrap}>
            <Text style={styles.headerTitle} numberOfLines={1}>{topic?.name ?? 'chat space'}</Text>
            <Text style={styles.headerAudience} numberOfLines={1}>
              {eventTopic ? 'people going to this event' : 'members who joined this chat space'}
            </Text>
          </View>
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
          {notificationButton}
          <ProfileButton compact/>
        </View>

        {eventTopic && topic?.explore_event_id && (
          <View style={styles.contextCard}>
            <Text style={styles.contextEyebrow}>COMMUNITY EVENT</Text>
            <Text style={styles.contextTitle} numberOfLines={2}>
              {topicMeta?.explore_events?.title ?? topic?.name ?? 'Event'}
            </Text>
            {!!logisticsLine && <Text style={styles.logisticsText} numberOfLines={2}>{logisticsLine}</Text>}
            {!!roomExpiry && (
              <Text style={styles.expiryText}>Chat closes {formatTimestampLA(roomExpiry.toISOString())}</Text>
            )}
            <View style={styles.contextActions}>
              <TouchableOpacity
                onPress={() => router.push(`/event/${topic.explore_event_id}` as never)}
                accessibilityRole="button"
                accessibilityLabel="View event details"
                style={styles.contextAction}
              >
                <Text style={styles.contextActionText}>View event</Text>
              </TouchableOpacity>
              {canAddEventCalendar && (
                <TouchableOpacity
                  onPress={() => showAddToCalendar(
                    topicMeta?.explore_events?.title ?? topic?.name ?? 'Event',
                    calendarStart!,
                    topicMeta?.explore_events?.end_time,
                    topicMeta?.explore_events?.venue ?? undefined,
                  )}
                  accessibilityRole="button"
                  accessibilityLabel="Add event to calendar"
                  style={styles.contextAction}
                >
                  <CalendarDays size={15} color={Colors.terracotta} strokeWidth={2} />
                  <Text style={styles.contextActionText}>Add to calendar</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}
        {!eventTopic && topicMeta?.community_id && (
          <TouchableOpacity
            onPress={() => router.push(`/community/${topicMeta.community_id}` as never)}
            accessibilityRole="button"
            accessibilityLabel="View community"
            style={styles.communityContext}
          >
            <Text style={styles.communityContextText}>View community</Text>
          </TouchableOpacity>
        )}
        </>}

        {!anchor && welcomeMessage && (
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

        {eventTopic && id && topic?.explore_event_id && readableScope && <TopicWelcomeEditor
          key={`${id}:${myId}:${topic.explore_event_id}`}
          topicId={id} eventId={topic.explore_event_id} owner={readableScope}
          canManage={iAmCreatorOrLeader}
          canCreate={canSetWelcome && !messagesLoading && !messagesLoadError && !removedFromCommunity}
          onSaved={refreshWelcome}
        />}

        {!!anchor && <ChatMessageAnchorNotice fonts={conversationFonts} loading={messagesLoading} unavailable={anchorUnavailable} failed={messagesLoadError} onLatest={() => { setIsAtBottom(true); clearAnchor(); }} />}
        <MessageViewport {...(Platform.OS === 'ios' ? { style: styles.flex, inset: insets.bottom } : {})}>
        {introReadFailed ? (
          <View style={styles.loadErrorWrap}>
            <Text style={styles.loadErrorTitle}>Couldn’t open this chat</Text>
            <Text style={styles.loadErrorBody}>We couldn’t check your introduction. Try again, or send a hello below.</Text>
            <TouchableOpacity style={styles.loadRetry} onPress={retryIntroStatus}
              disabled={introRetrying || introStatusFetching} accessibilityRole="button"
              accessibilityLabel="Retry checking your chat introduction"
              accessibilityState={{ disabled: introRetrying || !!introStatusFetching, busy: introRetrying || !!introStatusFetching }}>
              <CreatorActionFill /><Text style={styles.loadRetryText}>{introRetrying || introStatusFetching ? 'Checking…' : 'Try again'}</Text>
            </TouchableOpacity>
          </View>
        ) : anchorUnavailable ? <View style={styles.flex} /> : (messagesLoading && listMessages.length === 0) || gateChecking ? (
          <View style={styles.centered}>
            <ActivityIndicator accessibilityLabel={gateChecking ? "Checking your chat introduction" : "Loading messages"} size="large" color={Colors.terracotta} />
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
        ) : messagesLoadError && listMessages.length === 0 ? (
          <View style={styles.loadErrorWrap}>
            <Text style={styles.loadErrorTitle}>Messages couldn't load</Text>
            <Text style={styles.loadErrorBody}>This chat is still here. Check your connection and try again.</Text>
            <TouchableOpacity style={styles.loadRetry} onPress={() => { void refreshMessages(); }} accessibilityRole="button" accessibilityLabel="Retry loading community messages">
              <CreatorActionFill /><Text style={styles.loadRetryText}>Try again</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.listWrap}>
            {messagesLoadError && (
              <TouchableOpacity style={styles.loadWarning} onPress={() => { void refreshMessages(true); }} accessibilityRole="button" accessibilityLabel="Community messages may be out of date. Retry loading">
                <Text style={styles.loadWarningText}>Messages may be out of date · Tap to retry</Text>
              </TouchableOpacity>
            )}
            {!!introLayout && readAcknowledgement.uncertain && <TouchableOpacity
              style={[styles.loadWarning, { backgroundColor: AfterglowColors.white }]} accessibilityRole="button"
              accessibilityLabel={readAcknowledgement.retryReady ? 'Retry syncing read messages' : 'Check read message status'}
              disabled={!!readAcknowledgement.checking}
              onPress={readAcknowledgement.retryReady ? readAcknowledgement.retryAcknowledgement : () => { void readAcknowledgement.checkReadPosition(); }}>
              <Text style={[styles.loadWarningText, { ...AfterglowType.caption, fontFamily: conversationFonts.medium, color: AfterglowColors.ink }]}>{readAcknowledgement.checking ? 'Checking read status…' : readAcknowledgement.retryReady ? 'Read status not saved · Tap to retry' : 'Read status uncertain · Tap to check'}</Text>
            </TouchableOpacity>}
            <FlatList
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
              key={`${id}:${muteViewer.viewerId}:${muteViewer.epoch}:${introLayout ? 'intros' : 'topic'}:${anchorKey ?? 'latest'}`}
              ref={listRef}
              data={listMessages}
              inverted
              onViewableItemsChanged={onViewableItemsChanged}
              viewabilityConfig={viewabilityConfig}
              maintainVisibleContentPosition={isAtBottom && !anchor ? undefined : { minIndexForVisible: 0 }}
              keyExtractor={(m) => 'source' in m ? m.key : m.id}
              renderItem={row => <View onLayout={anchorKey && ('source' in row.item ? row.item.key === anchorKey : `topic:${row.item.id}` === anchorKey) ? anchorScroll.onTargetLayout : undefined} style={anchorKey && ('source' in row.item ? row.item.key === anchorKey : `topic:${row.item.id}` === anchorKey) ? { backgroundColor: Colors.goldBadgeSoft, borderRadius: 12 } : undefined}>{renderRoomItem(row)}</View>}
              onLayout={() => {
                if (!entryIsCurrent()) return;
                if (anchor) anchorScroll.schedule();
                else if (isAtBottom) listRef.current?.scrollToOffset({ offset: 0, animated: false });
              }}
              onScrollToIndexFailed={anchorScroll.onScrollToIndexFailed}
              contentContainerStyle={styles.listContent}
              ListFooterComponent={hasOlder || loadingOlder || olderLoadError ? (
                <TouchableOpacity style={styles.olderButton} onPress={() => { void loadOlder(); }} disabled={loadingOlder} accessibilityRole="button" accessibilityLabel={olderLoadError ? 'Retry loading earlier messages' : 'Load earlier messages'}>
                  {loadingOlder ? <ActivityIndicator size="small" color={Colors.terracotta} /> : (
                    <Text style={styles.olderButtonText}>{olderLoadError ? 'Could not load earlier messages · Try again' : 'Earlier messages'}</Text>
                  )}
                </TouchableOpacity>
              ) : null}
              onScroll={(event) => {
                if (!entryIsCurrent()) return;
                const atBottom = event.nativeEvent.contentOffset.y <= 80;
                setIsAtBottom(atBottom);
                if (atBottom) setUnreadWhileScrolled(0);
              }}
              scrollEventThrottle={100}
              onContentSizeChange={() => {
                if (!entryIsCurrent()) return;
                if (anchor) anchorScroll.schedule();
                else if (isAtBottom) listRef.current?.scrollToOffset({ offset: 0, animated: false });
              }}
              ListEmptyComponent={
                <Text style={styles.emptyLine}>nobody has said anything here yet. go first.</Text>
              }
            />
            {!anchor && !isAtBottom && (
              <TouchableOpacity
                style={styles.scrollLatestBtn}
                onPress={() => {
                  listRef.current?.scrollToOffset({ offset: 0, animated: true });
                  setUnreadWhileScrolled(0);
                }}
                accessibilityRole="button"
                accessibilityLabel={unreadWhileScrolled > 0 ? `Scroll to latest messages, ${unreadWhileScrolled} new ${unreadWhileScrolled === 1 ? 'message' : 'messages'}` : 'Scroll to latest messages'}
              >
                <ChevronDown size={17} color={Colors.white} strokeWidth={2.5} />
                {unreadWhileScrolled > 0 && <Text style={styles.scrollLatestText}>{unreadWhileScrolled}</Text>}
              </TouchableOpacity>
            )}
          </View>
        )}

        </MessageViewport>
        <ComposerDock {...(Platform.OS === 'ios' ? { inset: insets.bottom } : {})}>
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
          {mentionQuery !== null && <ChatMentionPicker members={mentionCandidates} fonts={conversationFonts}
            loading={membersLoading} error={membersError}
            onRetry={()=>{if(entryIsCurrent())void retryMembers();}}
            onSelect={insertMention} onClose={()=>{if(entryIsCurrent())setMentionQuery(null);}}/>}
          {(!composerDraft.ready || composerDraft.error || composerDraft.draft.attempt && !sending) && <View style={styles.composerContext}>
            <View style={styles.composerContextText}>
              <Text style={styles.composerContextLabel}>{composerDraft.error ? 'Your draft could not be saved or checked.' : !composerDraft.ready ? 'Checking your draft…' : 'Your previous message is not confirmed.'}</Text>
              {composerDraft.draft.attempt && <Text style={styles.composerContextBody} numberOfLines={2}>{composerDraft.draft.attempt.text}</Text>}
              {composerDraft.error ? <TouchableOpacity accessibilityRole="button" accessibilityLabel="Retry message draft" style={styles.draftRecoveryAction} onPress={() => { void composerDraft.retry(); }}><Text style={styles.composerContextLabel}>Try again</Text></TouchableOpacity>
                : composerDraft.draft.attempt ? <View style={{ flexDirection: 'row', gap: 20 }}>
                  <TouchableOpacity accessibilityRole="button" accessibilityLabel="Check original message" style={styles.draftRecoveryAction} disabled={sending} onPress={() => { void checkPendingDraft(); }}><Text style={styles.composerContextLabel}>Check</Text></TouchableOpacity>
                  <TouchableOpacity accessibilityRole="button" accessibilityLabel="Retry original message" style={styles.draftRecoveryAction} disabled={sending || archived || removedFromCommunity} onPress={() => { void handleSend(); }}><Text style={styles.composerContextLabel}>Retry original</Text></TouchableOpacity>
                </View> : null}
            </View>
          </View>}
          {(replyingTo || editingMessageId) && (
            <View style={styles.composerContext}>
              <View style={styles.composerContextText}>
                <Text style={styles.composerContextLabel}>{editingMessageId ? 'Edit message' : `Reply to ${replyingTo?.sender_name ?? 'someone'}`}</Text>
                <Text style={styles.composerContextBody} numberOfLines={1}>{editingMessageId ? draft : (replyingTo?.body || 'photo')}</Text>
              </View>
              <TouchableOpacity
                onPress={() => {
                  if (!entryIsCurrent()) return;
                  entryRevisionRef.current += 1;
                  setReplyingTo(null);
                  if (editingMessageId) {
                    setDraft('');
                    draftRef.current = '';
                  }
                  setEditingMessageId(null);
                }}
                hitSlop={8}
                accessibilityRole="button"
                style={{minWidth:44,minHeight:44,alignItems:'center',justifyContent:'center'}}
                accessibilityLabel="Cancel message action"
              >
                <X size={18} color={Colors.tertiary} />
              </TouchableOpacity>
            </View>
          )}
          {COMMUNITY_CHAT_GROUPING_ENABLED ? <CommunityChatComposer
            composerInputRef={composerInputRef}
            fonts={conversationFonts}
            inputProps={{ ...composerInputProps, placeholderTextColor: AfterglowColors.muted, placeholder: gated ? "hi, i'm from..." : 'Message…' }}
            photo={{ onPress: () => handlePickPhoto(), disabled: draftBlocked || !myId || uploadingPhoto || gated || gateChecking || !!editingMessageId, busy: uploadingPhoto }}
            camera={{ onPress: () => handlePickPhoto('camera'), disabled: draftBlocked || !myId || uploadingPhoto || gated || gateChecking || archived || !!editingMessageId }}
            location={{ onPress: currentAction(() => setLocationPickerOpen(true)), disabled: draftBlocked || !myId || gated || gateChecking || archived || !!editingMessageId }}
            onSend={handleSend}
            sendDisabled={draftBlocked || !draft.trim() || sending}
            sending={sending}
            editing={!!editingMessageId}
          /> : <View style={styles.composer}>
            <TouchableOpacity
              style={styles.photoBtn}
              onPress={() => handlePickPhoto()}
              disabled={draftBlocked || !myId || uploadingPhoto || gated || gateChecking || !!editingMessageId}
              accessibilityRole="button"
              accessibilityLabel="Add photo"
            >
              {uploadingPhoto
                ? <ActivityIndicator size="small" color={Colors.terracotta} />
                : <ImageIcon size={22} color={Colors.terracotta} strokeWidth={2.25} />}
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.photoBtn}
              onPress={currentAction(() => setLocationPickerOpen(true))}
              disabled={draftBlocked || !myId || gated || gateChecking || archived || !!editingMessageId}
              accessibilityRole="button"
              accessibilityLabel="Share location"
            >
              <MapPin size={22} color={Colors.terracotta} strokeWidth={2.25} />
            </TouchableOpacity>
            <TextInput ref={composerInputRef} style={styles.input} {...composerInputProps} />
            <TouchableOpacity
              style={[styles.sendBtn, (!draft.trim() || sending) && styles.sendBtnOff]}
              onPress={handleSend}
              disabled={draftBlocked || !draft.trim() || sending}
            >
              {sending ? (
                <ActivityIndicator size="small" color={Colors.white} />
              ) : (
                <Text style={styles.sendBtnText}>send</Text>
              )}
            </TouchableOpacity>
          </View>}
        </View>
        )}
        </ComposerDock>
      </KeyboardLayout>

      <LocationPickerModal
        visible={locationPickerOpen}
        retryPreservesMessage
        onClose={currentAction(() => setLocationPickerOpen(false))}
        onConfirm={handleShareLocation}
      />

      {COMMUNITY_CHAT_GROUPING_ENABLED && <ChatPhotoViewer photos={photos} {...photoSelection} fonts={conversationFonts} />}

      <PhotoPreviewModal
        visible={photoPreviewOpen}
        assets={pendingPhoto ? [pendingPhoto] : []}
        sending={uploadingPhoto}
        initialCaption={draft}
        errorMessage={photoError}
        captionLocked={!!pendingPhoto && photoSendSessionRef.current.hasCaption(pendingPhoto.uri)}
        onCancel={() => {
          if (!entryIsCurrent() || uploadingPhoto) return;
          setPhotoPreviewOpen(false);
          setPendingPhoto(null);
          setPhotoError(null);
          photoSendSessionRef.current.clear(); photoReplyRef.current = null;
        }}
        onSend={handleSendPhoto}
      />

      {reportTarget && (
        <ReportModal
          visible={showReport}
          onClose={currentAction(() => setShowReport(false))}
          scope={readableScope}
          reportedUserId={reportTarget.id}
          reportedUserName={reportTarget.name}
        />
      )}

      {reactionDetails && <ReactionDetailsSheet request={reactionDetails} onClose={() => setReactionDetails(null)} />}
      <MessageActionsMenu menu={messageMenu} onClose={() => setMessageMenu(null)} />
      <BrandedAlert
        visible={!!alertInfo}
        title={alertInfo?.title ?? ''}
        message={alertInfo?.message}
        buttons={alertInfo?.buttons}
        onClose={currentAction(() => setAlertInfo(null))}
      />
      <MiniProfileCard
        visible={!!profileUserId}
        userId={profileUserId}
        onClose={currentAction(() => setProfileUserId(null))}
        onReport={(userId, userName) => {
          if (!entryIsCurrent()) return;
          setProfileUserId(null);
          setReportTarget({ id: userId, name: userName });
          setShowReport(true);
        }}
        onBlock={(userId, userName) => {
          if (!entryIsCurrent()) return;
          setProfileUserId(null);
          blockUser(userId, userName, currentAction(() => { void refreshMessages(); }));
        }}
      />
      <ReactionEmojiPicker
        visible={!!reactionPickerMsgId}
        onSelect={(emoji) => {
          if (!entryIsCurrent()) return;
          const message = messages.find(item => item.id === reactionPickerMsgId);
          if (message && !archived) {
            const reactionKey = reactionKeyForEmoji(emoji, topicReactionCounts(message.reactions, myId), 'heart');
            void reactToMessage(message.id, reactionKey);
          }
          setReactionPickerMsgId(null);
        }}
        onClose={currentAction(() => setReactionPickerMsgId(null))}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.parchment },
  flex: { flex: 1 },
  compactContextStrip: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 4,
    backgroundColor: AfterglowColors.paper,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: AfterglowColors.subtleLine,
  },
  compactContextCopy: { flex: 1, minWidth: 0, paddingVertical: 4 },
  compactContextText: { ...AfterglowType.caption, color: AfterglowColors.muted },
  compactPhotos: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, minHeight: 44, minWidth: 44, flexShrink: 0 },
  compactPhotosText: { ...AfterglowType.caption, color: AfterglowColors.clay },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  headerTitle: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyLG,
    color: Colors.darkWarm,
    textAlign: 'center',
  },
  headerTitleWrap: { flex: 1, alignItems: 'center' },
  headerAudience: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.caption,
    color: Colors.tertiary,
    textAlign: 'center',
  },
  listWrap: { flex: 1 },
  loadErrorWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 12 },
  loadErrorTitle: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.darkWarm, textAlign: 'center' },
  loadErrorBody: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.secondary, textAlign: 'center' },
  loadRetry: { backgroundColor: Colors.terracotta, borderRadius: 24, minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 12, marginTop: 4 },
  loadRetryText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.white },
  loadWarning: { backgroundColor: Colors.inputBg, paddingHorizontal: 16, paddingVertical: 9 },
  loadWarningText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.darkWarm, textAlign: 'center' },
  olderButton: { alignSelf: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  olderButtonText: { fontFamily: Fonts.sansSemibold, fontSize: FontSizes.bodySM, color: Colors.terracotta },
  listContent: { paddingHorizontal: 12, paddingVertical: 10, gap: 8, flexGrow: 1 },
  contextCard: {
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 12,
    gap: 5,
    backgroundColor: Colors.cardBg,
    borderColor: Colors.border,
    borderWidth: 1,
    borderRadius: 6,
  },
  contextEyebrow: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.caption,
    color: Colors.terracotta,
    letterSpacing: 1,
  },
  contextTitle: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyLG,
    color: Colors.darkWarm,
  },
  contextActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, marginTop: 6 },
  contextAction: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 4 },
  contextActionText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodySM, color: Colors.terracotta },
  communityContext: {
    marginHorizontal: 16,
    marginBottom: 8,
    paddingVertical: 8,
    borderBottomColor: Colors.border,
    borderBottomWidth: 1,
  },
  communityContextText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodySM, color: Colors.terracotta },
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
  messageRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  messageRowGrouped: { marginTop: -5 },
  messageRowMine: { justifyContent: 'flex-end' },
  face: { width: 24, height: 24, borderRadius: 12, marginTop: 3 },
  faceSpacer: { width: 24 },
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
  bubbleWrap: { maxWidth: '86%', flexShrink: 1 },
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
  reactionRow: { alignSelf: 'flex-start' },
  reactionRowMine: { alignSelf: 'flex-end', justifyContent: 'flex-end' },
  scrollLatestBtn: {
    position: 'absolute',
    right: 18,
    bottom: 10,
    minWidth: 44,
    height: 44,
    borderRadius: 22,
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
  draftRecoveryAction: { minHeight: 44, justifyContent: 'center' },
  composerContext: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 2,
    borderTopWidth: StyleSheet.hairlineWidth,
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
  locationLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 4 },
  locationLabel: { fontFamily: Fonts.sansSemibold, fontSize: FontSizes.bodySM, color: Colors.terracotta },
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
