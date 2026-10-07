import { beginChatTiming, type ChatTimingOutcome } from '../../lib/chatPerformance';
import { parseMemberReactionAnchor } from '../../lib/memberChatMessageAnchor';
import { useChatAnchorScroll } from '../../hooks/useChatMessageAnchor';
import { ChatMessageAnchorNotice } from './ChatMessageAnchorNotice';
import { addChatMentionReference, rebaseChatMentions, readChatMentionDocument } from '../../lib/chatMentionIdentity';
import { useChatMentionFocus } from '../../hooks/useChatMentionFocus';
import { useChatResumeRefresh } from '../../hooks/useChatResumeRefresh';
import LinkifiedText from '../LinkifiedText';
import { ChatMentionPicker } from './ChatMentionPicker';
import { findMentionMembers } from '../../lib/chatMentions';
import { mentionQueryAt, insertMentionAt } from '../../lib/communityChatUi';
import { ChatBubbleFill } from './ChatBubbleFill';
import ProfileButton from '../ProfileButton';
import { messageActionAccess, messageActionWeb } from './messageActionAccess';
import { MessageActionsMenu, type MessageMenu } from './MessageActionsMenu';
import { MEMBER_REDESIGN_APPEARANCE_ENABLED, memberPresentationFonts } from '../../constants/MemberAppearance';
import React, { useState, useRef, useCallback, useEffect, useLayoutEffect, useMemo, memo } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Keyboard,
  Platform,
  ActionSheetIOS,
  Alert,
  ActivityIndicator,
  Modal,
  Pressable,
  Linking,
  ScrollView,
  AppState,
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
import { Fonts, FontSizes, ChatType, AfterglowType, type AfterglowFontFamilies } from '../../constants/Typography';
import { COMMUNITY_CHAT_GROUPING_ENABLED } from '../../constants/FeatureFlags';
import { useAfterglowFonts } from '../../hooks/useAfterglowFonts';
import { ChatContextHeader, chatHeaderActionStyle } from './ChatContextHeader';
import { CreatorActionFill } from '../creator/CreatorActionFill';
import { ChatPhotoAttachment } from './ChatPhotoAttachment';
import { createChatMessageAppearance } from './chatMessageAppearance';
import { createChatComposerAppearance } from './chatComposerAppearance';
import { useChatInputHeight } from '../../hooks/useChatInputHeight';
import { ChatPhotoViewer, useChatPhotoSelection } from './ChatPhotoViewer';
import type { AnchorRect } from '../menu/MenuCard';
import SunriseIcon from '../yours/icons/SunriseIcon';
import ChatPlanCard from './ChatPlanCard';
import { openUrl, soleUrlIn } from '../../lib/url';
import { uploadBase64ToStorage } from '../../lib/uploadPhoto';
import { isChatEditRefused } from '../../lib/chatMessageEdit';
import { checkContent } from '../../lib/contentFilter';
import { restoreChatDraft } from '../../lib/restoreChatDraft';
import { PhotoBatchFailure, sendPhotoBatch } from '../../lib/chatPhotoBatch';
import { requestWithDeadline } from '../../lib/requestWithDeadline';
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
import { ReactionChips } from './ReactionChips';
import { ReactionDetailsSheet, type ReactionDetailsRequest } from './ReactionDetailsSheet';
import { reactionEmoji, reactionKeyForEmoji, topicReactionCounts } from '../../lib/communityReactionChips';
import LinkPreviewCard from '../chat/LinkPreviewCard';
import TypingIndicator from '../chat/TypingIndicator';
import { useTypingIndicator } from '../../hooks/useTypingIndicator';
import { useActiveChatPresence } from '../../hooks/useActiveChatPresence';
import ScrollToBottomButton from '../chat/ScrollToBottomButton';
import VoicePlayer from '../chat/VoicePlayer';
import { ChatSizedText } from './ChatSizedText';
import { ChatLocationPreview } from './ChatLocationPreview';
import { chatLocationLabel, parsePlanChatLocation } from '../../lib/chatLocation';
import VoiceRecorder, { RecorderUiMode } from '../chat/VoiceRecorder';
import { useVoiceRecorder } from '../../hooks/useVoiceRecorder';
import { uploadAudioToStorage } from '../../lib/uploadAudio';
import { logError } from '../../lib/logger';
import { ReportModal } from '../modals/ReportModal';
import { useBlock } from '../../hooks/useBlock';
import { BrandedAlert, BrandedAlertButton } from '../BrandedAlert';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { registerPushNotificationsWithResult, getPushPermissionStatus } from '../../hooks/usePushNotifications';
import { pushRegistrationFeedback } from '../notifications/pushRegistrationFeedback';

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

function formatChatDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const msgDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  if (msgDate.getTime() === today.getTime()) return 'Today';
  if (msgDate.getTime() === yesterday.getTime()) return 'Yesterday';
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatMessageTime(dateString: string): string {
  return new Date(dateString).toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

function isSameDay(a: string, b: string): boolean {
  const da = new Date(a), db = new Date(b);
  return da.getFullYear() === db.getFullYear()
    && da.getMonth() === db.getMonth()
    && da.getDate() === db.getDate();
}

// ─── Linked Text ─────────────────────────────────────────────────────────────

const URL_PATTERN = /(https?:\/\/[^\s]+|www\.[^\s]+)/i;

// Image bubble sizing -- bounds the bubble while preserving the source image's
// aspect ratio (the old 240x180 + contentFit:cover cropped tall GIFs to their
// top). Intrinsic w/h is captured via expo-image's onLoad and cached so the
// same image (e.g. a GIF reused in scrollback) doesn't re-measure on every
// remount.
const MESSAGE_IMAGE_MAX_WIDTH = 240;
const MESSAGE_IMAGE_MAX_HEIGHT = 320;
const MESSAGE_IMAGE_DEFAULT_AR = 4 / 3;
const imageSizeCache = new Map<string, { w: number; h: number }>();
function fitImage(natural: { w: number; h: number } | null) {
  const ar = natural && natural.h > 0 ? natural.w / natural.h : MESSAGE_IMAGE_DEFAULT_AR;
  let width = MESSAGE_IMAGE_MAX_WIDTH;
  let height = width / ar;
  if (height > MESSAGE_IMAGE_MAX_HEIGHT) {
    height = MESSAGE_IMAGE_MAX_HEIGHT;
    width = height * ar;
  }
  return { width: Math.round(width), height: Math.round(height) };
}

// A message that is only 1-3 emoji (no letters/numbers) renders large with no
// bubble, like iMessage/WhatsApp. Hermes may lack Intl.Segmenter, so fall back
// to a code-point count; over-counting a ZWJ sequence just renders it as a
// normal bubble, which is a safe default.
function isEmojiOnly(text: string): boolean {
  const t = text.trim();
  if (!t || /[\p{L}\p{N}]/u.test(t)) return false;
  if (!/\p{Extended_Pictographic}/u.test(t)) return false;
  const Seg = (Intl as any)?.Segmenter;
  const count = Seg ? Array.from(new Seg().segment(t)).length : Array.from(t).length;
  return count <= 3;
}

function LinkedText(props: React.ComponentProps<typeof LinkifiedText>) {
  return <LinkifiedText {...props} fullUrls/>;
}

// ─── Location helpers ─────────────────────────────────────────────────────────

function openLocationInMaps(lat: number, lng: number, address: string) {
  const encoded = encodeURIComponent(address);
  const url = Platform.OS === 'ios'
    ? `maps://app?ll=${lat},${lng}&q=${encoded}`
    : `geo:${lat},${lng}?q=${encoded}`;
  Linking.openURL(url).catch(() => {
    const fallback = Platform.OS === 'ios'
      ? `https://maps.apple.com/?ll=${lat},${lng}&q=${encoded}`
      : `https://www.google.com/maps?q=${lat},${lng}`;
    Linking.openURL(fallback).catch(() => {});
  });
}

// ─── Message Bubble ───────────────────────────────────────────────────────────

interface BubbleProps {
  message: ChatMessage;
  isOwn: boolean;
  showAvatar: boolean;
  showName: boolean;
  isGrouped: boolean;
  currentUserId: string;
  contextTitle?: string;
  onPhotoPress?: (url: string, messageId: string) => void;
  photoMaxWidth: number;
  conversationFonts: AfterglowFontFamilies;
  onReaction?: (messageId: string, emoji?: string) => void;
  onAddReaction?: (messageId: string) => void;
  onViewReactions?: (messageId: string) => void;
  reactionsDisabled?: boolean;
  onMessageLongPress?: (message: ChatMessage, isOwn: boolean) => void;
  onStartReply?: (messageId: string) => void;
  onReplyTap?: (messageId: string) => void;
  onAvatarPress?: (userId: string) => void;
  mentionNames?: Set<string>;
}

// The bare system-row templates the app writes today (app/plan/[id].tsx).
// Anchored exact-match so legacy name-embedded lines are never double-prefixed.
const BARE_SYSTEM_TEMPLATES = /^(joined the plan|had to leave the plan|cancelled this plan)$/i;

const MessageBubble = memo(function MessageBubble({ message, isOwn, showAvatar, showName, isGrouped, currentUserId, contextTitle, onPhotoPress, photoMaxWidth, conversationFonts, onReaction, onAddReaction, onViewReactions, reactionsDisabled, onMessageLongPress, onStartReply, onReplyTap, onAvatarPress, mentionNames }: BubbleProps) {
  const messageAppearance = useMemo(() => MEMBER_REDESIGN_APPEARANCE_ENABLED ? createChatMessageAppearance(conversationFonts) : null, [conversationFonts]);
  if (message.message_type === 'system') {
    // A system message carrying a plan reference renders as the compact plan card
    // (invite delivery), not as system text.
    if (message.ref_event_id) {
      return (
        <View style={bubbleStyles.systemRow}>
          <ChatPlanCard eventId={message.ref_event_id} />
        </View>
      );
    }
    let displayContent = message.content;
    // Current-era system rows store the bare verb phrase and carry the actor
    // only in user_id, so the line rendered nameless ("joined Cali splash!").
    // Prefix the sender's name for exactly those templates; older rows (the
    // "X just joined the group!" era) already embed the name.
    if (BARE_SYSTEM_TEMPLATES.test(displayContent.trim()) && message.sender?.first_name) {
      displayContent = `${message.sender.first_name} ${displayContent.trim()}`;
    }
    if (contextTitle) {
      displayContent = displayContent
        .replace(/joined the plan/gi, `joined ${contextTitle}`)
        .replace(/the plan/gi, contextTitle);
    }
    return (
      <View style={bubbleStyles.systemRow}>
        <Text style={[bubbleStyles.systemText, messageAppearance?.day]}>{displayContent}</Text>
      </View>
    );
  }

  const handleLongPress = () => {
    hapticMedium();
    onMessageLongPress?.(message, isOwn);
  };

  const reactions = message.reactions ?? [];
  const totalReactions = reactions.length;
  // Collect unique emojis in order of first appearance -- memoized so a parent
  // re-render that didn't touch reactions skips the loop.
  const uniqueEmojis = useMemo(() => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const r of reactions) {
      if (!seen.has(r.reaction)) { seen.add(r.reaction); out.push(r.reaction); }
    }
    return out;
  }, [reactions]);
  const iReacted = reactions.some(r => r.user_id === currentUserId);
  // First link in a text message gets a rich preview card under the text (the
  // card renders nothing until og-unfurl returns usable metadata). Memoized so
  // the regex doesn't re-run on unrelated re-renders.
  const firstUrl = useMemo(
    () => (message.message_type === 'user' ? (message.content?.match(URL_PATTERN)?.[0] ?? null) : null),
    [message.message_type, message.content],
  );
  // A message carrying exactly one link makes the whole bubble a second way
  // into that link. The inline link Text stays the primary target; this is the
  // one an ancestor cannot swallow, which is the failure shape reported on
  // 8-02 (a shared plan link that did nothing when tapped on Android). The
  // bubble had no onPress at all before, so this only adds a way through and
  // can never override an existing one.
  const bubbleUrl = useMemo(
    () => (message.message_type === 'user' ? soleUrlIn(message.content) : null),
    [message.message_type, message.content],
  );
  // A plain text bubble can be a direct reply target. Media, locations, audio,
  // and links keep their existing tap action; long-press and swipe still expose
  // Reply for those message types.
  const canTapToReply = message.message_type === 'user' && !message.image_url && !firstUrl;
  // Media owns its individual accessible controls (map, photo viewer, playback).
  // The wrapper retains the physical long-press without grouping those controls
  // into a second, non-functional screen-reader button.
  const hasInteractiveMedia = !!message.image_url || message.message_type === 'location'
    || (message.message_type === 'audio' && !!message.audio_url);
  // Cache the emoji-only verdict per content -- the regex/Segmenter test is
  // cheap individually but runs for every bubble on every list re-render.
  const isEmojiOnlyMsg = useMemo(() => isEmojiOnly(message.content), [message.content]);
  // Intrinsic image size -- seeded from the module-level cache if we've seen
  // this URL before, otherwise updated by the Image's onLoad. fitImage clamps
  // to the bubble bounds while keeping the source aspect ratio (no more
  // top-of-GIF cropping for portrait sources).
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(
    () => (message.image_url ? imageSizeCache.get(message.image_url) ?? null : null),
  );
  const imageDisplaySize = useMemo(() => fitImage(imgSize), [imgSize]);

  const borderRadius = isOwn
    ? { borderTopLeftRadius: 14, borderTopRightRadius: 14, borderBottomLeftRadius: 14, borderBottomRightRadius: 5 }
    : { borderTopLeftRadius: 14, borderTopRightRadius: 14, borderBottomLeftRadius: 5, borderBottomRightRadius: 14 };

  return (
    <View
      style={[
        bubbleStyles.row,
        isOwn ? bubbleStyles.rowOwn : bubbleStyles.rowOther,
        // Reaction badge is absolutely positioned at bottom:-12 of the bubble.
        // Without extra clearance below, it overlaps the sender label of the
        // next message. Bump marginBottom only when there's a badge to clear.
        !COMMUNITY_CHAT_GROUPING_ENABLED && totalReactions > 0 && bubbleStyles.rowWithReaction,
      ]}
    >
      {!isOwn && (
        <View style={bubbleStyles.avatarSlot}>
          {showAvatar ? (
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => onAvatarPress?.(message.user_id)}
              hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
              accessibilityLabel={`View ${message.sender?.first_name ?? 'member'}'s profile`}
            >
              {message.sender?.avatar_url ? (
                <Image source={{ uri: message.sender.avatar_url }} style={bubbleStyles.avatar} contentFit="cover" />
              ) : (
                <View style={[bubbleStyles.avatar, bubbleStyles.avatarFallback, messageAppearance?.avatar]}>
                  <Text style={[bubbleStyles.avatarInitial, messageAppearance?.avatarInitial]}>
                    {message.sender?.first_name?.[0]?.toUpperCase() ?? '?'}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          ) : null}
        </View>
      )}

      <View style={[bubbleStyles.bubbleWrapper, isOwn ? bubbleStyles.wrapperOwn : bubbleStyles.wrapperOther]} {...messageActionWeb(handleLongPress)}>

        <Pressable
          onPress={bubbleUrl
            ? () => openUrl(bubbleUrl)
            : canTapToReply
              ? () => onStartReply?.(message.id)
              : undefined}
          onLongPress={handleLongPress}
          {...messageActionAccess(handleLongPress)}
          delayLongPress={400}
          accessible={hasInteractiveMedia ? false : undefined}
          accessibilityRole={hasInteractiveMedia ? undefined : 'button'}
          accessibilityActions={hasInteractiveMedia ? undefined : [{ name: 'messageActions', label: 'Message actions and reactions' }]}
          onAccessibilityAction={hasInteractiveMedia ? undefined : event => { if (event.nativeEvent.actionName === 'messageActions') handleLongPress(); }}
          accessibilityHint={bubbleUrl
            ? 'Opens this link'
            : canTapToReply
              ? 'Starts a reply to this message'
              : 'Shows message actions'}
        >
          {message.message_type === 'audio' && message.audio_url ? (
            <View style={[
              bubbleStyles.bubble,
              bubbleStyles.bubbleText,
              isOwn ? bubbleStyles.bubbleOwn : bubbleStyles.bubbleOther,
              borderRadius,
              messageAppearance?.bubble, isOwn && messageAppearance?.bubbleOwn,
            ]}>
              <VoicePlayer
                uri={message.audio_url}
                durationSeconds={message.duration_seconds ?? 0}
                isOwn={isOwn}
                appearance={COMMUNITY_CHAT_GROUPING_ENABLED ? { fonts: conversationFonts } : undefined}
              />
            </View>
          ) : !!message.image_url ? (
            <View>
              {COMMUNITY_CHAT_GROUPING_ENABLED ? <ChatPhotoAttachment
                uri={message.image_url} senderName={message.sender?.first_name} fonts={conversationFonts}
                maxWidth={photoMaxWidth} onOpen={() => onPhotoPress?.(message.image_url!, message.id)} onLongPress={handleLongPress}
              /> : (
              <Pressable
                onPress={() => onPhotoPress?.(message.image_url!, message.id)}
                onLongPress={handleLongPress}
                delayLongPress={400}
              >
                <Image
                  source={{ uri: message.image_url }}
                  style={[bubbleStyles.messageImage, imageDisplaySize, borderRadius]}
                  contentFit="contain"
                  transition={200}
                  placeholder={{ blurhash: 'L6PZfSi_.AyE_3t7t7R**0o#DgR4' }}
                  cachePolicy="memory-disk"
                  onLoad={(e) => {
                    const w = e.source?.width;
                    const h = e.source?.height;
                    if (w && h && message.image_url) {
                      imageSizeCache.set(message.image_url, { w, h });
                      setImgSize({ w, h });
                    }
                  }}
                />
              </Pressable>
              )}
              {!!message.content?.trim() && (
                <Text style={[bubbleStyles.imageCaption, isOwn && bubbleStyles.imageCaptionOwn, messageAppearance?.body]}>
                  {message.content}
                </Text>
              )}
            </View>
          ) : message.message_type === 'location' ? (() => {
            const location = parsePlanChatLocation(message.content);
            return (
              <Pressable
                onPress={location ? () => openLocationInMaps(location.latitude, location.longitude, location.address) : undefined}
                onLongPress={handleLongPress}
                accessibilityRole={location ? 'button' : undefined}
                accessibilityLabel={location ? `Open map for ${chatLocationLabel(location)}` : 'Location unavailable'}
                style={[
                  bubbleStyles.bubble,
                  bubbleStyles.locationBubble,
                  isOwn ? bubbleStyles.bubbleOwn : bubbleStyles.bubbleOther,
                  borderRadius,
              messageAppearance?.bubble, isOwn && messageAppearance?.bubbleOwn,
                ]}
              >
                {COMMUNITY_CHAT_GROUPING_ENABLED ? <ChatLocationPreview location={location} fonts={conversationFonts} isOwn={isOwn} /> : <>
                <View style={bubbleStyles.locationPinRow}>
                  <Ionicons name="location" size={15} color={isOwn ? Colors.white : Colors.terracotta} />
                  <Text style={[bubbleStyles.locationLabel, isOwn && bubbleStyles.locationLabelOwn]}>
                    Shared location
                  </Text>
                </View>
                <Text style={[bubbleStyles.locationAddress, isOwn && bubbleStyles.locationAddressOwn]} numberOfLines={2}>
                  {location ? chatLocationLabel(location) : 'Location unavailable'}
                </Text>
                <Text style={[bubbleStyles.locationTapHint, isOwn && bubbleStyles.locationTapHintOwn]}>
                  {location ? 'Tap to open in Maps' : 'Ask for a new pin'}
                </Text>
                </>}
              </Pressable>
            );
          })() : isEmojiOnlyMsg && !message.reply_to ? (
            // Wrap the emoji glyph in a padded View so the outer Pressable has a
            // real hit area -- a bare Text loses the long-press to the row-level
            // SwipeableRow's pan gesture on Android, hiding the delete overlay.
            <View style={bubbleStyles.emojiOnlyWrap}>
              <Text style={bubbleStyles.emojiOnly}>{message.content}</Text>
            </View>
          ) : (
            <View style={[
              bubbleStyles.bubble,
              bubbleStyles.bubbleText,
              isOwn ? bubbleStyles.bubbleOwn : bubbleStyles.bubbleOther,
              borderRadius,
              messageAppearance?.bubble, isOwn && messageAppearance?.bubbleOwn,
            ]}>
              {isOwn && COMMUNITY_CHAT_GROUPING_ENABLED && <ChatBubbleFill/>}
              {!isOwn && showName && <Text style={bubbleStyles.senderName}>{message.sender?.first_name ?? 'Someone'}</Text>}
              {message.reply_to && (
                <TouchableOpacity
                  onPress={() => onReplyTap?.(message.reply_to!.id)}
                  style={[bubbleStyles.replyQuote, isOwn ? bubbleStyles.replyQuoteOwn : bubbleStyles.replyQuoteOther, messageAppearance?.quote, isOwn && messageAppearance?.quoteOwn]}
                  activeOpacity={0.7}
                >
                  <Text style={[bubbleStyles.replyQuoteName, isOwn && bubbleStyles.replyQuoteNameOwn, messageAppearance?.quoteName, isOwn && messageAppearance?.bodyOwn]}>
                    {message.reply_to.sender_name ?? 'Someone'}
                  </Text>
                  <Text style={[bubbleStyles.replyQuoteText, isOwn && bubbleStyles.replyQuoteTextOwn, messageAppearance?.quoteBody, isOwn && messageAppearance?.bodyOwn]} numberOfLines={2}>
                    {message.reply_to.content}
                  </Text>
                </TouchableOpacity>
              )}
              <LinkedText
                text={message.content}
                mentionDocument={message.mention_data}
                onMentionPress={onAvatarPress}
                style={[bubbleStyles.messageText, isOwn && bubbleStyles.messageTextOwn, messageAppearance?.body, isOwn && messageAppearance?.bodyOwn]}
                linkStyle={messageAppearance ? isOwn ? messageAppearance.linkOwn : messageAppearance.link : isOwn ? bubbleStyles.linkOwn : bubbleStyles.linkOther}
                mentionNames={mentionNames}
                mentionStyle={messageAppearance ? isOwn ? messageAppearance.mentionOwn : messageAppearance.mention : isOwn ? bubbleStyles.mentionOwn : bubbleStyles.mention}
              />
              {firstUrl && <LinkPreviewCard url={firstUrl} isOwn={isOwn} />}
              <ChatSizedText style={[bubbleStyles.inlineTime, isOwn && bubbleStyles.inlineTimeOwn]}>{formatMessageTime(message.created_at)}</ChatSizedText>
            </View>
          )}

          {!COMMUNITY_CHAT_GROUPING_ENABLED && totalReactions > 0 && (
            <TouchableOpacity onPress={event => { event.stopPropagation(); onViewReactions?.(message.id); }} accessibilityRole="button" accessibilityLabel={`${totalReactions} reactions. See who reacted`} hitSlop={12} style={[bubbleStyles.reactionBadge, isOwn ? bubbleStyles.reactionBadgeOwn : bubbleStyles.reactionBadgeOther, iReacted && bubbleStyles.reactionBadgeMine]}>
              {uniqueEmojis.map((emoji) => (
                <Text key={emoji} style={bubbleStyles.reactionEmoji}>
                  {emoji === 'heart' ? '\u2764\uFE0F' : emoji}
                </Text>
              ))}
              {totalReactions > 1 && (
                <Text style={bubbleStyles.reactionCount}>{totalReactions}</Text>
              )}
            </TouchableOpacity>
          )}
        </Pressable>
        {(message.image_url || message.message_type === 'location' || message.message_type === 'audio' || (isEmojiOnlyMsg && !message.reply_to)) && (
          <ChatSizedText style={bubbleStyles.inlineTime}>{!isOwn && showName ? `${message.sender?.first_name ?? 'Someone'} · ` : ''}{formatMessageTime(message.created_at)}</ChatSizedText>
        )}
        {COMMUNITY_CHAT_GROUPING_ENABLED && totalReactions > 0 && <ReactionChips attached
          reactions={topicReactionCounts(reactions, currentUserId)}
          onViewReactions={onViewReactions ? () => onViewReactions(message.id) : undefined}
          onReact={key => { if (!isOwn && !reactionsDisabled) onReaction?.(message.id, key); }}
          onAddReaction={!isOwn && onAddReaction ? () => onAddReaction(message.id) : undefined}
          disabled={isOwn || reactionsDisabled}
          appearance={{ fonts: conversationFonts }}
        />}
      </View>
    </View>
  );
});

const bubbleStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 2, paddingHorizontal: 12 },
  rowOwn: { justifyContent: 'flex-end' },
  rowOther: { justifyContent: 'flex-start' },
  // Extra clearance below a row that has a reaction badge dangling
  // 12px below the bubble. 16px = badge offset (12) + breathing room (4).
  rowWithReaction: { marginBottom: 16 },
  avatarSlot: { width: 24, marginRight: 6, alignSelf: 'flex-start', marginTop: 3 },
  avatar: { width: 24, height: 24, borderRadius: 12 },
  avatarFallback: { backgroundColor: Colors.inputBg, alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { fontFamily: Fonts.sansBold, fontSize: FontSizes.caption, color: Colors.terracotta },
  bubbleWrapper: { maxWidth: '84%', flexShrink: 1 },
  wrapperOwn: { alignItems: 'flex-end' },
  wrapperOther: { alignItems: 'flex-start' },
  senderLine: { marginBottom: 2, marginLeft: 4 },
  senderName: { ...ChatType.sender, fontFamily: Fonts.sansSemibold, color: Colors.terracotta, marginBottom: 3 },
  senderDot: { fontSize: 10, color: Colors.tertiary },
  senderTime: { fontSize: 10, color: Colors.secondary },
  bubble: { overflow: 'hidden' },
  bubbleText: { paddingHorizontal: 11, paddingVertical: 7 },
  bubbleOwn: { backgroundColor: Colors.terracotta },
  bubbleOther: {
    backgroundColor: Colors.cardBg,
  },
  messageText: { ...ChatType.message, fontFamily: Fonts.sans, color: Colors.darkWarm },
  emojiOnly: { fontSize: 44, lineHeight: 54, paddingVertical: 2 },
  emojiOnlyWrap: { paddingVertical: 6, paddingHorizontal: 10 },
  imageCaption: { fontFamily: Fonts.sans, fontSize: 15, color: Colors.darkWarm, lineHeight: 21, marginTop: 6, maxWidth: 260 },
  imageCaptionOwn: { color: Colors.darkWarm },
  messageTextOwn: { color: Colors.white },
  inlineTime: { ...ChatType.time, fontFamily: Fonts.sans, color: Colors.secondary, textAlign: 'right', alignSelf: 'flex-end', marginLeft: 14, marginTop: 2 },
  inlineTimeOwn: { color: Colors.overlayWhiteLight },
  linkOther: { textDecorationLine: 'underline' as const, color: Colors.terracotta },
  linkOwn: { textDecorationLine: 'underline' as const, color: Colors.white },
  mention: { fontFamily: Fonts.sansBold, color: Colors.terracotta },
  mentionOwn: { fontFamily: Fonts.sansBold, color: Colors.white },
  messageImage: { backgroundColor: Colors.inputBg },
  systemRow: { alignItems: 'center', marginVertical: 8, paddingHorizontal: 16 },
  systemText: {
    fontFamily: Fonts.sans,
    fontSize: 11,
    color: Colors.tertiary,
    backgroundColor: Colors.inputBg,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 10,
    overflow: 'hidden',
  },
  reactionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.white,
    borderRadius: 12,
    paddingHorizontal: 6,
    paddingVertical: 3,
    gap: 2,
    position: 'absolute',
    bottom: -12,
    shadowColor: Colors.shadowBlack,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  reactionBadgeOwn: { right: 4 },
  reactionBadgeOther: { left: 4 },
  reactionBadgeMine: {
    backgroundColor: Colors.warmTint,
  },
  reactionEmoji: { fontSize: 13 },
  reactionCount: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.caption,
    color: Colors.textMedium,
    marginLeft: 1,
  },
  replyQuote: {
    borderLeftWidth: 3,
    paddingLeft: 8,
    paddingVertical: 4,
    marginBottom: 6,
    borderRadius: 10,
  },
  replyQuoteOwn: {
    borderLeftColor: Colors.overlayWhite,
    backgroundColor: Colors.overlayLight,
  },
  replyQuoteOther: {
    borderLeftColor: Colors.terracotta,
    backgroundColor: Colors.inputBg,
  },
  replyQuoteName: {
    fontFamily: Fonts.sansBold,
    fontSize: 12,
    color: Colors.terracotta,
    marginBottom: 1,
  },
  replyQuoteNameOwn: {
    color: Colors.overlayWhiteLight,
  },
  replyQuoteText: {
    fontFamily: Fonts.sans,
    ...ChatType.quote,
    color: Colors.textMedium,
  },
  replyQuoteTextOwn: {
    color: Colors.overlayWhiteLight,
  },
  locationBubble: { paddingHorizontal: 13, paddingVertical: 10, minWidth: 180 },
  locationPinRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 4 },
  locationLabel: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.textMedium },
  locationLabelOwn: { color: Colors.white },
  locationAddress: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
    marginBottom: 6,
    lineHeight: 20,
  },
  locationAddressOwn: { color: Colors.white },
  locationTapHint: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.caption,
    color: Colors.textLight,
  },
  locationTapHintOwn: { color: Colors.overlayWhiteLight },
});

// ─── Swipe to reply ─────────────────────────────────────────────────────────
// Drag a message row left-to-right (finger moves rightward on screen,
// independent of the inverted list) to enter reply mode, mirroring WhatsApp.
// activeOffsetX keeps it from stealing the FlatList's vertical scroll and from
// firing on Android's left-edge back gesture; failOffsetY cancels the moment
// the drag turns vertical. At the threshold we fire hapticMedium once and, on
// release, the same reply activation the long-press menu uses.
const SWIPE_REPLY_THRESHOLD = 80;
const SWIPE_REPLY_MAX_TRANSLATE = 96;
const SWIPE_REPLY_ACTIVE_OFFSET_X = 20;
const SWIPE_REPLY_FAIL_OFFSET_Y = 12;
const SWIPE_REPLY_ICON_SIZE = 20;
const SWIPE_REPLY_ICON_LEFT = 16;
const SWIPE_REPLY_ICON_MIN_SCALE = 0.6;
const SWIPE_REPLY_ICON_SCALE_RANGE = 0.4;
const SWIPE_REPLY_SPRING = { damping: 18, stiffness: 220, mass: 0.5 };

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
const SCROLL_AT_BOTTOM_THRESHOLD = 24;
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

const SwipeableRow = memo(function SwipeableRow({
  enabled,
  messageId,
  onTriggerReply,
  containerStyle,
  children,
}: {
  enabled: boolean;
  messageId: string;
  onTriggerReply: (messageId: string) => void;
  containerStyle: any;
  children: React.ReactNode;
}) {
  const translateX = useSharedValue(0);
  const triggered = useSharedValue(false);

  // Keep the latest callback in a ref so the memoized gesture never calls a
  // stale closure when the row re-renders.
  const onTriggerReplyRef = useRef(onTriggerReply);
  onTriggerReplyRef.current = onTriggerReply;
  const fireReply = useCallback(() => onTriggerReplyRef.current?.(messageId), [messageId]);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .enabled(enabled)
        // A positive scalar waits for rightward movement. A positive lower
        // bound also activates at dx=0, stealing stationary long presses.
        .activeOffsetX(SWIPE_REPLY_ACTIVE_OFFSET_X)
        .failOffsetY([-SWIPE_REPLY_FAIL_OFFSET_Y, SWIPE_REPLY_FAIL_OFFSET_Y])
        .onBegin(() => {
          triggered.value = false;
        })
        .onUpdate((e) => {
          const x = Math.max(0, Math.min(e.translationX, SWIPE_REPLY_MAX_TRANSLATE));
          translateX.value = x;
          if (!triggered.value && x >= SWIPE_REPLY_THRESHOLD) {
            triggered.value = true;
            runOnJS(hapticMedium)();
          }
        })
        .onEnd(() => {
          if (triggered.value) runOnJS(fireReply)();
        })
        .onFinalize(() => {
          translateX.value = withSpring(0, SWIPE_REPLY_SPRING);
          triggered.value = false;
        }),
    [enabled, fireReply],
  );

  const rowStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  const iconStyle = useAnimatedStyle(() => {
    const progress = Math.min(translateX.value / SWIPE_REPLY_THRESHOLD, 1);
    return {
      opacity: progress,
      transform: [
        { scale: SWIPE_REPLY_ICON_MIN_SCALE + SWIPE_REPLY_ICON_SCALE_RANGE * progress },
      ],
    };
  });

  if (!enabled) {
    return <View style={containerStyle}>{children}</View>;
  }

  return (
    <View style={containerStyle}>
      <Animated.View style={[swipeStyles.replyIcon, iconStyle]} pointerEvents="none">
        <Ionicons name="arrow-undo" size={SWIPE_REPLY_ICON_SIZE} color={Colors.terracotta} />
      </Animated.View>
      <GestureDetector gesture={pan}>
        <Animated.View style={rowStyle}>{children}</Animated.View>
      </GestureDetector>
    </View>
  );
});

const swipeStyles = StyleSheet.create({
  replyIcon: {
    position: 'absolute',
    left: SWIPE_REPLY_ICON_LEFT,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

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
    .slice().sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
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
  const [showPushBanner, setShowPushBanner] = useState(false);
  const [enablingPush, setEnablingPush] = useState(false);
  const [pushFeedback, setPushFeedback] = useState<string | null>(null);
  const [pushVisit, setPushVisit] = useState<object>({});
  const activePushVisit = useRef<object | null>(null);
  const pushAttempt = useRef<object | null>(null);
  const pushCheckRevision = useRef(0);
  const pushSettingsReturn = useRef<{ visit: object; returned: boolean } | null>(null);
  const PUSH_BANNER_KEY = 'push_banner_dismissed_at';
  const PUSH_BANNER_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
  const isCurrentPush = useCallback(() => isCurrentEntry() && activePushVisit.current === pushVisit,
    [isCurrentEntry, pushVisit]);

  useFocusEffect(useCallback(() => {
    const visit = {};
    activePushVisit.current = visit;
    setPushVisit(visit);
    pushAttempt.current = null;
    pushSettingsReturn.current = null;
    pushCheckRevision.current++;
    setShowPushBanner(false);
    setPushFeedback(null);
    setEnablingPush(false);
    return () => {
      if (activePushVisit.current !== visit) return;
      activePushVisit.current = null;
      pushAttempt.current = null;
      pushSettingsReturn.current = null;
      pushCheckRevision.current++;
    };
  }, [entry]));

  useEffect(() => {
    if (!isCurrentPush() || !currentUserId || messages.length === 0) return;
    if (!messages.some(message => message.user_id !== currentUserId)) return;
    let cancelled = false;
    const revision = pushCheckRevision.current;
    const current = () => !cancelled && isCurrentPush() && revision === pushCheckRevision.current;
    void (async () => {
      try {
        const permission = await getPushPermissionStatus();
        if (!current() || permission === 'granted') return;
        const dismissed = await AsyncStorage.getItem(PUSH_BANNER_KEY);
        if (!current()) return;
        if (dismissed && Date.now() - parseInt(dismissed, 10) < PUSH_BANNER_COOLDOWN_MS) return;
        setShowPushBanner(true);
      } catch { /* A passive check never opens an error or requests permission. */ }
    })();
    return () => { cancelled = true; };
  }, [currentUserId, messages.length, isCurrentPush]);

  const handleEnablePush = useCallback(async (fromSettings = false): Promise<void> => {
    if (!isCurrentPush() || pushAttempt.current) return;
    if (fromSettings && (pushSettingsReturn.current?.visit !== pushVisit || !pushSettingsReturn.current.returned)) return;
    pushSettingsReturn.current = null;
    const attempt = {};
    pushAttempt.current = attempt;
    pushCheckRevision.current++;
    setEnablingPush(true);
    setPushFeedback(null);
    const current = () => isCurrentPush() && pushAttempt.current === attempt;
    // showResult and the native foreground listener can assign this ref
    // after the initial clear; read its declared type at completion time.
    const getSettingsReturn = (): { visit: object; returned: boolean } | null => pushSettingsReturn.current;
    const showResult = (result: Parameters<typeof pushRegistrationFeedback>[0], previouslyDenied = false) => {
      if (!current()) return;
      const feedback = pushRegistrationFeedback(result);
      if (feedback.kind === 'silent') return;
      if (feedback.kind === 'success') {
        setShowPushBanner(false);
      } else if (feedback.kind === 'settings') {
        // Keep the established snooze after a declined native prompt. Open
        // Settings only when denial was known before this enable attempt.
        void AsyncStorage.setItem(PUSH_BANNER_KEY, String(Date.now())).catch(() => {});
        setShowPushBanner(false);
        if (fromSettings || !previouslyDenied) return;
        const settingsReturn = { visit: pushVisit, returned: false };
        pushSettingsReturn.current = settingsReturn;
        void Linking.openSettings().catch(() => {
          if (!isCurrentPush() || pushSettingsReturn.current !== settingsReturn) return;
          pushSettingsReturn.current = null;
          setShowPushBanner(true);
          setPushFeedback('Couldn’t open Settings. Open your device settings and choose WashedUp.');
        });
      } else {
        setShowPushBanner(true);
        setPushFeedback(feedback.message);
      }
    };
    try {
      // An explicit Enable action first asks for a truthful, non-prompting
      // registration result; the coarse Android native enum is insufficient.
      let result = await registerPushNotificationsWithResult({ prompt: false, userId: currentUserId });
      if (!current()) return;
      const previouslyDenied = result.status === 'permission-denied';
      if (result.status === 'permission-required' && !fromSettings) {
        result = await registerPushNotificationsWithResult({ prompt: true, userId: currentUserId, canPrompt: current });
      }
      showResult(result, previouslyDenied);
    } catch {
      showResult({ status: 'failed' });
    } finally {
      if (pushAttempt.current === attempt) {
        pushAttempt.current = null;
        if (isCurrentPush()) {
          setEnablingPush(false);
          // An early foreground event may arrive before this attempt releases
          // its lock. Retain and consume that one return after the lock clears.
          const settingsReturn = getSettingsReturn();
          if (settingsReturn?.visit === pushVisit && settingsReturn.returned) {
            void handleEnablePush(true);
          }
        }
      }
    }
  }, [currentUserId, isCurrentPush, pushVisit]);

  const handleDismissPushBanner = useCallback(() => {
    if (!isCurrentPush()) return;
    pushAttempt.current = null;
    pushCheckRevision.current++;
    pushSettingsReturn.current = null;
    setEnablingPush(false);
    setShowPushBanner(false);
    setPushFeedback(null);
    void AsyncStorage.setItem(PUSH_BANNER_KEY, String(Date.now())).catch(() => {});
  }, [isCurrentPush]);

  // Recheck only after this visit's explicit Settings action. Foregrounding
  // elsewhere must not start another registration or display a new prompt.
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state !== 'active' || !isCurrentPush() || pushSettingsReturn.current?.visit !== pushVisit) return;
      pushSettingsReturn.current.returned = true;
      void handleEnablePush(true);
    });
    return () => sub.remove();
  }, [handleEnablePush, isCurrentPush, pushVisit]);

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

  const handleReportMenu = useCallback(async () => {
    if (!isCurrentEntry()) return;
    // The full member list (avatar row is capped) comes from the per-kind wrapper:
    // plans query event_members, circles query circle_members.
    let reportMembers: { id: string; name: string }[];
    try { reportMembers = (await props.fetchReportMembers?.()) ?? []; }
    catch {
      if (isCurrentEntry()) setAlertInfo({ title: 'Could not load members', message: 'Try opening the member menu again.' });
      return;
    }
    if (!isCurrentEntry()) return;

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
          if (!isCurrentEntry() || idx < 0 || idx >= reportMembers.length) return;
          const member = reportMembers[idx];
          setTimeout(() => {
            if (!isCurrentEntry()) return;
            ActionSheetIOS.showActionSheetWithOptions(
              { options: ['Report User', 'Block User', 'Cancel'], destructiveButtonIndex: 1, cancelButtonIndex: 2, title: member.name },
              (actionIdx) => {
                if (!isCurrentEntry()) return;
                if (actionIdx === 0) { setReportTarget(member); setShowReport(true); }
                if (actionIdx === 1) blockUser(member.id, member.name, () => { if (isCurrentEntry()) router.back(); }, moderationScope);
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
              if (!isCurrentEntry()) return;
              setTimeout(() => {
                if (!isCurrentEntry()) return;
                setAlertInfo({
                  title: member.name,
                  message: '',
                  buttons: [
                    { text: 'Report User', onPress: () => { if (isCurrentEntry()) { setReportTarget(member); setShowReport(true); } } },
                    { text: 'Block User', style: 'destructive', onPress: () => blockUser(member.id, member.name, () => { if (isCurrentEntry()) router.back(); }, moderationScope) },
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

  // Explicit jumps happen immediately. New rows at the live edge do not use
  // visible-position preservation: that would pin the previous message and
  // place the new bubble underneath the composer until server confirmation.
  const scrollToBottom = useCallback(() => {
    if (!isCurrentEntry()) return;
    atBottomRef.current = true;
    setFollowingLatest(true);
    if (anchorId) { clearAnchor(); return; }
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, [isCurrentEntry, anchorId, clearAnchor]);

  // Floating scroll-to-bottom button + "new messages below" counter.
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [unreadBelow, setUnreadBelow] = useState(0);
  const atBottomRef = useRef(true);
  const [followingLatest, setFollowingLatest] = useState(!anchorId);
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
    atBottomRef.current = y <= SCROLL_AT_BOTTOM_THRESHOLD;
    setFollowingLatest(atBottomRef.current);
    setShowScrollBtn(y > SCROLL_SHOW_THRESHOLD);
    if (atBottomRef.current) setUnreadBelow(0);
  }, [isCurrentEntry]);

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
      if (!retryOriginal || !await checkChatComposerAttempt(draftRoom, original, draftOwner)) {
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
      if (canWrite()) scrollToBottom();
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
  }, [canWrite, draftOwner, uploading, composerDraft, draftRoom, editMessage, sendMessage, entryScope, scrollToBottom, setInputText, stopTyping, changeDraft]);

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
    try {
      if (!session.url) {
        const url = await requestWithDeadline(uploadAudioToStorage(id, currentUserId, uri, attemptScope), 30_000);
        requireAttempt(); session.url = url;
      }
      requireAttempt();
      const confirmed = await requestWithDeadline(sendAudio(session.url, session.durationSeconds, attemptScope, session.sendId), 25_000);
      requireAttempt();
      if (!confirmed) throw new Error('Voice delivery is unconfirmed');
      resetRecording(); scrollToBottom();
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
  }, [canWrite, currentUserId, id, sendAudio, scrollToBottom, resetRecording]);

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
    try {
      const sent = await requestWithDeadline(sendMessage('', url, undefined, sendId, sendScope), 25_000);
      if (!isCurrent()) return;
      if (!sent) throw Error('GIF delivery is unconfirmed.');
      gifPendingIds.current.delete(url);
      scrollToBottom();
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
  }, [canWrite, sendMessage, scrollToBottom, entryScope]);

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
      session.clear(); scrollToBottom();
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
  }, [pendingPhotos, currentUserId, sendMessage, scrollToBottom, canWrite, requireEntry, entryScope]);

  const handleLocationConfirm = useCallback(async (latitude: number, longitude: number, address: string) => {
    if (!canWrite() || locationAttempt.current) return false;
    const attempt = {}; locationAttempt.current = attempt;
    const attemptScope = { userId: entryScope.userId, isCurrent: () => canWrite() && locationAttempt.current === attempt };
    const pin = JSON.stringify({ latitude, longitude, address });
    if (!locationSession.current || locationSession.current.pin !== pin) {
      locationSession.current = { pin, sendId: Crypto.randomUUID() };
    }
    const session = locationSession.current;
    try {
      const confirmed = await requestWithDeadline(sendLocation(latitude, longitude, address, attemptScope, session.sendId), 25_000);
      if (!attemptScope.isCurrent()) return false;
      if (confirmed) { locationSession.current = null; setLocationPickerOpen(false); scrollToBottom(); }
      return confirmed;
    } catch {
      return false; // The existing preview retains its pin and presents inline retry.
    } finally {
      if (locationAttempt.current === attempt) locationAttempt.current = null;
    }
  }, [sendLocation, scrollToBottom, canWrite, entryScope]);

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
  useEffect(() => { enrichedItemsRef.current = enrichedItems; }, [enrichedItems]);
  const handleReplyTap = useCallback((msgId: string) => {
    const items = enrichedItemsRef.current;
    const idx = items.findIndex(item => !('type' in item) && item.id === msgId);
    if (idx >= 0) {
      listRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.5 });
    }
  }, []);
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
      <View style={[chatStyles.headerSafe, COMMUNITY_CHAT_GROUPING_ENABLED && { backgroundColor: AfterglowColors.paper }, { paddingTop: insets.top }]}>
        {COMMUNITY_CHAT_GROUPING_ENABLED ? <ChatContextHeader
          title={props.title} subtitle={typingLabel ?? props.subtitle} location={props.locationLabel}
          contextLabel={props.viewContextLabel} fonts={conversationFonts}
          onBack={() => { Keyboard.dismiss(); router.navigate('/(tabs)/chats' as never); }} onViewContext={props.onViewContext}
          wrapActionsOnNarrow={!!props.calendarAction}
          actions={<>
            {props.calendarAction && <TouchableOpacity onPress={props.calendarAction.onPress} accessibilityRole="button" accessibilityLabel={props.calendarAction.label} style={chatHeaderActionStyle}>
              <Ionicons name="calendar-outline" size={21} color={AfterglowColors.clay} />
            </TouchableOpacity>}
            {props.headerMenu.type === 'plus' ? <TouchableOpacity ref={plusBtnRef} onPress={openPlusFromButton} style={chatHeaderActionStyle} accessibilityRole="button" accessibilityLabel="Add people or make a plan">
              <Ionicons name="add" size={24} color={AfterglowColors.clay} />
            </TouchableOpacity> : <TouchableOpacity onPress={handleReportMenu} style={chatHeaderActionStyle} accessibilityRole="button" accessibilityLabel="More options">
              <Ionicons name="ellipsis-horizontal" size={21} color={AfterglowColors.ink} />
            </TouchableOpacity>}
          </>}
        /> : <View style={chatStyles.header}>
          <TouchableOpacity
            onPress={() => { Keyboard.dismiss(); router.navigate('/(tabs)/chats' as never); }}
            style={chatStyles.backBtn}
            accessibilityRole="button"
            accessibilityLabel="Back to Chats"
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Ionicons name="chevron-back" size={24} color={Colors.asphalt} />
          </TouchableOpacity>

          <View style={chatStyles.headerCenter}>
            <Text style={chatStyles.headerTitle} numberOfLines={1}>{props.title}</Text>
            {(typingLabel ?? props.subtitle) != null && (
              <Text style={chatStyles.headerSub} numberOfLines={1}>
                {typingLabel ?? props.subtitle}
              </Text>
            )}
          </View>

          <TouchableOpacity
            onPress={props.onViewContext}
            style={chatStyles.viewPlanBtn}
            accessibilityRole="button"
            accessibilityLabel={props.viewContextLabel}
          >
            <Text style={chatStyles.viewPlanText} numberOfLines={1}>{props.viewContextLabel}</Text>
          </TouchableOpacity>

          {props.headerMenu.type === 'plus' ? (
            <TouchableOpacity
              ref={plusBtnRef}
              onPress={openPlusFromButton}
              style={chatStyles.ellipsisBtn}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              accessibilityRole="button"
              accessibilityLabel="Add people or make a plan"
            >
              <Ionicons name="add" size={24} color={Colors.terracotta} />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              onPress={handleReportMenu}
              style={chatStyles.ellipsisBtn}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              accessibilityRole="button"
              accessibilityLabel="More options"
            >
              <Ionicons name="ellipsis-horizontal" size={20} color={Colors.warmGray} />
            </TouchableOpacity>
          )}
          <ProfileButton compact/>
        </View>}

        {/* Header banner slot (plan ticket banner) */}
        {props.renderHeaderBanner?.()}

        {/* Member avatars row */}
        {members.length > 0 && (() => {
          const total = members.length;
          const isOverflow = total > 5;
          const visibleMembers = !isOverflow || membersExpanded
            ? members
            : members.slice(0, 4);
          return (
            <ScrollView
              decelerationRate="normal"
              horizontal
              showsHorizontalScrollIndicator={false}
              style={[chatStyles.membersRow, COMMUNITY_CHAT_GROUPING_ENABLED && { backgroundColor: AfterglowColors.paper }]}
              contentContainerStyle={chatStyles.membersRowContent}
            >
              {visibleMembers.map((member) => (
                <TouchableOpacity
                  key={member.id}
                  style={[chatStyles.memberItem, COMMUNITY_CHAT_GROUPING_ENABLED && { width: 44, minHeight: 44 }]}
                  onPress={() => handleAvatarPress(member.id)}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={`View ${member.first_name || 'member'} profile`}
                >
                  {member.avatar_url ? (
                    <Image source={{ uri: member.avatar_url }} style={chatStyles.memberAvatar} contentFit="cover" />
                  ) : (
                    <View style={[chatStyles.memberAvatar, chatStyles.memberAvatarFallback]}>
                      <ChatSizedText allowFontScaling={!COMMUNITY_CHAT_GROUPING_ENABLED} style={[chatStyles.memberInitial, COMMUNITY_CHAT_GROUPING_ENABLED && { fontFamily: conversationFonts.medium, color: AfterglowColors.clay }]}>{member.first_name?.[0]?.toUpperCase() ?? '?'}</ChatSizedText>
                    </View>
                  )}
                  <ChatSizedText style={[chatStyles.memberName, COMMUNITY_CHAT_GROUPING_ENABLED && { fontFamily: conversationFonts.regular, color: AfterglowColors.muted }]} numberOfLines={1}>{member.first_name ?? ''}</ChatSizedText>
                </TouchableOpacity>
              ))}
              {isOverflow && !membersExpanded && (
                <TouchableOpacity
                  style={[chatStyles.memberItem, COMMUNITY_CHAT_GROUPING_ENABLED && { width: 44, minHeight: 44 }]}
                  onPress={() => setMembersExpanded(true)}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={`Show ${total - 4} more members`}
                >
                  <View style={[chatStyles.memberAvatar, chatStyles.memberOverflow]}>
                    <ChatSizedText style={chatStyles.memberOverflowText}>+{total - 4}</ChatSizedText>
                  </View>
                </TouchableOpacity>
              )}
              {isOverflow && membersExpanded && (
                <TouchableOpacity
                  style={[chatStyles.memberItem, COMMUNITY_CHAT_GROUPING_ENABLED && { width: 44, minHeight: 44 }]}
                  onPress={() => setMembersExpanded(false)}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel="Show fewer members"
                >
                  <View style={[chatStyles.memberAvatar, chatStyles.memberOverflow]}>
                    <Ionicons name="chevron-back" size={16} color={Colors.terracotta} />
                  </View>
                </TouchableOpacity>
              )}
            </ScrollView>
          );
        })()}

      </View>

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
            onScroll={handleListScroll}
            onEndReached={() => { void loadOlder(); }}
            onEndReachedThreshold={0.2}
            scrollEventThrottle={16}
            // Inverted list: the header renders at the visual bottom (newest
            // side), so the typing dots sit just above the input bar.
            ListHeaderComponent={typingUsers.length > 0 ? <TypingIndicator /> : null}
            onScrollToIndexFailed={(info) => {
              if (anchorId) { anchorScroll.onScrollToIndexFailed(info); return; }
              listRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: true });
              setTimeout(() => {
                listRef.current?.scrollToIndex({ index: info.index, animated: true, viewPosition: 0.5 });
              }, 300);
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
            {(!composerDraft.ready || composerDraft.error || composerDraft.draft.attempt && !sendingText) && (
              <View style={chatStyles.replyBar}>
                <View style={chatStyles.replyBarContent}>
                  <Text style={[chatStyles.replyBarName, composerAppearance?.contextName]}>{composerDraft.error ? 'Your draft could not be saved or checked.' : !composerDraft.ready ? 'Checking your draft…' : 'Your previous message is not confirmed.'}</Text>
                  {!!composerDraft.draft.attempt && <Text style={[chatStyles.replyBarText, composerAppearance?.contextBody]} numberOfLines={2}>{composerDraft.draft.attempt.text}</Text>}
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16 }}>
                    {composerDraft.error ? <TouchableOpacity accessibilityRole="button" accessibilityLabel="Retry message draft" style={chatStyles.draftRecoveryAction} onPress={() => { void composerDraft.retry(); }}><Text style={[chatStyles.replyBarName, composerAppearance?.contextName]}>Try again</Text></TouchableOpacity>
                      : composerDraft.draft.attempt && <>
                        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Check original message" style={chatStyles.draftRecoveryAction} disabled={checkingDraft} onPress={() => { void checkPendingDraft(); }}><Text style={[chatStyles.replyBarName, composerAppearance?.contextName]}>Check message</Text></TouchableOpacity>
                        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Retry original message" style={chatStyles.draftRecoveryAction} disabled={checkingDraft || !canWrite()} onPress={() => { void handleSend(true); }}><Text style={[chatStyles.replyBarName, composerAppearance?.contextName]}>Retry original</Text></TouchableOpacity>
                      </>}
                  </View>
                </View>
              </View>
            )}
            {replyingTo && (
              <View style={chatStyles.replyBar}>
                <View style={chatStyles.replyBarLeft}>
                  <Ionicons name="arrow-undo-outline" size={16} color={composerAppearance ? AfterglowColors.clay : Colors.terracotta} />
                  <View style={chatStyles.replyBarContent}>
                    <Text style={[chatStyles.replyBarName, composerAppearance?.contextName]}>{replyingTo.senderName}</Text>
                    <Text style={[chatStyles.replyBarText, composerAppearance?.contextBody]} numberOfLines={1}>{replyingTo.content}</Text>
                  </View>
                </View>
                <TouchableOpacity onPress={() => { if (!canWrite()) return; draftRevision.current++; draftContextRevision.current++; setReplyingTo(null); }} style={chatStyles.composerCancel} accessibilityRole="button" accessibilityLabel="Cancel reply">
                  <Ionicons name="close" size={18} color={composerAppearance ? AfterglowColors.muted : Colors.warmGray} />
                </TouchableOpacity>
              </View>
            )}
            {editingMessageId && (
              <View style={chatStyles.editingBar}>
                <Ionicons name="create-outline" size={16} color={composerAppearance ? AfterglowColors.clay : Colors.terracotta} />
                <Text style={[chatStyles.editingText, composerAppearance?.contextName]}>Editing message</Text>
                <TouchableOpacity onPress={() => { if (!canWrite()) return; draftRevision.current++; draftContextRevision.current++; setEditingMessageId(null); setInputText(''); inputTextRef.current = ''; }} style={chatStyles.composerCancel} accessibilityRole="button" accessibilityLabel="Cancel edit">
                  <Ionicons name="close" size={18} color={composerAppearance ? AfterglowColors.muted : Colors.warmGray} />
                </TouchableOpacity>
              </View>
            )}
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

function createConversationAppearance(fonts: AfterglowFontFamilies) {
  return StyleSheet.create({
    screen: { backgroundColor: AfterglowColors.paper },
    day: { ...AfterglowType.caption, fontFamily: fonts.regular, color: AfterglowColors.muted, backgroundColor: AfterglowColors.paper, borderRadius: 0 },
    title: { ...AfterglowType.identity, fontFamily: fonts.semibold, color: AfterglowColors.ink },
    body: { ...AfterglowType.body, fontFamily: fonts.regular, color: AfterglowColors.muted },
    warning: { minHeight: 44, justifyContent: 'center', backgroundColor: AfterglowColors.white, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: AfterglowColors.line },
    button: { minHeight: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: AfterglowColors.clay, borderRadius: 6 },
    buttonText: { ...AfterglowType.body, fontFamily: fonts.semibold, color: AfterglowColors.white },
    textAction: { minHeight: 44, justifyContent: 'center' },
    link: { ...AfterglowType.body, fontFamily: fonts.medium, color: AfterglowColors.clay },
  });
}

const chatStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.parchment },
  headerSafe: { backgroundColor: Colors.white },
  listWrap: { flex: 1 },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadErrorWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 12 },
  loadErrorTitle: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.asphalt, textAlign: 'center' },
  loadErrorText: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.secondary, textAlign: 'center' },
  loadRetry: { backgroundColor: Colors.terracotta, borderRadius: 24, minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 12, marginTop: 4 },
  loadRetryText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.white },
  loadWarning: { backgroundColor: Colors.inputBg, paddingHorizontal: 16, paddingVertical: 9 },
  loadWarningText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.asphalt, textAlign: 'center' },
  olderRetry: { alignSelf: 'center', paddingHorizontal: 16, paddingVertical: 12, marginVertical: 8 },
  olderRetryText: { fontFamily: Fonts.sansSemibold, fontSize: FontSizes.bodySM, color: Colors.terracotta, textAlign: 'center' },
  pushBanner: {
    backgroundColor: Colors.inputBg,
    paddingVertical: 10,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },
  pushBannerContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  pushBannerText: {
    flex: 1,
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.asphalt,
  },
  pushBannerButton: {
    backgroundColor: Colors.terracotta,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
  },
  pushBannerButtonText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodySM,
    color: Colors.white,
  },
  pushBannerClose: {
    marginLeft: 8,
    padding: 4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: Colors.white,
    gap: 8,
  },
  backBtn: { padding: 2 },
  headerCenter: { flex: 1, minWidth: 0 },
  headerTitle: { fontSize: 16, fontWeight: '700' as const, color: Colors.darkWarm },
  headerSub: { fontSize: 11, color: Colors.secondary, marginTop: 1 },
  viewPlanBtn: {
    borderWidth: 1.5,
    borderColor: Colors.terracotta,
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 4,
    // Cap so a long DM counterpart name ("View Magdalena") can't crowd/wrap the
    // header; the title (flex:1) truncates first, then this.
    maxWidth: 85,
  },
  viewPlanText: { fontSize: 12, fontWeight: '600' as const, color: Colors.terracotta },
  ellipsisBtn: {
    padding: 4,
  },
  membersRow: {
    backgroundColor: Colors.white,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.border,
    flexGrow: 0,
  },
  membersRowContent: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
  },
  memberItem: {
    alignItems: 'center',
    width: 40,
  },
  memberAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  memberAvatarFallback: {
    backgroundColor: Colors.dividerWarm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberInitial: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.terracotta,
  },
  memberName: {
    fontSize: 9,
    color: Colors.secondary,
    marginTop: 2,
    textAlign: 'center',
    maxWidth: 40,
  },
  memberOverflow: {
    backgroundColor: Colors.cream,
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberOverflowText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.terracotta,
  },

  messageList: { paddingTop: 4, paddingBottom: 12 },
  msgGap1: { marginBottom: 1 },
  msgGap10: { marginBottom: 10 },
  msgGap18: { marginBottom: 18 },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
    transform: Platform.OS === 'android'
      ? [{ scaleY: -1 }, { scaleX: -1 }]
      : [{ scaleY: -1 }],
  },
  emptyMark: {
    marginBottom: 12,
  },
  emptyText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodyLG,
    color: Colors.tertiary,
  },

  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingTop: 8,
    backgroundColor: Colors.white,
    borderTopWidth: 1,
    borderTopColor: Colors.inputBg,
    gap: 8,
  },
  cameraBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  input: {
    flex: 1,
    backgroundColor: Colors.inputBg,
    borderRadius: 20,
    paddingLeft: 10,
    paddingRight: 10,
    paddingTop: 9,
    paddingBottom: 9,
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.asphalt,
    maxHeight: 100,
    textAlign: 'left',
  },
  emojiBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  sendMorphWrap: {
    width: 36,
    height: 36,
    marginBottom: 2,
  },
  morphLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendCircle: { backgroundColor: Colors.terracotta },
  recorderOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: Colors.white,
    borderTopWidth: 1,
    borderTopColor: Colors.inputBg,
  },
  attachPanelWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },

  readOnlyBar: {
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 20,
    backgroundColor: Colors.white,
    borderTopWidth: 1,
    borderTopColor: Colors.inputBg,
  },
  readOnlyText: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.warmGray },
  countdownText: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.secondary,
    textAlign: 'center',
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: Colors.inputBg,
  },
  draftRecoveryAction: { minHeight: 44, justifyContent: 'center' },
  replyBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: Colors.inputBg,
  },
  replyBarLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  replyBarContent: {
    flex: 1,
  },
  replyBarName: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.caption,
    color: Colors.terracotta,
  },
  replyBarText: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.caption,
    color: Colors.warmGray,
  },
  editingBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: Colors.inputBg,
    gap: 8,
  },
  editingText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Colors.terracotta,
    flex: 1,
  },
  composerCancel: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },

  mentionBar: {
    borderTopWidth: 1,
    borderTopColor: Colors.inputBg,
  },
  mentionBarContent: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
    alignItems: 'center',
  },
  mentionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 999,
    backgroundColor: Colors.inputBg,
  },
  mentionAvatar: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: Colors.border,
  },
  mentionAvatarFallback: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: Colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mentionInitial: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.caption,
    color: Colors.terracotta,
  },
  mentionName: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Colors.asphalt,
    maxWidth: 120,
  },

  photoModal: {
    flex: 1,
    backgroundColor: Colors.overlayDarker,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoFull: { width: '100%', height: '80%' },
  photoClose: {
    position: 'absolute',
    top: 60,
    right: 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.overlayLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
