import { useChatScrollFollow } from '../../hooks/useChatScrollFollow';
import { beginChatTiming, type ChatTimingOutcome } from '../../lib/chatPerformance';
import { useCommunityLocalDelivery, type CommunityDeliveryRow } from '../../hooks/useCommunityLocalDelivery';
import { CHAT_SEND_ATTEMPT_DEADLINE_MS } from '../../lib/chatSendReceipt';
import { getCommunityMessageAnchorWindow, CommunityMessageUnavailableError } from '../../lib/communityMessageAnchor';
import { useChatMessageAnchor, useChatAnchorScroll } from '../../hooks/useChatMessageAnchor';
import { ChatMessageAnchorNotice } from '../../components/chat/ChatMessageAnchorNotice';
import { useTopicComposerDraft } from '../../hooks/useTopicComposerDraft';
import { subscribeCommunityMain } from '../../lib/communityConversationRealtime';
import { checkTopicComposerAttempt, verifyTopicComposerTarget } from '../../lib/topicComposerDraft';
import { addChatMentionReference, rebaseChatMentions } from '../../lib/chatMentionIdentity';
import { ChatOptionsButton } from '../../components/chat/ChatOptionsButton';
import { useChatMentionFocus } from '../../hooks/useChatMentionFocus';
import { ChatMentionPicker } from '../../components/chat/ChatMentionPicker';
import { findMentionMembers } from '../../lib/chatMentions';
import { ChatBubbleFill } from '../../components/chat/ChatBubbleFill';
import ProfileButton from '../../components/ProfileButton';
import { requestWithDeadline, RequestDeadlineError } from '../../lib/requestWithDeadline';
import { MessageActionsMenu, type MessageMenu } from '../../components/chat/MessageActionsMenu';
import { messageActionAccess, messageActionWeb } from '../../components/chat/messageActionAccess';
import { CreatorActionFill } from '../../components/creator/CreatorActionFill';
import { memberPresentationFonts } from '../../constants/MemberAppearance';
/**
 * Mapped creator pages use independent main-room history/read positions under
 * the existing development flags. Unmapped communities retain the earlier
 * combined conversation below; original message/actions/storage are reused.
 *
 * The legacy community conversation (doc 09 + batch 21): a fully open
 * member chat. Everyone talks freely through the composer; broadcasts and
 * intro cards are special highlighted rows INSIDE the same stream (one
 * table, one ordering, one unread count). Rooms remain the focused side
 * spaces. Mute-not-leave in the header, unreads clear on open, realtime on
 * the whole stream.
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
  useWindowDimensions,
  Platform,
  AppState,
  type ViewToken,
  ScrollView,
} from 'react-native';
import { ChatKeyboardAvoidingView as KeyboardAvoidingView, IOSKeyboardDock, IOSKeyboardViewport } from '../../components/keyboard/ChatKeyboard';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useRouter, useLocalSearchParams, useFocusEffect, Stack } from 'expo-router';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Bell, BellOff, CalendarDays, CircleHelp, Image as ImageIcon, MapPin, X } from 'lucide-react-native';
import Colors, { AfterglowColors } from '../../constants/Colors';
import { Fonts, FontSizes, LineHeights, AfterglowType } from '../../constants/Typography';
import { COMMUNITY_CHAT_GROUPING_ENABLED, CREATOR_PAGES_ENABLED } from '../../constants/FeatureFlags';
import { useAfterglowFonts } from '../../hooks/useAfterglowFonts';
import { ChatContextHeader, chatHeaderActionStyle } from '../../components/chat/ChatContextHeader';
import { CommunityChatComposer } from '../../components/chat/CommunityChatComposer';
import { createChatMessageAppearance } from '../../components/chat/chatMessageAppearance';
import { ChatPhotoAttachment } from '../../components/chat/ChatPhotoAttachment';
import { ChatLocationPreview } from '../../components/chat/ChatLocationPreview';
import { chatLocationLabel } from '../../lib/chatLocation';
import { ChatPhotoViewer, useChatPhotoSelection } from '../../components/chat/ChatPhotoViewer';
import { BrandedAlert, type BrandedAlertButton } from '../../components/BrandedAlert';
import { ReportModal } from '../../components/modals/ReportModal';
import { useBlock } from '../../hooks/useBlock';
import { ReactionDetailsSheet, type ReactionDetailsRequest } from '../../components/chat/ReactionDetailsSheet';
import { BroadcastCard } from '../../components/communities/BroadcastCard';
import { OfflineBanner, PermissionState } from '../../components/state/StateViews';
import LinkifiedText from '../../components/LinkifiedText';
import LinkPreviewCard from '../../components/chat/LinkPreviewCard';
import MiniProfileCard from '../../components/MiniProfileCard';
import ReactionEmojiPicker from '../../components/chat/ReactionEmojiPicker';
import { reactionEmoji, reactionKeyForEmoji } from '../../lib/communityReactionChips';
import PhotoPreviewModal from '../../components/chat/PhotoPreviewModal';
import LocationPickerModal from '../../components/chat/LocationPickerModal';
import { CommunityMessageActions } from '../../components/communities/CommunityMessageActions';
import { friendlyError } from '../../lib/friendlyError';
import { hapticLight } from '../../lib/haptics';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import { useObservedUser } from '../../hooks/useObservedUser';
import { useCommunityCoreReadAcknowledgement } from '../../hooks/useCommunityCoreReadAcknowledgement';
import { getCommunityRoomIdentities, getCommunityRoomHistory, type CommunityRoomCursor } from '../../lib/communityRoomHistory';
import { CommunityChatPreferenceControl } from '../../components/chats/CommunityChatPreferenceControl';
import { useCommunityConversationNotifications } from '../../hooks/useCommunityConversationNotifications';
import { useCommunityBroadcastMute } from '../../hooks/useCommunityBroadcastMute';
import {
  getCommunityBroadcasts,
  getCommunityChatMembers,
  getCommunityChatPayload,
  getPinnedCommunityEvent,
  markBroadcastsRead,
  deleteCommunityMessage,
  editCommunityMessage,
  sendCommunityMessage,
  toggleBroadcastReaction,
  ObsoleteCommunityOperationError,
  isObsoleteCommunityOperation,
  type CommunityBroadcast,
  type CommunityBroadcastPage,
} from '../../lib/communityChat';
import { getJoinGate, getMyMembership } from '../../lib/communityJoin';
import { formatEventDateLA } from '../../lib/laDate';
import { extractFirstUrl, openUrl, soleUrlIn } from '../../lib/url';
import { formatChatTime, formatChatDay, insertMentionAt, isSameChatDay, mentionQueryAt } from '../../lib/communityChatUi';
import { uploadBase64ToStorage } from '../../lib/uploadPhoto';
import { PhotoSendSession } from '../../lib/photoSendSession';
import { TextSendSession } from '../../lib/textSendSession';
import { communityLocationMapUrl, encodeCommunityLocation, parseCommunityLocation } from '../../lib/communityLocationMessage';
import { KEYBOARD_DONE_ACCESSORY_ID } from '../../components/keyboard/KeyboardDoneBar';

export default function CommunityThreadScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // Keep context fixed while history and the composer share native iOS motion.
  // Android/web keep their existing keyboard-avoiding layout and view tree.
  const KeyboardLayout = Platform.OS === 'ios' ? View : KeyboardAvoidingView;
  const MessageViewport = Platform.OS === 'ios' ? IOSKeyboardViewport : React.Fragment;
  const ComposerDock = Platform.OS === 'ios' ? IOSKeyboardDock : React.Fragment;
  const { width: windowWidth } = useWindowDimensions();
  const { fonts: loadedConversationFonts } = useAfterglowFonts(COMMUNITY_CHAT_GROUPING_ENABLED);
  const conversationFonts = memberPresentationFonts(loadedConversationFonts);
  const messageAppearance = useMemo(() => COMMUNITY_CHAT_GROUPING_ENABLED ? createChatMessageAppearance(conversationFonts) : null, [conversationFonts]);
  const queryClient = useQueryClient();
  const { id, reactionMessageId, reactionMessageSource } = useLocalSearchParams<{ id: string; reactionMessageId?: string; reactionMessageSource?: string }>();
  const { anchor, anchorKey, clearAnchor } = useChatMessageAnchor(id, reactionMessageId, reactionMessageSource);
  const listRef = useRef<FlatList<CommunityDeliveryRow>>(null);
  const scrollFollow = useChatScrollFollow(!anchor);
  const { atBottomRef, followingLatest, setFollowingLatest } = scrollFollow;
  const [reactionDetails, setReactionDetails] = useState<ReactionDetailsRequest | null>(null);
  const [messageMenu, setMessageMenu] = useState<MessageMenu | null>(null);
  const [replyRequest, setReplyRequest] = useState<{ messageId: string } | null>(null);
  const [alertInfo, setAlertInfo] = React.useState<{ title: string; message?: string; buttons?: BrandedAlertButton[] } | null>(null);
  const [sending, setSending] = useState(false);
  const viewer = useObservedUser();
  const myId = viewer.viewerId ?? null;
  const [reportTarget, setReportTarget] = useState<{ id: string; name: string } | null>(null);
  const [showReport, setShowReport] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [pendingPhoto, setPendingPhoto] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [photoPreviewOpen, setPhotoPreviewOpen] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [locationPickerOpen, setLocationPickerOpen] = useState(false);
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [reactionPickerMsgId, setReactionPickerMsgId] = useState<string | null>(null);
  const selectionRef = useRef({ start: 0, end: 0 });
  const composerInputRef = useRef<TextInput>(null);
  const [composerFocusRequest, setComposerFocusRequest] = useState(0);
  const draftRef = useRef('');
  const photoSendSessionRef = useRef(new PhotoSendSession(() => Crypto.randomUUID()));
  const locationSendSessionRef = useRef(new TextSendSession(() => Crypto.randomUUID()));
  const { blockUser } = useBlock();
  const entryRevisionRef = useRef(0);
  const sendAttemptRef = useRef<object | null>(null);
  const photoAttemptRef = useRef<object | null>(null);
  const pickerAttemptRef = useRef<object | null>(null);
  const locationAttemptRef = useRef<object | null>(null);
  const reactionAttemptsRef = useRef(new Map<string, object>());
  const mutationAttemptsRef = useRef(new Map<string, object>());
  const entryVisit = useMemo(() => ({}), [id, viewer.viewerId, viewer.epoch]);
  const activeEntryVisit = useRef<object | null>(null);
  const identityReady = !!myId && !viewer.isLoading && !viewer.error;
  const entryIsCurrent = useCallback(() => activeEntryVisit.current === entryVisit && identityReady && viewer.isCurrent(), [entryVisit, identityReady, viewer.isCurrent]);
  const readScope = useMemo(() => ({ userId: myId ?? '', isCurrent: entryIsCurrent }), [myId, entryIsCurrent]);
  const queryKeys = useMemo(() => ({
    layout: ['community-room-identities', id, myId, viewer.epoch],
    membership: ['community-my-membership', id, myId, viewer.epoch],
    cards: ['community-chat-cards', myId, viewer.epoch, id],
    members: ['community-chat-members', id, myId, viewer.epoch],
    messages: ['community-broadcasts', id, myId, viewer.epoch],
    event: ['community-pinned-event', id, myId, viewer.epoch],
    gate: ['community-gate', id, myId, viewer.epoch],
  }), [id, myId, viewer.epoch]);
  useLayoutEffect(() => {
    activeEntryVisit.current = entryVisit;
    setComposerFocusRequest(0);
    draftRef.current = ''; selectionRef.current = { start: 0, end: 0 }; entryRevisionRef.current = 0;
    sendAttemptRef.current = null; photoAttemptRef.current = null; pickerAttemptRef.current = null; locationAttemptRef.current = null;
    reactionAttemptsRef.current = new Map(); mutationAttemptsRef.current = new Map();
    photoSendSessionRef.current = new PhotoSendSession(() => Crypto.randomUUID());
    locationSendSessionRef.current = new TextSendSession(() => Crypto.randomUUID());
    setSending(false); setMentionQuery(null);
    setUploadingPhoto(false); setPendingPhoto(null); setPhotoPreviewOpen(false); setPhotoError(null); setLocationPickerOpen(false);
    setAlertInfo(null); setMessageMenu(null); setReplyRequest(null); setReportTarget(null); setShowReport(false); setProfileUserId(null); setReactionPickerMsgId(null);
    atBottomRef.current = true; setFollowingLatest(true);
    return () => { if (activeEntryVisit.current === entryVisit) activeEntryVisit.current = null; };
  }, [entryVisit]);
  useEffect(() => () => {
    Object.values(queryKeys).forEach(queryKey => { void queryClient.cancelQueries({ queryKey, exact: true }).catch(() => {}); });
  }, [queryClient, queryKeys]);
  const readCurrent = async <T,>(read: () => Promise<T>, signal?: AbortSignal): Promise<T> => {
    if (!entryIsCurrent() || signal?.aborted) throw new ObsoleteCommunityOperationError();
    const result = await requestWithDeadline(read(), 12_000);
    if (!entryIsCurrent() || signal?.aborted) throw new ObsoleteCommunityOperationError();
    return result;
  };

  const needsRoomIdentity = COMMUNITY_CHAT_GROUPING_ENABLED && CREATOR_PAGES_ENABLED;
  const roomIdentity = useQuery({
    queryKey: queryKeys.layout,
    queryFn: ({ signal }) => readCurrent(() => getCommunityRoomIdentities(id!, readScope), signal),
    enabled: !!id && identityReady && needsRoomIdentity,
    retry: false,
  });
  // A failed identity lookup cannot fall back to the combined legacy stream.
  const roomReady = !needsRoomIdentity || roomIdentity.isSuccess;
  const coreLayout = needsRoomIdentity && roomReady ? roomIdentity.data : null;
  const messageQueryKey = useMemo(() => [...(coreLayout ? [...queryKeys.messages, 'core-main'] : queryKeys.messages), ...(anchorKey ? ['reaction', anchorKey] : [])], [queryKeys.messages, !!coreLayout, anchorKey]);
  useEffect(() => () => { void queryClient.cancelQueries({ queryKey: messageQueryKey, exact: true }).catch(() => {}); }, [queryClient, messageQueryKey]);

  // report / block a member from a long-press on their message (mirrors chat).
  // Blocking refetches so their messages drop out via the block filter.
  const openMemberMenu = (userId: string, name: string, messageId: string) => {
    if (!admissionIsCurrent() || !userId || userId === myId) return;
    const message = menuMessages.current.find(row => row.id === messageId);
    if (!message) return;
    hapticLight();
    setMessageMenu({
      preview: message.image_url ? 'Photo' : parseCommunityLocation(message.body) ? 'Shared place' : message.body,
      selectedReaction: reactionEmoji(message.reactions.find(reaction => reaction.mine)?.emoji ?? ''),
      isCurrent: () => selectedMessageCurrent(messageId),
      onReact: emoji => {
        if (!selectedMessageCurrent(messageId)) return;
        const current = menuMessages.current.find(row => row.id === messageId)!;
        void selectReactionRef.current(messageId, reactionKeyForEmoji(emoji, current.reactions));
      },
      title: name,
      buttons: [
        { text: 'react', onPress: currentAction(() => setReactionPickerMsgId(messageId)) },
        { text: 'reply', onPress: () => { if (selectedMessageCurrent(messageId)) setReplyRequest({ messageId }); } },
        { text: 'report', onPress: currentAction(() => { setReportTarget({ id: userId, name }); setShowReport(true); }) },
        { text: 'block', style: 'destructive', onPress: currentAction(() => blockUser(userId, name, currentAction(refreshMessages), operationScope)) },
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
    queryKey: queryKeys.membership,
    queryFn: ({ signal }) => readCurrent(() => getMyMembership(id!), signal),
    enabled: !!id && identityReady,
    staleTime: 60_000,
  });
  const removedFromCommunity = myMembership?.status === 'removed' || myMembership?.status === 'banned';
  const admissionVisit = useMemo(() => ({ allowed: identityReady && roomReady && !removedFromCommunity }), [entryVisit, identityReady, roomReady, removedFromCommunity]);
  const activeAdmissionVisit = useRef<typeof admissionVisit | null>(null);
  useLayoutEffect(() => {
    activeAdmissionVisit.current = admissionVisit;
    if (!admissionVisit.allowed) {
      sendAttemptRef.current = null; photoAttemptRef.current = null; pickerAttemptRef.current = null; locationAttemptRef.current = null;
      reactionAttemptsRef.current = new Map(); mutationAttemptsRef.current = new Map();
      setSending(false); setUploadingPhoto(false); setPendingPhoto(null); setPhotoPreviewOpen(false); setPhotoError(null); setLocationPickerOpen(false);
      setAlertInfo(null); setMessageMenu(null); setReplyRequest(null); setReactionPickerMsgId(null); setProfileUserId(null); setReportTarget(null); setShowReport(false);
    }
    return () => { if (activeAdmissionVisit.current === admissionVisit) activeAdmissionVisit.current = null; };
  }, [admissionVisit]);
  const admissionIsCurrent = useCallback(() => entryIsCurrent() && admissionVisit.allowed && activeAdmissionVisit.current === admissionVisit, [entryIsCurrent, admissionVisit]);
  const operationScope = useMemo(() => ({ userId: myId ?? '', isCurrent: admissionIsCurrent }), [myId, admissionIsCurrent]);
  const readableScope = useMemo(() => myId ? { userId: myId, isCurrent: entryIsCurrent } : null, [myId, entryIsCurrent]);
  const composerRoom = useMemo(() => id ? { kind: 'main' as const, id } : undefined, [id]);
  const composerDraft = useTopicComposerDraft(composerRoom, readableScope);
  const draft = composerDraft.draft.text, editingMessageId = composerDraft.draft.edit?.id ?? null;
  const setDraft = (text: string) => composerDraft.change({ text, mentions: composerDraft.draft.mentions ? rebaseChatMentions(composerDraft.draft.mentions, text) : null });
  useEffect(() => { draftRef.current = draft; }, [draft]);
  const draftBlocked = !composerDraft.ready || composerDraft.error || !!composerDraft.draft.attempt;
  const attachmentVisit = useMemo(() => ({ allowed: admissionVisit.allowed && !editingMessageId && !draftBlocked }), [admissionVisit, !!editingMessageId, draftBlocked]);
  const activeAttachmentVisit = useRef<typeof attachmentVisit | null>(null);
  useLayoutEffect(() => {
    activeAttachmentVisit.current = attachmentVisit;
    if (!attachmentVisit.allowed) {
      photoAttemptRef.current = null; pickerAttemptRef.current = null; locationAttemptRef.current = null;
      setUploadingPhoto(false); setPhotoPreviewOpen(false); setPendingPhoto(null); setPhotoError(null); setLocationPickerOpen(false);
    }
    return () => { if (activeAttachmentVisit.current === attachmentVisit) activeAttachmentVisit.current = null; };
  }, [attachmentVisit]);
  const attachmentIsCurrent = useCallback(() => admissionIsCurrent() && attachmentVisit.allowed && activeAttachmentVisit.current === attachmentVisit, [admissionIsCurrent, attachmentVisit]);
  useEffect(() => {
    if (!composerFocusRequest) return;
    const frame = requestAnimationFrame(() => { if (admissionIsCurrent()) composerInputRef.current?.focus(); });
    return () => cancelAnimationFrame(frame);
  }, [composerFocusRequest, admissionIsCurrent]);
  const currentAction = (action: () => void) => () => { if (admissionIsCurrent()) action(); };
  const refreshMessages = (refreshInbox = false) => {
    if (!admissionIsCurrent()) return;
    void queryClient.invalidateQueries({ queryKey: messageQueryKey, exact: true }).catch(() => {});
    // Start the preview refresh when a message change is confirmed, while the
    // conversation is still open. Waiting for unmount shows the previous text
    // on a quick return to the community hub.
    if (refreshInbox) {
      void queryClient.invalidateQueries({ queryKey: ['community-chat-cards'] }).catch(() => {});
      void queryClient.invalidateQueries({ queryKey: ['community-chat-rows'] }).catch(() => {});
    }
  };
  const clearSubmittedEntry = (revision: number) => {
    if (!admissionIsCurrent() || revision !== entryRevisionRef.current) return;
    composerDraft.change({ text: '', mentions: null, edit: null }); draftRef.current = ''; setMentionQuery(null);
  };
  const { online } = useNetworkStatus();

  const { data: payload } = useQuery({
    queryKey: queryKeys.cards,
    queryFn: ({ signal }) => readCurrent(() => getCommunityChatPayload(readScope), signal),
    enabled: identityReady,
  });
  const card = identityReady ? payload?.cards.find((c) => c.community_id === id) ?? null : null;

  const { data: members = [], isLoading: membersLoading, isError: membersError, refetch: retryMembers } = useQuery({
    queryKey: queryKeys.members,
    queryFn: ({ signal }) => readCurrent(() => getCommunityChatMembers(id!, readScope), signal),
    enabled: !!id && identityReady,
    staleTime: 60_000,
  });
  const mentionNames = useMemo(() => new Set(
    members.flatMap((member) => member.first_name ? [member.first_name.toLowerCase()] : []),
  ), [members]);
  const mentionCandidates = useMemo(() => findMentionMembers(members, mentionQuery, myId), [members, mentionQuery, myId]);

  const historyTiming = useRef<{ key: typeof messageQueryKey; ready: ReturnType<typeof beginChatTiming>; layout: ReturnType<typeof beginChatTiming> } | null>(null);
  useEffect(() => () => { if (historyTiming.current?.key === messageQueryKey) { historyTiming.current.ready('retired'); historyTiming.current.layout('retired'); } }, [messageQueryKey]);
  const [basicHistory, setBasicHistory] = useState<{ key: typeof messageQueryKey; page: CommunityBroadcastPage } | null>(null);
  const activeHistoryKey = useRef(messageQueryKey); activeHistoryKey.current = messageQueryKey;
  const basicPage = basicHistory?.key === messageQueryKey ? basicHistory.page : null;
  const { data: broadcastPages, isLoading: historyLoading, isError: historyError, error: historyFailure, refetch: refetchHistory,
    hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = useInfiniteQuery({
    queryKey: messageQueryKey,
    queryFn: async ({ pageParam, signal }) => {
      let active = true;
      if (!pageParam && historyTiming.current?.key !== messageQueryKey) {
        historyTiming.current = { key: messageQueryKey, ready: beginChatTiming('community-main', 'history-text-ready'), layout: beginChatTiming('community-main', 'history-first-layout') };
      }
      const onBasicPage = (page: CommunityBroadcastPage) => {
        if (active && !signal.aborted && entryIsCurrent() && activeHistoryKey.current === messageQueryKey && !anchor && !pageParam) {
          historyTiming.current?.ready();
          setBasicHistory({ key: messageQueryKey, page });
        }
      };
      try { return await readCurrent(async () => {
      if (anchor && !pageParam) {
        const page = await getCommunityMessageAnchorWindow({ kind: 'main', communityId: id!, mapped: !!coreLayout }, anchor, readScope);
        return { ...page, messages: page.messages.flatMap(item => item.source === 'broadcast' ? [item.message] : []).reverse() };
      }
      if (!coreLayout) return getCommunityBroadcasts(id!, pageParam ?? undefined, readScope, { onBasicPage, strictEnrichment: true });
      const page = await getCommunityRoomHistory(id!, 'main', readScope, pageParam as CommunityRoomCursor | undefined, { onBasicPage: page => onBasicPage({ ...page, messages: page.messages.flatMap(item => item.source === 'broadcast' ? [item.message] : []) }) });
      return { ...page, messages: page.messages.map(item => {
        if (item.source !== 'broadcast') throw Error('This message belongs to another chat.');
        return item.message;
      }) };
      }, signal); } finally { active = false; }
    },
    initialPageParam: undefined as { created_at: string; id: string } | CommunityRoomCursor | undefined,
    getNextPageParam: (lastPage) => lastPage.hasMore ? lastPage.olderCursor ?? undefined : undefined,
    enabled: !!id && identityReady && roomReady,
    // A deadline already consumed the full loading budget. Show recovery now,
    // rather than repeating 12-second attempts behind the initial spinner.
    retry: (failures, error) => !anchor && !(error instanceof RequestDeadlineError) && failures < 2,
  });
  const anchorUnavailable = !!anchor && historyFailure instanceof CommunityMessageUnavailableError;
  const isLoading = (historyLoading && !basicPage) || (needsRoomIdentity && !roomReady && !roomIdentity.isError);
  const broadcastsError = historyError || (needsRoomIdentity && roomIdentity.isError);
  const refetchBroadcasts = () => needsRoomIdentity && !roomReady ? roomIdentity.refetch() : refetchHistory();
  const broadcasts = useMemo(() => identityReady && roomReady && !anchorUnavailable ? broadcastPages?.pages.flatMap((page) => page.messages) ?? basicPage?.messages ?? [] : [], [broadcastPages, basicPage, identityReady, roomReady, anchorUnavailable]);
  const menuMessages = useRef(broadcasts); menuMessages.current = broadcasts;
  const selectedMessageCurrent = (messageId: string) => admissionIsCurrent() && menuMessages.current.some(message => message.id === messageId && !message.metadata_pending);
  const openReactionDetails = (messageId: string) => {
    const isCurrent = () => selectedMessageCurrent(messageId);
    if (!isCurrent() || !myId) return;
    setReactionDetails({ source: 'broadcast', messageId, scope: { userId: myId, isCurrent }, canRemove: admissionIsCurrent, onChanged: refreshMessages });
  };
  useEffect(() => { if (reactionDetails && !reactionDetails.scope.isCurrent()) setReactionDetails(null); }, [reactionDetails, broadcasts, admissionVisit]);

  useEffect(() => { if (messageMenu && !messageMenu.isCurrent()) setMessageMenu(null); }, [messageMenu, broadcasts, admissionVisit]);
  // Start at the live edge without estimating every older variable-height row.
  // Inverted rendering keeps the visible chronology oldest above newest.
  const delivery = useCommunityLocalDelivery(operationScope, broadcasts, composerDraft.draft.attempt, sending);
  const thread: CommunityDeliveryRow[] = admissionVisit.allowed && !anchor ? delivery.messages : broadcasts;
  const anchorScroll = useChatAnchorScroll(listRef, anchorKey, anchor ? thread.findIndex(message => message.id === anchor.id) : -1);
  const photos = useMemo(() => broadcasts.slice().reverse().flatMap(message =>
    message.kind === 'message' && message.image_url
      ? [{ id: message.id, uri: message.image_url, senderName: message.sender_name, caption: message.body }] : []), [broadcasts]);
  const photoSelection = useChatPhotoSelection(`community:${id}:${myId}:${viewer.epoch}`, removedFromCommunity ? [] : photos);
  const coreFocused = useRef(false);
  useFocusEffect(useCallback(() => {
    coreFocused.current = true;
    // Both legacy and mapped main rooms need to recover missed live updates.
    // Reuse an in-flight read instead of cancelling it on overlapping returns.
    if (admissionIsCurrent()) void refetchHistory({ cancelRefetch: false });
    return () => { coreFocused.current = false; };
  }, [admissionIsCurrent, refetchHistory]));
  useEffect(() => {
    let previousState = AppState.currentState;
    const subscription = AppState.addEventListener('change', state => {
      const returning = state === 'active' && previousState !== 'active';
      previousState = state;
      if (returning && coreFocused.current && admissionIsCurrent()) void refetchHistory({ cancelRefetch: false });
    });
    return () => subscription.remove();
  }, [admissionIsCurrent, refetchHistory]);
  const previousOnline = useRef(online);
  useEffect(() => {
    const reconnected = online && !previousOnline.current;
    previousOnline.current = online;
    if (reconnected && coreFocused.current && AppState.currentState === 'active' && admissionIsCurrent()) {
      void refetchHistory({ cancelRefetch: false });
    }
  }, [online, admissionIsCurrent, refetchHistory]);
  const readAcknowledgementScope = useMemo(() => ({ userId: operationScope.userId,
    isCurrent: () => coreFocused.current && AppState.currentState === 'active' && operationScope.isCurrent(),
  }), [operationScope]);
  const readAcknowledgement = useCommunityCoreReadAcknowledgement(id, 'main', readAcknowledgementScope, !!coreLayout);
  const visibleRead = useRef<(items: ViewToken<CommunityBroadcast>[]) => void>(() => {});
  visibleRead.current = items => {
    if (!coreLayout || !admissionIsCurrent()) return;
    const visible = new Set(items.filter(item => item.isViewable).map(item => item.item.id));
    // Reader order preserves microseconds and the server's exact tie ordering.
    const newestVisible = broadcasts.find(message => visible.has(message.id));
    if (newestVisible) readAcknowledgement.acknowledge({ broadcast: newestVisible });
  };
  const onViewableItemsChanged = useCallback(({ viewableItems }: { viewableItems: ViewToken<CommunityBroadcast>[] }) => { if (entryIsCurrent()) visibleRead.current(viewableItems); }, [entryIsCurrent]);
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 50, minimumViewTime: 300 }).current;
  const newestMessageId = broadcasts[0]?.id;
  useEffect(() => {
    if (!anchor && newestMessageId && atBottomRef.current) {
      const frame = requestAnimationFrame(() => { if (entryIsCurrent() && atBottomRef.current) listRef.current?.scrollToOffset({ offset: 0, animated: false }); });
      return () => cancelAnimationFrame(frame);
    }
  }, [newestMessageId, entryIsCurrent, anchorKey]);

  const individualNotifications = useCommunityBroadcastMute(id, viewer);
  const notifications = useCommunityConversationNotifications(CREATOR_PAGES_ENABLED && COMMUNITY_CHAT_GROUPING_ENABLED && id ? { kind: 'persistent', communityId: id } : { kind: 'legacy' }, viewer, individualNotifications);
  const { muted, ready: muteReady, isChecking: muteChecking, toggle: toggleMute } = notifications;

  // chat model 7-07: the soonest upcoming Live event sits pinned at the top
  const { data: pinnedEvent = null } = useQuery({
    queryKey: queryKeys.event,
    queryFn: ({ signal }) => readCurrent(() => getPinnedCommunityEvent(id!, readScope), signal),
    enabled: !!id && identityReady,
  });

  // a joined thread never looks dead (correction 4): since migration 19 the
  // system-composed intro card IS in the thread, so a new member's room is
  // never truly empty; the welcome note covers the remaining edge
  const emptyThread = !isLoading && !broadcastsError && !hasNextPage && thread.length === 0;
  const { data: gate } = useQuery({
    queryKey: queryKeys.gate,
    queryFn: ({ signal }) => readCurrent(() => getJoinGate(id!), signal),
    enabled: !!id && identityReady && emptyThread,
  });

  useEffect(() => {
    if (!id || !operationScope.isCurrent()) return;
    let active = true;
    const scope = { userId: operationScope.userId, isCurrent: () => active && operationScope.isCurrent() };
    if (!coreLayout && !anchor) markBroadcastsRead(id, scope)
      .then(() => {
        if (!scope.isCurrent()) return;
        queryClient.invalidateQueries({ queryKey: ['community-chat-cards'] });
        queryClient.invalidateQueries({ queryKey: ['community-chat-rows'] });
      })
      .catch(() => {});
    const stop = subscribeCommunityMain({
      channelName: `community-thread-${id}-${myId}-${viewer.epoch}`,
      communityId: id, isCurrent: scope.isCurrent,
      hasMessage: messageId => menuMessages.current.some(message => message.id === messageId),
      hasMessages: () => menuMessages.current.length > 0,
      refresh: () => queryClient.invalidateQueries({ queryKey: messageQueryKey, exact: true }),
      onMessage: () => { if (!coreLayout && !anchor) void markBroadcastsRead(id, scope).catch(() => {}); },
    });
    return () => {
      active = false;
      stop();
      queryClient.invalidateQueries({ queryKey: ['community-chat-cards'] });
      queryClient.invalidateQueries({ queryKey: ['community-chat-rows'] });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, myId, viewer.epoch, operationScope, queryClient, messageQueryKey, !!coreLayout]);

  const showError = (title: string, message: string) => { if (admissionIsCurrent()) setAlertInfo({ title, message }); };

  const checkPendingDraft = async () => {
    const pending = composerDraft.draft.attempt;
    if (!pending || !composerRoom || !readableScope || !admissionIsCurrent() || sendAttemptRef.current) return;
    const token = {}; sendAttemptRef.current = token; setSending(true);
    try {
      if (await checkTopicComposerAttempt(composerRoom, pending, readableScope)) {
        if (!admissionIsCurrent()) return;
        delivery.confirm(pending); await composerDraft.finish(pending); refreshMessages(true);
      } else if (admissionIsCurrent()) showError('Not confirmed yet', 'Your original message is kept. Check again or retry the original when you’re ready.');
    } catch (error) { if (admissionIsCurrent()) showError('Could not check your message', friendlyError(error, 'Your original message is kept.')); }
    finally { if (admissionIsCurrent() && sendAttemptRef.current === token) { sendAttemptRef.current = null; setSending(false); } }
  };
  const handleSend = async () => {
    if (!admissionIsCurrent() || !id || !composerRoom || !readableScope || (!draft.trim() && !composerDraft.draft.attempt) || sendAttemptRef.current) return;
    const finishTiming = beginChatTiming('community-main', 'send-to-confirmation');
    let timingOutcome: ChatTimingOutcome = 'retired';
    const token = {}; sendAttemptRef.current = token; setSending(true);
    const resumingOriginal = !!composerDraft.draft.attempt;
    let prepared = false;
    const sendScope = { userId: operationScope.userId, isCurrent: () => operationScope.isCurrent() && sendAttemptRef.current === token };
    let original: Awaited<ReturnType<typeof composerDraft.prepare>> | null = null;
    try {
      original = await composerDraft.prepare({ detachText: true, onDetach: () => { composerInputRef.current?.clear(); draftRef.current = ''; setMentionQuery(null); } }); prepared = true;
      if (!sendScope.isCurrent()) return;
      const confirmed = resumingOriginal && await checkTopicComposerAttempt(composerRoom, original, sendScope);
      if (!sendScope.isCurrent()) return;
      if (!confirmed) {
        if (resumingOriginal) await verifyTopicComposerTarget(composerRoom, original, sendScope);
        if (!sendScope.isCurrent()) return;
        if (original.kind === 'edit' && original.edit) {
          await requestWithDeadline(editCommunityMessage(original.id, original.text, sendScope, { communityId: id, original: original.edit, mentions: original.mentions ?? null }), 12_000);
        } else {
          await requestWithDeadline(sendCommunityMessage(id, original.text, undefined, original.id, sendScope, original.mentions ?? null), CHAT_SEND_ATTEMPT_DEADLINE_MS);
        }
      }
      if (!sendScope.isCurrent()) return;
      delivery.confirm(original);
      timingOutcome = 'ok'; finishTiming();
      await composerDraft.finish(original);
      if (!sendScope.isCurrent()) return;
      refreshMessages(true);
      if (anchor && original.kind === 'send') { atBottomRef.current = true; setFollowingLatest(true); clearAnchor(); }
      else if (!anchor) { atBottomRef.current = true; setFollowingLatest(true); listRef.current?.scrollToOffset({ offset: 0, animated: false }); }
    } catch (error) {
      timingOutcome = 'error';
      if (original) composerDraft.restoreFailedText(original);
      if (admissionIsCurrent() && !isObsoleteCommunityOperation(error)) showError(prepared || resumingOriginal ? 'Message not confirmed' : 'Message not sent', friendlyError(error, 'Your original message is kept. Check it before trying again.'));
    } finally { finishTiming(admissionIsCurrent() ? timingOutcome : 'retired');
      if (admissionIsCurrent() && sendAttemptRef.current === token) { sendAttemptRef.current = null; setSending(false); }
    }
  };

  const handleMute = async () => {
    const result = await toggleMute();
    if (!result || !entryIsCurrent()) return;
    if (result.matched) hapticLight();
    else setAlertInfo({ title: 'Check notification setting', message: result.value === null
      ? 'We couldn’t confirm this change. Open chat options to check before trying again.'
      : 'The requested change wasn’t confirmed. Chat options shows the current saved setting.' });
  };

  const handleDeleteMessage = async (messageId: string) => {
    if (!admissionIsCurrent() || mutationAttemptsRef.current.has(messageId)) return;
    const attempt = {}, attempts = mutationAttemptsRef.current; attempts.set(messageId, attempt);
    try {
      await deleteCommunityMessage(messageId, operationScope);
      if (!admissionIsCurrent()) return;
      hapticLight();
      refreshMessages(true);
    } catch (e) {
      if (!admissionIsCurrent() || isObsoleteCommunityOperation(e)) return;
      showError('That did not remove', friendlyError(e, 'Try again in a moment.'));
    } finally {
      if (admissionIsCurrent() && attempts.get(messageId) === attempt) attempts.delete(messageId);
    }
  };

  const openOwnMessageMenu = (message: CommunityBroadcast) => {
    if (!admissionIsCurrent()) return;
    hapticLight();
    setMessageMenu({
      preview: message.image_url ? 'Photo' : parseCommunityLocation(message.body) ? 'Shared place' : message.body,
      own: true,
      selectedReaction: reactionEmoji(message.reactions.find(reaction => reaction.mine)?.emoji ?? ''),
      isCurrent: () => selectedMessageCurrent(message.id),
      onReact: emoji => {
        if (!selectedMessageCurrent(message.id)) return;
        const current = menuMessages.current.find(row => row.id === message.id)!;
        void selectReactionRef.current(message.id, reactionKeyForEmoji(emoji, current.reactions));
      },
      title: 'Your message',
      buttons: [
        { text: 'react', onPress: currentAction(() => setReactionPickerMsgId(message.id)) },
        { text: 'reply', onPress: () => { if (selectedMessageCurrent(message.id)) setReplyRequest({ messageId: message.id }); } },
        ...(message.body && !parseCommunityLocation(message.body) ? [{ text: 'edit', onPress: currentAction(() => { if (draftBlocked || sending) return; entryRevisionRef.current++; composerDraft.change({ text: message.body, mentions: message.mention_data ?? null, reply: null, edit: { id: message.id, body: message.body, edited_at: message.edited_at ?? null, mentions: message.mention_data ?? null } }); draftRef.current = message.body; setComposerFocusRequest(request => request + 1); }) }] : []),
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
  // it off. New emoji use raw characters, as in BroadcastCard. Presentation
  // resolves an existing legacy alias back to its stored key when toggling.
  const handleSelectReaction = async (messageId: string, emoji: string) => {
    if (!admissionIsCurrent() || reactionAttemptsRef.current.has(messageId)) return;
    const attempt = {}, attempts = reactionAttemptsRef.current; attempts.set(messageId, attempt);
    const message = broadcasts.find((b) => b.id === messageId);
    const mineReaction = message?.reactions.find((r) => r.mine);
    try {
      hapticLight();
      if (mineReaction?.emoji === emoji) {
        await toggleBroadcastReaction(messageId, emoji, false, operationScope);
      } else {
        if (mineReaction) await toggleBroadcastReaction(messageId, mineReaction.emoji, false, operationScope);
        if (!admissionIsCurrent()) return;
        await toggleBroadcastReaction(messageId, emoji, true, operationScope);
      }
      if (admissionIsCurrent()) refreshMessages();
    } catch (e) {
      if (!admissionIsCurrent() || isObsoleteCommunityOperation(e)) return;
      showError('That did not land', friendlyError(e, 'Try again in a moment.'));
    } finally {
      if (admissionIsCurrent() && attempts.get(messageId) === attempt) attempts.delete(messageId);
    }
  };

  const selectReactionRef = useRef(handleSelectReaction); selectReactionRef.current = handleSelectReaction;

  const handlePickPhoto = async (source: 'library' | 'camera' = 'library') => {
    if (!attachmentIsCurrent() || photoAttemptRef.current || pickerAttemptRef.current) return;
    const attempt = {}; pickerAttemptRef.current = attempt;
    try {
      if (source === 'camera') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!attachmentIsCurrent()) return;
        if (permission.status !== 'granted') throw new Error('Camera access is needed to take a picture.');
      }
      // The images-only system picker grants access to the selected photo.
      const result = source === 'camera' ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 }) : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
      if (!attachmentIsCurrent() || result.canceled || !result.assets[0]) return;
      photoSendSessionRef.current.clear();
      setPendingPhoto(result.assets[0]);
      setPhotoError(null);
      setPhotoPreviewOpen(true);
    } catch (e) {
      if (!attachmentIsCurrent()) return;
      showError(source === 'camera' ? 'Could not open camera' : 'Could not open photos', friendlyError(e, 'Try again in a moment.'));
    } finally {
      if (admissionIsCurrent() && pickerAttemptRef.current === attempt) pickerAttemptRef.current = null;
    }
  };

  const handleSendPhoto = async (caption: string) => {
    const asset = pendingPhoto;
    if (!attachmentIsCurrent() || !myId || !id || !asset || photoAttemptRef.current) return;
    const attempt = {}; photoAttemptRef.current = attempt;
    const revision = entryRevisionRef.current;
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
      await requestWithDeadline(sendCommunityMessage(id, session.captionFor(asset.uri, caption), imageUrl, session.idFor(asset.uri), sendScope), 35_000);
      if (!isCurrent()) return;
      clearSubmittedEntry(revision);
      setPhotoPreviewOpen(false);
      setPendingPhoto(null);
      session.clear();
      refreshMessages(true);
      if (anchor) { atBottomRef.current = true; setFollowingLatest(true); clearAnchor(); }
      else { atBottomRef.current = true; setFollowingLatest(true); listRef.current?.scrollToOffset({ offset: 0, animated: false }); }
    } catch (e) {
      if (!isCurrent() || isObsoleteCommunityOperation(e)) return;
      setPhotoError(session.hasCaption(asset.uri) ? 'Couldn’t confirm delivery. Retry keeps the same photo and caption.' : friendlyError(e, 'Your photo is kept. Try again.'));
    } finally {
      if (admissionIsCurrent() && photoAttemptRef.current === attempt) { photoAttemptRef.current = null; setUploadingPhoto(false); }
    }
  };

  const handleShareLocation = async (latitude: number, longitude: number, address: string): Promise<boolean> => {
    if (!attachmentIsCurrent() || !myId || !id || locationAttemptRef.current) return false;
    const attempt = {}; locationAttemptRef.current = attempt;
    const session = locationSendSessionRef.current;
    const isCurrent = () => attachmentIsCurrent() && locationAttemptRef.current === attempt;
    try {
      const body = encodeCommunityLocation({ latitude, longitude, address });
      await requestWithDeadline(sendCommunityMessage(id, body, undefined, session.idFor(body, null), { userId: myId, isCurrent }), 35_000);
      if (!isCurrent()) return false;
      session.clear();
      setLocationPickerOpen(false);
      refreshMessages(true);
      if (anchor) { atBottomRef.current = true; setFollowingLatest(true); clearAnchor(); }
      else { atBottomRef.current = true; setFollowingLatest(true); listRef.current?.scrollToOffset({ offset: 0, animated: false }); }
      return true;
    } catch {
      return false;
    } finally {
      if (admissionIsCurrent() && locationAttemptRef.current === attempt) locationAttemptRef.current = null;
    }
  };

  const focusMention = useChatMentionFocus(composerInputRef, admissionIsCurrent);
  const insertMention = (member: { id: string; first_name: string | null }) => {
    if (!admissionIsCurrent() || !composerDraft.ready || composerDraft.error || !member.first_name || !members.some(row => row.id === member.id && row.first_name === member.first_name)) return;
    const text = draftRef.current, caret = selectionRef.current.start;
    const query = mentionQueryAt(text, caret);
    if (query === null) return;
    const start = caret - query.length - 1;
    const inserted = insertMentionAt(text, caret, member.first_name);
    const mentions = addChatMentionReference(inserted.text, composerDraft.draft.mentions ?? null, member.id, member.first_name, start);
    entryRevisionRef.current++;
    composerDraft.change({ text: inserted.text, mentions });
    draftRef.current = inserted.text;
    selectionRef.current = { start: inserted.caret, end: inserted.caret };
    setMentionQuery(null); focusMention(inserted.caret);
  };

  const composerInputProps: React.ComponentProps<typeof TextInput> = {
    value: draft,
    editable: identityReady && composerDraft.ready && !composerDraft.error,
    onChangeText: (text) => {
      if (!admissionIsCurrent()) return;
      entryRevisionRef.current++;
      const previousLength = draftRef.current.length;
      const caret = selectionRef.current.start >= previousLength ? text.length : selectionRef.current.start;
      selectionRef.current = { start: caret, end: caret };
      draftRef.current = text;
      setDraft(text);
      setMentionQuery(mentionQueryAt(text, caret));
    },
    onSelectionChange: (event) => {
      if (!admissionIsCurrent()) return;
      selectionRef.current = event.nativeEvent.selection;
      setMentionQuery(mentionQueryAt(draftRef.current, event.nativeEvent.selection.start));
    },
    placeholder: 'say something',
    placeholderTextColor: Colors.inkSoft, multiline: true, maxLength: 4000,
    inputAccessoryViewID: KEYBOARD_DONE_ACCESSORY_ID,
  };

  return (
    <SafeAreaView style={[styles.container, COMMUNITY_CHAT_GROUPING_ENABLED && { backgroundColor: AfterglowColors.paper }]} edges={Platform.OS === 'ios' ? ['top'] : ['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardLayout style={styles.flex} {...(Platform.OS === 'ios' ? {} : { behavior: 'height' as const })}>
      {COMMUNITY_CHAT_GROUPING_ENABLED ? <ChatContextHeader
        title={coreLayout?.rooms[1].name ?? card?.main_chat_name ?? 'Community chat'}
        subtitle={coreLayout?.name ?? card?.name ?? 'Everyone in this community'}
        contextLabel="View community"
        fonts={conversationFonts}
        onBack={() => router.back()}
        backLabel="Back"
        onViewContext={id ? currentAction(() => router.push(`/community/${id}` as never)) : undefined}
        actions={<ChatOptionsButton key={`${id}:${myId}:${viewer.epoch}`} fonts={conversationFonts} isCurrent={entryIsCurrent}
          contextLabel="View community" onViewContext={id ? currentAction(() => router.push(`/community/${id}` as never)) : undefined}
          notificationLabel={notifications.label ?? (muteChecking ? 'Checking notifications…' : !muteReady ? 'Check notification setting' : muted ? 'Unmute chat' : 'Mute chat')}
          notificationBusy={!!muteChecking} onNotifications={handleMute}>
          {notifications.parent && <CommunityChatPreferenceControl control={notifications.parent} fonts={conversationFonts} compact/>}
        </ChatOptionsButton>}

      /> : <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
          <ArrowLeft size={22} color={Colors.asphalt} strokeWidth={2.5} />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.headerTitleTap}
          onPress={() => router.push(`/community/${id}` as never)}
          hitSlop={6}
        >
          {/* Screen 37: the main chat's own display name (communities.main_chat_name),
              not the community's name -- the two are deliberately decoupled so a
              leader can eventually rename just the chat. Falls back to the same
              "community chat" default the column itself carries, for a card that
              predates migration 20260906200000. */}
          <Text style={styles.headerTitle} numberOfLines={1}>{card?.main_chat_name ?? 'community chat'}</Text>
          <Text style={styles.headerAudience} numberOfLines={1}>
            {card?.name ? `everyone in ${card.name}` : 'everyone in this community'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={handleMute} style={styles.muteButton} disabled={!!muteChecking}
          accessibilityRole="button"
          accessibilityLabel={notifications.label ?? (muteChecking ? 'Checking chat notifications' : !muteReady ? 'Check chat notification setting' : muted ? 'Unmute chat' : 'Mute chat')}
          accessibilityState={{ disabled: !!muteChecking, busy: !!muteChecking }}>
          {muteChecking ? <ActivityIndicator size="small" color={Colors.tertiary} /> : muted === true ? (
            <BellOff size={20} color={Colors.tertiary} strokeWidth={2.5} />
          ) : (
            <Bell size={20} color={muteReady ? Colors.terracotta : Colors.tertiary} strokeWidth={2.5} />
          )}
        </TouchableOpacity>
        <ProfileButton compact/>
      </View>}
      {!COMMUNITY_CHAT_GROUPING_ENABLED && notifications.parent && <View style={{ paddingHorizontal: 16, paddingVertical: 4 }}><CommunityChatPreferenceControl control={notifications.parent} fonts={conversationFonts} compact /></View>}
      {!muteChecking && !muteReady
        ? <Text style={[styles.mutedLine, COMMUNITY_CHAT_GROUPING_ENABLED && { ...AfterglowType.caption, fontFamily: conversationFonts.regular, color: AfterglowColors.muted, paddingHorizontal: 16, paddingVertical: 4 }]} accessibilityLiveRegion="polite">{COMMUNITY_CHAT_GROUPING_ENABLED ? 'Couldn’t check notifications. Retry in chat options.' : 'Couldn’t check notifications. Tap the bell to retry.'}</Text>
        : muted === true && <Text style={[styles.mutedLine, COMMUNITY_CHAT_GROUPING_ENABLED && { ...AfterglowType.caption, fontFamily: conversationFonts.regular, color: AfterglowColors.muted, paddingHorizontal: 16, paddingVertical: 4 }]}>Chat muted. Unread messages stay here.</Text>}
      {!!coreLayout && readAcknowledgement.uncertain && <TouchableOpacity
        style={[styles.loadWarning, { backgroundColor: AfterglowColors.white }]} accessibilityRole="button"
        accessibilityLabel={readAcknowledgement.retryReady ? 'Retry syncing read messages' : 'Check read message status'}
        disabled={!!readAcknowledgement.checking}
        onPress={readAcknowledgement.retryReady ? readAcknowledgement.retryAcknowledgement : () => { void readAcknowledgement.checkReadPosition(); }}>
        <Text style={[styles.loadWarningText, { ...AfterglowType.caption, fontFamily: conversationFonts.medium, color: AfterglowColors.ink }]}>{readAcknowledgement.checking ? 'Checking read status…' : readAcknowledgement.retryReady ? 'Read status not saved · Tap to retry' : 'Read status uncertain · Tap to check'}</Text>
      </TouchableOpacity>}
      {!!pinnedEvent && (
        <TouchableOpacity
          style={[styles.pinnedCard, COMMUNITY_CHAT_GROUPING_ENABLED && styles.compactPinnedEvent]}
          onPress={() => router.push(`/event/${pinnedEvent.id}` as never)}
          accessibilityRole="button"
          accessibilityLabel={`View upcoming event: ${pinnedEvent.title}`}
          accessibilityHint={[pinnedEvent.event_date ? formatEventDateLA(pinnedEvent.event_date) : null, pinnedEvent.venue].filter(Boolean).join('. ')}
          activeOpacity={0.85}
        >
          <CalendarDays size={18} color={COMMUNITY_CHAT_GROUPING_ENABLED ? AfterglowColors.clay : Colors.terracotta} strokeWidth={2.5} />
          <View style={styles.pinnedBody}>
            {/* LIZ COPY */}
            {!COMMUNITY_CHAT_GROUPING_ENABLED && <Text style={styles.pinnedLabel}>up next</Text>}
            <Text style={[styles.pinnedTitle, COMMUNITY_CHAT_GROUPING_ENABLED && { ...AfterglowType.body, fontFamily: conversationFonts.medium, color: AfterglowColors.ink }]} numberOfLines={1}>{pinnedEvent.title}</Text>
            <Text style={[styles.pinnedMeta, COMMUNITY_CHAT_GROUPING_ENABLED && { ...AfterglowType.caption, fontFamily: conversationFonts.regular, color: AfterglowColors.muted }]} numberOfLines={1}>
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

      {!!anchor && <ChatMessageAnchorNotice fonts={conversationFonts} loading={isLoading} unavailable={anchorUnavailable} failed={broadcastsError} onLatest={() => { atBottomRef.current = true; setFollowingLatest(true); clearAnchor(); }} />}
      <MessageViewport {...(Platform.OS === 'ios' ? { style: styles.flex, inset: insets.bottom } : {})}>
      {anchorUnavailable ? <View style={styles.flex} /> : isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.terracotta} />
        </View>
      ) : broadcastsError && thread.length === 0 ? (
        <View style={styles.loadErrorWrap}>
          <Text style={styles.loadErrorTitle}>Messages couldn't load</Text>
          <Text style={styles.loadErrorBody}>Your community chat is still here. Check your connection and try again.</Text>
          <TouchableOpacity style={styles.loadRetry} onPress={() => { void refetchBroadcasts(); }} accessibilityRole="button" accessibilityLabel="Retry loading community chat">
            <CreatorActionFill /><Text style={styles.loadRetryText}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          key={JSON.stringify(messageQueryKey)}
          ref={listRef}
          data={thread}
          inverted
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
          maintainVisibleContentPosition={followingLatest && !anchor ? undefined : { minIndexForVisible: 0 }}
          keyExtractor={(b) => b.id}
          onLayout={() => {
            if (!entryIsCurrent()) return;
            historyTiming.current?.ready(); historyTiming.current?.layout();
            if (anchor) anchorScroll.schedule();
            else if (atBottomRef.current) listRef.current?.scrollToOffset({ offset: 0, animated: false });
          }}
          onContentSizeChange={() => {
            if (!entryIsCurrent()) return;
            if (anchor) anchorScroll.schedule();
            else if (atBottomRef.current) listRef.current?.scrollToOffset({ offset: 0, animated: false });
          }}
          onScrollToIndexFailed={anchorScroll.onScrollToIndexFailed}
              onScrollBeginDrag={() => {
                if (!entryIsCurrent()) return;
                scrollFollow.onScrollBeginDrag(); anchorScroll.cancel();
              }}
              onScrollEndDrag={event => { if (entryIsCurrent()) scrollFollow.onScrollEndDrag(event); }}
              onMomentumScrollBegin={() => { if (entryIsCurrent()) scrollFollow.onMomentumScrollBegin(); }}
              onMomentumScrollEnd={event => { if (entryIsCurrent()) scrollFollow.onMomentumScrollEnd(event); }}
          onScroll={(event) => {
            if (!entryIsCurrent()) return;
            scrollFollow.onScroll(event);
          }}
          scrollEventThrottle={16}
          ListFooterComponent={broadcastsError || hasNextPage || isFetchingNextPage || isFetchNextPageError ? (
            <View>
              {broadcastsError && (
                <TouchableOpacity style={styles.loadWarning} onPress={() => { void refetchBroadcasts(); }} accessibilityRole="button" accessibilityLabel="Community messages may be out of date. Retry loading">
                  <Text style={styles.loadWarningText}>Messages may be out of date · Tap to retry</Text>
                </TouchableOpacity>
              )}
              {(hasNextPage || isFetchingNextPage || isFetchNextPageError) && (
                <TouchableOpacity style={styles.olderButton} onPress={() => { void fetchNextPage(); }} disabled={isFetchingNextPage} accessibilityRole="button" accessibilityLabel={isFetchNextPageError ? 'Retry loading earlier community messages' : 'Load earlier community messages'}>
                  {isFetchingNextPage ? <ActivityIndicator size="small" color={Colors.terracotta} /> : (
                    <Text style={styles.olderButtonText}>{isFetchNextPageError ? 'Could not load earlier messages · Try again' : 'Earlier messages'}</Text>
                  )}
                </TouchableOpacity>
              )}
            </View>
          ) : null}
          renderItem={({ item, index }) => {
            const previous = thread[index + 1] ?? null;
            const showDay = !previous || !isSameChatDay(previous.created_at, item.created_at);
            const grouped = item.kind === 'message'
              && previous?.kind === 'message'
              && previous.sender_id === item.sender_id
              && isSameChatDay(previous.created_at, item.created_at) &&
              Math.abs(new Date(previous.created_at).getTime() - new Date(item.created_at).getTime()) <= 5 * 60 * 1000;
            const mine = item.sender_id === myId;
            const localDelivery = item.localDelivery;
            const detailsReady = !localDelivery && !item.metadata_pending;
            const firstUrl = extractFirstUrl(item.body);
            const sharedLocation = item.kind === 'message' ? parseCommunityLocation(item.body) : null;
            // A message carrying exactly one link makes the whole bubble a second
            // way into that link (mirrors ChatThread's bubbleUrl fix, 8-02): the
            // bubble TouchableOpacity claims the touch responder for onLongPress,
            // which can swallow the nested LinkifiedText <Text onPress> before it
            // ever fires (reported live 2026-08-27, links posted in Community
            // chat not opening). The inline link Text stays the primary target;
            // this is the path no ancestor can intercept.
            const bubbleUrl = item.kind === 'message' && !sharedLocation ? soleUrlIn(item.body) : null;
            return (
              <View onLayout={anchor?.id === item.id ? anchorScroll.onTargetLayout : undefined} style={anchor?.id === item.id ? { backgroundColor: Colors.goldBadgeSoft, borderRadius: 12 } : undefined}>
                {showDay && <Text style={[styles.daySeparator, messageAppearance?.day]}>{formatChatDay(item.created_at)}</Text>}
                {item.kind === 'message' ? (
                  <View style={[styles.messageRow, grouped && styles.messageRowGrouped, mine && styles.messageRowMine]}>
                    {!mine && (!grouped ? (
                      <TouchableOpacity onPress={currentAction(() => setProfileUserId(item.sender_id))} accessibilityLabel={`View ${item.sender_name ?? 'member'} profile`}>
                        {item.sender_photo ? (
                          <Image source={{ uri: item.sender_photo }} style={styles.face} contentFit="cover" />
                        ) : (
                          <View style={[styles.face, styles.facePlaceholder, messageAppearance?.avatar]}>
                            <Text style={[styles.faceInitial, messageAppearance?.avatarInitial]}>{(item.sender_name ?? '?').slice(0, 1).toLowerCase()}</Text>
                          </View>
                        )}
                      </TouchableOpacity>
                    ) : <View style={styles.faceSpacer} />)}
                    <View style={[styles.messageColumn, mine && styles.messageColumnMine]} {...(detailsReady ? messageActionWeb(() => { if (mine) openOwnMessageMenu(item); else if (item.sender_id) openMemberMenu(item.sender_id, item.sender_name ?? 'someone', item.id); }) : {})}>
                      <TouchableOpacity
                        activeOpacity={0.9}
                        onPress={COMMUNITY_CHAT_GROUPING_ENABLED && item.image_url ? () => photoSelection.onSelect(item.id) : sharedLocation ? () => openUrl(communityLocationMapUrl(sharedLocation)) : bubbleUrl ? () => openUrl(bubbleUrl) : undefined}
                        onLongPress={!detailsReady ? undefined : () => {
                          if (mine) openOwnMessageMenu(item);
                          else if (item.sender_id) openMemberMenu(item.sender_id, item.sender_name ?? 'someone', item.id);
                        }}
                        style={[styles.bubble, mine && styles.bubbleMine, messageAppearance?.bubble, mine && messageAppearance?.bubbleOwn, COMMUNITY_CHAT_GROUPING_ENABLED && { maxWidth: '100%' }]}
                        {...(detailsReady ? messageActionAccess(() => { if (mine) openOwnMessageMenu(item); else if (item.sender_id) openMemberMenu(item.sender_id, item.sender_name ?? 'someone', item.id); }) : {})}
                        accessibilityHint={detailsReady ? "hold for message actions" : undefined}
                        accessibilityRole={sharedLocation ? 'button' : undefined}
                        accessibilityLabel={sharedLocation ? `Open map for ${chatLocationLabel(sharedLocation)}` : undefined}
                      >
                        {mine && COMMUNITY_CHAT_GROUPING_ENABLED && <ChatBubbleFill/>}
              {!mine && !grouped && <Text style={[styles.senderName, messageAppearance?.sender]}>{item.sender_name ?? 'someone'}</Text>}
                        {sharedLocation && (COMMUNITY_CHAT_GROUPING_ENABLED ? <ChatLocationPreview location={sharedLocation} fonts={conversationFonts} isOwn={mine} /> : (
                          <View style={styles.locationCard}>
                            <View style={styles.locationHeading}><MapPin size={16} color={mine ? Colors.white : Colors.terracotta} /><Text style={[styles.locationLabel, mine && styles.locationLabelMine]}>Shared location</Text></View>
                            <Text style={[styles.locationAddress, mine && styles.locationLabelMine]} numberOfLines={2}>{sharedLocation.address || 'View on map'}</Text>
                            <Text style={[styles.locationHint, mine && styles.locationLabelMine]}>Tap to open map</Text>
                          </View>
                        ))}
                        {!!item.image_url && (COMMUNITY_CHAT_GROUPING_ENABLED ? <ChatPhotoAttachment
                          uri={item.image_url} senderName={item.sender_name} fonts={conversationFonts}
                          maxWidth={Math.min(240, (windowWidth - 68) * 0.82 - 26)}
                          onOpen={() => photoSelection.onSelect(item.id)}
                          onLongPress={() => { if (mine) openOwnMessageMenu(item); else if (item.sender_id) openMemberMenu(item.sender_id, item.sender_name ?? 'someone', item.id); }}
                        /> : <Image source={{ uri: item.image_url }} style={styles.messageImage} contentFit="cover" />)}
                        {!!item.body && !sharedLocation && (
                          <LinkifiedText
                            text={item.body}
                            mentionDocument={item.mention_data}
                            onMentionPress={userId => { if (admissionIsCurrent()) setProfileUserId(userId); }}
                            style={[styles.messageText, mine && styles.messageTextMine, messageAppearance?.body, mine && messageAppearance?.bodyOwn]}
                            linkStyle={messageAppearance ? mine ? messageAppearance.linkOwn : messageAppearance.link : mine && styles.messageTextMine}
                            mentionNames={mentionNames}
                            mentionStyle={messageAppearance ? mine ? messageAppearance.mentionOwn : messageAppearance.mention : mine && styles.messageTextMine}
                          />
                        )}
                        {!!firstUrl && <LinkPreviewCard url={firstUrl} isOwn={mine} />}
                        <Text style={[styles.editedText, messageAppearance?.metadata, mine && messageAppearance?.metadataOwn, { alignSelf: 'flex-end', marginTop: 2 }]}>{localDelivery === 'sending' ? 'Sending…' : localDelivery === 'unconfirmed' ? 'Not confirmed · retry below' : localDelivery === 'sent' ? 'Sent' : formatChatTime(item.created_at)}</Text>
                      {!!item.edited_at && <Text style={[styles.editedText, mine && styles.messageTextMine, messageAppearance?.metadata, mine && messageAppearance?.metadataOwn]}>edited</Text>}
                      </TouchableOpacity>
                      {detailsReady && <CommunityMessageActions onViewMember={userId => { if (admissionIsCurrent()) setProfileUserId(userId); }} compactReplies replyRequest={replyRequest?.messageId === item.id ? replyRequest : undefined} onRepliesClose={currentAction(() => setReplyRequest(current => current?.messageId === item.id ? null : current))} onViewReactions={() => openReactionDetails(item.id)} appearance={COMMUNITY_CHAT_GROUPING_ENABLED ? { fonts: conversationFonts } : undefined} message={item} scope={operationScope} onError={showError} onReact={emoji => handleSelectReaction(item.id, emoji)} onAddReaction={currentAction(() => setReactionPickerMsgId(item.id))} />}
                    </View>
                  </View>
                ) : item.metadata_pending ? (
                  <View style={styles.welcomeCard}><Text style={styles.welcomeBody}>{item.body}</Text></View>
                ) : (
                  <BroadcastCard onViewMember={userId => { if (admissionIsCurrent()) setProfileUserId(userId); }}
                    appearance={COMMUNITY_CHAT_GROUPING_ENABLED ? { fonts: conversationFonts } : undefined}
                    broadcast={item}
                    onViewReactions={() => openReactionDetails(item.id)}
                    scope={operationScope}
                    communityName={card?.name ?? ''}
                    onError={showError}
                    mentionNames={mentionNames}
                  />
                )}
              </View>
            );
          }}
          contentContainerStyle={styles.listContent}
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

      </MessageViewport>
      <ComposerDock {...(Platform.OS === 'ios' ? { inset: insets.bottom } : {})}>
      {removedFromCommunity ? (
        /* SC-07: a real reason, not a silently-broken composer. */
        <PermissionState message="you were removed from this community." />
      ) : (
        <>
          {!online && <OfflineBanner label="You’re offline. Reconnect, then retry any messages that didn’t send." />}
          {mentionQuery !== null && <ChatMentionPicker members={mentionCandidates} fonts={conversationFonts}
            loading={membersLoading} error={membersError}
            onRetry={()=>{if(entryIsCurrent())void retryMembers();}}
            onSelect={insertMention} onClose={()=>{if(entryIsCurrent())setMentionQuery(null);}}/>}
          {(!composerDraft.ready || composerDraft.error || composerDraft.draft.attempt && !sending) && <View style={styles.draftRecovery}>
            <Text style={[styles.draftRecoveryLabel, { fontFamily: conversationFonts.medium }]}>{composerDraft.error ? 'Your draft could not be saved or checked.' : !composerDraft.ready ? 'Checking your draft…' : 'Your previous message is not confirmed.'}</Text>
            {composerDraft.draft.attempt && <Text style={[styles.draftRecoveryBody, { fontFamily: conversationFonts.regular }]} numberOfLines={2}>{composerDraft.draft.attempt.text}</Text>}
            {composerDraft.error ? <TouchableOpacity accessibilityRole="button" accessibilityLabel="Retry message draft" style={styles.draftRecoveryAction} onPress={() => { void composerDraft.retry(); }}><Text style={styles.draftRecoveryLabel}>Try again</Text></TouchableOpacity>
              : composerDraft.draft.attempt && <View style={styles.draftRecoveryActions}>
                <TouchableOpacity accessibilityRole="button" accessibilityLabel="Check original message" style={styles.draftRecoveryAction} disabled={sending} onPress={() => { void checkPendingDraft(); }}><Text style={styles.draftRecoveryLabel}>Check</Text></TouchableOpacity>
                <TouchableOpacity accessibilityRole="button" accessibilityLabel="Retry original message" style={styles.draftRecoveryAction} disabled={sending} onPress={() => { void handleSend(); }}><Text style={styles.draftRecoveryLabel}>Retry original</Text></TouchableOpacity>
              </View>}
          </View>}
          {!!editingMessageId && (
            <View style={styles.editingBar}>
              <Text style={styles.editingText}>editing</Text>
              <TouchableOpacity onPress={currentAction(() => { if (draftBlocked || sending) return; entryRevisionRef.current++; composerDraft.change({ text: '', mentions: null, edit: null }); draftRef.current = ''; })} hitSlop={8} accessibilityLabel="Cancel edit">
                <X size={18} color={Colors.tertiary} />
              </TouchableOpacity>
            </View>
          )}
          {COMMUNITY_CHAT_GROUPING_ENABLED ? <CommunityChatComposer
            composerInputRef={composerInputRef}
            fonts={conversationFonts}
            inputProps={{ ...composerInputProps, placeholderTextColor: AfterglowColors.muted, placeholder: 'Message…' }}
            photo={{ onPress: () => handlePickPhoto(), disabled: !attachmentVisit.allowed || uploadingPhoto, busy: uploadingPhoto }}
            camera={{ onPress: () => handlePickPhoto('camera'), disabled: !attachmentVisit.allowed || uploadingPhoto }}
            location={{ onPress: () => { if (attachmentIsCurrent()) setLocationPickerOpen(true); }, disabled: !attachmentVisit.allowed || uploadingPhoto }}
            onSend={handleSend}
            sendDisabled={!identityReady || draftBlocked || !draft.trim() || sending}
            sending={sending}
            editing={!!editingMessageId}
          /> : <View style={styles.composer}>
            <TouchableOpacity
              style={styles.photoBtn}
              onPress={() => handlePickPhoto()}
              disabled={!attachmentVisit.allowed || uploadingPhoto}
              accessibilityRole="button"
              accessibilityLabel="Add photo"
            >
              {uploadingPhoto
                ? <ActivityIndicator size="small" color={Colors.terracotta} />
                : <ImageIcon size={22} color={Colors.terracotta} strokeWidth={2.25} />}
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.photoBtn}
              onPress={() => { if (attachmentIsCurrent()) setLocationPickerOpen(true); }}
              disabled={!attachmentVisit.allowed || uploadingPhoto}
              accessibilityRole="button"
              accessibilityLabel="Share location"
            >
              <MapPin size={22} color={Colors.terracotta} strokeWidth={2.25} />
            </TouchableOpacity>
            <TextInput ref={composerInputRef} style={styles.input} {...composerInputProps} />
            <TouchableOpacity
              style={[styles.sendBtn, (!draft.trim() || sending) && styles.sendBtnOff]}
              onPress={handleSend}
              disabled={!identityReady || draftBlocked || !draft.trim() || sending}
            >
              {sending ? (
                <ActivityIndicator size="small" color={Colors.white} />
              ) : (
                <Text style={styles.sendBtnText}>send</Text>
              )}
            </TouchableOpacity>
          </View>}
        </>
      )}

      </ComposerDock>
      </KeyboardLayout>
      {COMMUNITY_CHAT_GROUPING_ENABLED && <ChatPhotoViewer photos={photos} {...photoSelection} fonts={conversationFonts} />}

      <PhotoPreviewModal
        visible={photoPreviewOpen}
        assets={pendingPhoto ? [pendingPhoto] : []}
        sending={uploadingPhoto}
        initialCaption={draft}
        errorMessage={photoError}
        captionLocked={!!pendingPhoto && photoSendSessionRef.current.hasCaption(pendingPhoto.uri)}
        onCancel={() => {
          if (!attachmentIsCurrent() || photoAttemptRef.current) return;
          setPhotoPreviewOpen(false);
          setPendingPhoto(null);
          setPhotoError(null);
          photoSendSessionRef.current.clear();
        }}
        onSend={handleSendPhoto}
      />
      <LocationPickerModal
        visible={locationPickerOpen}
        retryPreservesMessage
        onClose={() => { if (!attachmentIsCurrent()) return; setLocationPickerOpen(false); }}
        onConfirm={handleShareLocation}
      />
      {reactionDetails && <ReactionDetailsSheet request={reactionDetails} onClose={() => setReactionDetails(null)} />}
      <MessageActionsMenu menu={messageMenu} onClose={() => setMessageMenu(null)} />
      <BrandedAlert
        visible={!!alertInfo}
        title={alertInfo?.title ?? ''}
        message={alertInfo?.message}
        buttons={alertInfo?.buttons}
        onClose={currentAction(() => setAlertInfo(null))}
      />

      {reportTarget && (
        <ReportModal
          visible={showReport}
          onClose={currentAction(() => setShowReport(false))}
          scope={myId ? operationScope : null}
          reportedUserId={reportTarget.id}
          reportedUserName={reportTarget.name}
        />
      )}
      <MiniProfileCard
        visible={!!profileUserId}
        userId={profileUserId}
        onClose={currentAction(() => setProfileUserId(null))}
        onReport={(userId, userName) => {
          if (!admissionIsCurrent()) return;
          setProfileUserId(null);
          setReportTarget({ id: userId, name: userName });
          setShowReport(true);
        }}
        onBlock={(userId, userName) => {
          if (!admissionIsCurrent()) return;
          setProfileUserId(null);
          blockUser(userId, userName, currentAction(refreshMessages), operationScope);
        }}
      />
      <ReactionEmojiPicker
        visible={!!reactionPickerMsgId}
        onSelect={(emoji) => {
          if (!admissionIsCurrent()) return;
          if (reactionPickerMsgId) {
            const message = broadcasts.find(item => item.id === reactionPickerMsgId);
            if (message) void handleSelectReaction(message.id, reactionKeyForEmoji(emoji, message.reactions));
          }
          setReactionPickerMsgId(null);
        }}
        onClose={currentAction(() => setReactionPickerMsgId(null))}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  draftRecovery: { paddingHorizontal: 16, paddingVertical: 10, gap: 4, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: AfterglowColors.line, backgroundColor: AfterglowColors.paper },
  draftRecoveryLabel: { ...AfterglowType.caption, color: AfterglowColors.ink, fontFamily: Fonts.sansMedium },
  draftRecoveryBody: { ...AfterglowType.caption, color: AfterglowColors.muted, fontFamily: Fonts.sans },
  draftRecoveryActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 20 },
  draftRecoveryAction: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  container: { flex: 1, backgroundColor: Colors.parchment },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadErrorWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 12 },
  loadErrorTitle: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.darkWarm, textAlign: 'center' },
  loadErrorBody: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.secondary, textAlign: 'center' },
  loadRetry: { backgroundColor: Colors.terracotta, borderRadius: 24, minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 12, marginTop: 4 },
  loadRetryText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.white },
  olderButton: { alignSelf: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  olderButtonText: { fontFamily: Fonts.sansSemibold, fontSize: FontSizes.bodySM, color: Colors.terracotta },
  loadWarning: { backgroundColor: Colors.inputBg, paddingHorizontal: 16, paddingVertical: 9 },
  loadWarningText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.darkWarm, textAlign: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  headerTitleTap: { flex: 1, alignItems: 'center' },
  muteButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyLG,
    color: Colors.darkWarm,
    textAlign: 'center',
  },
  headerAudience: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.caption,
    color: Colors.tertiary,
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
  compactPinnedEvent: {
    backgroundColor: AfterglowColors.paper,
    borderRadius: 0,
    borderWidth: 0,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: AfterglowColors.subtleLine,
    marginHorizontal: 0,
    marginBottom: 0,
    paddingHorizontal: 16,
    paddingVertical: 8,
    minHeight: 52,
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
  messageRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginBottom: 8 },
  messageRowGrouped: { marginTop: -7 },
  messageRowMine: { justifyContent: 'flex-end' },
  messageColumn: { maxWidth: '86%', flexShrink: 1, alignItems: 'flex-start' },
  messageColumnMine: { alignItems: 'flex-end' },
  face: { width: 24, height: 24, borderRadius: 12, marginTop: 3 },
  faceSpacer: { width: 24 },
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
  locationCard: { minWidth: 180, gap: 4 },
  locationHeading: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  locationLabel: { fontFamily: Fonts.sansSemibold, fontSize: FontSizes.bodySM, color: Colors.darkWarm },
  locationLabelMine: { color: Colors.white },
  locationAddress: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.darkWarm },
  locationHint: { fontFamily: Fonts.sans, fontSize: FontSizes.caption, color: Colors.secondary },
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
