import React, { useState, useRef, useCallback, useEffect, useMemo, memo } from 'react';
import {
  View,
  Text,
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
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import { FlashList, FlashListRef } from '@shopify/flash-list';
import { KEYBOARD_DONE_ACCESSORY_ID } from '../keyboard/KeyboardDoneBar';
import * as Notifications from 'expo-notifications'; // setBadgeCountAsync only -- local-only API, no server call.
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
// Lazy-load expo-clipboard so older production binaries (built before this dep
// was added) don't crash when this screen's module is imported.
let Clipboard: typeof import('expo-clipboard') | null = null;
try { Clipboard = require('expo-clipboard'); } catch {}
import { hapticLight, hapticMedium } from '../../lib/haptics';
import Animated, { FadeIn, useSharedValue, useAnimatedStyle, withSpring, withTiming, useAnimatedKeyboard, useAnimatedReaction, runOnJS } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { supabase } from '../../lib/supabase';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';
import SunriseIcon from '../yours/icons/SunriseIcon';
import ChatPlanCard from '../chat/ChatPlanCard';
import { openUrl, soleUrlIn } from '../../lib/url';
import { uploadBase64ToStorage } from '../../lib/uploadPhoto';
import type { ChatMessage } from '../../hooks/useChat';
import { useChatEngine } from '../../hooks/useChatEngine';
import { CHAT_PERF_HUD } from '../../constants/FeatureFlags';
import type { ChatThreadProps } from '../chat/ChatThread';
import MiniProfileCard from '../MiniProfileCard';
import AttachmentPanel, { AttachmentKey } from '../chat/AttachmentSheet';
import MediaPanel from '../chat/MediaPanel';
import LocationPickerModal from '../chat/LocationPickerModal';
import PhotoPreviewModal from '../chat/PhotoPreviewModal';
import ReactionEmojiPicker from '../chat/ReactionEmojiPicker';
import LinkPreviewCard from '../chat/LinkPreviewCard';
import TypingIndicator from '../chat/TypingIndicator';
import { useTypingIndicator } from '../../hooks/useTypingIndicator';
import ScrollToBottomButton from '../chat/ScrollToBottomButton';
import VoicePlayer from '../chat/VoicePlayer';
import VoiceRecorder, { RecorderUiMode } from '../chat/VoiceRecorder';
import { useVoiceRecorder } from '../../hooks/useVoiceRecorder';
import { uploadAudioToStorage } from '../../lib/uploadAudio';
import { logError } from '../../lib/logger';
import { ReportModal } from '../modals/ReportModal';
import { useBlock } from '../../hooks/useBlock';
import { BrandedAlert, BrandedAlertButton } from '../BrandedAlert';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { registerForPushNotifications, getPushPermissionStatus } from '../../hooks/usePushNotifications';

// ─── The ONE chat engine (doc 123) ──────────────────────────────────────────
// ChatEngineThread is the doc-123 rebuild of ChatThread: identical chrome,
// bubbles, composer, reactions, replies, voice, and moderation -- with the list
// on @shopify/flash-list v2 (cell recycling, chronological order,
// startRenderingFromBottom) and the data layer on useChatEngine (newest page
// first, cursor-paged history, batched realtime, cached senders).
//
// It accepts the SAME ChatThreadProps as components/chat/ChatThread, so every
// per-kind wrapper can select engine-vs-legacy on CHAT_ENGINE_ENABLED without
// changing anything else. The legacy file is untouched: with the flag off,
// every surface renders exactly the shipped code.
//
// Structural deltas from the legacy thread (everything else is carried over
// verbatim):
//   • FlashList v2, NOT an inverted FlatList. Data is chronological
//     (oldest → newest); maintainVisibleContentPosition renders from the
//     bottom and holds the viewport across prepends, so history pages in
//     under the scroll position without a jump.
//   • Cursor pagination via onStartReached → loadOlder (doc-123 bar: 500
//     messages with no hitch -- they now arrive in pages, not one fetch).
//   • Per-bubble derivations (URL regex, emoji-only Segmenter check, sole-url
//     tap-through) are computed ONCE per message in the enrichment pass and
//     cached by id+content -- not re-run inside each bubble on every recycle
//     (doc 106 §3.4 / doc 107 item 7).
//   • The swipe-to-reply callback is a single stable function receiving the
//     message, not a fresh closure per row per render (the doc 106 §2
//     re-render leak, doc 107 item 5).
//   • Swipe rows reset their gesture translate when a recycled cell is
//     re-bound to a different message (doc 106 §4 risk 4).

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
// aspect ratio. Intrinsic w/h is captured via expo-image's onLoad and cached so
// the same image doesn't re-measure on every recycle.
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

const MENTION_SUGGESTION_LIMIT = 6;
const MENTION_AT_CARET = /(?:^|\s)@([\p{L}\p{N}_]*)$/u;
function mentionQueryAt(text: string, caret: number): string | null {
  const before = text.slice(0, Math.max(0, Math.min(caret, text.length)));
  const m = before.match(MENTION_AT_CARET);
  return m ? m[1] : null;
}

// A message that is only 1-3 emoji (no letters/numbers) renders large with no
// bubble. Hermes may lack Intl.Segmenter, so fall back to a code-point count.
function isEmojiOnly(text: string): boolean {
  const t = text.trim();
  if (!t || /[\p{L}\p{N}]/u.test(t)) return false;
  if (!/\p{Extended_Pictographic}/u.test(t)) return false;
  const Seg = (Intl as any)?.Segmenter;
  const count = Seg ? Array.from(new Seg().segment(t)).length : Array.from(t).length;
  return count <= 3;
}

const TOKEN_PATTERN = /(https?:\/\/[^\s]+|www\.[^\s]+|@[\p{L}\p{N}_]+)/giu;

function LinkedText({ text, style, linkStyle, mentionNames, mentionStyle }: {
  text: string;
  style: any;
  linkStyle?: any;
  mentionNames?: Set<string>;
  mentionStyle?: any;
}) {
  const parts = text.split(TOKEN_PATTERN);
  if (parts.length === 1) return <Text style={style}>{text}</Text>;

  return (
    <Text style={style}>
      {parts.map((part, i) => {
        if (!part) return null;
        if (URL_PATTERN.test(part)) {
          return (
            <Text
              key={i}
              style={[linkStyle ?? { textDecorationLine: 'underline' as const }]}
              onPress={() => openUrl(part)}
            >
              {part}
            </Text>
          );
        }
        if (mentionNames && part[0] === '@' && mentionNames.has(part.slice(1).toLowerCase())) {
          return <Text key={i} style={mentionStyle}>{part}</Text>;
        }
        return <Text key={i}>{part}</Text>;
      })}
    </Text>
  );
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

// ─── Per-message derived values (hoisted out of the bubble) ──────────────────
// These were three useMemos inside every MessageBubble; under recycling they
// re-ran on every rebind. Computed once per message content here, cached
// module-wide (content edits change the key, so an edited message re-derives).

export interface DerivedMessageBits {
  firstUrl: string | null;
  bubbleUrl: string | null;
  emojiOnly: boolean;
}

const derivedCache = new Map<string, DerivedMessageBits>();

export function deriveMessageBits(m: ChatMessage): DerivedMessageBits {
  const key = `${m.id}:${m.content ?? ''}`;
  const hit = derivedCache.get(key);
  if (hit) return hit;
  const isUser = (m.message_type ?? 'user') === 'user';
  const bits: DerivedMessageBits = {
    firstUrl: isUser ? (m.content?.match(URL_PATTERN)?.[0] ?? null) : null,
    bubbleUrl: isUser ? soleUrlIn(m.content) : null,
    emojiOnly: isUser ? isEmojiOnly(m.content) : false,
  };
  derivedCache.set(key, bits);
  return bits;
}

// ─── Message Bubble ───────────────────────────────────────────────────────────

interface BubbleProps {
  message: ChatMessage;
  derived: DerivedMessageBits;
  isOwn: boolean;
  showAvatar: boolean;
  showName: boolean;
  isGrouped: boolean;
  currentUserId: string;
  contextTitle?: string;
  onPhotoPress?: (url: string) => void;
  onReaction?: (messageId: string, emoji?: string) => void;
  onMessageLongPress?: (message: ChatMessage, isOwn: boolean) => void;
  onReplyTap?: (messageId: string) => void;
  onAvatarPress?: (userId: string) => void;
  mentionNames?: Set<string>;
}

// The bare system-row templates the app writes today (app/plan/[id].tsx).
const BARE_SYSTEM_TEMPLATES = /^(joined the plan|had to leave the plan|cancelled this plan)$/i;

export const EngineMessageBubble = memo(function EngineMessageBubble({ message, derived, isOwn, showAvatar, showName, isGrouped, currentUserId, contextTitle, onPhotoPress, onReaction, onMessageLongPress, onReplyTap, onAvatarPress, mentionNames }: BubbleProps) {
  if (message.message_type === 'system') {
    if (message.ref_event_id) {
      return (
        <View style={bubbleStyles.systemRow}>
          <ChatPlanCard eventId={message.ref_event_id} />
        </View>
      );
    }
    let displayContent = message.content;
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
        <Text style={bubbleStyles.systemText}>{displayContent}</Text>
      </View>
    );
  }

  const handleLongPress = () => {
    hapticMedium();
    onMessageLongPress?.(message, isOwn);
  };

  const reactions = message.reactions ?? [];
  const totalReactions = reactions.length;
  const uniqueEmojis = useMemo(() => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const r of reactions) {
      if (!seen.has(r.reaction)) { seen.add(r.reaction); out.push(r.reaction); }
    }
    return out;
  }, [reactions]);
  const iReacted = reactions.some(r => r.user_id === currentUserId);
  const { firstUrl, bubbleUrl, emojiOnly: isEmojiOnlyMsg } = derived;
  // Intrinsic image size -- seeded from the module-level cache; recycling a
  // cell onto a new message re-seeds via the effect below.
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(
    () => (message.image_url ? imageSizeCache.get(message.image_url) ?? null : null),
  );
  useEffect(() => {
    setImgSize(message.image_url ? imageSizeCache.get(message.image_url) ?? null : null);
  }, [message.image_url]);
  const imageDisplaySize = useMemo(() => fitImage(imgSize), [imgSize]);

  const borderRadius = isOwn
    ? { borderTopLeftRadius: 18, borderTopRightRadius: 18, borderBottomLeftRadius: 18, borderBottomRightRadius: 2 }
    : { borderTopLeftRadius: 18, borderTopRightRadius: 18, borderBottomLeftRadius: 2, borderBottomRightRadius: 18 };

  return (
    <View
      style={[
        bubbleStyles.row,
        isOwn ? bubbleStyles.rowOwn : bubbleStyles.rowOther,
        // Reaction badge is absolutely positioned at bottom:-12 of the bubble.
        // Without extra clearance below, it overlaps the next message.
        totalReactions > 0 && bubbleStyles.rowWithReaction,
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
                <View style={[bubbleStyles.avatar, bubbleStyles.avatarFallback]}>
                  <Text style={bubbleStyles.avatarInitial}>
                    {message.sender?.first_name?.[0]?.toUpperCase() ?? '?'}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          ) : null}
        </View>
      )}

      <View style={[bubbleStyles.bubbleWrapper, isOwn ? bubbleStyles.wrapperOwn : bubbleStyles.wrapperOther]}>
        {!isOwn && showName && (
          <Text style={bubbleStyles.senderLine}>
            <Text style={bubbleStyles.senderName}>{message.sender?.first_name ?? 'Someone'}</Text>
            <Text style={bubbleStyles.senderDot}> · </Text>
            <Text style={bubbleStyles.senderTime}>{formatMessageTime(message.created_at)}</Text>
          </Text>
        )}

        <Pressable
          onPress={bubbleUrl ? () => openUrl(bubbleUrl) : undefined}
          onLongPress={handleLongPress}
          delayLongPress={400}
        >
          {message.message_type === 'audio' && message.audio_url ? (
            <View style={[
              bubbleStyles.bubble,
              bubbleStyles.bubbleText,
              isOwn ? bubbleStyles.bubbleOwn : bubbleStyles.bubbleOther,
              borderRadius,
            ]}>
              <VoicePlayer
                uri={message.audio_url}
                durationSeconds={message.duration_seconds ?? 0}
                isOwn={isOwn}
              />
            </View>
          ) : !!message.image_url ? (
            <View>
              <Pressable
                onPress={() => onPhotoPress?.(message.image_url!)}
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
              {!!message.content?.trim() && (
                <Text style={[bubbleStyles.imageCaption, isOwn && bubbleStyles.imageCaptionOwn]}>
                  {message.content}
                </Text>
              )}
            </View>
          ) : message.message_type === 'location' ? (() => {
            let lat = 0, lng = 0, address = '';
            try { const p = JSON.parse(message.content); lat = p.lat; lng = p.lng; address = p.address; } catch {}
            return (
              <Pressable
                onPress={() => openLocationInMaps(lat, lng, address)}
                style={[
                  bubbleStyles.bubble,
                  bubbleStyles.locationBubble,
                  isOwn ? bubbleStyles.bubbleOwn : bubbleStyles.bubbleOther,
                  borderRadius,
                ]}
              >
                <View style={bubbleStyles.locationPinRow}>
                  <Ionicons name="location" size={15} color={isOwn ? Colors.white : Colors.terracotta} />
                  <Text style={[bubbleStyles.locationLabel, isOwn && bubbleStyles.locationLabelOwn]}>
                    Shared location
                  </Text>
                </View>
                <Text style={[bubbleStyles.locationAddress, isOwn && bubbleStyles.locationAddressOwn]} numberOfLines={2}>
                  {address}
                </Text>
                <Text style={[bubbleStyles.locationTapHint, isOwn && bubbleStyles.locationTapHintOwn]}>
                  Tap to open in Maps
                </Text>
              </Pressable>
            );
          })() : isEmojiOnlyMsg && !message.reply_to ? (
            <View style={bubbleStyles.emojiOnlyWrap}>
              <Text style={bubbleStyles.emojiOnly}>{message.content}</Text>
            </View>
          ) : (
            <View style={[
              bubbleStyles.bubble,
              bubbleStyles.bubbleText,
              isOwn ? bubbleStyles.bubbleOwn : bubbleStyles.bubbleOther,
              borderRadius,
            ]}>
              {message.reply_to && (
                <TouchableOpacity
                  onPress={() => onReplyTap?.(message.reply_to!.id)}
                  style={[bubbleStyles.replyQuote, isOwn ? bubbleStyles.replyQuoteOwn : bubbleStyles.replyQuoteOther]}
                  activeOpacity={0.7}
                >
                  <Text style={[bubbleStyles.replyQuoteName, isOwn && bubbleStyles.replyQuoteNameOwn]}>
                    {message.reply_to.sender_name ?? 'Someone'}
                  </Text>
                  <Text style={[bubbleStyles.replyQuoteText, isOwn && bubbleStyles.replyQuoteTextOwn]} numberOfLines={2}>
                    {message.reply_to.content}
                  </Text>
                </TouchableOpacity>
              )}
              <LinkedText
                text={message.content}
                style={[bubbleStyles.messageText, isOwn && bubbleStyles.messageTextOwn]}
                linkStyle={isOwn ? bubbleStyles.linkOwn : bubbleStyles.linkOther}
                mentionNames={mentionNames}
                mentionStyle={isOwn ? bubbleStyles.mentionOwn : bubbleStyles.mention}
              />
              {firstUrl && <LinkPreviewCard url={firstUrl} isOwn={isOwn} />}
            </View>
          )}

          {totalReactions > 0 && (
            <View style={[bubbleStyles.reactionBadge, isOwn ? bubbleStyles.reactionBadgeOwn : bubbleStyles.reactionBadgeOther, iReacted && bubbleStyles.reactionBadgeMine]}>
              {uniqueEmojis.map((emoji) => (
                <Text key={emoji} style={bubbleStyles.reactionEmoji}>
                  {emoji === 'heart' ? '\u2764\uFE0F' : emoji}
                </Text>
              ))}
              {totalReactions > 1 && (
                <Text style={bubbleStyles.reactionCount}>{totalReactions}</Text>
              )}
            </View>
          )}
        </Pressable>

      </View>
    </View>
  );
});

const bubbleStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 2, paddingHorizontal: 16 },
  rowOwn: { justifyContent: 'flex-end' },
  rowOther: { justifyContent: 'flex-start' },
  // Extra clearance below a row whose reaction badge dangles 12px under the
  // bubble. 16 = badge offset (12) + breathing room (4).
  rowWithReaction: { marginBottom: 16 },
  avatarSlot: { width: 28, marginRight: 8, alignSelf: 'flex-end' },
  avatar: { width: 28, height: 28, borderRadius: 14 },
  avatarFallback: { backgroundColor: Colors.inputBg, alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { fontFamily: Fonts.sansBold, fontSize: FontSizes.caption, color: Colors.terracotta },
  bubbleWrapper: { maxWidth: '80%', gap: 3 },
  wrapperOwn: { alignItems: 'flex-end' },
  wrapperOther: { alignItems: 'flex-start' },
  senderLine: { marginBottom: 2, marginLeft: 4 },
  senderName: { fontWeight: '700', fontSize: 12, color: Colors.terracotta },
  senderDot: { fontSize: 10, color: Colors.tertiary },
  senderTime: { fontSize: 10, color: Colors.secondary },
  bubble: { overflow: 'hidden' },
  bubbleText: { paddingHorizontal: 14, paddingVertical: 10 },
  bubbleOwn: { backgroundColor: Colors.terracotta },
  bubbleOther: {
    backgroundColor: Colors.dividerWarm,
  },
  messageText: { fontFamily: Fonts.sans, fontSize: 15, color: Colors.darkWarm, lineHeight: 22 },
  emojiOnly: { fontSize: 44, lineHeight: 54, paddingVertical: 2 },
  emojiOnlyWrap: { paddingVertical: 6, paddingHorizontal: 10 },
  imageCaption: { fontFamily: Fonts.sans, fontSize: 15, color: Colors.darkWarm, lineHeight: 21, marginTop: 6, maxWidth: 260 },
  imageCaptionOwn: { color: Colors.darkWarm },
  messageTextOwn: { color: Colors.white },
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
    borderRadius: 4,
  },
  replyQuoteOwn: {
    borderLeftColor: 'rgba(255,255,255,0.5)',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  replyQuoteOther: {
    borderLeftColor: Colors.terracotta,
    backgroundColor: 'rgba(0,0,0,0.04)',
  },
  replyQuoteName: {
    fontFamily: Fonts.sansBold,
    fontSize: 12,
    color: Colors.terracotta,
    marginBottom: 1,
  },
  replyQuoteNameOwn: {
    color: 'rgba(255,255,255,0.85)',
  },
  replyQuoteText: {
    fontFamily: Fonts.sans,
    fontSize: 12,
    color: Colors.textMedium,
    lineHeight: 16,
  },
  replyQuoteTextOwn: {
    color: 'rgba(255,255,255,0.7)',
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
  locationTapHintOwn: { color: 'rgba(255,255,255,0.7)' },
});

// ─── Swipe to reply ─────────────────────────────────────────────────────────
// Same gesture as the legacy thread, with two engine deltas: the reply
// callback is a stable (message) => void shared by every row, and the
// translate resets when FlashList recycles the cell onto a different message.
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

// Scroll-to-bottom button thresholds (chronological list: distance from the
// content bottom; 0 = pinned to newest).
const SCROLL_SHOW_THRESHOLD = 300;
const SCROLL_AT_BOTTOM_THRESHOLD = 24;
const SCROLL_BTN_GAP = 12;

// How far from the top edge (in viewport lengths) the older-history page
// starts loading. 0.6 ≈ starts fetching before the user actually hits the top.
const START_REACHED_THRESHOLD = 0.6;

// Inline attachment panel height used until a real keyboard height is observed
// this session (the panel then matches the keyboard it replaces).
const PANEL_FALLBACK_HEIGHT = 280;
const PANEL_ANIM_MS = 180;
const PHOTO_BATCH_LIMIT = 10;

// Voice recording hold gesture thresholds (mirrors WhatsApp).
const VOICE_HOLD_MS = 200;
const VOICE_CANCEL_THRESHOLD = 80;
const VOICE_LOCK_THRESHOLD = 80;

const SwipeableRow = memo(function SwipeableRow({
  enabled,
  message,
  onTriggerReply,
  containerStyle,
  children,
}: {
  enabled: boolean;
  message: ChatMessage;
  onTriggerReply: (message: ChatMessage) => void;
  containerStyle: any;
  children: React.ReactNode;
}) {
  const translateX = useSharedValue(0);
  const triggered = useSharedValue(false);

  // Latest message + callback in refs so the memoized gesture never fires a
  // stale closure after re-render or recycle.
  const messageRef = useRef(message);
  messageRef.current = message;
  const onTriggerReplyRef = useRef(onTriggerReply);
  onTriggerReplyRef.current = onTriggerReply;
  const fireReply = useCallback(() => onTriggerReplyRef.current?.(messageRef.current), []);

  // Recycle reset: when this cell is re-bound to a different message, any
  // in-flight translate from the previous binding must not carry over.
  useEffect(() => {
    translateX.value = 0;
    triggered.value = false;
  }, [message.id, translateX, triggered]);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .enabled(enabled)
        .activeOffsetX([SWIPE_REPLY_ACTIVE_OFFSET_X, Number.MAX_SAFE_INTEGER])
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

// ─── Enrichment (exported for the dev benchmark) ─────────────────────────────

export type EnrichedItem = ChatMessage | { type: 'date'; label: string; id: string } | { type: 'time'; label: string; id: string };

// Chronological (oldest → newest) -- the FlashList is NOT inverted; separators
// precede the message they introduce, exactly as read.
export function buildEnrichedItems(messages: ChatMessage[]): EnrichedItem[] {
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
  return items;
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

function ChatEngineThread(props: ChatThreadProps) {
  const { id } = props;
  const isPast = props.readOnly != null;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [inputText, setInputText] = useState('');
  const [uploading, setUploading] = useState(false);
  const [photoViewUrl, setPhotoViewUrl] = useState<string | null>(null);
  const [showReport, setShowReport] = useState(false);
  const [reportTarget, setReportTarget] = useState<{ id: string; name: string } | null>(null);
  const [miniProfileUserId, setMiniProfileUserId] = useState<string | null>(null);
  const [alertInfo, setAlertInfo] = useState<{ title: string; message: string; buttons?: BrandedAlertButton[] } | null>(null);
  const [overlayMessage, setOverlayMessage] = useState<{ message: ChatMessage; isOwn: boolean } | null>(null);
  const listRef = useRef<FlashListRef<EnrichedItem>>(null);
  // Measured so the "+" header menu (DMs) can bloom from the button.
  const plusBtnRef = useRef<View>(null);
  const openPlusFromButton = useCallback(() => {
    if (props.headerMenu.type !== 'plus') return;
    const onPress = props.headerMenu.onPress;
    plusBtnRef.current?.measureInWindow((x, y, width, height) =>
      onPress({ x, y, width, height }),
    );
  }, [props.headerMenu]);
  const { messages, loading, loadingOlder, hasMore, currentUserId, sendMessage, sendLocation, sendAudio, deleteMessage, editMessage, toggleReaction, loadOlder, refetch } = useChatEngine({ kind: props.kind, id });

  // ── doc-106 s5 perf markers ──────────────────────────────────────────
  // Production builds have no dev menu and no RN perf monitor, so the
  // device measurement pass reads these instead. Behind CHAT_PERF_HUD
  // (ships off): when the flag is off nothing renders and no timing state
  // ever updates.
  const perfMountRef = useRef(CHAT_PERF_HUD ? performance.now() : 0);
  const [perfLayoutMs, setPerfLayoutMs] = useState<number | null>(null);
  const [perfDataMs, setPerfDataMs] = useState<number | null>(null);
  const [perfSendMs, setPerfSendMs] = useState<number | null>(null);
  const perfSendStartRef = useRef<number | null>(null);
  const handlePerfLayout = useCallback(() => {
    if (!CHAT_PERF_HUD) return;
    setPerfLayoutMs(prev => prev ?? Math.round(performance.now() - perfMountRef.current));
  }, []);
  useEffect(() => {
    if (!CHAT_PERF_HUD || loading || perfDataMs !== null) return;
    setPerfDataMs(Math.round(performance.now() - perfMountRef.current));
  }, [loading, perfDataMs]);
  useEffect(() => {
    if (!CHAT_PERF_HUD || perfSendStartRef.current === null) return;
    setPerfSendMs(Math.round(performance.now() - perfSendStartRef.current));
    perfSendStartRef.current = null;
  }, [messages.length]);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<{ id: string; content: string; senderName: string } | null>(null);
  const [membersExpanded, setMembersExpanded] = useState(false);
  // Keyboard handling is carried over from the legacy thread unchanged:
  // iOS listens to keyboardWillShow and pads a wrapper (KAV is broken under
  // Fabric); Android uses Reanimated's useAnimatedKeyboard (edge-to-edge).
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [iosKeyboardHeight, setIosKeyboardHeight] = useState(0);
  const [androidKeyboardHeight, setAndroidKeyboardHeight] = useState(0);

  const [activePanel, setActivePanel] = useState<'attach' | 'emoji' | null>(null);
  const panelOpen = activePanel !== null;
  const [locationPickerOpen, setLocationPickerOpen] = useState(false);
  const [pendingPhotos, setPendingPhotos] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [photoPreviewOpen, setPhotoPreviewOpen] = useState(false);
  const [reactionPickerMsgId, setReactionPickerMsgId] = useState<string | null>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [panelHeight, setPanelHeight] = useState(PANEL_FALLBACK_HEIGHT);
  const panelInset = panelOpen ? panelHeight : 0;

  const animatedKeyboard = useAnimatedKeyboard();
  const panelInsetSV = useSharedValue(0);
  useEffect(() => {
    panelInsetSV.value = withTiming(panelInset, { duration: PANEL_ANIM_MS });
  }, [panelInset, panelInsetSV]);
  const androidInputBarAnimatedStyle = useAnimatedStyle(() => ({
    bottom: Math.max(animatedKeyboard.height.value, panelInsetSV.value),
  }));
  useAnimatedReaction(
    () => animatedKeyboard.height.value,
    (h) => { runOnJS(setAndroidKeyboardHeight)(h); },
    [],
  );
  const InputBarWrapper: React.ComponentType<any> =
    Platform.OS === 'android' ? Animated.View : View;
  const inputBarBottomStyle =
    Platform.OS === 'android'
      ? androidInputBarAnimatedStyle
      : { bottom: Math.max(iosKeyboardHeight, panelInset) };

  // Scroll to the newest message (content bottom in the chronological list).
  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      listRef.current?.scrollToEnd({ animated: true });
    });
  }, []);

  useEffect(() => {
    const scrollToLatest = () => {
      listRef.current?.scrollToEnd({ animated: true });
    };
    const onKeyboardShown = (height: number) => {
      if (height > 0) setPanelHeight(height);
      setActivePanel(null);
    };
    if (Platform.OS === 'ios') {
      const showSub = Keyboard.addListener('keyboardWillShow', (e) => {
        setKeyboardVisible(true);
        setIosKeyboardHeight(e.endCoordinates.height);
        onKeyboardShown(e.endCoordinates.height);
        scrollToLatest();
      });
      const hideSub = Keyboard.addListener('keyboardWillHide', () => {
        setKeyboardVisible(false);
        setIosKeyboardHeight(0);
      });
      return () => {
        showSub.remove();
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
  }, []);
  const inputBarBottomPadding = keyboardVisible || panelOpen ? 8 : insets.bottom + 8;
  // Reserved space at the content bottom so the newest message always sits
  // directly above the input bar (dock is absolutely positioned). Same iOS /
  // Android split as the legacy thread; here it's plain paddingBottom because
  // the list isn't inverted.
  const [bottomDockHeight, setBottomDockHeight] = useState(70);
  const listBottomReservation =
    Platform.OS === 'ios'
      ? bottomDockHeight + 8
      : bottomDockHeight + 8 + Math.max(androidKeyboardHeight, panelInset);

  // ── "Enable notifications" banner ────────────────────────────────────
  const [showPushBanner, setShowPushBanner] = useState(false);
  const PUSH_BANNER_KEY = 'push_banner_dismissed_at';
  const PUSH_BANNER_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

  useEffect(() => {
    if (!currentUserId || messages.length === 0) return;
    const hasOtherMessages = messages.some(m => m.user_id !== currentUserId);
    if (!hasOtherMessages) return;

    let cancelled = false;
    (async () => {
      try {
        const status = await getPushPermissionStatus();
        if (status === 'granted') return;

        const dismissed = await AsyncStorage.getItem(PUSH_BANNER_KEY);
        if (dismissed) {
          const elapsed = Date.now() - parseInt(dismissed, 10);
          if (elapsed < PUSH_BANNER_COOLDOWN_MS) return;
        }
        if (!cancelled) setShowPushBanner(true);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [currentUserId, messages.length]);

  const handleEnablePush = useCallback(async () => {
    const status = await getPushPermissionStatus();
    if (status === 'denied') {
      await AsyncStorage.setItem(PUSH_BANNER_KEY, String(Date.now())).catch(() => {});
      setShowPushBanner(false);
      Linking.openSettings();
      return;
    }

    const token = await registerForPushNotifications({ prompt: true, userId: currentUserId });
    setShowPushBanner(false);
    if (!token) {
      await AsyncStorage.setItem(PUSH_BANNER_KEY, String(Date.now())).catch(() => {});
    }
  }, [currentUserId]);

  const handleDismissPushBanner = useCallback(async () => {
    await AsyncStorage.setItem(PUSH_BANNER_KEY, String(Date.now())).catch(() => {});
    setShowPushBanner(false);
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', async (state) => {
      if (state !== 'active' || !showPushBanner) return;
      const status = await getPushPermissionStatus();
      if (status === 'granted') {
        setShowPushBanner(false);
        registerForPushNotifications({ prompt: false, userId: currentUserId }).catch(() => {});
      }
    });
    return () => sub.remove();
  }, [showPushBanner, currentUserId]);

  // Throttled focus-driven resync (realtime is the live path; this heals).
  const lastChatFocusFetchRef = useRef(0);
  useFocusEffect(
    useCallback(() => {
      const nowTs = Date.now();
      if (nowTs - lastChatFocusFetchRef.current > 15_000) {
        lastChatFocusFetchRef.current = nowTs;
        refetch(true);
      }
      Notifications.setBadgeCountAsync(0).catch(() => {});
    }, [refetch]),
  );

  // active_chat presence (plan-only column) -- identical to the legacy thread.
  const enablePresence = props.enablePresence;
  useFocusEffect(
    useCallback(() => {
      if (!enablePresence) return;
      let cancelled = false;
      let markedActive = false;

      const setActive = async () => {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user || cancelled) return;
        const { error } = await supabase
          .from('profiles')
          .update({ active_chat_event_id: id })
          .eq('id', user.id);
        if (error) {
          if (__DEV__) console.warn('[chat] setActive failed:', error.message);
          return;
        }
        markedActive = true;
      };

      const clearActive = async () => {
        if (!markedActive) return;
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const { error } = await supabase
          .from('profiles')
          .update({ active_chat_event_id: null })
          .eq('id', user.id);
        if (error) {
          if (__DEV__) console.warn('[chat] clearActive failed:', error.message);
          return;
        }
        markedActive = false;
      };

      if (AppState.currentState === 'active') setActive();

      const appSub = AppState.addEventListener('change', (state) => {
        if (state === 'active') setActive();
        else clearActive();
      });

      return () => {
        cancelled = true;
        appSub.remove();
        clearActive();
      };
    }, [id, enablePresence]),
  );

  const { blockUser } = useBlock();

  const members = props.members;

  const currentUserName = useMemo(
    () => members.find(m => m.id === currentUserId)?.first_name ?? null,
    [members, currentUserId],
  );
  const { typingUsers, broadcastTyping, stopTyping } = useTypingIndicator(id, currentUserId, currentUserName, props.kind);

  const mentionNames = useMemo(() => {
    const s = new Set<string>();
    members.forEach(m => { if (m.first_name) s.add(m.first_name.toLowerCase()); });
    return s;
  }, [members]);

  const mentionCandidates = useMemo(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    return members
      .filter(m => m.id !== currentUserId && m.first_name && (q === '' || m.first_name.toLowerCase().startsWith(q)))
      .slice(0, MENTION_SUGGESTION_LIMIT);
  }, [mentionQuery, members, currentUserId]);

  const typingLabel = useMemo(() => {
    if (typingUsers.length === 0) return null;
    if (typingUsers.length === 1) return `${typingUsers[0].name} is typing...`;
    if (typingUsers.length === 2) return `${typingUsers[0].name} and ${typingUsers[1].name} are typing...`;
    return 'Several people are typing...';
  }, [typingUsers]);

  const inputTextRef = useRef('');
  const handleInputChange = useCallback((text: string) => {
    setInputText(text);
    inputTextRef.current = text;
    broadcastTyping();
    setMentionQuery(mentionQueryAt(text, selectionRef.current.start));
  }, [broadcastTyping]);
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

  const handleReportMenu = useCallback(async () => {
    const reportMembers = (await props.fetchReportMembers?.()) ?? [];

    if (reportMembers.length === 0) {
      setAlertInfo({ title: 'No other members', message: 'There are no other members in this chat to report.' });
      return;
    }

    const memberNames = reportMembers.map(m => m.name);
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: [...memberNames, 'Cancel'], cancelButtonIndex: memberNames.length, title: 'Members' },
        (idx) => {
          if (idx >= reportMembers.length) return;
          const member = reportMembers[idx];
          setTimeout(() => {
            ActionSheetIOS.showActionSheetWithOptions(
              { options: ['Report User', 'Block User', 'Cancel'], destructiveButtonIndex: 1, cancelButtonIndex: 2, title: member.name },
              (actionIdx) => {
                if (actionIdx === 0) { setReportTarget(member); setShowReport(true); }
                if (actionIdx === 1) blockUser(member.id, member.name, () => router.back());
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
              setTimeout(() => {
                setAlertInfo({
                  title: member.name,
                  message: '',
                  buttons: [
                    { text: 'Report User', onPress: () => { setReportTarget(member); setShowReport(true); } },
                    { text: 'Block User', style: 'destructive', onPress: () => blockUser(member.id, member.name, () => router.back()) },
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
  }, [props.fetchReportMembers, router, blockUser]);

  // Floating scroll-to-bottom button + "new messages below" counter.
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [unreadBelow, setUnreadBelow] = useState(0);
  const atBottomRef = useRef(true);
  const lastMsgCountRef = useRef(0);

  const handleListScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const distanceFromBottom = contentSize.height - contentOffset.y - layoutMeasurement.height;
    atBottomRef.current = distanceFromBottom <= SCROLL_AT_BOTTOM_THRESHOLD;
    setShowScrollBtn(distanceFromBottom > SCROLL_SHOW_THRESHOLD);
    if (atBottomRef.current) setUnreadBelow(0);
  }, []);

  useEffect(() => {
    if (messages.length > lastMsgCountRef.current) {
      const delta = messages.length - lastMsgCountRef.current;
      if (!atBottomRef.current) setUnreadBelow(c => c + delta);
    }
    lastMsgCountRef.current = messages.length;
  }, [messages.length]);

  const handleScrollToBottomPress = useCallback(() => {
    scrollToBottom();
    setUnreadBelow(0);
  }, [scrollToBottom]);

  const scrollBtnBottom =
    Math.max(Platform.OS === 'ios' ? iosKeyboardHeight : androidKeyboardHeight, panelInset) + bottomDockHeight + SCROLL_BTN_GAP;

  const handleSend = useCallback(async () => {
    const text = inputText.trim();
    if (!text || uploading) return;
    setInputText('');
    setMentionQuery(null);
    stopTyping();
    if (editingMessageId) {
      editMessage(editingMessageId, text);
      setEditingMessageId(null);
    } else {
      if (CHAT_PERF_HUD) perfSendStartRef.current = performance.now();
      sendMessage(text, undefined, replyingTo?.id);
      setReplyingTo(null);
      scrollToBottom();
    }
  }, [inputText, uploading, sendMessage, editMessage, editingMessageId, replyingTo, scrollToBottom, stopTyping]);

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
  const recorder = useVoiceRecorder();
  const [recordingMode, setRecordingMode] = useState<RecorderUiMode | 'idle'>('idle');
  const [draft, setDraft] = useState<{ uri: string; durationSeconds: number } | null>(null);

  const resetRecording = useCallback(() => {
    setRecordingMode('idle');
    setDraft(null);
  }, []);

  const uploadAndSendAudio = useCallback(async (uri: string, durationSeconds: number) => {
    if (!currentUserId) { resetRecording(); return; }
    resetRecording();
    try {
      const url = await uploadAudioToStorage(id, currentUserId, uri);
      await sendAudio(url, durationSeconds);
      scrollToBottom();
    } catch (e) {
      logError(e, 'chatEngine.uploadAndSendAudio');
      Alert.alert("Couldn't send voice message", 'Please try again.');
    }
  }, [currentUserId, id, sendAudio, scrollToBottom, resetRecording]);

  const beginRecording = useCallback(async () => {
    if (isPast) return;
    Keyboard.dismiss();
    hapticMedium();
    setRecordingMode('holding');
    const ok = await recorder.start();
    if (!ok) {
      setRecordingMode('idle');
      Alert.alert('Microphone needed', 'Enable microphone access in Settings to send voice messages.');
    }
  }, [isPast, recorder]);

  const cancelRecording = useCallback(async () => {
    hapticLight();
    await recorder.cancel();
    resetRecording();
  }, [recorder, resetRecording]);

  useEffect(() => {
    if (Platform.OS !== 'android' || recordingMode === 'idle') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      void cancelRecording();
      return true;
    });
    return () => sub.remove();
  }, [recordingMode, cancelRecording]);

  useEffect(() => {
    if (Platform.OS !== 'android' || !panelOpen) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setActivePanel(null);
      return true;
    });
    return () => sub.remove();
  }, [panelOpen]);

  const lockRecording = useCallback(() => {
    hapticLight();
    setRecordingMode('locked');
  }, []);

  const stopRecordingToDraft = useCallback(async () => {
    const res = await recorder.stop();
    if (res) { setDraft(res); setRecordingMode('draft'); }
    else resetRecording();
  }, [recorder, resetRecording]);

  const finishHeldRecording = useCallback(async () => {
    const res = await recorder.stop();
    if (res) await uploadAndSendAudio(res.uri, res.durationSeconds);
    else resetRecording();
  }, [recorder, uploadAndSendAudio, resetRecording]);

  const sendDraft = useCallback(async () => {
    if (draft) await uploadAndSendAudio(draft.uri, draft.durationSeconds);
  }, [draft, uploadAndSendAudio]);

  const pauseResumeRecording = useCallback(() => {
    if (recorder.status === 'paused') recorder.resume();
    else recorder.pause();
  }, [recorder]);

  const endHoldGesture = useCallback((translationX: number, translationY: number) => {
    if (translationY < -VOICE_LOCK_THRESHOLD) lockRecording();
    else if (translationX < -VOICE_CANCEL_THRESHOLD) cancelRecording();
    else finishHeldRecording();
  }, [lockRecording, cancelRecording, finishHeldRecording]);

  const handleMorphTap = useCallback(() => {
    if (hasText) { handleSend(); return; }
    hapticLight();
  }, [hasText, handleSend]);

  const micGesture = useMemo(() => {
    const tap = Gesture.Tap().onEnd((_e, success) => {
      if (success) runOnJS(handleMorphTap)();
    });
    const pan = Gesture.Pan()
      .enabled(!hasText)
      .activateAfterLongPress(VOICE_HOLD_MS)
      .onStart(() => { runOnJS(beginRecording)(); })
      .onEnd((e) => { runOnJS(endHoldGesture)(e.translationX, e.translationY); });
    return Gesture.Exclusive(pan, tap);
  }, [hasText, handleMorphTap, beginRecording, endHoldGesture]);

  const handleEmojiToggle = useCallback(() => {
    if (activePanel === 'emoji') {
      textInputRef.current?.focus();
    } else {
      setActivePanel('emoji');
      Keyboard.dismiss();
    }
  }, [activePanel]);

  const selectionRef = useRef({ start: 0, end: 0 });
  const insertEmoji = useCallback((emoji: string) => {
    setInputText((prev) => {
      const s = Math.min(selectionRef.current.start, prev.length);
      const e = Math.min(selectionRef.current.end, prev.length);
      const caret = s + emoji.length;
      selectionRef.current = { start: caret, end: caret };
      return prev.slice(0, s) + emoji + prev.slice(e);
    });
  }, []);
  const insertMention = useCallback((firstName: string) => {
    setInputText((prev) => {
      const caret = Math.min(selectionRef.current.start, prev.length);
      const replaced = prev.slice(0, caret).replace(/@[\p{L}\p{N}_]*$/u, `@${firstName} `);
      const next = replaced + prev.slice(caret);
      selectionRef.current = { start: replaced.length, end: replaced.length };
      inputTextRef.current = next;
      return next;
    });
    setMentionQuery(null);
    textInputRef.current?.focus();
  }, []);
  const handleEmojiBackspace = useCallback(() => {
    setInputText((prev) => {
      const s = Math.min(selectionRef.current.start, prev.length);
      const e = Math.min(selectionRef.current.end, prev.length);
      if (s !== e) {
        selectionRef.current = { start: s, end: s };
        return prev.slice(0, s) + prev.slice(e);
      }
      if (s <= 0) return prev;
      const head = Array.from(prev.slice(0, s));
      head.pop();
      const newHead = head.join('');
      selectionRef.current = { start: newHead.length, end: newHead.length };
      return newHead + prev.slice(e);
    });
  }, []);

  const sendGif = useCallback((url: string) => {
    setActivePanel(null);
    void sendMessage('', url);
    scrollToBottom();
  }, [sendMessage, scrollToBottom]);

  const doPhotoAction = useCallback(async (choice: 'camera' | 'library') => {
    if (!currentUserId) return;

    if (choice === 'camera') {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        setAlertInfo({ title: 'Camera access needed', message: 'Please allow camera access in Settings to take photos.' });
        return;
      }
    }

    const result = choice === 'camera'
      ? await ImagePicker.launchCameraAsync({ quality: 0.8 })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          allowsMultipleSelection: true,
          selectionLimit: PHOTO_BATCH_LIMIT,
          quality: 0.8,
        });

    if (result.canceled || !result.assets?.length) return;
    setPendingPhotos(result.assets);
    setPhotoPreviewOpen(true);
  }, [currentUserId]);

  const sendPhotos = useCallback(async (caption: string) => {
    const assets = pendingPhotos;
    setPhotoPreviewOpen(false);
    setPendingPhotos([]);
    if (!currentUserId || assets.length === 0) return;

    setUploading(true);
    try {
      for (let i = 0; i < assets.length; i++) {
        const manipulated = await ImageManipulator.manipulateAsync(
          assets[i].uri,
          [{ resize: { width: 1200 } }],
          { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG, base64: true },
        );
        if (!manipulated.base64) continue;
        const fileName = `${currentUserId}/${Date.now()}-${i}.jpg`;
        const publicUrl = await uploadBase64ToStorage('chat-images', fileName, manipulated.base64);
        await sendMessage(i === 0 ? caption.trim() : '', publicUrl);
      }
      scrollToBottom();
    } catch {
      setAlertInfo({ title: 'Could not send photos', message: 'Something went wrong uploading. Please try again.' });
    } finally {
      setUploading(false);
    }
  }, [pendingPhotos, currentUserId, sendMessage, scrollToBottom]);

  const handleLocationConfirm = useCallback((latitude: number, longitude: number, address: string) => {
    setLocationPickerOpen(false);
    void sendLocation(latitude, longitude, address);
    scrollToBottom();
  }, [sendLocation, scrollToBottom]);

  const textInputRef = useRef<TextInput>(null);

  const handleAttachSelect = useCallback((key: AttachmentKey) => {
    setActivePanel(null);
    if (key === 'camera') {
      doPhotoAction('camera');
    } else if (key === 'photos') {
      doPhotoAction('library');
    } else if (key === 'location') {
      Keyboard.dismiss();
      setLocationPickerOpen(true);
    }
  }, [doPhotoAction]);

  const handleAttachToggle = useCallback(() => {
    if (!currentUserId) return;
    if (activePanel === 'attach') {
      textInputRef.current?.focus();
    } else {
      setActivePanel('attach');
      Keyboard.dismiss();
    }
  }, [currentUserId, activePanel]);

  const enrichedItems = useMemo<EnrichedItem[]>(() => buildEnrichedItems(messages), [messages]);

  // Stable callbacks so the bubble memo and the recycled rows never see fresh
  // function identities on unrelated state changes.
  const handleReaction = useCallback(
    (msgId: string, emoji?: string) => toggleReaction(msgId, emoji ?? 'heart'),
    [toggleReaction],
  );
  const handleMessageLongPress = useCallback(
    (msg: ChatMessage, ownFlag: boolean) => setOverlayMessage({ message: msg, isOwn: ownFlag }),
    [],
  );
  // The doc-106 §2 fix: ONE stable reply activator for every row, receiving
  // the message -- not an inline closure per row per render.
  const handleTriggerReply = useCallback((msg: ChatMessage) => {
    setReplyingTo({
      id: msg.id,
      content: msg.content,
      senderName: msg.sender?.first_name ?? 'Someone',
    });
    setEditingMessageId(null);
  }, []);
  const enrichedItemsRef = useRef(enrichedItems);
  useEffect(() => { enrichedItemsRef.current = enrichedItems; }, [enrichedItems]);
  const handleReplyTap = useCallback((msgId: string) => {
    const items = enrichedItemsRef.current;
    const idx = items.findIndex(item => !('type' in item) && item.id === msgId);
    if (idx >= 0) {
      Promise.resolve(listRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.5 })).catch(() => {});
    }
  }, []);
  const handleAvatarPress = useCallback((uid: string) => setMiniProfileUserId(uid), []);

  const handleStartReached = useCallback(() => {
    if (loading || !hasMore) return;
    void loadOlder();
  }, [loading, hasMore, loadOlder]);

  // Low-cardinality row types so FlashList recycles like with like.
  const getItemType = useCallback((item: EnrichedItem) => {
    if ('type' in item && (item.type === 'date' || item.type === 'time')) return 'sep';
    const msg = item as ChatMessage;
    if (msg.message_type === 'system') return 'system';
    return msg.user_id === currentUserId ? 'own' : 'other';
  }, [currentUserId]);

  const renderMessage = useCallback(
    ({ item, index }: { item: EnrichedItem; index: number }) => {
      if ('type' in item && (item.type === 'date' || item.type === 'time')) {
        return (
          <View style={bubbleStyles.systemRow}>
            <Text style={bubbleStyles.systemText}>{item.label}</Text>
          </View>
        );
      }

      const msg = item as ChatMessage;
      const isOwn = msg.user_id === currentUserId;

      // Chronological list: index-1 = older in time, index+1 = newer in time.
      const olderItem = enrichedItems[index - 1];
      const olderMsg = olderItem && !('type' in olderItem) ? (olderItem as ChatMessage) : null;
      const newerItem = enrichedItems[index + 1];
      const newerMsg = newerItem && !('type' in newerItem) ? (newerItem as ChatMessage) : null;

      // Only user-authored bubbles participate in grouping, on either side
      // (system rows carry the actor's user_id and must not group).
      const groupsWith = (other: ChatMessage | null) =>
        !!other && other.message_type !== 'system' && msg.message_type !== 'system' &&
        other.user_id === msg.user_id && isSameDay(other.created_at, msg.created_at);
      const isGroupedWithOlder = groupsWith(olderMsg);
      const isGroupedWithNewer = groupsWith(newerMsg);

      const showAvatar = !isOwn && !isGroupedWithNewer;
      const showName = !isOwn && !isGroupedWithOlder;

      // Gap ABOVE this message: tight inside a sender group; extra when the
      // older message above dangles a reaction badge into the gap.
      const gap = isGroupedWithOlder ? chatStyles.msgGapTop1
        : olderMsg?.reactions?.length ? chatStyles.msgGapTop18
        : chatStyles.msgGapTop10;

      return (
        <SwipeableRow
          containerStyle={gap}
          enabled={!isPast && msg.message_type === 'user'}
          message={msg}
          onTriggerReply={handleTriggerReply}
        >
          <EngineMessageBubble
            message={msg}
            derived={deriveMessageBits(msg)}
            isOwn={isOwn}
            showAvatar={showAvatar}
            showName={showName}
            isGrouped={isGroupedWithNewer}
            currentUserId={currentUserId}
            contextTitle={props.contextTitle}
            onPhotoPress={setPhotoViewUrl}
            onReaction={handleReaction}
            onMessageLongPress={handleMessageLongPress}
            onReplyTap={handleReplyTap}
            onAvatarPress={handleAvatarPress}
            mentionNames={mentionNames}
          />
        </SwipeableRow>
      );
    },
    [currentUserId, enrichedItems, isPast, props.contextTitle, handleTriggerReply, handleReaction, handleMessageLongPress, handleReplyTap, handleAvatarPress, mentionNames],
  );

  // History spinner + the plan's pinned card live at the content TOP (oldest
  // side) of the chronological list; typing dots at the content BOTTOM.
  const listHeader = useMemo(() => (
    <View>
      {loadingOlder && hasMore ? (
        <View style={chatStyles.olderSpinnerWrap}>
          <ActivityIndicator size="small" color={Colors.terracotta} />
        </View>
      ) : null}
      {props.renderPinnedFooter ? props.renderPinnedFooter() : null}
    </View>
  ), [loadingOlder, hasMore, props.renderPinnedFooter]);

  const listContentStyle = useMemo(
    () => ({ paddingTop: 12, paddingBottom: listBottomReservation }),
    [listBottomReservation],
  );

  // FlashList v2 takes a single ViewStyle (no style arrays). iOS shrinks the
  // list by the keyboard/panel inset via marginBottom, same as the legacy
  // thread's FlatList did.
  const listStyle = useMemo(
    () =>
      Platform.OS === 'ios'
        ? { flex: 1, marginBottom: Math.max(iosKeyboardHeight, panelInset) }
        : { flex: 1 },
    [iosKeyboardHeight, panelInset],
  );

  const mvcpConfig = useMemo(
    () => ({ startRenderingFromBottom: true, autoscrollToBottomThreshold: 0.2 }),
    [],
  );

  return (
    <View style={chatStyles.screen}>
      {/* ── Header ── */}
      <SafeAreaView edges={['top']} style={chatStyles.headerSafe}>
        <View style={chatStyles.header}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={chatStyles.backBtn}
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
        </View>

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
              style={chatStyles.membersRow}
              contentContainerStyle={chatStyles.membersRowContent}
            >
              {visibleMembers.map((member) => (
                <TouchableOpacity
                  key={member.id}
                  style={chatStyles.memberItem}
                  onPress={() => setMiniProfileUserId(member.id)}
                  activeOpacity={0.7}
                >
                  {member.avatar_url ? (
                    <Image source={{ uri: member.avatar_url }} style={chatStyles.memberAvatar} contentFit="cover" />
                  ) : (
                    <View style={[chatStyles.memberAvatar, chatStyles.memberAvatarFallback]}>
                      <Text style={chatStyles.memberInitial}>{member.first_name?.[0]?.toUpperCase() ?? '?'}</Text>
                    </View>
                  )}
                  <Text style={chatStyles.memberName} numberOfLines={1}>{member.first_name ?? ''}</Text>
                </TouchableOpacity>
              ))}
              {isOverflow && !membersExpanded && (
                <TouchableOpacity
                  style={chatStyles.memberItem}
                  onPress={() => setMembersExpanded(true)}
                  activeOpacity={0.7}
                  accessibilityLabel={`Show ${total - 4} more members`}
                >
                  <View style={[chatStyles.memberAvatar, chatStyles.memberOverflow]}>
                    <Text style={chatStyles.memberOverflowText}>+{total - 4}</Text>
                  </View>
                </TouchableOpacity>
              )}
              {isOverflow && membersExpanded && (
                <TouchableOpacity
                  style={chatStyles.memberItem}
                  onPress={() => setMembersExpanded(false)}
                  activeOpacity={0.7}
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

      </SafeAreaView>

      {showPushBanner && (
        <View style={chatStyles.pushBanner}>
          <View style={chatStyles.pushBannerContent}>
            <Text style={chatStyles.pushBannerText}>
              Turn on notifications so you never miss a message.
            </Text>
            <TouchableOpacity
              style={chatStyles.pushBannerButton}
              onPress={handleEnablePush}
              activeOpacity={0.85}
            >
              <Text style={chatStyles.pushBannerButtonText}>Enable</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            onPress={handleDismissPushBanner}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={chatStyles.pushBannerClose}
          >
            <Ionicons name="close" size={14} color={Colors.textLight} />
          </TouchableOpacity>
        </View>
      )}

      {/* ── Messages ── */}
      <View style={chatStyles.listWrap}>
        {loading && messages.length === 0 ? (
          <View style={chatStyles.loadingWrap}>
            <ActivityIndicator size="large" color={Colors.terracotta} />
          </View>
        ) : (
          <FlashList
            ref={listRef}
            data={enrichedItems}
            keyExtractor={item => item.id}
            getItemType={getItemType}
            renderItem={renderMessage}
            maintainVisibleContentPosition={mvcpConfig}
            onStartReached={handleStartReached}
            onStartReachedThreshold={START_REACHED_THRESHOLD}
            style={listStyle}
            onLayout={CHAT_PERF_HUD ? handlePerfLayout : undefined}
            contentContainerStyle={listContentStyle}
            showsVerticalScrollIndicator={false}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            onScroll={handleListScroll}
            scrollEventThrottle={16}
            ListHeaderComponent={listHeader}
            ListFooterComponent={typingUsers.length > 0 ? <TypingIndicator /> : null}
            ListEmptyComponent={
              <View style={chatStyles.emptyState}>
                {/* Line-drawn sunrise mark (no emoji, ever): a beginning, gold,
                    fading in. Same family as the Yours tab sunrise glyph. */}
                <Animated.View entering={FadeIn.duration(400)} style={chatStyles.emptyMark}>
                  <SunriseIcon size={36} color={Colors.gold} strokeWidth={1.75} />
                </Animated.View>
                <Text style={chatStyles.emptyText}>{props.emptyText ?? 'Say hi to everyone!'}</Text>
              </View>
            }
          />
        )}

        {/* Input bar -- absolutely positioned; the list reserves the dock height
            via paddingBottom on its content container. */}
        {isPast ? (
          <InputBarWrapper
            style={[
              chatStyles.readOnlyBar,
              chatStyles.dockAbsolute,
              {
                paddingBottom: inputBarBottomPadding,
                paddingLeft: Math.max(insets.left, 20),
                paddingRight: Math.max(insets.right, 20),
              },
              inputBarBottomStyle,
            ]}
            onLayout={(e: LayoutChangeEvent) => setBottomDockHeight(e.nativeEvent.layout.height)}
          >
            <Text style={chatStyles.readOnlyText}>{props.readOnly?.text ?? ''}</Text>
          </InputBarWrapper>
        ) : (
          <InputBarWrapper
            style={[
              chatStyles.dockAbsolute,
              chatStyles.dockSurface,
              inputBarBottomStyle,
            ]}
            onLayout={(e: LayoutChangeEvent) => setBottomDockHeight(e.nativeEvent.layout.height)}
          >
            {props.countdownText != null && (
              <Text style={chatStyles.countdownText}>
                {props.countdownText}
              </Text>
            )}
            {replyingTo && (
              <View style={chatStyles.replyBar}>
                <View style={chatStyles.replyBarLeft}>
                  <Ionicons name="arrow-undo-outline" size={16} color={Colors.terracotta} />
                  <View style={chatStyles.replyBarContent}>
                    <Text style={chatStyles.replyBarName}>{replyingTo.senderName}</Text>
                    <Text style={chatStyles.replyBarText} numberOfLines={1}>{replyingTo.content}</Text>
                  </View>
                </View>
                <TouchableOpacity onPress={() => setReplyingTo(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Ionicons name="close" size={18} color={Colors.warmGray} />
                </TouchableOpacity>
              </View>
            )}
            {editingMessageId && (
              <View style={chatStyles.editingBar}>
                <Ionicons name="create-outline" size={16} color={Colors.terracotta} />
                <Text style={chatStyles.editingText}>Editing message</Text>
                <TouchableOpacity onPress={() => { setEditingMessageId(null); setInputText(''); }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Ionicons name="close" size={18} color={Colors.warmGray} />
                </TouchableOpacity>
              </View>
            )}
            {mentionQuery !== null && mentionCandidates.length > 0 && (
              <View style={chatStyles.mentionBar}>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                  contentContainerStyle={chatStyles.mentionBarContent}
                >
                  {mentionCandidates.map((m) => (
                    <TouchableOpacity
                      key={m.id}
                      style={chatStyles.mentionChip}
                      onPress={() => insertMention(m.first_name!)}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityLabel={`Mention ${m.first_name}`}
                    >
                      {m.avatar_url ? (
                        <Image source={{ uri: m.avatar_url }} style={chatStyles.mentionAvatar} contentFit="cover" />
                      ) : (
                        <View style={chatStyles.mentionAvatarFallback}>
                          <Text style={chatStyles.mentionInitial}>{m.first_name?.[0]?.toUpperCase() ?? '?'}</Text>
                        </View>
                      )}
                      <Text style={chatStyles.mentionName} numberOfLines={1}>{m.first_name}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            )}
          <View
            style={[
              chatStyles.inputBar,
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
              style={chatStyles.cameraBtn}
              disabled={uploading}
              accessibilityRole="button"
              accessibilityLabel={activePanel === 'attach' ? 'Show keyboard' : 'Add attachment'}
            >
              {uploading ? (
                <ActivityIndicator size="small" color={Colors.warmGray} />
              ) : activePanel === 'attach' ? (
                // Deliberate single-family exception: Ionicons has no keyboard
                // glyph, so the keyboard toggle uses MaterialIcons.
                <MaterialIcons name="keyboard" size={26} color={Colors.warmGray} />
              ) : (
                <Ionicons name="add-circle-outline" size={26} color={Colors.warmGray} />
              )}
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleEmojiToggle}
              style={chatStyles.emojiBtn}
              disabled={uploading}
              accessibilityRole="button"
              accessibilityLabel={activePanel === 'emoji' ? 'Show keyboard' : 'Open emoji picker'}
            >
              {activePanel === 'emoji' ? (
                <MaterialIcons name="keyboard" size={24} color={Colors.terracotta} />
              ) : (
                <Ionicons name="happy-outline" size={24} color={Colors.terracotta} />
              )}
            </TouchableOpacity>

            <TextInput
              ref={textInputRef}
              style={chatStyles.input}
              value={inputText}
              onChangeText={handleInputChange}
              onSelectionChange={(e) => {
                selectionRef.current = e.nativeEvent.selection;
                setMentionQuery(mentionQueryAt(inputTextRef.current, e.nativeEvent.selection.start));
              }}
              placeholder="Message..."
              placeholderTextColor={Colors.warmGray}
              multiline
              textAlignVertical="top"
              maxLength={1000}
              returnKeyType="default"
              keyboardType="default"
              autoCorrect={true}
              spellCheck={true}
              autoCapitalize="sentences"
              inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
              autoComplete="off"
              importantForAutofill="no"
              textContentType="none"
            />

            <GestureDetector gesture={micGesture}>
              <Animated.View style={chatStyles.sendMorphWrap}>
                <Animated.View style={[chatStyles.morphLayer, chatStyles.sendCircle, sendLayerStyle]}>
                  <Ionicons name="arrow-up" size={SEND_ARROW_ICON_SIZE} color={Colors.white} />
                </Animated.View>
                <Animated.View style={[chatStyles.morphLayer, micLayerStyle]}>
                  <Ionicons name="mic" size={SEND_MIC_ICON_SIZE} color={Colors.terracotta} />
                </Animated.View>
              </Animated.View>
            </GestureDetector>
          </View>

          {recordingMode !== 'idle' && (
            <View
              style={[chatStyles.recorderOverlay, { paddingBottom: inputBarBottomPadding }]}
              pointerEvents={recordingMode === 'holding' ? 'none' : 'auto'}
            >
              <VoiceRecorder
                mode={recordingMode as RecorderUiMode}
                durationMillis={recorder.durationMillis}
                meterings={recorder.meterings}
                isPaused={recorder.status === 'paused'}
                draftUri={draft?.uri ?? null}
                draftDuration={draft?.durationSeconds ?? 0}
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

        {CHAT_PERF_HUD && (
          <View style={chatStyles.perfHud} pointerEvents="none">
            <Text style={chatStyles.perfHudText}>
              {`layout ${perfLayoutMs ?? '--'}ms | data ${perfDataMs ?? '--'}ms | send ${perfSendMs ?? '--'}ms`}
            </Text>
          </View>
        )}

        {panelOpen && (
          <View style={chatStyles.attachPanelWrap}>
            {activePanel === 'attach' ? (
              <AttachmentPanel onSelect={handleAttachSelect} height={panelHeight} bottomInset={insets.bottom} />
            ) : (
              <MediaPanel
                onSelect={insertEmoji}
                onBackspace={handleEmojiBackspace}
                onGifSelect={sendGif}
                height={panelHeight}
                bottomInset={insets.bottom}
              />
            )}
          </View>
        )}
      </View>

      {/* Report user modal */}
      {reportTarget && (
        <ReportModal
          visible={showReport}
          onClose={() => {
            setShowReport(false);
            setReportTarget(null);
          }}
          reportedUserId={reportTarget.id}
          reportedUserName={reportTarget.name}
          eventId={props.reportEventId}
        />
      )}

      <LocationPickerModal
        visible={locationPickerOpen}
        onClose={() => setLocationPickerOpen(false)}
        onConfirm={handleLocationConfirm}
      />

      <PhotoPreviewModal
        visible={photoPreviewOpen}
        assets={pendingPhotos}
        sending={uploading}
        onCancel={() => { setPhotoPreviewOpen(false); setPendingPhotos([]); }}
        onSend={sendPhotos}
      />

      <ReactionEmojiPicker
        visible={!!reactionPickerMsgId}
        onSelect={(emoji) => {
          const reactionKey = emoji === '\u2764\uFE0F' ? 'heart' : emoji;
          if (reactionPickerMsgId) toggleReaction(reactionPickerMsgId, reactionKey);
          setReactionPickerMsgId(null);
        }}
        onClose={() => setReactionPickerMsgId(null)}
      />

      {/* Full-screen photo viewer */}
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
        onClose={() => setMiniProfileUserId(null)}
        onReport={(uid, uname) => {
          setReportTarget({ id: uid, name: uname });
          setShowReport(true);
        }}
        onBlock={(uid, uname) => blockUser(uid, uname, () => router.back())}
      />

      <BrandedAlert
        visible={!!alertInfo}
        title={alertInfo?.title ?? ''}
        message={alertInfo?.message}
        buttons={alertInfo?.buttons}
        onClose={() => setAlertInfo(null)}
      />


      {/* Message interaction overlay */}
      <Modal visible={!!overlayMessage} transparent animationType="fade" onRequestClose={() => setOverlayMessage(null)} statusBarTranslucent>
        <Pressable style={overlayStyles.backdrop} onPress={() => setOverlayMessage(null)}>
          <Pressable onPress={(e) => e.stopPropagation()} style={overlayStyles.container}>
            {/* Emoji reaction row -- only for other people's messages, disabled when read-only */}
            {!overlayMessage?.isOwn && !isPast && (
            <View style={overlayStyles.emojiRow}>
              {['\uD83D\uDC4D', '\u2764\uFE0F', '\uD83D\uDE02', '\uD83D\uDE2E', '\uD83D\uDE22', '\uD83D\uDE4F'].map((emoji) => (
                <EmojiReactionButton
                  key={emoji}
                  emoji={emoji}
                  onSelect={(e) => {
                    const reactionKey = e === '\u2764\uFE0F' ? 'heart' : e;
                    toggleReaction(overlayMessage!.message.id, reactionKey);
                    setOverlayMessage(null);
                  }}
                />
              ))}
              <TouchableOpacity
                style={overlayStyles.emojiBtn}
                onPress={() => {
                  hapticLight();
                  setReactionPickerMsgId(overlayMessage!.message.id);
                  setOverlayMessage(null);
                }}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="More reactions"
              >
                <Ionicons name="add" size={24} color={Colors.textMedium} />
              </TouchableOpacity>
            </View>
            )}

            {/* Action menu */}
            <View style={overlayStyles.actionMenu}>
              {overlayMessage?.message.message_type === 'user' && !isPast && (
                <>
                  <TouchableOpacity
                    style={overlayStyles.actionRow}
                    onPress={() => {
                      hapticLight();
                      const msg = overlayMessage.message;
                      setReplyingTo({
                        id: msg.id,
                        content: msg.content,
                        senderName: msg.sender?.first_name ?? 'Someone',
                      });
                      setEditingMessageId(null);
                      setOverlayMessage(null);
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={overlayStyles.actionText}>Reply</Text>
                    <Ionicons name="arrow-undo-outline" size={18} color={Colors.asphalt} />
                  </TouchableOpacity>
                  <View style={overlayStyles.actionDivider} />
                </>
              )}

              <TouchableOpacity
                style={overlayStyles.actionRow}
                onPress={() => {
                  const msg = overlayMessage?.message;
                  if (msg) {
                    let copyText = msg.content;
                    if (msg.image_url) {
                      copyText = msg.image_url;
                    } else if (msg.message_type === 'location') {
                      try { copyText = JSON.parse(msg.content).address ?? msg.content; } catch {}
                    }
                    Clipboard?.setStringAsync(copyText).catch(() => {});
                  }
                  hapticLight();
                  setOverlayMessage(null);
                }}
                activeOpacity={0.7}
              >
                <Text style={overlayStyles.actionText}>Copy</Text>
                <Ionicons name="copy-outline" size={18} color={Colors.asphalt} />
              </TouchableOpacity>

              {overlayMessage?.isOwn && overlayMessage.message.message_type === 'user' && !overlayMessage.message.image_url && (
                <>
                  <View style={overlayStyles.actionDivider} />
                  <TouchableOpacity
                    style={overlayStyles.actionRow}
                    onPress={() => {
                      hapticLight();
                      setEditingMessageId(overlayMessage.message.id);
                      setReplyingTo(null);
                      setInputText(overlayMessage.message.content);
                      setOverlayMessage(null);
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={overlayStyles.actionText}>Edit</Text>
                    <Ionicons name="create-outline" size={18} color={Colors.asphalt} />
                  </TouchableOpacity>
                </>
              )}

              {overlayMessage?.isOwn && (
                <>
                  <View style={overlayStyles.actionDivider} />
                  <TouchableOpacity
                    style={overlayStyles.actionRow}
                    onPress={() => {
                      hapticMedium();
                      setOverlayMessage(null);
                      setAlertInfo({
                        title: 'Delete this message?',
                        message: '',
                        buttons: [
                          { text: 'Cancel', style: 'cancel' },
                          { text: 'Delete', style: 'destructive', onPress: () => deleteMessage(overlayMessage.message.id) },
                        ],
                      });
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={overlayStyles.actionTextDelete}>Delete</Text>
                    <Ionicons name="trash-outline" size={18} color={Colors.errorRed} />
                  </TouchableOpacity>
                </>
              )}
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

// Memoized like the legacy thread: a parent re-render (e.g. the DM screen
// toggling its + menu state) must not re-render the whole chat.
export default memo(ChatEngineThread);

const chatStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.parchment },
  headerSafe: { backgroundColor: Colors.white },
  listWrap: { flex: 1 },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  olderSpinnerWrap: { paddingVertical: 12, alignItems: 'center' },
  perfHud: {
    position: 'absolute',
    top: 4,
    right: 8,
    backgroundColor: Colors.overlayDarker,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  perfHudText: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.caption,
    color: Colors.white,
  },
  dockAbsolute: {
    position: 'absolute',
    left: 0,
    right: 0,
  },
  dockSurface: {
    backgroundColor: Colors.white,
  },
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
  headerCenter: { flex: 1 },
  headerTitle: { fontSize: 16, fontWeight: '700' as const, color: Colors.darkWarm },
  headerSub: { fontSize: 11, color: Colors.secondary, marginTop: 1 },
  viewPlanBtn: {
    borderWidth: 1.5,
    borderColor: Colors.terracotta,
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 4,
    maxWidth: 150,
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

  // Chronological list: the gap is ABOVE each message (toward the older one).
  msgGapTop1: { marginTop: 1 },
  msgGapTop10: { marginTop: 10 },
  msgGapTop18: { marginTop: 18 },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
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

const overlayStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  container: {
    width: '100%',
    maxWidth: 320,
    alignItems: 'center',
    gap: 10,
  },
  emojiRow: {
    flexDirection: 'row',
    backgroundColor: Colors.white,
    borderRadius: 28,
    paddingHorizontal: 8,
    paddingVertical: 6,
    gap: 2,
    shadowColor: Colors.shadowBlack,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  emojiBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emojiText: {
    fontSize: 28,
  },
  actionMenu: {
    backgroundColor: Colors.white,
    borderRadius: 14,
    width: '100%',
    overflow: 'hidden',
    shadowColor: Colors.shadowBlack,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  actionText: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyLG,
    color: Colors.asphalt,
  },
  actionTextDelete: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyLG,
    color: Colors.errorRed,
  },
  actionDivider: {
    height: 1,
    backgroundColor: Colors.border,
    marginHorizontal: 18,
  },
});

// Animated emoji button with scale bounce on tap
function EmojiReactionButton({ emoji, onSelect }: { emoji: string; onSelect: (emoji: string) => void }) {
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <TouchableOpacity
      style={overlayStyles.emojiBtn}
      onPress={() => {
        hapticLight();
        scale.value = withSpring(1.3, { damping: 8, stiffness: 300 }, () => {
          scale.value = withSpring(1);
        });
        setTimeout(() => onSelect(emoji), 150);
      }}
      activeOpacity={1}
    >
      <Animated.View style={animStyle}>
        <Text style={overlayStyles.emojiText}>{emoji}</Text>
      </Animated.View>
    </TouchableOpacity>
  );
}
