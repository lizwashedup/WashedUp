import { ChatComposerContext } from './ChatComposerContext';
import { chatStyles, createConversationAppearance } from './chatThreadStyles';
import MessageBubble from './ChatMessageBubble';
import SwipeableRow from './ChatSwipeReplyRow';
import { bubbleStyles } from './chatBubbleStyles';
import { formatChatDate, formatMessageTime, isSameDay } from './chatDateFormatting';
import { useChatReplyScroll } from '../../hooks/useChatReplyScroll';
import { useChatScrollFollow } from '../../hooks/useChatScrollFollow';
import { beginChatTiming, type ChatTimingOutcome } from '../../lib/chatPerformance';
import { parseMemberReactionAnchor } from '../../lib/memberChatMessageAnchor';
import { useChatAnchorScroll } from '../../hooks/useChatMessageAnchor';
import { ChatMessageAnchorNotice } from './ChatMessageAnchorNotice';
import { addChatMentionReference, rebaseChatMentions, readChatMentionDocument } from '../../lib/chatMentionIdentity';
import { useChatMentionFocus } from '../../hooks/useChatMentionFocus';
import { useChatResumeRefresh } from '../../hooks/useChatResumeRefresh';
import { ChatMentionPicker } from './ChatMentionPicker';
import { findMentionMembers } from '../../lib/chatMentions';
import { mentionQueryAt, insertMentionAt } from '../../lib/communityChatUi';
import { ChatThreadHeader } from './ChatThreadHeader';
import { MessageActionsMenu, type MessageMenu } from './MessageActionsMenu';
import { MEMBER_REDESIGN_APPEARANCE_ENABLED, memberPresentationFonts } from '../../constants/MemberAppearance';
import React, { useState, useRef, useCallback, useEffect, useLayoutEffect, useMemo, memo } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  TextInput,
  Keyboard,
  Platform,
  ActionSheetIOS,
  Alert,
  ActivityIndicator,
  Modal,
  Pressable,
  Linking,
  BackHandler,
  LayoutChangeEvent,
  useWindowDimensions,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import { KEYBOARD_DONE_ACCESSORY_ID } from '../keyboard/KeyboardDoneBar';
import * as Notifications from 'expo-notifications'; // setBadgeCountAsync only -- local-only API, no server call. OneSignal SDK doesn't expose direct badge clear; revisit during cleanup.
import * as Crypto from 'expo-crypto';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
// Lazy-load expo-clipboard so older production binaries (built before this dep
// was added) don't crash when this screen's module is imported. Mirrors the
// pattern in lib/addToCalendar.ts and components/VideoSplash.tsx.
let Clipboard: typeof import('expo-clipboard') | null = null;
try { Clipboard = require('expo-clipboard'); } catch {}
import { hapticLight, hapticMedium, hapticHeavy, hapticSelection, hapticSuccess, hapticWarning, hapticError } from '../../lib/haptics';
import Animated, { FadeIn, useSharedValue, useAnimatedStyle, withSpring, withTiming, useAnimatedReaction, runOnJS } from 'react-native-reanimated';
import { IOSKeyboardDock, IOSKeyboardViewport, useAnimatedKeyboard } from '../keyboard/ChatKeyboard';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { supabase } from '../../lib/supabase';
import Colors, { AfterglowColors } from '../../constants/Colors';
import { COMMUNITY_CHAT_GROUPING_ENABLED } from '../../constants/FeatureFlags';
import { useAfterglowFonts } from '../../hooks/useAfterglowFonts';
import { CreatorActionFill } from '../creator/CreatorActionFill';
import { createChatComposerAppearance } from './chatComposerAppearance';
import { useChatInputHeight } from '../../hooks/useChatInputHeight';
import { ChatPhotoViewer, useChatPhotoSelection } from './ChatPhotoViewer';
import type { AnchorRect } from '../menu/MenuCard';
import SunriseIcon from '../yours/icons/SunriseIcon';
import { openUrl } from '../../lib/url';
import { uploadBase64ToStorage } from '../../lib/uploadPhoto';
import { isChatEditRefused } from '../../lib/chatMessageEdit';
import { checkContent } from '../../lib/contentFilter';
import { restoreChatDraft } from '../../lib/restoreChatDraft';
import { PhotoBatchFailure, sendPhotoBatch } from '../../lib/chatPhotoBatch';
import { requestWithDeadline } from '../../lib/requestWithDeadline';
import { compareChatSequence } from '../../lib/chatPaging';
import { PhotoSendSession } from '../../lib/photoSendSession';
import { useChatComposerDraft } from '../../hooks/useChatComposerDraft';
import { checkChatComposerAttempt, verifyChatComposerTarget, type ChatDraftAttempt } from '../../lib/chatComposerDraft';
import { useChat, isObsoleteChatOperation, isUnconfirmedChatReaction, ChatMessage, MessageReaction, ReplyTo } from '../../hooks/useChat';
import { friendlyError } from '../../lib/friendlyError';
import MiniProfileCard from '../MiniProfileCard';
import AttachmentPanel, { AttachmentKey } from '../chat/AttachmentSheet';
import MediaPanel, { isChatGifPickerAvailable } from '../chat/MediaPanel';
import LocationPickerModal from '../chat/LocationPickerModal';
import PhotoPreviewModal from '../chat/PhotoPreviewModal';
import ReactionEmojiPicker from '../chat/ReactionEmojiPicker';
import { ReactionDetailsSheet, type ReactionDetailsRequest } from './ReactionDetailsSheet';
import { reactionEmoji, reactionKeyForEmoji, topicReactionCounts } from '../../lib/communityReactionChips';
import TypingIndicator from '../chat/TypingIndicator';
import { useTypingIndicator } from '../../hooks/useTypingIndicator';
import { useActiveChatPresence } from '../../hooks/useActiveChatPresence';
import ScrollToBottomButton from '../chat/ScrollToBottomButton';
import { ChatSizedText } from './ChatSizedText';
import VoiceRecorder, { RecorderUiMode } from '../chat/VoiceRecorder';
import { useVoiceRecorder } from '../../hooks/useVoiceRecorder';
import { uploadAudioToStorage } from '../../lib/uploadAudio';
import { logError } from '../../lib/logger';
import { ReportModal } from '../modals/ReportModal';
import { useBlock } from '../../hooks/useBlock';
import { BrandedAlert, BrandedAlertButton } from '../BrandedAlert';
import { useChatPushBanner } from '../../hooks/useChatPushBanner';

// ─── Shared chat surface ────────────────────────────────────────────────────────
// ChatThread is the ONE polished chat body shared by plan, circle, and DM chats.
// Per-kind chrome (title, members, the "View X" button, the header trailing menu,
// the ticket/pinned/countdown/read-only slots, presence) is injected via props so
// the message list + bubbles + composer + reactions + voice stay byte-identical
// across all three. Plan chat (app/(tabs)/chats/[id].tsx) is the canonical consumer.

export interface ChatThreadMember {
  id: string;
  first_name: string | null;
  avatar_url: string | null;
}

// Header trailing button: plan chats show the report/block ellipsis; circle/DM
// chats show a "+" menu (add people / make a plan). The report machinery lives
// inside ChatThread (also reachable via avatar -> mini profile), so 'report'
// needs no callback; 'plus' supplies its own handler.
export type ChatThreadHeaderMenu =
  | { type: 'report' }
  // onPress receives the + button's measured window rect so a menu can bloom from it.
  | { type: 'plus'; onPress: (anchor: AnchorRect) => void };

export interface ChatThreadProps {
  kind: 'event' | 'circle';
  id: string;
  reactionMessageId?: string | string[];
  reactionMessageSource?: string | string[];
  // Header
  title: string;
  subtitle: string | null;
  members: ChatThreadMember[];
  viewContextLabel: string;
  onViewContext: () => void;
  locationLabel?: string | null;
  calendarAction?: { label: string; onPress: () => void };
  headerMenu: ChatThreadHeaderMenu;
  // System-message rewriting (plan title); undefined leaves system copy verbatim.
  contextTitle?: string;
  // Read-only / countdown / empty (all optional; plans set them, circles don't)
  readOnly?: { text: string } | null;
  countdownText?: string | null;
  emptyText?: string;
  // Chrome slots rendered inside the shared body
  renderHeaderBanner?: () => React.ReactElement | null;
  renderPinnedFooter?: () => React.ReactElement | null;
  // Moderation: the full member list for the report sheet (avatar row is capped).
  // Only used by the 'report' header menu; circle/DM use the '+' menu and reach
  // report via avatar -> mini profile, so this is optional for them.
  fetchReportMembers?: () => Promise<{ id: string; name: string }[]>;
  reportEventId?: string;
  // active_chat presence write (plan-only column); circles skip it
  enablePresence?: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Input-bar send button morph: crossfade between mic (empty input) and send
// (text entered). 0 = mic, 1 = send.
const SEND_MORPH_DURATION = 150;
const SEND_MORPH_MIN_SCALE = 0.85;
const SEND_MORPH_SCALE_RANGE = 0.15;
const SEND_MIC_ICON_SIZE = 22;
const SEND_ARROW_ICON_SIZE = 18;

// Scroll-to-bottom button thresholds (inverted list: contentOffset.y grows as
// you scroll up toward older messages; 0 = pinned to newest).
const SCROLL_SHOW_THRESHOLD = 300;
const SCROLL_BTN_GAP = 12;

// Inline attachment panel height used until a real keyboard height is observed
// this session (the panel then matches the keyboard it replaces).
const PANEL_FALLBACK_HEIGHT = 280;
const PANEL_ANIM_MS = 180;
const PHOTO_BATCH_LIMIT = 10;

// Voice recording hold gesture: activate after a short hold, then slide left to
// cancel or up to lock (hands-free), mirroring WhatsApp.
const VOICE_HOLD_MS = 200;
const VOICE_CANCEL_THRESHOLD = 80;
const VOICE_LOCK_THRESHOLD = 80;

// ─── Main Screen ──────────────────────────────────────────────────────────────

let nextChatEntry = 0;

function ChatThread(props: ChatThreadProps) {
  const { id } = props;
  const { width: windowWidth } = useWindowDimensions();
  const { fonts: loadedConversationFonts } = useAfterglowFonts(COMMUNITY_CHAT_GROUPING_ENABLED);
  const conversationFonts = memberPresentationFonts(loadedConversationFonts);
  const screenAppearance = useMemo(() => MEMBER_REDESIGN_APPEARANCE_ENABLED ? createConversationAppearance(conversationFonts) : null, [conversationFonts]);
  const composerAppearance = useMemo(() => COMMUNITY_CHAT_GROUPING_ENABLED ? createChatComposerAppearance(conversationFonts) : null, [conversationFonts]);
  const useSystemEmoji = COMMUNITY_CHAT_GROUPING_ENABLED && (Platform.OS === 'ios' || Platform.OS === 'android');
  const gifsInAttachments = useSystemEmoji && isChatGifPickerAvailable();
  const isPast = props.readOnly != null;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [uploading, setUploading] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [photoViewUrl, setPhotoViewUrl] = useState<string | null>(null);
  const [showReport, setShowReport] = useState(false);
  const [reportTarget, setReportTarget] = useState<{ id: string; name: string } | null>(null);
  const [miniProfileUserId, setMiniProfileUserId] = useState<string | null>(null);
  const [alertInfo, setAlertInfo] = useState<{ title: string; message: string; scrollMessage?: boolean; buttons?: BrandedAlertButton[] } | null>(null);
  const [reactionDetails, setReactionDetails] = useState<ReactionDetailsRequest | null>(null);
  const [overlayMessage, setOverlayMessage] = useState<MessageMenu | null>(null);
  const listRef = useRef<FlatList>(null);
  // Measured so the "+" header menu (DMs) can bloom from the button.
  const plusBtnRef = useRef<View>(null);
  const requestedAnchor = parseMemberReactionAnchor(props.reactionMessageId, props.reactionMessageSource);
  const anchorRequestKey = `${props.kind}:${id}:${requestedAnchor}`;
  const [dismissedAnchor, setDismissedAnchor] = useState<string | null>(null);
  const anchorId = dismissedAnchor === anchorRequestKey ? null : requestedAnchor;
  const clearAnchor = useCallback(() => setDismissedAnchor(anchorRequestKey), [anchorRequestKey]);
  const { messages, loading, loadError, olderLoadError, anchorUnavailable, currentUserId, operationScope, sendMessage, sendLocation, sendAudio, deleteMessage, editMessage, toggleReaction, loadOlder, refetch } = useChat({ kind: props.kind, id }, anchorId);
  // A room/account return is a new entry, even when its IDs repeat. The
  // transport also owns its own account epoch; this tighter scope includes
  // the read-only transition and every asynchronous composer continuation.
  const entry = useMemo(() => ({ serial: ++nextChatEntry }), [props.kind, id, currentUserId, operationScope]);
  const activeEntry = useRef<typeof entry | null>(null);
  const writableVisit = useMemo(() => ({}), [entry, isPast]);
  const activeWritableVisit = useRef<object | null>(null);
  const isCurrentEntry = useCallback(() => activeEntry.current === entry && !!currentUserId &&
    operationScope !== null && (!operationScope || operationScope.isCurrent()), [entry, currentUserId, operationScope]);
  const draftRoom = useMemo(() => ({ kind: props.kind, id }), [props.kind, id]);
  const draftOwner = useMemo(() => currentUserId ? { userId: currentUserId, isCurrent: isCurrentEntry } : null, [currentUserId, isCurrentEntry]);
  const composerDraft = useChatComposerDraft(draftRoom, draftOwner);
  const inputText = composerDraft.draft.text;
  const editingMessageId = composerDraft.draft.edit?.id ?? null;
  const replyingTo = composerDraft.draft.reply;
  const changeDraft = composerDraft.change;
  const setInputText = useCallback((value: React.SetStateAction<string>) => changeDraft(draft => {
    const text = typeof value === 'function' ? value(draft.text) : value;
    return { text, mentions: draft.mentions ? rebaseChatMentions(draft.mentions, text) : null };
  }), [changeDraft]);
  const setReplyingTo = useCallback((reply: typeof replyingTo) => changeDraft({ reply }), [changeDraft]);
  const setEditingMessageId = useCallback((_id: null) => changeDraft({ edit: null }), [changeDraft]);
  const canWrite = useCallback(() => isCurrentEntry() && composerDraft.isCurrent() && composerDraft.ready && !composerDraft.error && !isPast && activeWritableVisit.current === writableVisit,
    [isCurrentEntry, composerDraft.isCurrent, composerDraft.ready, composerDraft.error, isPast, writableVisit]);
  const entryScope = useMemo(() => ({ userId: currentUserId, isCurrent: canWrite }), [currentUserId, canWrite]);
  const moderationScope = useMemo(() => ({ userId: currentUserId ?? '', isCurrent: isCurrentEntry }), [currentUserId, isCurrentEntry]);
  const openPlusFromButton = useCallback(() => {
    if (!isCurrentEntry() || props.headerMenu.type !== 'plus') return;
    const onPress = props.headerMenu.onPress;
    plusBtnRef.current?.measureInWindow((x, y, width, height) => {
      if (isCurrentEntry()) onPress({ x, y, width, height });
    });
  }, [props.headerMenu, isCurrentEntry]);
  const requireEntry = useCallback(() => { if (!canWrite()) throw new Error('Conversation changed'); }, [canWrite]);
  useLayoutEffect(() => {
    activeEntry.current = entry;
    return () => { if (activeEntry.current === entry) activeEntry.current = null; };
  }, [entry]);
  useLayoutEffect(() => {
    activeWritableVisit.current = writableVisit;
    sendingRef.current = null; photoSendingRef.current = null; photoPickerAttempt.current = null;
    gifAttempt.current = null; locationAttempt.current = null;
    return () => { if (activeWritableVisit.current === writableVisit) activeWritableVisit.current = null; };
  }, [writableVisit]);
  const photos = useMemo(() => messages.filter(message => message.message_type !== 'system' && message.image_url)
    .slice().sort(compareChatSequence)
    .map(message => ({ id: message.id, uri: message.image_url!, senderName: message.sender?.first_name, caption: message.content })), [messages]);
  const photoSelection = useChatPhotoSelection(`${props.kind}:${id}:${currentUserId}:${entry.serial}`, photos);
  const openMessagePhoto = useCallback((url: string, messageId: string) => {
    if (COMMUNITY_CHAT_GROUPING_ENABLED) photoSelection.onSelect(messageId);
    else setPhotoViewUrl(url);
  }, [photoSelection.onSelect]);
  const [membersExpanded, setMembersExpanded] = useState(false);
  // Native keyboard geometry stays on the UI thread. Waiting for an iOS
  // keyboardWillShow state commit lets the rising keyboard cover messages
  // before the composer/list move. Event state below is only for controls
  // and panel handoff; it is not the iOS viewport's height source.
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [iosKeyboardHeight, setIosKeyboardHeight] = useState(0);
  // Android keyboard height mirrored from Reanimated's shared value into
  // JS state so the FlatList's contentContainerStyle can re-render with
  // the correct paddingTop reservation when the keyboard opens/closes.
  const [androidKeyboardHeight, setAndroidKeyboardHeight] = useState(0);

  // Inline attachment panel ("keyboard-height panel" substrate, reused later by
  // the emoji/GIF pickers). It REPLACES the keyboard and never coexists with
  // it. The bottom inset fed to the input bar + list is
  // max(keyboardHeight, panelOpen ? panelHeight : 0) so the keyboard<->panel
  // handoff never collapses to 0 for a frame (prevents the input bar jumping).
  // Which keyboard-height panel is showing (both share the substrate + inset).
  const [activePanel, setActivePanel] = useState<'attach' | 'emoji' | 'gif' | null>(null);
  const attachmentShowsKeyboard = activePanel === 'attach' || (useSystemEmoji && activePanel === 'gif');
  const panelOpen = activePanel !== null;
  const [locationPickerOpen, setLocationPickerOpen] = useState(false);
  const [pendingPhotos, setPendingPhotos] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [photoPreviewOpen, setPhotoPreviewOpen] = useState(false);
  const photoCaptionSentRef = useRef(false);
  const photoSendingRef = useRef<object | null>(null);
  const photoPickerAttempt = useRef<object | null>(null);
  const gifAttempt = useRef<object | null>(null);
  const gifPendingIds = useRef(new Map<string, string>());
  const locationAttempt = useRef<object | null>(null);
  const locationSession = useRef<{ pin: string; sendId: string } | null>(null);
  const photoSendSessionRef = useRef(new PhotoSendSession(() => Crypto.randomUUID()));
  // Message id whose full-emoji reaction picker is open (via the "+" on the
  // quick-react row); null when closed.
  const [reactionPickerMsgId, setReactionPickerMsgId] = useState<string | null>(null);
  // The partial name typed after an "@" at the caret, or null when not composing
  // a mention. Drives the autocomplete strip above the input bar.
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  // Match the panel to the keyboard it replaces: track the observed keyboard
  // height; fall back until one is seen this session.
  const [panelHeight, setPanelHeight] = useState(PANEL_FALLBACK_HEIGHT);
  const panelInset = panelOpen ? panelHeight : 0;
  const iosDockFloor = Math.max(panelInset, insets.bottom);

  const animatedKeyboard = useAnimatedKeyboard();
  // Android retains its existing eased panel inset. On iOS the panel mounts
  // at full height, so reserve that footprint in the same render; only the
  // native keyboard height animates. Otherwise the panel covers the dock
  // while the inset catches up.
  const panelInsetSV = useSharedValue(0);
  useEffect(() => {
    panelInsetSV.value = withTiming(panelInset, { duration: PANEL_ANIM_MS });
  }, [panelInset, panelInsetSV]);
  const immediateIOSPanelInset = Platform.OS === 'ios' ? panelInset : null;
  const nativeInputBarAnimatedStyle = useAnimatedStyle(() => ({
    bottom: Math.max(animatedKeyboard.height.value, immediateIOSPanelInset ?? panelInsetSV.value),
  }));
  const MessageViewport = Platform.OS === 'ios' ? IOSKeyboardViewport : View;
  const mirrorKeyboardHeightToJS = Platform.OS === 'android';
  useAnimatedReaction(
    () => mirrorKeyboardHeightToJS ? animatedKeyboard.height.value : 0,
    (h) => { runOnJS(setAndroidKeyboardHeight)(h); },
    [],
  );
  // The iOS viewport and dock use the same native height for every animation
  // frame, including interactive dismissal. Android retains its existing
  // edge-to-edge content reservation; web has no native keyboard inset.
  const InputBarWrapper: React.ComponentType<any> =
    Platform.OS === 'web' ? View : Platform.OS === 'ios' ? IOSKeyboardDock : Animated.View;
  const inputBarBottomStyle =
    Platform.OS === 'web' ? { bottom: panelInset } : Platform.OS === 'ios' ? { bottom: 0 } : nativeInputBarAnimatedStyle;
  useEffect(() => {
    // Inverted FlatList: offset 0 is the visual bottom (newest message).
    // Keep the newest message above the keyboard only when already at the
    // bottom. Reading or replying further up must not lose that position.
    const scrollToLatest = () => {
      if (isCurrentEntry() && !anchorId && atBottomRef.current) listRef.current?.scrollToOffset({ offset: 0, animated: false });
    };
    // Remember the keyboard height so the attachment panel matches it, and
    // close the panel only once the keyboard has actually taken over the space
    // (keeps the inset from collapsing to 0 during the panel->keyboard handoff).
    const onKeyboardShown = (height: number) => {
      if (height > 0) setPanelHeight(height);
      setActivePanel(null);
    };
    if (Platform.OS === 'ios') {
      let listening = true;
      let showPending = false;
      const showSub = Keyboard.addListener('keyboardWillShow', (e) => {
        if (!listening || !isCurrentEntry()) return;
        showPending = true;
        setKeyboardVisible(true);
        setIosKeyboardHeight(e.endCoordinates.height);
        // Keep the panel's reservation while the native keyboard is rising.
        // keyboardWillShow carries a target height, not occupied space yet.
        scrollToLatest();
      });
      const shownSub = Keyboard.addListener('keyboardDidShow', (e) => {
        if (!listening || !showPending) return;
        showPending = false;
        // A cancelled transition, picker, or newer panel request must not
        // let a delayed completion dismiss the currently selected panel.
        if (!isCurrentEntry() || !textInputRef.current?.isFocused()) return;
        const height = e.endCoordinates?.height ?? 0;
        if (height > 0) onKeyboardShown(height);
      });
      const hideSub = Keyboard.addListener('keyboardWillHide', () => {
        showPending = false;
        if (!listening || !isCurrentEntry()) return;
        setKeyboardVisible(false);
        setIosKeyboardHeight(0);
      });
      return () => {
        listening = false;
        showPending = false;
        showSub.remove();
        shownSub.remove();
        hideSub.remove();
      };
    }
    const showSub = Keyboard.addListener('keyboardDidShow', (e) => {
      setKeyboardVisible(true);
      onKeyboardShown(e.endCoordinates?.height ?? 0);
      scrollToLatest();
    });
    const hideSub = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [isCurrentEntry, anchorId]);
  // The keyboard AND the attachment panel both span the home-indicator area, so
  // when either is up the bar sits flush on it (8) rather than adding insets.bottom.
  const inputBarBottomPadding = Platform.OS === 'ios' ? 8 : keyboardVisible || panelOpen ? 8 : insets.bottom + 8;
  // Measure the bottom dock (input bar + any reply/edit banners) so the
  // inverted FlatList can reserve exactly that much space at its visual
  // bottom. Inverted lists flip the content container, so paddingTop in
  // style terms is the side closest to the input bar visually.
  // Wait for the actual dock before revealing messages. A fixed first-frame
  // estimate can miss the safe area or a restored draft/reply tray, exposing
  // the newest bubble underneath the dock on entry. Keep the list mounted so
  // it can lay out, then reveal it in the same commit as its measured inset.
  // Retain the measurement while this physical dock remains mounted: focus
  // alone does not guarantee another native onLayout event.
  const [bottomDockHeight, setBottomDockHeight] = useState<number | null>(null);
  const onDockLayout = useCallback((event: LayoutChangeEvent) => {
    const height = event.nativeEvent.layout.height;
    if (Number.isFinite(height) && height > 0) setBottomDockHeight(height);
  }, []);

  // Reserved space at the visual bottom of the inverted FlatList so the
  // newest message always sits directly above the input bar.
  //
  // iOS: the viewport shrinks with the native keyboard animation, so the
  // contentContainer only needs to reserve
  // the input bar height. Growing paddingTop by the keyboard height here
  // would trigger maintainVisibleContentPosition to shift the scroll on
  // keyboard open, leaving the user stuck mid-conversation unable to
  // reach the newest message above the bar.
  //
  // Android: edgeToEdge disables the classic adjustResize window shrink,
  // so the list itself doesn't get smaller when the keyboard opens -- the
  // paddingTop has to reserve both the bar and the keyboard height.
  const listBottomReservation =
    Platform.OS === 'ios'
      ? (bottomDockHeight ?? 0) + 8
      : (bottomDockHeight ?? 0) + 8 + Math.max(androidKeyboardHeight, panelInset);

  // Keep the existing invitation and seven-day explicit-dismissal/denial
  // policy. A slow or failed registration is not a permission decision.
  const { showPushBanner, enablingPush, pushFeedback, handleEnablePush, handleDismissPushBanner } = useChatPushBanner({ entry, currentUserId, isCurrentEntry, messages });

  // Throttle the focus-driven message refetch. New messages already
  // arrive live via realtime; this is a safety-net resync, so once per
  // 15s on focus is enough. Firing it on every focus contributed to the
  // 2026-05-18 "chat is slow" reports.
  const lastChatFocusFetchRef = useRef(0);
  const hasFocusedChatRef = useRef(false);
  const chatFocusedRef = useRef(false);
  useChatResumeRefresh(refetch, isCurrentEntry, chatFocusedRef);
  useFocusEffect(
    useCallback(() => {
      chatFocusedRef.current = true;
      const nowTs = Date.now();
      const isFirstFocus = !hasFocusedChatRef.current;
      hasFocusedChatRef.current = true;
      if (isFirstFocus) lastChatFocusFetchRef.current = nowTs;
      // useChat already loads on mount. Starting the focus safety-net on that
      // same first frame doubled the initial message request.
      if (!isFirstFocus && nowTs - lastChatFocusFetchRef.current > 15_000) {
        lastChatFocusFetchRef.current = nowTs;
        refetch(true);
      }
      Notifications.setBadgeCountAsync(0).catch(() => {});
      return () => { chatFocusedRef.current = false; };
    }, [refetch]),
  );

  // Preserve existing Plan-only push suppression while owning each focused
  // room/account visit and its background/return cleanup.
  useActiveChatPresence(id, operationScope ?? null, !!props.enablePresence);

  const { blockUser } = useBlock();

  // Conversation metadata (title/subtitle/members) is resolved by the per-kind
  // wrapper and passed in via props, so ChatThread itself runs no info query.
  const members = props.members;

  // Typing indicators broadcast over an ephemeral Realtime channel (separate
  // from the chat data channel). Our own display name comes from the already
  // loaded member list, so no extra query is needed.
  const currentUserName = useMemo(
    () => members.find(m => m.id === currentUserId)?.first_name ?? null,
    [members, currentUserId],
  );
  const { typingUsers, broadcastTyping, stopTyping } = useTypingIndicator(id, currentUserId, currentUserName, props.kind, operationScope);

  // Lowercased first names of everyone in the chat, for highlighting @mentions
  // in rendered bubbles. Memoized so the Set reference stays stable (MessageBubble
  // is memo'd).
  const mentionNames = useMemo(() => {
    const s = new Set<string>();
    members.forEach(m => { if (m.first_name) s.add(m.first_name.toLowerCase()); });
    return s;
  }, [members]);

  // Candidates for the autocomplete strip: members whose first name starts with
  // what's been typed after "@" (self excluded). Empty query lists everyone.
  const mentionCandidates = useMemo(() => findMentionMembers(members, mentionQuery, currentUserId), [mentionQuery, members, currentUserId]);

  const typingLabel = useMemo(() => {
    if (typingUsers.length === 0) return null;
    if (typingUsers.length === 1) return `${typingUsers[0].name} is typing...`;
    if (typingUsers.length === 2) return `${typingUsers[0].name} and ${typingUsers[1].name} are typing...`;
    return 'Several people are typing...';
  }, [typingUsers]);

  // Latest input text, synchronously, so onSelectionChange can detect a mention
  // against fresh text before React commits the state update.
  const inputTextRef = useRef('');
  // Synchronous lock on the send button: setInputText('') below doesn't
  // commit until the next render, so a fast real double-tap can fire
  // handleSend twice reading the same pre-clear text -- two identical real
  // messages, not a display glitch. A ref closes that window instantly.
  const sendingRef = useRef<object | null>(null);
  const draftRevision = useRef(0);
  const draftContextRevision = useRef(0);
  const handleInputChange = useCallback((text: string) => {
    if (!canWrite()) return;
    draftRevision.current++;
    const previousLength = inputTextRef.current.length;
    const caret = selectionRef.current.start >= previousLength ? text.length : selectionRef.current.start;
    selectionRef.current = { start: caret, end: caret };
    setInputText(text);
    inputTextRef.current = text;
    broadcastTyping();
    setMentionQuery(mentionQueryAt(text, caret));
  }, [broadcastTyping, canWrite]);
  useEffect(() => { inputTextRef.current = inputText; }, [inputText]);

  const prefetchedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    messages.forEach(m => {
      if (m.image_url && !prefetchedRef.current.has(m.image_url)) {
        prefetchedRef.current.add(m.image_url);
        Image.prefetch(m.image_url).catch(() => {});
      }
    });
  }, [messages]);

  // NOTE: no early return here. The "chat not found / failed to load" gate lives
  // in each per-kind wrapper (e.g. app/(tabs)/chats/[id].tsx) and renders the
  // error screen INSTEAD of mounting ChatThread, so the hook list below is never
  // conditionally skipped (an early return before these hooks would throw
  // "rendered fewer hooks" if infoError flipped true after a successful render).

  const reportMembersAttempt = useRef<object | null>(null);
  const [loadingReportMembers, setLoadingReportMembers] = useState(false);
  const reportMenuVisit = useRef<object | null>(null);
  useFocusEffect(useCallback(() => {
    const visit = {}; reportMenuVisit.current = visit;
    reportMembersAttempt.current = null; setLoadingReportMembers(false);
    return () => {
      if (reportMenuVisit.current !== visit) return;
      reportMenuVisit.current = null; reportMembersAttempt.current = null;
    };
  }, [entry]));
  const handleReportMenu = useCallback(async () => {
    const visit = reportMenuVisit.current;
    const current = () => isCurrentEntry() && !!visit && reportMenuVisit.current === visit;
    if (!current() || reportMembersAttempt.current) return;
    const menuScope = { userId: moderationScope.userId, isCurrent: () => current() && moderationScope.isCurrent() };
    const attempt = {}; reportMembersAttempt.current = attempt; setLoadingReportMembers(true);
    // The full member list (avatar row is capped) comes from the per-kind wrapper:
    // plans query event_members, circles query circle_members.
    let reportMembers: { id: string; name: string }[];
    try { reportMembers = (await props.fetchReportMembers?.()) ?? []; }
    catch {
      if (current()) setAlertInfo({ title: 'Could not load members', message: 'Try opening the member menu again.' });
      return;
    } finally {
      if (reportMembersAttempt.current === attempt) {
        reportMembersAttempt.current = null;
        if (current()) setLoadingReportMembers(false);
      }
    }
    if (!current()) return;

    if (reportMembers.length === 0) {
      setAlertInfo({ title: 'No other members', message: 'There are no other members in this chat to report.' });
      return;
    }

    // Pick a member, then show report/block options -- all via native action sheets
    const memberNames = reportMembers.map(m => m.name);
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: [...memberNames, 'Cancel'], cancelButtonIndex: memberNames.length, title: 'Members' },
        (idx) => {
          if (!current() || idx < 0 || idx >= reportMembers.length) return;
          const member = reportMembers[idx];
          setTimeout(() => {
            if (!current()) return;
            ActionSheetIOS.showActionSheetWithOptions(
              { options: ['Report User', 'Block User', 'Cancel'], destructiveButtonIndex: 1, cancelButtonIndex: 2, title: member.name },
              (actionIdx) => {
                if (!current()) return;
                if (actionIdx === 0) { setReportTarget(member); setShowReport(true); }
                if (actionIdx === 1) blockUser(member.id, member.name, () => { if (current()) router.back(); }, menuScope);
              },
            );
          }, 300);
        },
      );
    } else {
      setAlertInfo({
        title: 'Members',
        message: 'Select a member',
        buttons: [
          ...reportMembers.map((member) => ({
            text: member.name,
            onPress: () => {
              if (!current()) return;
              setTimeout(() => {
                if (!current()) return;
                setAlertInfo({
                  title: member.name,
                  message: '',
                  buttons: [
                    { text: 'Report User', onPress: () => { if (current()) { setReportTarget(member); setShowReport(true); } } },
                    { text: 'Block User', style: 'destructive', onPress: () => blockUser(member.id, member.name, () => { if (current()) router.back(); }, menuScope) },
                    { text: 'Cancel', style: 'cancel' },
                  ],
                });
              }, 100);
            },
          })),
          { text: 'Cancel', style: 'cancel' as const },
        ],
      });
    }
  }, [props.fetchReportMembers, router, blockUser, isCurrentEntry, moderationScope]);

  const cancelReplyScroll = useRef<() => void>(() => {});
  // Explicit jumps happen immediately. New rows at the live edge do not use
  // visible-position preservation: that would pin the previous message and
  // place the new bubble underneath the composer until server confirmation.
  const scrollToBottom = useCallback(() => {
    if (!isCurrentEntry()) return;
    cancelReplyScroll.current();
    atBottomRef.current = true;
    setFollowingLatest(true);
    if (anchorId) { clearAnchor(); return; }
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, [isCurrentEntry, anchorId, clearAnchor]);

  // Floating scroll-to-bottom button + "new messages below" counter.
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [unreadBelow, setUnreadBelow] = useState(0);
  const scrollFollow = useChatScrollFollow(!anchorId);
  const { atBottomRef, followingLatest, setFollowingLatest, captureScrollIntent } = scrollFollow;
  const incomingTracker = useRef<{ entry: typeof entry; ids: Set<string>; newest: number } | null>(null);
  useLayoutEffect(() => {
    // A new room or history window starts with its own list position.
    // Keep this separate from composer resets when only the anchor changes.
    incomingTracker.current = null;
    atBottomRef.current = !anchorId;
    setFollowingLatest(!anchorId);
    setUnreadBelow(0); setShowScrollBtn(false);
  }, [entry, anchorId]);

  const handleListScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!isCurrentEntry()) return;
    const y = e.nativeEvent.contentOffset.y;
    scrollFollow.onScroll(e);
    setShowScrollBtn(y > SCROLL_SHOW_THRESHOLD);
    if (atBottomRef.current) setUnreadBelow(0);
  }, [isCurrentEntry, scrollFollow.onScroll]);

  // Track arrivals by identity and time, not array length: pagination adds
  // history above, and a delete plus arrival can leave the length unchanged.
  useEffect(() => {
    const previous = incomingTracker.current;
    const newest = messages.reduce((latest, message) => {
      const timestamp = Date.parse(message.created_at);
      return Number.isFinite(timestamp) ? Math.max(latest, timestamp) : latest;
    }, -Infinity);
    if (!previous || previous.entry !== entry) {
      incomingTracker.current = { entry, ids: new Set(messages.map(message => message.id)), newest };
      return;
    }
    let incoming = 0;
    for (const message of messages) {
      if (!previous.ids.has(message.id) && Date.parse(message.created_at) >= previous.newest && message.user_id !== currentUserId) incoming++;
      previous.ids.add(message.id);
    }
    previous.newest = Math.max(previous.newest, newest);
    if (!atBottomRef.current && incoming > 0) setUnreadBelow(count => count + incoming);
  }, [messages, entry, currentUserId]);

  const handleScrollToBottomPress = useCallback(() => {
    scrollToBottom();
    setUnreadBelow(0);
  }, [scrollToBottom]);

  const scrollBtnBottom =
    Math.max(Platform.OS === 'ios' ? iosKeyboardHeight : androidKeyboardHeight, panelInset) + (bottomDockHeight ?? 0) + SCROLL_BTN_GAP;

  const [checkingDraft, setCheckingDraft] = useState(false);
  const [sendingText, setSendingText] = useState(false);
  const checkPendingDraft = useCallback(async () => {
    const original = composerDraft.draft.attempt;
    if (!original || !draftOwner || !isCurrentEntry() || sendingRef.current) return;
    const token = {}; sendingRef.current = token; setCheckingDraft(true);
    try {
      if (await checkChatComposerAttempt(draftRoom, original, draftOwner)) {
        await composerDraft.finish(original);
        if (isCurrentEntry()) await refetch();
      } else if (isCurrentEntry()) setAlertInfo({ title: 'Not confirmed yet', message: 'Your original message is kept. Check again or retry the original when you’re ready.' });
    } catch (error) {
      if (isCurrentEntry()) setAlertInfo({ title: 'Could not check your message', message: error instanceof Error ? error.message : 'Your original message is kept.' });
    } finally {
      if (sendingRef.current === token) { sendingRef.current = null; setCheckingDraft(false); }
    }
  }, [composerDraft, draftRoom, draftOwner, isCurrentEntry, refetch]);

  const handleSend = useCallback(async (retryOriginal = false) => {
    if (!canWrite() || !draftOwner || sendingRef.current || uploading || (composerDraft.draft.attempt && !retryOriginal)) return;
    if (!inputTextRef.current.trim() && !composerDraft.draft.attempt) return;
    const finishTiming = beginChatTiming(props.kind, 'send-to-confirmation');
    let timingOutcome: ChatTimingOutcome = 'retired';
    const token = {}; sendingRef.current = token; setSendingText(true);
    const revision = draftRevision.current;
    const contextRevision = draftContextRevision.current;
    let original: ChatDraftAttempt | null = null;
    const scrollIntentIsCurrent = captureScrollIntent();
    try {
      if (!composerDraft.draft.attempt) {
        const filtered = checkContent(inputTextRef.current.trim());
        if (!filtered.ok) throw Error(filtered.reason ?? 'Please revise your message.');
      }
      original = await composerDraft.prepare({ detachText: true, onDetach: () => { textInputRef.current?.clear(); inputTextRef.current = ''; setMentionQuery(null); stopTyping(); } });
      if (!canWrite()) return;
      // Fresh text detaches atomically before its storage wait in the draft hook.
      // Edits retain the existing clear-after-preparation behavior.
      if (original.edit && !retryOriginal && draftRevision.current === revision) { setInputText(''); inputTextRef.current = ''; setMentionQuery(null); stopTyping(); }
      const alreadyConfirmed = retryOriginal && await checkChatComposerAttempt(draftRoom, original, draftOwner);
      if (!alreadyConfirmed) {
        if (retryOriginal) await verifyChatComposerTarget(draftRoom, original, draftOwner);
        const confirmed = original.edit
          ? await editMessage(original.id, original.text, entryScope, original.edit.content, original.mentions, original.edit.mentions, { errorPresentation: 'caller' })
          : await sendMessage(original.text, undefined, original.replyId ?? undefined, original.id, entryScope, original.mentions);
        if (!canWrite()) return;
        // Text sends already return an exact, account-and-room-scoped receipt.
        // Keep edit verification and the pre-retry check for uncertain attempts.
        if (!confirmed || (original.edit && !await checkChatComposerAttempt(draftRoom, original, draftOwner))) throw Error('Your original message has not been confirmed yet.');
      }
      if (!canWrite()) return;
      timingOutcome = 'ok'; finishTiming();
      await composerDraft.finish(original);
      // A lost receipt removes the optimistic bubble. Finding the saved row
      // on retry confirms delivery, but must also reconcile visible history.
      // Keep that refresh separate from delivery and never hold newer typing.
      if (alreadyConfirmed && canWrite()) void refetch(true).catch(() => {});
      if (canWrite() && scrollIntentIsCurrent()) scrollToBottom();
    } catch (error) {
      timingOutcome = 'error';
      if (!canWrite()) return;
      // An unresolved original is shown separately from newer typing/context.
      // Never merge it into a newer message that could later resend it as new.
      if (original && draftContextRevision.current === contextRevision) composerDraft.restoreFailedText(original);
      // A definitive refusal of this new edit made no change. Older uncertain
      // attempts remain protected even if a later retry is refused.
      if (original && !retryOriginal && isChatEditRefused(error)) await composerDraft.refuseFresh(original).catch(() => undefined);
      if (canWrite()) setAlertInfo({ title: original && (!isChatEditRefused(error) || retryOriginal) ? 'Message not confirmed' : 'Message not sent', message: error instanceof Error ? error.message : 'Your message is kept. Check it before trying again.' });
    } finally {
      finishTiming(isCurrentEntry() ? timingOutcome : 'retired');
      if (sendingRef.current === token) { sendingRef.current = null; setSendingText(false); }
    }
  }, [canWrite, draftOwner, uploading, composerDraft, draftRoom, editMessage, sendMessage, entryScope, refetch, scrollToBottom, captureScrollIntent, setInputText, stopTyping, changeDraft]);

  // Send button morph (mic when empty, send when typing). A single shared value
  // drives the crossfade so the two stacked icon layers animate in opposition.
  const hasText = inputText.trim().length > 0;
  const sendMorph = useSharedValue(0);
  useEffect(() => {
    sendMorph.value = withTiming(hasText ? 1 : 0, { duration: SEND_MORPH_DURATION });
  }, [hasText, sendMorph]);
  const micLayerStyle = useAnimatedStyle(() => ({
    opacity: 1 - sendMorph.value,
    transform: [{ scale: SEND_MORPH_MIN_SCALE + SEND_MORPH_SCALE_RANGE * (1 - sendMorph.value) }],
  }));
  const sendLayerStyle = useAnimatedStyle(() => ({
    opacity: sendMorph.value,
    transform: [{ scale: SEND_MORPH_MIN_SCALE + SEND_MORPH_SCALE_RANGE * sendMorph.value }],
  }));

  // ── Voice recording ────────────────────────────────────────────────────
  const recorder = useVoiceRecorder(entryScope);
  const [recordingMode, setRecordingMode] = useState<RecorderUiMode | 'idle'>('idle');
  const [draft, setDraft] = useState<{ uri: string; durationSeconds: number } | null>(null);

  const voiceCapture = useRef<object | null>(null);
  const voiceStopAttempt = useRef<object | null>(null);
  const audioSendAttempt = useRef<object | null>(null);
  const audioSession = useRef<{ uri: string; durationSeconds: number; sendId: string; url?: string } | null>(null);
  const [audioSending, setAudioSending] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [voiceDockHeight, setVoiceDockHeight] = useState(0);

  const resetRecording = useCallback(() => {
    if (!isCurrentEntry()) return;
    setRecordingMode('idle'); setDraft(null); setAudioError(null);
    voiceCapture.current = null; audioSession.current = null;
  }, [isCurrentEntry]);

  const uploadAndSendAudio = useCallback(async (uri: string, durationSeconds: number) => {
    if (!canWrite() || audioSendAttempt.current) return;
    const attempt = {}; audioSendAttempt.current = attempt;
    const session = audioSession.current?.uri === uri ? audioSession.current
      : { uri, durationSeconds, sendId: Crypto.randomUUID(), url: undefined as string | undefined };
    audioSession.current = session;
    setDraft({ uri, durationSeconds }); setRecordingMode('draft'); setAudioSending(true); setAudioError(null);
    const attemptScope = { userId: currentUserId, isCurrent: () => audioSendAttempt.current === attempt && canWrite() };
    const requireAttempt = () => { if (!attemptScope.isCurrent()) throw new Error('Voice attempt ended'); };
    const scrollIntentIsCurrent = captureScrollIntent();
    try {
      if (!session.url) {
        const url = await requestWithDeadline(uploadAudioToStorage(id, currentUserId, uri, attemptScope, session.sendId), 30_000);
        requireAttempt(); session.url = url;
      }
      requireAttempt();
      const confirmed = await requestWithDeadline(sendAudio(session.url, session.durationSeconds, attemptScope, session.sendId), 25_000);
      requireAttempt();
      if (!confirmed) throw new Error('Voice delivery is unconfirmed');
      resetRecording(); if (scrollIntentIsCurrent()) scrollToBottom();
    } catch (error) {
      if (!canWrite()) return;
      logError(error, 'chat.uploadAndSendAudio');
      setAudioError(session.url ? 'Delivery isn’t confirmed. Retry keeps the same recording.' : 'Couldn’t upload your recording. It’s still here to retry.');
    } finally {
      if (audioSendAttempt.current === attempt) {
        audioSendAttempt.current = null;
        if (canWrite()) setAudioSending(false);
      }
    }
  }, [canWrite, currentUserId, id, sendAudio, scrollToBottom, captureScrollIntent, resetRecording]);

  const beginRecording = useCallback(async (initialMode: 'holding' | 'locked' = 'holding') => {
    if (!canWrite() || voiceCapture.current || audioSendAttempt.current || voiceStopAttempt.current) return;
    const capture = {}; voiceCapture.current = capture;
    Keyboard.dismiss(); hapticMedium(); setRecordingMode(initialMode);
    const ok = await recorder.start();
    if (!canWrite() || voiceCapture.current !== capture) return;
    if (!ok) {
      voiceCapture.current = null; setRecordingMode('idle');
      Alert.alert('Microphone needed', 'Enable microphone access in Settings to send voice messages.');
    }
  }, [canWrite, recorder]);

  const cancelRecording = useCallback(async () => {
    if (!canWrite() || audioSendAttempt.current) return;
    voiceCapture.current = null;
    hapticLight();
    await recorder.cancel();
    if (canWrite() && !voiceCapture.current) resetRecording();
  }, [canWrite, recorder, resetRecording]);

  // Android: while a recording is in progress (holding/locked/draft), the
  // hardware back button should cancel the recording rather than navigate away
  // and silently discard it. Consume the event so navigation doesn't fire.
  useEffect(() => {
    if (Platform.OS !== 'android' || recordingMode === 'idle') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      void cancelRecording();
      return true;
    });
    return () => sub.remove();
  }, [recordingMode, cancelRecording]);

  // Android: hardware back closes the attachment panel instead of navigating.
  useEffect(() => {
    if (Platform.OS !== 'android' || !panelOpen) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setActivePanel(null);
      return true;
    });
    return () => sub.remove();
  }, [panelOpen]);

  const lockRecording = useCallback(() => {
    if (!canWrite() || !voiceCapture.current || audioSendAttempt.current) return;
    hapticLight(); setRecordingMode('locked');
  }, [canWrite]);

  const stopRecording = useCallback(async (send: boolean) => {
    if (!canWrite() || !voiceCapture.current || voiceStopAttempt.current || audioSendAttempt.current) return;
    const capture = voiceCapture.current;
    const attempt = {}; voiceStopAttempt.current = attempt;
    try {
      const result = await recorder.stop();
      if (!canWrite() || voiceCapture.current !== capture) return;
      if (!result) { resetRecording(); return; }
      setDraft(result); setRecordingMode('draft');
      if (send) await uploadAndSendAudio(result.uri, result.durationSeconds);
    } finally {
      if (voiceStopAttempt.current === attempt) voiceStopAttempt.current = null;
    }
  }, [canWrite, recorder, resetRecording, uploadAndSendAudio]);
  const stopRecordingToDraft = useCallback(() => stopRecording(false), [stopRecording]);
  const finishHeldRecording = useCallback(() => stopRecording(true), [stopRecording]);
  const sendDraft = useCallback(async () => {
    if (canWrite() && draft) await uploadAndSendAudio(draft.uri, draft.durationSeconds);
  }, [canWrite, draft, uploadAndSendAudio]);
  const pauseResumeRecording = useCallback(() => {
    if (!canWrite() || !voiceCapture.current || voiceStopAttempt.current || audioSendAttempt.current) return;
    if (recorder.status === 'paused') recorder.resume(); else recorder.pause();
  }, [canWrite, recorder]);

  // Resolve a released hold from the final finger translation.
  const endHoldGesture = useCallback((translationX: number, translationY: number) => {
    if (translationY < -VOICE_LOCK_THRESHOLD) lockRecording();
    else if (translationX < -VOICE_CANCEL_THRESHOLD) cancelRecording();
    else finishHeldRecording();
  }, [lockRecording, cancelRecording, finishHeldRecording]);

  // Quick tap on the morph button: send when there's text; otherwise it's a
  // no-op hint (voice messages are hold-to-record).
  const handleMorphTap = useCallback(() => {
    if (hasText) { handleSend(); return; }
    hapticLight();
  }, [hasText, handleSend]);

  // Screen readers and keyboards cannot perform the physical hold/swipe. An
  // empty activation opens the existing hands-free controls; it never sends.
  const activateComposerControl = useCallback(() => {
    if (!canWrite() || composerDraft.draft.attempt || uploading || sendingRef.current || voiceCapture.current ||
        audioSendAttempt.current || voiceStopAttempt.current) return;
    if (inputTextRef.current.trim()) { void handleSend(); return; }
    void beginRecording('locked');
  }, [canWrite, composerDraft.draft.attempt, uploading, handleSend, beginRecording]);
  const composerControlDisabled = !canWrite() || !!composerDraft.draft.attempt || uploading || recordingMode !== 'idle';
  const composerControlLabel = hasText ? editingMessageId ? 'Save edit' : 'Send message' : 'Record voice message';
  const webComposerControlProps = Platform.OS === 'web' ? {
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || (event.key !== 'Enter' && event.key !== ' ')) return;
      event.preventDefault();
      if (!event.repeat) activateComposerControl();
    },
    // DOM clicks handle mouse, touch and assistive activation consistently.
    // Native hold/swipe gestures are disabled on web to avoid double dispatch.
    onClick: () => activateComposerControl(),
  } : {};

  const micGesture = useMemo(() => {
    const tap = Gesture.Tap().enabled(Platform.OS !== 'web').onEnd((_e, success) => {
      if (success) runOnJS(handleMorphTap)();
    });
    const pan = Gesture.Pan()
      .enabled(Platform.OS !== 'web' && !hasText && !composerControlDisabled)
      .activateAfterLongPress(VOICE_HOLD_MS)
      .onStart(() => { runOnJS(beginRecording)(); })
      .onEnd((e) => { runOnJS(endHoldGesture)(e.translationX, e.translationY); });
    return Gesture.Exclusive(pan, tap);
  }, [hasText, composerControlDisabled, handleMorphTap, beginRecording, endHoldGesture]);

  // Smile button toggles the inline emoji panel (same substrate as attachments).
  const handleEmojiToggle = useCallback(() => {
    if (!canWrite() || useSystemEmoji) return;
    if (activePanel === 'emoji') {
      textInputRef.current?.focus();
    } else {
      setActivePanel('emoji');
      Keyboard.dismiss();
    }
  }, [activePanel, useSystemEmoji, canWrite]);

  // Cursor position in the message input, so emoji insert where the caret is.
  const textInputRef = useRef<TextInput>(null);
  const selectionRef = useRef({ start: 0, end: 0 });
  const insertEmoji = useCallback((emoji: string) => {
    if (!canWrite()) return;
    draftRevision.current++;
    setInputText((prev) => {
      const s = Math.min(selectionRef.current.start, prev.length);
      const e = Math.min(selectionRef.current.end, prev.length);
      const caret = s + emoji.length;
      selectionRef.current = { start: caret, end: caret };
      const next = prev.slice(0, s) + emoji + prev.slice(e);
      inputTextRef.current = next;
      return next;
    });
  }, [canWrite]);
  // Replace the partial "@query" at the caret with the full "@Name " and close
  // the autocomplete. The selected member ID travels with the exact text range.
  const focusMention = useChatMentionFocus(textInputRef, canWrite);
  const insertMention = useCallback((member: { id: string; first_name: string | null }) => {
    if (!canWrite()) return;
    if (!member.first_name || !members.some(candidate => candidate.id === member.id && candidate.first_name === member.first_name)) return;
    const before = inputTextRef.current;
    const caret = Math.max(0, Math.min(selectionRef.current.start, before.length));
    if (mentionQueryAt(before, caret) === null) return;
    const start = before.slice(0, caret).lastIndexOf('@');
    const inserted = insertMentionAt(before, caret, member.first_name);
    let mentions;
    try { mentions = addChatMentionReference(inserted.text, composerDraft.draft.mentions ?? null, member.id, member.first_name, start); } catch { return; }
    draftRevision.current++;
    selectionRef.current = { start: inserted.caret, end: inserted.caret };
    inputTextRef.current = inserted.text;
    changeDraft({ text: inserted.text, mentions });
    setMentionQuery(null);
    focusMention(inserted.caret);
  }, [canWrite, focusMention, members, composerDraft.draft.mentions, changeDraft]);

  const handleEmojiBackspace = useCallback(() => {
    if (!canWrite()) return;
    draftRevision.current++;
    setInputText((prev) => {
      const s = Math.min(selectionRef.current.start, prev.length);
      const e = Math.min(selectionRef.current.end, prev.length);
      if (s !== e) {
        selectionRef.current = { start: s, end: s };
        return prev.slice(0, s) + prev.slice(e);
      }
      if (s <= 0) return prev;
      // Delete one whole code point so a surrogate-pair emoji clears in one tap.
      const head = Array.from(prev.slice(0, s));
      head.pop();
      const newHead = head.join('');
      selectionRef.current = { start: newHead.length, end: newHead.length };
      const next = newHead + prev.slice(e);
      inputTextRef.current = next;
      return next;
    });
  }, [canWrite]);

  // Send a GIF: the Giphy URL goes straight in as the image_url (no upload), and
  // the existing image bubble renders + autoplays it via expo-image. A dedicated
  // 'gif' message_type (for chat-list preview text) is deferred to the pre-flip
  // migration batch.
  const sendGif = useCallback(async (url: string) => {
    if (!canWrite() || gifAttempt.current) return;
    const attempt = {}; gifAttempt.current = attempt;
    const isCurrent = () => canWrite() && gifAttempt.current === attempt;
    const sendScope = { ...entryScope, isCurrent };
    let sendId = gifPendingIds.current.get(url);
    if (!sendId) { sendId = Crypto.randomUUID(); gifPendingIds.current.set(url, sendId); }
    setActivePanel(null); setAlertInfo(null);
    const scrollIntentIsCurrent = captureScrollIntent();
    try {
      const sent = await requestWithDeadline(sendMessage('', url, undefined, sendId, sendScope), 25_000);
      if (!isCurrent()) return;
      if (!sent) throw Error('GIF delivery is unconfirmed.');
      gifPendingIds.current.delete(url);
      if (scrollIntentIsCurrent()) scrollToBottom();
    } catch {
      if (isCurrent()) setAlertInfo({
        title: 'GIF not confirmed',
        message: 'Your selection is kept. Retry sends the same GIF without adding a second message.',
        buttons: [
          { text: 'Try again', onPress: () => { if (canWrite()) void sendGif(url); } },
          { text: 'Close', style: 'cancel' },
        ],
      });
    } finally {
      if (gifAttempt.current === attempt) gifAttempt.current = null;
    }
  }, [canWrite, sendMessage, scrollToBottom, captureScrollIntent, entryScope]);

  // Pick first, then preserve the selected batch/caption through explicit retry.
  const doPhotoAction = useCallback(async (choice: 'camera' | 'library') => {
    if (!canWrite() || photoPickerAttempt.current || photoSendingRef.current) return;
    const attempt = {}; photoPickerAttempt.current = attempt;
    try {
      if (choice === 'camera') {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (!canWrite()) return;
        if (status !== 'granted') {
          setAlertInfo({ title: 'Camera access needed', message: 'Please allow camera access in Settings to take photos.' });
          return;
        }
      }
      const result = choice === 'camera'
        ? await ImagePicker.launchCameraAsync({ quality: 0.8 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: PHOTO_BATCH_LIMIT, quality: 0.8 });
      if (!canWrite() || result.canceled || !result.assets?.length) return;
      photoSendSessionRef.current = new PhotoSendSession(() => Crypto.randomUUID());
      photoCaptionSentRef.current = false;
      setPhotoError(null);
      setPendingPhotos(result.assets);
      setPhotoPreviewOpen(true);
    } catch {
      if (canWrite()) setAlertInfo({ title: 'Photos could not open', message: 'Please try again.' });
    } finally {
      if (photoPickerAttempt.current === attempt) photoPickerAttempt.current = null;
    }
  }, [canWrite]);

  const sendPhotos = useCallback(async (caption: string) => {
    if (!canWrite() || photoSendingRef.current) return;
    const assets = pendingPhotos;
    if (assets.length === 0) return;
    if (!photoCaptionSentRef.current && !photoSendSessionRef.current.hasCaption(assets[0].uri)) {
      const allowed = checkContent(caption);
      if (!allowed.ok) { setPhotoError(allowed.reason ?? 'Please revise your caption.'); return; }
    }
    const attempt = {}; photoSendingRef.current = attempt;
    setUploading(true);
    setPhotoError(null);
    const attemptScope = { userId: currentUserId, isCurrent: () => photoSendingRef.current === attempt && canWrite() };
    const requireAttempt = () => { if (!attemptScope.isCurrent()) throw new Error('Photo attempt ended'); };
    const session = photoSendSessionRef.current;
    const alreadyCaptioned = photoCaptionSentRef.current;
    const scrollIntentIsCurrent = captureScrollIntent();
    try {
      await sendPhotoBatch(assets, async (asset) => {
        requireAttempt();
        const cachedUrl = session.uploadedUrl(asset.uri);
        if (cachedUrl) return cachedUrl;
        const manipulated = await requestWithDeadline(ImageManipulator.manipulateAsync(
          asset.uri, [{ resize: { width: 1200 } }],
          { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG, base64: true }), 12_000);
        requireAttempt();
        if (!manipulated.base64) throw new Error('Could not prepare photo');
        const fileName = `${currentUserId}/${session.idFor(asset.uri)}.jpg`;
        const url = await requestWithDeadline(uploadBase64ToStorage('chat-images', fileName, manipulated.base64, { existingIsSuccess: true }), 30_000);
        requireAttempt();
        session.rememberUploadedUrl(asset.uri, url);
        return url;
      }, async (messageCaption, url, asset) => {
        requireAttempt();
        const originalCaption = session.captionFor(asset.uri, messageCaption);
        const sent = await requestWithDeadline(sendMessage(originalCaption, url, undefined, session.idFor(asset.uri), attemptScope), 25_000);
        requireAttempt();
        return sent;
      }, caption, alreadyCaptioned);
      if (!canWrite()) return;
      setPendingPhotos([]); setPhotoPreviewOpen(false);
      photoCaptionSentRef.current = false;
      session.clear(); if (scrollIntentIsCurrent()) scrollToBottom();
    } catch (error) {
      if (!canWrite()) return;
      const failure = error as PhotoBatchFailure;
      if (failure.sentCount > 0) {
        setPendingPhotos(assets.slice(failure.sentCount));
        photoCaptionSentRef.current = true;
      }
      setPhotoError(session.hasCaption(assets[failure.sentCount]?.uri)
        ? 'Delivery isn’t confirmed. Retry keeps the same photos and original caption.'
        : 'Couldn’t finish sending. Your remaining photos are here. Try again.');
    } finally {
      if (photoSendingRef.current === attempt) {
        photoSendingRef.current = null;
        if (canWrite()) setUploading(false);
      }
    }
  }, [pendingPhotos, currentUserId, sendMessage, scrollToBottom, captureScrollIntent, canWrite, requireEntry, entryScope]);

  const handleLocationConfirm = useCallback(async (latitude: number, longitude: number, address: string) => {
    if (!canWrite() || locationAttempt.current) return false;
    const attempt = {}; locationAttempt.current = attempt;
    const attemptScope = { userId: entryScope.userId, isCurrent: () => canWrite() && locationAttempt.current === attempt };
    const pin = JSON.stringify({ latitude, longitude, address });
    if (!locationSession.current || locationSession.current.pin !== pin) {
      locationSession.current = { pin, sendId: Crypto.randomUUID() };
    }
    const session = locationSession.current;
    const scrollIntentIsCurrent = captureScrollIntent();
    try {
      const confirmed = await requestWithDeadline(sendLocation(latitude, longitude, address, attemptScope, session.sendId), 25_000);
      if (!attemptScope.isCurrent()) return false;
      if (confirmed) { locationSession.current = null; setLocationPickerOpen(false); if (scrollIntentIsCurrent()) scrollToBottom(); }
      return confirmed;
    } catch {
      return false; // The existing preview retains its pin and presents inline retry.
    } finally {
      if (locationAttempt.current === attempt) locationAttempt.current = null;
    }
  }, [sendLocation, scrollToBottom, captureScrollIntent, canWrite, entryScope]);

  const composerInputHeight = useChatInputHeight(textInputRef, inputText, conversationFonts.regular, 100, COMMUNITY_CHAT_GROUPING_ENABLED);
  // Keep iOS native multiline sizing: fixed height can stop Fabric size events.

  // Route an attachment-panel selection. Photos/Camera launch the picker;
  // Location opens the map preview screen. (Document/Poll/Contact were removed.)
  const handleAttachSelect = useCallback((key: AttachmentKey) => {
    if (!canWrite()) return;
    if (key === 'gif') {
      if (!gifsInAttachments) return;
      // Swap the content in the same keyboard-height slot, without dropping
      // its reserved inset between the attachment menu and the GIF grid.
      setActivePanel('gif');
      Keyboard.dismiss();
      return;
    }
    setActivePanel(null);
    if (key === 'camera') {
      doPhotoAction('camera');
    } else if (key === 'photos') {
      doPhotoAction('library');
    } else if (key === 'location') {
      Keyboard.dismiss();
      setLocationPickerOpen(true);
    }
  }, [doPhotoAction, gifsInAttachments, canWrite]);

  // Left input-bar button toggles + <-> keyboard.
  //  - panel closed: open it, THEN dismiss the keyboard. Setting panelInset
  //    first means the unified inset is max(keyboard, panel) throughout the
  //    handoff, so the input bar never drops for a frame.
  //  - panel open: refocus the input; the keyboard-show listener closes the
  //    panel once the keyboard has taken over (again, no inset collapse).
  const handleAttachToggle = useCallback(() => {
    if (!canWrite()) return;
    if (attachmentShowsKeyboard) {
      textInputRef.current?.focus();
    } else {
      // From the emoji panel this just swaps content (keyboard already down).
      setActivePanel('attach');
      Keyboard.dismiss();
    }
  }, [canWrite, attachmentShowsKeyboard]);

  useLayoutEffect(() => {
    inputTextRef.current = ''; draftRevision.current = 0; draftContextRevision.current = 0;
    setMentionQuery(null); setCheckingDraft(false); setSendingText(false);
    selectionRef.current = { start: 0, end: 0 };
    sendingRef.current = null; photoSendingRef.current = null;
    photoPickerAttempt.current = null; gifAttempt.current = null; locationAttempt.current = null; locationSession.current = null; gifPendingIds.current.clear();
    photoSendSessionRef.current = new PhotoSendSession(() => Crypto.randomUUID());
    photoCaptionSentRef.current = false;
    setUploading(false); setPendingPhotos([]); setPhotoPreviewOpen(false);
    setLocationPickerOpen(false); setActivePanel(null);
    setOverlayMessage(null); setReactionDetails(null); setReactionPickerMsgId(null); setPhotoViewUrl(null);
    setAlertInfo(null); setMiniProfileUserId(null); setShowReport(false); setReportTarget(null);
    reportMembersAttempt.current = null; setLoadingReportMembers(false);
    setRecordingMode('idle'); setDraft(null); setAudioSending(false); setAudioError(null); setVoiceDockHeight(0);
    voiceCapture.current = null; voiceStopAttempt.current = null; audioSendAttempt.current = null; audioSession.current = null;
  }, [entry]);
  useLayoutEffect(() => {
    if (!isPast) return;
    setActivePanel(null); setLocationPickerOpen(false); setPhotoPreviewOpen(false);
    setPendingPhotos([]); setUploading(false); setOverlayMessage(null); setReactionDetails(null); setReactionPickerMsgId(null);
    setRecordingMode('idle'); setDraft(null); setAudioSending(false); setAudioError(null); setVoiceDockHeight(0);
    voiceCapture.current = null; voiceStopAttempt.current = null; audioSendAttempt.current = null; audioSession.current = null;
  }, [isPast]);

  type EnrichedItem = ChatMessage | { type: 'date'; label: string; id: string } | { type: 'time'; label: string; id: string };
  const enrichedItems = useMemo<EnrichedItem[]>(() => {
    const items: EnrichedItem[] = [];
    messages.forEach((msg, i) => {
      const prev = messages[i - 1];
      if (!prev || !isSameDay(prev.created_at, msg.created_at)) {
        items.push({ type: 'date', label: formatChatDate(msg.created_at), id: `date-${msg.id}` });
      } else if (prev) {
        const gap = new Date(msg.created_at).getTime() - new Date(prev.created_at).getTime();
        if (gap >= 10 * 60 * 1000) {
          items.push({ type: 'time', label: formatMessageTime(msg.created_at), id: `time-${msg.id}` });
        }
      }
      items.push(msg);
    });
    return items.reverse();
  }, [messages]);

  const anchorScroll = useChatAnchorScroll(listRef, anchorId ? `${props.kind}:${id}:${anchorId}` : null,
    anchorId ? enrichedItems.findIndex(item => item.id === anchorId) : -1);

  // Stable callbacks for MessageBubble's memo to actually work -- inline lambdas
  // at the call site would create new function refs every render and break it,
  // which made every keystroke re-render every row (visible Android jank).
  const reactionMessagesRef = useRef(messages);
  reactionMessagesRef.current = messages;
  const handleReaction = useCallback(function react(msgId: string, emoji?: string, retry?: () => Promise<void>) {
    if (!canWrite()) return;
    const message = reactionMessagesRef.current.find(row => row.id === msgId);
    if (!message || message.user_id === currentUserId) return;
    const key = reactionKeyForEmoji(emoji ?? 'heart', topicReactionCounts(message.reactions ?? [], currentUserId), 'heart');
    void (retry ? retry() : toggleReaction(msgId, key, entryScope))?.catch(error => {
      if (!canWrite() || isObsoleteChatOperation(error)) return;
      logError(error, 'chat.reaction');
      setAlertInfo(isUnconfirmedChatReaction(error) ? {
        title: 'Reaction not confirmed', message: error.message, scrollMessage: true,
        buttons: [
          { text: 'Close', style: 'cancel' },
          { text: 'Retry', onPress: () => react(msgId, key, error.retry) },
        ],
      } : { title: 'Reaction not confirmed', message: friendlyError(error, 'Please try again.'), scrollMessage: true });
    });
  }, [toggleReaction, canWrite, currentUserId, entryScope]);
  const openReactionDetails = useCallback((messageId: string) => {
    const isCurrent = () => isCurrentEntry() && reactionMessagesRef.current.some(message => message.id === messageId);
    if (!isCurrent() || !currentUserId) return;
    setReactionDetails({ source: 'chat', messageId, scope: { userId: currentUserId, isCurrent },
      canRemove: canWrite, onChanged: () => { if (isCurrent()) void refetch(); } });
  }, [isCurrentEntry, currentUserId, canWrite, refetch]);
  useEffect(() => { if (reactionDetails && !reactionDetails.scope.isCurrent()) setReactionDetails(null); }, [reactionDetails, messages, entry]);
  const handleAddReaction = useCallback((messageId: string) => { if (canWrite()) setReactionPickerMsgId(messageId); }, [canWrite]);
  // enrichedItems is read via a ref so this callback stays stable across message
  // updates -- depending on enrichedItems directly would re-break the memo every
  // time a new message lands.
  const enrichedItemsRef = useRef(enrichedItems);
  enrichedItemsRef.current = enrichedItems;
  const replyScrollScope = useMemo(() => ({}), [entry, anchorId]);
  const replyScroll = useChatReplyScroll(listRef, replyScrollScope,
    useCallback((msgId: string) => enrichedItemsRef.current.findIndex(item => !('type' in item) && item.id === msgId), []));
  cancelReplyScroll.current = replyScroll.cancel;
  const handleReplyTap = useCallback((msgId: string) => {
    if (!isCurrentEntry()) return;
    anchorScroll.cancel();
    setFollowingLatest(false);
    replyScroll.scrollToMessage(msgId);
  }, [isCurrentEntry, anchorScroll.cancel, setFollowingLatest, replyScroll.scrollToMessage]);
  const handleAvatarPress = useCallback((uid: string) => {
    if (isCurrentEntry()) setMiniProfileUserId(uid);
  }, [isCurrentEntry]);
  const handleTriggerReply = useCallback((msgId: string) => {
    if (!canWrite()) return;
    draftRevision.current++; draftContextRevision.current++;
    const msg = enrichedItemsRef.current.find(
      (item): item is ChatMessage => !('type' in item) && item.id === msgId,
    );
    if (!msg) return;
    changeDraft({ reply: { id: msg.id, content: msg.content, senderName: msg.user_id === currentUserId ? 'You' : msg.sender?.first_name ?? 'Someone' }, edit: null });
    setActivePanel(null);
    requestAnimationFrame(() => { if (canWrite()) textInputRef.current?.focus(); });
  }, [canWrite, changeDraft, currentUserId]);

  const menuReadOnly = useRef(isPast); menuReadOnly.current = isPast;
  const handleMessageLongPress = useCallback((selected: ChatMessage, _ownFlag: boolean) => {
    const currentMessage = () => reactionMessagesRef.current.find(message => message.id === selected.id);
    const menuIsCurrent = () => isCurrentEntry() && menuReadOnly.current === isPast && !!currentMessage();
    const message = currentMessage();
    if (!menuIsCurrent() || !message) return;
    const own = message.user_id === currentUserId;
    const buttons: BrandedAlertButton[] = [];
    if (!own && !isPast) buttons.push({ text: 'react', onPress: () => { if (canWrite() && currentMessage()) setReactionPickerMsgId(message.id); } });
    if (message.message_type === 'user' && !isPast) buttons.push({ text: 'reply', onPress: () => { if (menuIsCurrent()) handleTriggerReply(message.id); } });
    buttons.push({ text: 'copy', onPress: () => {
      if (!menuIsCurrent()) return;
      const latest = currentMessage()!;
      let copyText = latest.content;
      if (latest.image_url) copyText = latest.image_url;
      else if (latest.message_type === 'location') { try { copyText = JSON.parse(latest.content).address ?? latest.content; } catch {} }
      Clipboard?.setStringAsync(copyText).catch(() => {}); hapticLight();
    } });
    if (own && !isPast && message.message_type === 'user' && !message.image_url) buttons.push({ text: 'edit', onPress: () => {
      if (!menuIsCurrent() || !canWrite()) return;
      const latest = currentMessage()!;
      hapticLight(); draftRevision.current++; draftContextRevision.current++;
      const mentions = readChatMentionDocument(latest.content, latest.mention_data);
      changeDraft({ edit: { id: latest.id, content: latest.content, mentions }, reply: null, text: latest.content, mentions });
      inputTextRef.current = latest.content; setActivePanel(null);
      requestAnimationFrame(() => { if (menuIsCurrent() && canWrite()) textInputRef.current?.focus(); });
    } });
    if (own) buttons.push({ text: 'delete', style: 'destructive', onPress: () => {
      if (!menuIsCurrent()) return;
      hapticMedium(); setAlertInfo({ title: 'Delete this message?', message: '', buttons: [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => { if (menuIsCurrent()) void deleteMessage(message.id, moderationScope)?.catch(error => { if (isCurrentEntry()) logError(error, 'chat.deleteMessage'); }); } },
      ] });
    } });
    setOverlayMessage({ title: message.sender?.first_name ?? 'Someone', own, buttons,
      preview: message.image_url ? 'Photo' : message.message_type === 'location' ? 'Shared place' : message.message_type === 'audio' ? 'Voice message' : message.content,
      selectedReaction: reactionEmoji(message.reactions?.find(reaction => reaction.user_id === currentUserId)?.reaction ?? ''),
      onReact: !own && !isPast ? emoji => { if (menuIsCurrent()) { hapticLight(); handleReaction(message.id, emoji); } } : undefined,
      isCurrent: menuIsCurrent,
    });
  }, [isCurrentEntry, isPast, currentUserId, canWrite, handleTriggerReply, changeDraft, deleteMessage, moderationScope, handleReaction]);
  useEffect(() => { if (overlayMessage && !overlayMessage.isCurrent()) setOverlayMessage(null); }, [overlayMessage, messages, isPast]);

  // Stable renderItem. An inline arrow in the FlatList changes identity every
  // render, so the list re-renders every visible row on ANY state change (opening
  // the + menu, toggling a panel, typing) -- the synchronous main-thread work that
  // widens the iOS keyboard task-queue deadlock window. Memoized here so a control
  // press no longer re-renders the message list. Recreates only when the data or a
  // row dependency actually changes.
  const renderMessage = useCallback(
    ({ item, index }: { item: EnrichedItem; index: number }) => {
      if ('type' in item && (item.type === 'date' || item.type === 'time')) {
        return (
          <View style={bubbleStyles.systemRow}>
            <Text style={[bubbleStyles.systemText, screenAppearance?.day]}>{item.label}</Text>
          </View>
        );
      }

      const msg = item as ChatMessage;
      const isOwn = msg.user_id === currentUserId;

      // In inverted list: index-1 = newer in time, index+1 = older in time
      const newerItem = enrichedItems[index - 1];
      const newerMsg = newerItem && !('type' in newerItem) ? (newerItem as ChatMessage) : null;
      const olderItem = enrichedItems[index + 1];
      const olderMsg = olderItem && !('type' in olderItem) ? (olderItem as ChatMessage) : null;

      // System rows (the join line) carry the actor's user_id, so raw
      // user_id equality made a member's first real message after joining
      // count as grouped and hid their name label. Only user-authored
      // bubbles participate in grouping, on either side.
      const groupsWith = (other: ChatMessage | null) =>
        !!other && other.message_type !== 'system' && msg.message_type !== 'system' &&
        other.user_id === msg.user_id && isSameDay(other.created_at, msg.created_at) &&
        Math.abs(new Date(other.created_at).getTime() - new Date(msg.created_at).getTime()) <= 5 * 60 * 1000;
      const isGroupedWithOlder = groupsWith(olderMsg);
      const isGroupedWithNewer = groupsWith(newerMsg);

      const showAvatar = !isOwn && !isGroupedWithNewer;
      const showName = !isOwn && !isGroupedWithOlder;

      const gap = isGroupedWithOlder ? chatStyles.msgGap1
        : !COMMUNITY_CHAT_GROUPING_ENABLED && msg.reactions?.length ? chatStyles.msgGap18
        : chatStyles.msgGap10;

      return (
        <View onLayout={msg.id === anchorId ? anchorScroll.onTargetLayout : undefined}
          style={msg.id === anchorId ? { backgroundColor: Colors.goldBadgeSoft } : undefined}>
        <SwipeableRow
          containerStyle={gap}
          enabled={!isPast && msg.message_type === 'user'}
          messageId={msg.id}
          onTriggerReply={handleTriggerReply}
        >
          <MessageBubble
            message={msg}
            isOwn={isOwn}
            showAvatar={showAvatar}
            showName={showName}
            isGrouped={isGroupedWithNewer}
            currentUserId={currentUserId}
            contextTitle={props.contextTitle}
            onPhotoPress={openMessagePhoto}
            photoMaxWidth={Math.min(240, (windowWidth - 72) * 0.8)}
            conversationFonts={conversationFonts}
            onReaction={handleReaction}
            onAddReaction={handleAddReaction}
            onViewReactions={openReactionDetails}
            reactionsDisabled={isPast}
            onMessageLongPress={handleMessageLongPress}
            onStartReply={!isPast ? handleTriggerReply : undefined}
            onReplyTap={handleReplyTap}
            onAvatarPress={handleAvatarPress}
            mentionNames={mentionNames}
          />
        </SwipeableRow>
        </View>
      );
    },
    [anchorId, anchorScroll.onTargetLayout, currentUserId, enrichedItems, isPast, props.contextTitle, handleReaction, handleAddReaction, openReactionDetails, screenAppearance, handleMessageLongPress, handleReplyTap, handleAvatarPress, handleTriggerReply, mentionNames, openMessagePhoto, conversationFonts, windowWidth],
  );

  return (
    <View style={[chatStyles.screen, screenAppearance?.screen]}>
      {/* ── Header ── */}
      <ChatThreadHeader
        thread={props} typingLabel={typingLabel} conversationFonts={conversationFonts} topInset={insets.top}
        plusBtnRef={plusBtnRef} openPlusFromButton={openPlusFromButton}
        handleReportMenu={handleReportMenu} loadingReportMembers={loadingReportMembers}
        members={members} membersExpanded={membersExpanded} setMembersExpanded={setMembersExpanded}
        handleAvatarPress={handleAvatarPress}
        onBack={() => { Keyboard.dismiss(); router.navigate('/(tabs)/chats' as never); }}
      />

      {showPushBanner && (
        <View style={chatStyles.pushBanner}>
          <View style={chatStyles.pushBannerContent}>
            <ChatSizedText style={chatStyles.pushBannerText} accessibilityLiveRegion="polite">
              {pushFeedback ?? 'Get alerts for new messages.'}
            </ChatSizedText>
            <TouchableOpacity
              style={chatStyles.pushBannerButton}
              onPress={() => { void handleEnablePush(); }}
              disabled={enablingPush}
              accessibilityRole="button"
              accessibilityState={{ disabled: enablingPush, busy: enablingPush }}
              activeOpacity={0.85}
            >
              <ChatSizedText style={chatStyles.pushBannerButtonText}>{enablingPush ? 'Turning on…' : 'Enable'}</ChatSizedText>
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            onPress={handleDismissPushBanner}
            accessibilityRole="button"
            accessibilityLabel="Dismiss notification reminder"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={chatStyles.pushBannerClose}
          >
            <Ionicons name="close" size={14} color={Colors.textLight} />
          </TouchableOpacity>
        </View>
      )}

      {/* iOS viewport and dock follow the same native keyboard animation.
          The inverted list reserves the measured dock height separately. */}
      <View style={chatStyles.listWrap}>
        {anchorId && <ChatMessageAnchorNotice loading={loading} unavailable={anchorUnavailable} failed={loadError}
          onLatest={clearAnchor} fonts={conversationFonts} />}
        {loadError && messages.length > 0 && !loading && (
          <TouchableOpacity style={[chatStyles.loadWarning, screenAppearance?.warning]} onPress={() => { void refetch(true); }} accessibilityRole="button" accessibilityLabel="Messages may be out of date. Retry loading">
            <Text style={[chatStyles.loadWarningText, screenAppearance?.body]}>Messages may be out of date · Tap to retry</Text>
          </TouchableOpacity>
        )}
        <MessageViewport testID="chat-message-viewport" style={{ flex: 1 }} {...(Platform.OS === 'ios' ? { inset: iosDockFloor } : {})}>
        {loading && messages.length === 0 ? (
          <View style={chatStyles.loadingWrap}>
            <ActivityIndicator size="large" color={COMMUNITY_CHAT_GROUPING_ENABLED ? AfterglowColors.clay : Colors.terracotta} />
          </View>
        ) : loadError && messages.length === 0 ? (
          <View style={chatStyles.loadErrorWrap}>
            <Text style={[chatStyles.loadErrorTitle, screenAppearance?.title]}>Messages couldn't load</Text>
            <Text style={[chatStyles.loadErrorText, screenAppearance?.body]}>Your conversation is still here. Check your connection and try again.</Text>
            <TouchableOpacity style={[chatStyles.loadRetry, screenAppearance?.button]} onPress={() => { void refetch(); }} accessibilityRole="button" accessibilityLabel="Retry loading messages">
              <CreatorActionFill /><Text style={[chatStyles.loadRetryText, screenAppearance?.buttonText]}>Try again</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <FlatList
            key={anchorId ?? 'latest'}
            decelerationRate="normal"
            ref={listRef}
            data={enrichedItems}
            keyExtractor={item => item.id}
            inverted={true}
            accessibilityElementsHidden={bottomDockHeight === null}
            importantForAccessibility={bottomDockHeight === null ? 'no-hide-descendants' : 'auto'}
            pointerEvents={bottomDockHeight === null ? 'none' : 'auto'}
            style={[
              { flex: 1, opacity: bottomDockHeight === null ? 0 : 1 },
            ]}
            contentContainerStyle={{ paddingBottom: 12, paddingTop: listBottomReservation }}
            showsVerticalScrollIndicator={false}
            removeClippedSubviews={Platform.OS === 'android'}
            automaticallyAdjustContentInsets={false}
            contentInsetAdjustmentBehavior="never"
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            keyboardShouldPersistTaps="handled"
            initialNumToRender={20}
            windowSize={10}
            maxToRenderPerBatch={15}
            maintainVisibleContentPosition={followingLatest && !anchorId ? undefined : { minIndexForVisible: 0 }}
            onLayout={() => {
              if (!isCurrentEntry()) return;
              if (anchorId) anchorScroll.schedule();
              else if (atBottomRef.current) listRef.current?.scrollToOffset({ offset: 0, animated: false });
            }}
            onContentSizeChange={() => {
              if (!isCurrentEntry()) return;
              if (anchorId) anchorScroll.schedule();
              else if (atBottomRef.current) listRef.current?.scrollToOffset({ offset: 0, animated: false });
            }}
            onScrollBeginDrag={() => {
              if (!isCurrentEntry()) return;
              scrollFollow.onScrollBeginDrag(); anchorScroll.cancel(); replyScroll.cancel();
            }}
            onScrollEndDrag={event => { if (isCurrentEntry()) scrollFollow.onScrollEndDrag(event); }}
            onMomentumScrollBegin={() => { if (isCurrentEntry()) scrollFollow.onMomentumScrollBegin(); }}
            onMomentumScrollEnd={event => { if (isCurrentEntry()) scrollFollow.onMomentumScrollEnd(event); }}
            onScroll={handleListScroll}
            onEndReached={() => { void loadOlder(); }}
            onEndReachedThreshold={0.2}
            scrollEventThrottle={16}
            // Inverted list: the header renders at the visual bottom (newest
            // side), so the typing dots sit just above the input bar.
            ListHeaderComponent={typingUsers.length > 0 ? <TypingIndicator /> : null}
            onScrollToIndexFailed={(info) => {
              if (!isCurrentEntry()) return;
              anchorScroll.onScrollToIndexFailed(info);
              replyScroll.onScrollToIndexFailed(info);
            }}
            ListEmptyComponent={anchorUnavailable ? null :
              <View style={chatStyles.emptyState}>
                {/* Line-drawn sunrise mark (no emoji, ever): a beginning, gold,
                    fading in. Same family as the Yours tab sunrise glyph. */}
                <Animated.View entering={FadeIn.duration(400)} style={chatStyles.emptyMark}>
                  <SunriseIcon size={36} color={Colors.gold} strokeWidth={1.75} />
                </Animated.View>
                <Text style={[chatStyles.emptyText, screenAppearance?.body]}>{props.emptyText ?? 'Say hi to everyone!'}</Text>
              </View>
            }
            ListFooterComponent={olderLoadError || props.renderPinnedFooter ? (
              <View>
                {olderLoadError && (
                  <TouchableOpacity style={[chatStyles.olderRetry, screenAppearance?.textAction]} onPress={() => { void loadOlder(true); }} accessibilityRole="button" accessibilityLabel="Retry loading older messages">
                    <Text style={[chatStyles.olderRetryText, screenAppearance?.link]}>Couldn't load older messages · Try again</Text>
                  </TouchableOpacity>
                )}
                {props.renderPinnedFooter?.()}
              </View>
            ) : null}
            renderItem={renderMessage}
          />
        )}
        </MessageViewport>

        {/* Input bar -- absolutely positioned so the FlatList can span the
            full KAV area. The measured height is reserved via paddingTop
            on the inverted list's contentContainerStyle, which guarantees
            new messages are never obscured by the bar on any screen size. */}
        {isPast ? (
          <InputBarWrapper
            {...(Platform.OS === 'ios' ? { inset: iosDockFloor } : {})}
            style={[
              chatStyles.readOnlyBar,
              {
                position: 'absolute',
                left: 0,
                right: 0,
                paddingBottom: inputBarBottomPadding,
                paddingLeft: Math.max(insets.left, 20),
                paddingRight: Math.max(insets.right, 20),
              },
              composerAppearance?.tray,
              inputBarBottomStyle,
            ]}
            testID="chat-bottom-dock"
            onLayout={onDockLayout}
          >
            <Text style={[chatStyles.readOnlyText, composerAppearance?.metadata]}>{props.readOnly?.text ?? ''}</Text>
          </InputBarWrapper>
        ) : (
          <InputBarWrapper
            {...(Platform.OS === 'ios' ? { inset: iosDockFloor } : {})}
            style={[
              {
                position: 'absolute',
                left: 0,
                right: 0,
                backgroundColor: Colors.white,
                minHeight: recordingMode !== 'idle' ? voiceDockHeight : 0,
              },
              composerAppearance?.tray,
              inputBarBottomStyle,
            ]}
            testID="chat-bottom-dock"
            onLayout={onDockLayout}
          >
            {props.countdownText != null && (
              <Text style={[chatStyles.countdownText, composerAppearance?.tray, composerAppearance?.metadata]}>
                {props.countdownText}
              </Text>
            )}
            <ChatComposerContext
              composerDraft={composerDraft}
              composerAppearance={composerAppearance}
              sendingText={sendingText}
              checkingDraft={checkingDraft}
              writable={canWrite()}
              replyingTo={replyingTo}
              editingMessageId={editingMessageId}
              onRetryDraft={() => { void composerDraft.retry(); }}
              onCheckOriginal={() => { void checkPendingDraft(); }}
              onRetryOriginal={() => { void handleSend(true); }}
              onCancelReply={() => { if (!canWrite()) return; draftRevision.current++; draftContextRevision.current++; setReplyingTo(null); }}
              onCancelEdit={() => { if (!canWrite()) return; draftRevision.current++; draftContextRevision.current++; setEditingMessageId(null); setInputText(''); inputTextRef.current = ''; }}
            />
            {mentionQuery !== null && <ChatMentionPicker members={mentionCandidates} fonts={conversationFonts}
              onSelect={insertMention} onClose={()=>{if(canWrite())setMentionQuery(null);}}/>}
          <View
            accessibilityElementsHidden={recordingMode !== 'idle'}
            importantForAccessibility={recordingMode !== 'idle' ? 'no-hide-descendants' : 'auto'}
            aria-hidden={recordingMode !== 'idle'}
            style={[
              chatStyles.inputBar,
              composerAppearance?.bar,
              Platform.OS === 'android'
                ? {
                    paddingBottom: inputBarBottomPadding,
                    paddingLeft: Math.max(insets.left, 12) + 12,
                    paddingRight: Math.max(insets.right, 12) + 12,
                  }
                : { paddingBottom: inputBarBottomPadding },
            ]}
          >
            <TouchableOpacity
              onPress={handleAttachToggle}
              style={[chatStyles.cameraBtn, composerAppearance?.utility]}
              disabled={uploading || recordingMode !== 'idle'}
              accessibilityRole="button"
              accessibilityLabel={attachmentShowsKeyboard ? 'Show keyboard' : 'Add attachment'}
            >
              {uploading ? (
                <ActivityIndicator size="small" color={composerAppearance ? AfterglowColors.muted : Colors.warmGray} />
              ) : attachmentShowsKeyboard ? (
                // Deliberate single-family exception: Ionicons has no keyboard
                // glyph (only keypad/dialpad), so the keyboard toggle uses
                // MaterialIcons. Every other input-bar icon stays Ionicons.
                <MaterialIcons name="keyboard" size={26} color={composerAppearance ? AfterglowColors.muted : Colors.warmGray} />
              ) : (
                <Ionicons name="add-circle-outline" size={26} color={composerAppearance ? AfterglowColors.muted : Colors.warmGray} />
              )}
            </TouchableOpacity>

            {/* Staged mobile uses the OS keyboard's emoji key. Web and the
                legacy composer retain the in-app emoji entry. */}
            {!useSystemEmoji && <TouchableOpacity
              onPress={handleEmojiToggle}
              style={[chatStyles.emojiBtn, composerAppearance?.utility]}
              disabled={uploading || recordingMode !== 'idle'}
              accessibilityRole="button"
              accessibilityLabel={activePanel === 'emoji' ? 'Show keyboard' : 'Open emoji picker'}
            >
              {activePanel === 'emoji' ? (
                <MaterialIcons name="keyboard" size={24} color={composerAppearance ? AfterglowColors.clay : Colors.terracotta} />
              ) : (
                <Ionicons name="happy-outline" size={24} color={composerAppearance ? AfterglowColors.clay : Colors.terracotta} />
              )}
            </TouchableOpacity>}

            <TextInput
              ref={textInputRef}
              style={[chatStyles.input, composerAppearance?.input, composerAppearance && { height: Platform.OS === 'ios' ? undefined : composerInputHeight.inputHeight }]}
              value={inputText}
              onContentSizeChange={composerAppearance ? composerInputHeight.onContentSizeChange : undefined}
              onLayout={composerAppearance ? composerInputHeight.measureWebInput : undefined}
              editable={recordingMode === 'idle' && composerDraft.ready && !composerDraft.error}
              tabIndex={recordingMode === 'idle' ? 0 : -1}
              onChangeText={handleInputChange}
              onSelectionChange={(e) => {
                if (!canWrite()) return;
                selectionRef.current = e.nativeEvent.selection;
                setMentionQuery(mentionQueryAt(inputTextRef.current, e.nativeEvent.selection.start));
              }}
              placeholder="Message..."
              placeholderTextColor={composerAppearance ? AfterglowColors.muted : Colors.warmGray}
              multiline
              numberOfLines={composerAppearance && Platform.OS === 'web' ? 1 : undefined}
              textAlignVertical="top"
              maxLength={1000}
              returnKeyType="default"
              keyboardType="default"
              autoCorrect={true}
              spellCheck={true}
              autoCapitalize="sentences"
              inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
              // Disable autofill so the Android IME's suggestion / spell-check
              // strip isn't suppressed on multiline inputs (Samsung & Gboard
              // both hide suggestions when autofill is active on a multiline).
              autoComplete="off"
              importantForAutofill="no"
              textContentType="none"
            />

            <GestureDetector gesture={micGesture}>
              <Animated.View
                style={[chatStyles.sendMorphWrap, composerAppearance?.morph, composerControlDisabled && { opacity: 0.45 }]}
                accessible={recordingMode === 'idle'}
                accessibilityRole="button"
                accessibilityLabel={composerControlLabel}
                accessibilityHint={hasText ? undefined : 'Starts recording. Use the controls to pause, stop or discard before sending.'}
                accessibilityState={{ disabled: composerControlDisabled }}
                accessibilityElementsHidden={recordingMode !== 'idle'}
                importantForAccessibility={recordingMode === 'idle' ? 'yes' : 'no-hide-descendants'}
                aria-hidden={recordingMode !== 'idle'}
                aria-disabled={composerControlDisabled}
                focusable={!composerControlDisabled}
                tabIndex={composerControlDisabled ? -1 : 0}
                onAccessibilityTap={activateComposerControl}
                accessibilityActions={[{ name: 'activate', label: composerControlLabel }]}
                onAccessibilityAction={event => { if (event.nativeEvent.actionName === 'activate') activateComposerControl(); }}
                {...webComposerControlProps}
              >
                <Animated.View style={[chatStyles.morphLayer, chatStyles.sendCircle, composerAppearance?.layer, composerAppearance?.send, sendLayerStyle]}>
                  <CreatorActionFill />
                  <Ionicons name="arrow-up" size={SEND_ARROW_ICON_SIZE} color={Colors.white} />
                </Animated.View>
                <Animated.View style={[chatStyles.morphLayer, composerAppearance?.layer, micLayerStyle]}>
                  <Ionicons name="mic" size={SEND_MIC_ICON_SIZE} color={composerAppearance ? AfterglowColors.clay : Colors.terracotta} />
                </Animated.View>
              </Animated.View>
            </GestureDetector>
          </View>

          {recordingMode !== 'idle' && (
            <View
              style={[chatStyles.recorderOverlay, composerAppearance?.tray, { paddingBottom: inputBarBottomPadding }]}
              pointerEvents={recordingMode === 'holding' ? 'none' : 'auto'}
              onLayout={(event: LayoutChangeEvent) => setVoiceDockHeight(event.nativeEvent.layout.height)}
            >
              {!!audioError && <Text accessibilityRole="alert" style={[chatStyles.replyBarText, composerAppearance?.contextBody, { paddingHorizontal: 16, paddingTop: 8 }]}>{audioError}</Text>}
              <VoiceRecorder
                mode={recordingMode as RecorderUiMode}
                durationMillis={recorder.durationMillis}
                meterings={recorder.meterings}
                isPaused={recorder.status === 'paused'}
                draftUri={draft?.uri ?? null}
                draftDuration={draft?.durationSeconds ?? 0}
                sending={audioSending}
                retryAvailable={!!audioError}
                appearance={COMMUNITY_CHAT_GROUPING_ENABLED ? { fonts: conversationFonts } : undefined}
                onTrash={cancelRecording}
                onPauseResume={pauseResumeRecording}
                onStop={stopRecordingToDraft}
                onSend={recordingMode === 'draft' ? sendDraft : finishHeldRecording}
              />
            </View>
          )}
          </InputBarWrapper>
        )}

        <ScrollToBottomButton
          visible={showScrollBtn}
          count={unreadBelow}
          bottomOffset={scrollBtnBottom}
          onPress={handleScrollToBottomPress}
        />

        {/* Inline panel: sits in the keyboard's footprint at the screen bottom;
            the input bar (offset by panelInset) floats above it. Attachment or
            emoji share the same slot. */}
        {panelOpen && (
          <View style={chatStyles.attachPanelWrap}>
            {activePanel === 'attach' ? (
              <AttachmentPanel
                onSelect={handleAttachSelect}
                height={panelHeight}
                bottomInset={insets.bottom}
                appearance={COMMUNITY_CHAT_GROUPING_ENABLED ? { fonts: conversationFonts } : undefined}
                showGif={gifsInAttachments}
              />
            ) : (
              <MediaPanel
                onSelect={insertEmoji}
                onBackspace={handleEmojiBackspace}
                onGifSelect={sendGif}
                height={panelHeight}
                bottomInset={insets.bottom}
                appearance={COMMUNITY_CHAT_GROUPING_ENABLED ? { fonts: conversationFonts } : undefined}
                mode={activePanel === 'gif' ? 'gif-only' : undefined}
              />
            )}
          </View>
        )}
      </View>

      {/* Report user modal */}
      {reportTarget && (
        <ReportModal
          visible={showReport}
          onClose={() => { if (isCurrentEntry()) setShowReport(false); }}
          scope={currentUserId ? moderationScope : null}
          reportedUserId={reportTarget.id}
          reportedUserName={reportTarget.name}
          eventId={props.reportEventId}
        />
      )}

      <LocationPickerModal
        key={`location:${entry.serial}`}
        retryPreservesMessage
        visible={locationPickerOpen}
        onClose={() => { if (canWrite()) setLocationPickerOpen(false); }}
        onConfirm={handleLocationConfirm}
      />

      <PhotoPreviewModal
        key={`photos:${entry.serial}`}
        visible={photoPreviewOpen}
        assets={pendingPhotos}
        sending={uploading}
        captionSent={photoCaptionSentRef.current}
        captionLocked={!!pendingPhotos[0] && photoSendSessionRef.current.hasCaption(pendingPhotos[0].uri)}
        errorMessage={photoError}
        onCancel={() => { if (!canWrite() || photoSendingRef.current) return; setPhotoPreviewOpen(false); setPendingPhotos([]); setPhotoError(null); photoCaptionSentRef.current = false; photoSendSessionRef.current.clear(); }}
        onSend={sendPhotos}
      />

      <ReactionEmojiPicker
        visible={!!reactionPickerMsgId}
        onSelect={(emoji) => {
          const reactionKey = emoji === '❤️' ? 'heart' : emoji;
          if (!canWrite()) return;
          if (reactionPickerMsgId) handleReaction(reactionPickerMsgId, reactionKey);
          setReactionPickerMsgId(null);
        }}
        onClose={() => { if (isCurrentEntry()) setReactionPickerMsgId(null); }}
      />

      {COMMUNITY_CHAT_GROUPING_ENABLED && <ChatPhotoViewer photos={photos} {...photoSelection} fonts={conversationFonts} />}

      {/* Legacy full-screen photo viewer */}
      <Modal visible={!!photoViewUrl} transparent animationType="fade" onRequestClose={() => setPhotoViewUrl(null)} statusBarTranslucent>
        <Pressable style={chatStyles.photoModal} onPress={() => setPhotoViewUrl(null)}>
          {photoViewUrl && (
            <Image source={{ uri: photoViewUrl }} style={chatStyles.photoFull} contentFit="contain" />
          )}
          <TouchableOpacity style={chatStyles.photoClose} onPress={() => setPhotoViewUrl(null)}>
            <Ionicons name="close" size={24} color={Colors.white} />
          </TouchableOpacity>
        </Pressable>
      </Modal>

      <MiniProfileCard
        userId={miniProfileUserId}
        visible={!!miniProfileUserId}
        onClose={() => { if (isCurrentEntry()) setMiniProfileUserId(null); }}
        onReport={(uid, uname) => {
          if (!isCurrentEntry()) return;
          setReportTarget({ id: uid, name: uname });
          setShowReport(true);
        }}
        onBlock={(uid, uname) => { if (isCurrentEntry()) blockUser(uid, uname, () => { if (isCurrentEntry()) router.back(); }, moderationScope); }}
      />

      <BrandedAlert
        visible={!!alertInfo}
        title={alertInfo?.title ?? ''}
        message={alertInfo?.message}
        scrollMessage={alertInfo?.scrollMessage}
        buttons={alertInfo?.buttons}
        onClose={() => setAlertInfo(null)}
      />


      {reactionDetails && <ReactionDetailsSheet request={reactionDetails} onClose={() => setReactionDetails(null)} />}
      <MessageActionsMenu menu={overlayMessage} onClose={() => setOverlayMessage(null)} />
    </View>
  );
}

// Memoized so a parent re-render (e.g. the DM screen toggling its + menu /
// add-people / plan state) does not re-render the whole chat. Paired with the
// stabilized props passed by CircleChatScreenInner.
export default memo(ChatThread);
