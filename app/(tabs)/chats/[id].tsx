import React, { useState, useRef, useCallback, useEffect, useMemo, memo } from 'react';
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
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import { KEYBOARD_DONE_ACCESSORY_ID } from '../../../components/keyboard/KeyboardDoneBar';
import * as Notifications from 'expo-notifications'; // setBadgeCountAsync only — local-only API, no server call. OneSignal SDK doesn't expose direct badge clear; revisit during cleanup.
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
// Lazy-load expo-clipboard so older production binaries (built before this dep
// was added) don't crash when this screen's module is imported. Mirrors the
// pattern in lib/addToCalendar.ts and components/VideoSplash.tsx.
let Clipboard: typeof import('expo-clipboard') | null = null;
try { Clipboard = require('expo-clipboard'); } catch {}
import { hapticLight, hapticMedium, hapticHeavy, hapticSelection, hapticSuccess, hapticWarning, hapticError } from '../../../lib/haptics';
import Animated, { useSharedValue, useAnimatedStyle, withSpring, withTiming, useAnimatedKeyboard, useAnimatedReaction, runOnJS } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import { showAddToCalendar } from '../../../lib/addToCalendar';
import Colors from '../../../constants/Colors';
import { capDisplayCount } from '../../../constants/GroupLimits';
import { Fonts, FontSizes } from '../../../constants/Typography';
import { openUrl } from '../../../lib/url';
import { uploadBase64ToStorage } from '../../../lib/uploadPhoto';
import { useChat, ChatMessage, MessageReaction, ReplyTo } from '../../../hooks/useChat';
import MiniProfileCard from '../../../components/MiniProfileCard';
import AttachmentPanel, { AttachmentKey } from '../../../components/chat/AttachmentSheet';
import MediaPanel from '../../../components/chat/MediaPanel';
import LocationPickerModal from '../../../components/chat/LocationPickerModal';
import TypingIndicator from '../../../components/chat/TypingIndicator';
import { useTypingIndicator } from '../../../hooks/useTypingIndicator';
import ScrollToBottomButton from '../../../components/chat/ScrollToBottomButton';
import VoicePlayer from '../../../components/chat/VoicePlayer';
import VoiceRecorder, { RecorderUiMode } from '../../../components/chat/VoiceRecorder';
import { useVoiceRecorder } from '../../../hooks/useVoiceRecorder';
import { uploadAudioToStorage } from '../../../lib/uploadAudio';
import { logError } from '../../../lib/logger';
import { ReportModal } from '../../../components/modals/ReportModal';
import { useBlock } from '../../../hooks/useBlock';
import { BrandedAlert, BrandedAlertButton } from '../../../components/BrandedAlert';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { registerForPushNotifications, getPushPermissionStatus } from '../../../hooks/usePushNotifications';

// ─── Event Header Data ────────────────────────────────────────────────────────

interface EventInfo {
  id: string;
  title: string;
  start_time: string;
  status: string;
  tickets_url: string | null;
  member_count: number;
  members: Array<{ id: string; first_name: string | null; avatar_url: string | null }>;
}

async function fetchEventInfo(eventId: string): Promise<EventInfo> {
  // Run event + member list in parallel — both only need eventId
  const [eventResult, memberResult] = await Promise.all([
    supabase
      .from('events')
      .select('id, title, start_time, status, tickets_url, member_count')
      .eq('id', eventId)
      .maybeSingle(),
    supabase
      .from('event_members')
      .select('user_id')
      .eq('event_id', eventId)
      .eq('status', 'joined')
      .limit(6),
  ]);

  if (eventResult.error) throw eventResult.error;
  if (!eventResult.data) throw new Error('Event not found');
  const event = eventResult.data;
  const memberRows = memberResult.data;

  const userIds = (memberRows ?? []).map((m: any) => m.user_id).filter(Boolean);

  let members: EventInfo['members'] = [];
  if (userIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles_public')
      .select('id, first_name_display, profile_photo_url')
      .in('id', userIds);

    members = (profiles ?? []).map((p: any) => ({
      id: p.id,
      first_name: p.first_name_display ?? null,
      avatar_url: p.profile_photo_url ?? null,
    }));
  }

  return {
    id: event.id,
    title: event.title,
    start_time: event.start_time,
    status: (event as any).status ?? 'forming',
    tickets_url: (event as any).tickets_url ?? null,
    member_count: (event as any).member_count ?? 0,
    members,
  };
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

function formatEventDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
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

function LinkedText({ text, style, linkStyle }: { text: string; style: any; linkStyle?: any }) {
  const parts = text.split(/(https?:\/\/[^\s]+|www\.[^\s]+)/i);
  if (parts.length === 1) return <Text style={style}>{text}</Text>;

  return (
    <Text style={style}>
      {parts.map((part, i) => {
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

// ─── Message Bubble ───────────────────────────────────────────────────────────

interface BubbleProps {
  message: ChatMessage;
  isOwn: boolean;
  showAvatar: boolean;
  showName: boolean;
  isGrouped: boolean;
  currentUserId: string;
  planTitle?: string;
  onPhotoPress?: (url: string) => void;
  onReaction?: (messageId: string, emoji?: string) => void;
  onMessageLongPress?: (message: ChatMessage, isOwn: boolean) => void;
  onReplyTap?: (messageId: string) => void;
  onAvatarPress?: (userId: string) => void;
}

const MessageBubble = memo(function MessageBubble({ message, isOwn, showAvatar, showName, isGrouped, currentUserId, planTitle, onPhotoPress, onReaction, onMessageLongPress, onReplyTap, onAvatarPress }: BubbleProps) {
  if (message.message_type === 'system') {
    let displayContent = message.content;
    if (planTitle) {
      displayContent = displayContent
        .replace(/joined the plan/gi, `joined ${planTitle}`)
        .replace(/the plan/gi, planTitle);
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
  // Collect unique emojis in order of first appearance
  const uniqueEmojis: string[] = [];
  const seen = new Set<string>();
  for (const r of reactions) {
    if (!seen.has(r.reaction)) {
      seen.add(r.reaction);
      uniqueEmojis.push(r.reaction);
    }
  }
  const iReacted = reactions.some(r => r.user_id === currentUserId);

  const borderRadius = isOwn
    ? { borderTopLeftRadius: 18, borderTopRightRadius: 18, borderBottomLeftRadius: 18, borderBottomRightRadius: 2 }
    : { borderTopLeftRadius: 18, borderTopRightRadius: 18, borderBottomLeftRadius: 2, borderBottomRightRadius: 18 };

  return (
    <View
      style={[
        bubbleStyles.row,
        isOwn ? bubbleStyles.rowOwn : bubbleStyles.rowOther,
        // Reaction badge is absolutely positioned at bottom:-12 of the bubble.
        // Without extra clearance below, it overlaps the sender label of the
        // next message. Bump marginBottom only when there's a badge to clear.
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
            <Pressable
              onPress={() => onPhotoPress?.(message.image_url!)}
            >
              <Image
                source={{ uri: message.image_url }}
                style={[bubbleStyles.messageImage, borderRadius]}
                contentFit="cover"
                transition={200}
                placeholder={{ blurhash: 'L6PZfSi_.AyE_3t7t7R**0o#DgR4' }}
                cachePolicy="memory-disk"
              />
            </Pressable>
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
          })() : isEmojiOnly(message.content) && !message.reply_to ? (
            <Text style={bubbleStyles.emojiOnly}>{message.content}</Text>
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
              />
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
  // Extra clearance below a row that has a reaction badge dangling
  // 12px below the bubble. 16px = badge offset (12) + breathing room (4).
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
  messageTextOwn: { color: Colors.white },
  inlineTime: { fontSize: 10, color: Colors.tertiary, textAlign: 'right', marginTop: 3 },
  inlineTimeOwn: { color: 'rgba(255,255,255,0.6)' },
  linkOther: { textDecorationLine: 'underline' as const, color: Colors.terracotta },
  linkOwn: { textDecorationLine: 'underline' as const, color: Colors.white },
  messageImage: { width: 240, height: 180 },
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

// Voice recording hold gesture: activate after a short hold, then slide left to
// cancel or up to lock (hands-free), mirroring WhatsApp.
const VOICE_HOLD_MS = 200;
const VOICE_CANCEL_THRESHOLD = 80;
const VOICE_LOCK_THRESHOLD = 80;

const SwipeableRow = memo(function SwipeableRow({
  enabled,
  onTriggerReply,
  containerStyle,
  children,
}: {
  enabled: boolean;
  onTriggerReply: () => void;
  containerStyle: any;
  children: React.ReactNode;
}) {
  const translateX = useSharedValue(0);
  const triggered = useSharedValue(false);

  // Keep the latest callback in a ref so the memoized gesture never calls a
  // stale closure when the row re-renders.
  const onTriggerReplyRef = useRef(onTriggerReply);
  onTriggerReplyRef.current = onTriggerReply;
  const fireReply = useCallback(() => onTriggerReplyRef.current?.(), []);

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

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
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
  const listRef = useRef<FlatList>(null);
  const { messages, loading, currentUserId, sendMessage, sendLocation, sendAudio, deleteMessage, editMessage, toggleReaction, refetch } = useChat(id);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<{ id: string; content: string; senderName: string } | null>(null);
  const [membersExpanded, setMembersExpanded] = useState(false);
  // Track keyboard on both platforms.
  //
  // iOS: KeyboardAvoidingView with behavior="padding" is broken under
  // the new architecture (Fabric) — the input bar slides behind the
  // keyboard. Instead we listen to keyboardWillShow, capture the
  // reported keyboard height, and apply it as paddingBottom on a
  // wrapper View around the FlatList + input bar. KAV is gone.
  //
  // Android: edgeToEdgeEnabled=true disables the classic adjustResize
  // window shrink on Android 15+, and Keyboard.addListener('keyboardDidShow')
  // reports a stale/zero height under new arch. We use Reanimated's
  // useAnimatedKeyboard instead — it hooks into Android's WindowInsets
  // API via the native module and is the only reliable height source in
  // edge-to-edge mode. The shared value drives an animated style applied
  // to the Android input bar wrapper (Animated.View). iOS continues to
  // use the keyboardWillShow listener + iosKeyboardHeight state untouched.
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
  const [activePanel, setActivePanel] = useState<'attach' | 'emoji' | null>(null);
  const panelOpen = activePanel !== null;
  const [locationPickerOpen, setLocationPickerOpen] = useState(false);
  // Match the panel to the keyboard it replaces: track the observed keyboard
  // height; fall back until one is seen this session.
  const [panelHeight, setPanelHeight] = useState(PANEL_FALLBACK_HEIGHT);
  const panelInset = panelOpen ? panelHeight : 0;

  const animatedKeyboard = useAnimatedKeyboard();
  // Panel inset mirrored to the UI thread so the Android animated bottom can
  // max() it against the live keyboard height (and ease it for a smooth open).
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
  // Android gets Animated.View driven by useAnimatedKeyboard; iOS gets
  // plain View with static bottom = max(keyboard, panel) inset.
  const InputBarWrapper: React.ComponentType<any> =
    Platform.OS === 'android' ? Animated.View : View;
  const inputBarBottomStyle =
    Platform.OS === 'android'
      ? androidInputBarAnimatedStyle
      : { bottom: Math.max(iosKeyboardHeight, panelInset) };
  useEffect(() => {
    // Inverted FlatList: offset 0 is the visual bottom (newest message).
    // When the keyboard opens we snap to that so the user always sees the
    // latest messages above the newly-raised input bar.
    const scrollToLatest = () => {
      listRef.current?.scrollToOffset({ offset: 0, animated: true });
    };
    // Remember the keyboard height so the attachment panel matches it, and
    // close the panel only once the keyboard has actually taken over the space
    // (keeps the inset from collapsing to 0 during the panel->keyboard handoff).
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
  // The keyboard AND the attachment panel both span the home-indicator area, so
  // when either is up the bar sits flush on it (8) rather than adding insets.bottom.
  const inputBarBottomPadding = keyboardVisible || panelOpen ? 8 : insets.bottom + 8;
  // Measure the bottom dock (input bar + any reply/edit banners) so the
  // inverted FlatList can reserve exactly that much space at its visual
  // bottom. Inverted lists flip the content container, so paddingTop in
  // style terms is the side closest to the input bar visually.
  // Default to 70 so the first render already reserves space for the input
  // bar. Without this, bottomDockHeight starts at 0, the inverted list has
  // no bottom padding, and the newest message renders behind the absolute-
  // positioned input bar until onLayout fires and corrects it.
  const [bottomDockHeight, setBottomDockHeight] = useState(70);

  // Reserved space at the visual bottom of the inverted FlatList so the
  // newest message always sits directly above the input bar.
  //
  // iOS: the list shrinks by iosKeyboardHeight via marginBottom on the
  // FlatList style below, so the contentContainer only needs to reserve
  // the input bar height. Growing paddingTop by the keyboard height here
  // would trigger maintainVisibleContentPosition to shift the scroll on
  // keyboard open, leaving the user stuck mid-conversation unable to
  // reach the newest message above the bar.
  //
  // Android: edgeToEdge disables the classic adjustResize window shrink,
  // so the list itself doesn't get smaller when the keyboard opens — the
  // paddingTop has to reserve both the bar and the keyboard height.
  const listBottomReservation =
    Platform.OS === 'ios'
      ? bottomDockHeight + 8
      : bottomDockHeight + 8 + Math.max(androidKeyboardHeight, panelInset);

  useEffect(() => {
    console.log('[ChatList] bottomDockHeight:', bottomDockHeight, '| listBottomReservation:', listBottomReservation);
  }, [bottomDockHeight, listBottomReservation]);

  // ── "Enable notifications" banner ────────────────────────────────────
  // Shows when the user has no push token and there are messages from
  // others in the chat. This is the moment they feel the pain of missing
  // notifications. Dismissable for 7 days via AsyncStorage.
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
    // If iOS has already recorded a hard denial, the system prompt silently
    // no-ops — the only path forward is Settings.
    const status = await getPushPermissionStatus();
    if (status === 'denied') {
      await AsyncStorage.setItem(PUSH_BANNER_KEY, String(Date.now())).catch(() => {});
      setShowPushBanner(false);
      Linking.openSettings();
      return;
    }

    // Undetermined / provisional: surface the native prompt and, on
    // grant, save the expo push token to the user's profile.
    const token = await registerForPushNotifications({ prompt: true, userId: currentUserId });
    setShowPushBanner(false);
    if (!token) {
      // User declined the system prompt — honor the 7-day cooldown so we
      // don't nag on every chat open.
      await AsyncStorage.setItem(PUSH_BANNER_KEY, String(Date.now())).catch(() => {});
    }
  }, [currentUserId]);

  const handleDismissPushBanner = useCallback(async () => {
    await AsyncStorage.setItem(PUSH_BANNER_KEY, String(Date.now())).catch(() => {});
    setShowPushBanner(false);
  }, []);

  // When returning from Settings, re-check permission. If granted, fetch
  // and save the token — banner auto-hides since permission is now granted.
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

  // Throttle the focus-driven message refetch. New messages already
  // arrive live via realtime; this is a safety-net resync, so once per
  // 15s on focus is enough. Firing it on every focus contributed to the
  // 2026-05-18 "chat is slow" reports.
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

  // Tell the server this user is actively viewing THIS chat, so the
  // send-push edge function suppresses pushes for new messages in the
  // same chat (they arrive live via realtime; a banner + haptic for a
  // message you can already see on screen is noise). Cleared on blur,
  // unmount, or app background; re-set when the app foregrounds while
  // still focused on this chat.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      let markedActive = false;

      const setActive = async () => {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user || cancelled) return;
        const { error } = await supabase
          .from('profiles')
          .update({ active_chat_event_id: id })
          .eq('id', user.id);
        // Only treat ourselves as "active" if the server actually recorded
        // it. If this silently failed and we still flipped markedActive,
        // clearActive's early-return guard would later skip the reset and
        // strand active_chat_event_id pointing at this chat — suppressing
        // push for it long after the user left (missed messages).
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
        // Keep markedActive=true on failure so the next blur/unmount/
        // background retries the clear instead of leaving suppression on.
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
    }, [id]),
  );

  const { blockUser } = useBlock();

  const { data: event, isError: eventError } = useQuery({
    queryKey: ['event-info', id],
    queryFn: () => fetchEventInfo(id),
    enabled: !!id,
    staleTime: 60_000,
    retry: 2,
  });

  // Typing indicators broadcast over an ephemeral Realtime channel (separate
  // from the chat data channel). Our own display name comes from the already
  // loaded member list, so no extra query is needed.
  const currentUserName = useMemo(
    () => event?.members.find(m => m.id === currentUserId)?.first_name ?? null,
    [event?.members, currentUserId],
  );
  const { typingUsers, broadcastTyping, stopTyping } = useTypingIndicator(id, currentUserId, currentUserName);

  const typingLabel = useMemo(() => {
    if (typingUsers.length === 0) return null;
    if (typingUsers.length === 1) return `${typingUsers[0].name} is typing...`;
    if (typingUsers.length === 2) return `${typingUsers[0].name} and ${typingUsers[1].name} are typing...`;
    return 'Several people are typing...';
  }, [typingUsers]);

  const handleInputChange = useCallback((text: string) => {
    setInputText(text);
    broadcastTyping();
  }, [broadcastTyping]);

  const prefetchedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    messages.forEach(m => {
      if (m.image_url && !prefetchedRef.current.has(m.image_url)) {
        prefetchedRef.current.add(m.image_url);
        Image.prefetch(m.image_url).catch(() => {});
      }
    });
  }, [messages]);

  if (!id || eventError) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: Colors.parchment }} edges={['top', 'bottom']}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.textMedium }}>
            {eventError ? 'Could not load this chat' : 'Chat not found'}
          </Text>
          <TouchableOpacity
            onPress={() => router.back()}
            style={{ marginTop: 16, paddingHorizontal: 24, paddingVertical: 12, backgroundColor: Colors.terracotta, borderRadius: 14 }}
          >
            <Text style={{ fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.white }}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const isPast = event
    ? event.status === 'cancelled' || new Date(event.start_time) < new Date(Date.now() - 48 * 60 * 60 * 1000)
    : false;

  const hoursLeft = event
    ? Math.round(48 - ((Date.now() - new Date(event.start_time).getTime()) / (1000 * 60 * 60)))
    : 0;
  const showCountdown = !isPast && !!event && new Date(event.start_time) < new Date() && hoursLeft > 0;

  const handleReportMenu = useCallback(async () => {
    // Fetch ALL members (no limit) for the report menu
    const { data: memberRows } = await supabase
      .from('event_members')
      .select('user_id')
      .eq('event_id', id)
      .eq('status', 'joined');

    const userIds = (memberRows ?? []).map((m: any) => m.user_id as string).filter(Boolean);
    const otherIds = userIds.filter((uid) => uid !== currentUserId);

    if (otherIds.length === 0) {
      setAlertInfo({ title: 'No other members', message: 'There are no other members in this plan to report.' });
      return;
    }

    const { data: profiles } = await supabase
      .from('profiles_public')
      .select('id, first_name_display, profile_photo_url')
      .in('id', otherIds);

    const members = (profiles ?? []).map((p: any) => ({
      id: p.id as string,
      name: (p.first_name_display as string | null) ?? 'Unknown',
    }));

    // Pick a member, then show report/block options — all via native action sheets
    const memberNames = members.map(m => m.name);
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: [...memberNames, 'Cancel'], cancelButtonIndex: memberNames.length, title: 'Members' },
        (idx) => {
          if (idx >= members.length) return;
          const member = members[idx];
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
          ...members.map((member) => ({
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
  }, [id, currentUserId, blockUser]);

  // Scroll the inverted FlatList to its visual bottom (offset 0 in inverted
  // coordinates is where the newest message lives). Needed because the list
  // uses maintainVisibleContentPosition, which keeps existing visible items
  // stable when new ones are added at index 0 — meaning a freshly-sent
  // message lands just below the visible area, behind the input bar. Calling
  // this after every send forces the new message into view. Wrapped in
  // requestAnimationFrame so layout has flushed before the scroll fires.
  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      listRef.current?.scrollToOffset({ offset: 0, animated: true });
    });
  }, []);

  // Floating scroll-to-bottom button + "new messages below" counter.
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [unreadBelow, setUnreadBelow] = useState(0);
  const atBottomRef = useRef(true);
  const lastMsgCountRef = useRef(0);

  const handleListScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y;
    atBottomRef.current = y <= SCROLL_AT_BOTTOM_THRESHOLD;
    setShowScrollBtn(y > SCROLL_SHOW_THRESHOLD);
    if (atBottomRef.current) setUnreadBelow(0);
  }, []);

  // Count messages that arrive while the user is scrolled up; clear when they
  // return to the bottom (handled in handleListScroll) or tap the button.
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
    stopTyping();
    if (editingMessageId) {
      editMessage(editingMessageId, text);
      setEditingMessageId(null);
    } else {
      sendMessage(text, undefined, replyingTo?.id);
      setReplyingTo(null);
      scrollToBottom();
    }
  }, [inputText, uploading, sendMessage, editMessage, editingMessageId, replyingTo, scrollToBottom, stopTyping]);

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

  // Mic press is a placeholder until voice recording lands in Component 5.
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
      logError(e, 'chat.uploadAndSendAudio');
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
    hapticLight();
    setRecordingMode('locked');
  }, []);

  const stopRecordingToDraft = useCallback(async () => {
    const res = await recorder.stop();
    if (res) { setDraft(res); setRecordingMode('draft'); }
    else resetRecording();
  }, [recorder, resetRecording]);

  // Finger lifted mid-hold (not locked, not slid to cancel): stop and send.
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

  // Smile button toggles the inline emoji panel (same substrate as attachments).
  const handleEmojiToggle = useCallback(() => {
    if (activePanel === 'emoji') {
      textInputRef.current?.focus();
    } else {
      setActivePanel('emoji');
      Keyboard.dismiss();
    }
  }, [activePanel]);

  // Cursor position in the message input, so emoji insert where the caret is.
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
  const handleEmojiBackspace = useCallback(() => {
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
      return newHead + prev.slice(e);
    });
  }, []);

  // Send a GIF: the Giphy URL goes straight in as the image_url (no upload), and
  // the existing image bubble renders + autoplays it via expo-image. A dedicated
  // 'gif' message_type (for chat-list preview text) is deferred to the pre-flip
  // migration batch.
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
          allowsMultipleSelection: false,
          quality: 0.8,
        });

    if (result.canceled || !result.assets?.[0]) return;

    setUploading(true);
    try {
      const asset = result.assets[0];
      const manipulated = await ImageManipulator.manipulateAsync(
        asset.uri,
        [{ resize: { width: 1200 } }],
        { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG, base64: true },
      );

      if (!manipulated.base64) throw new Error('No base64 data');

      const fileName = `${currentUserId}/${Date.now()}.jpg`;
      const publicUrl = await uploadBase64ToStorage('chat-images', fileName, manipulated.base64);

      await sendMessage('', publicUrl);
      scrollToBottom();
    } catch {
      setAlertInfo({ title: 'Could not send photo', message: 'Something went wrong uploading the image. Please try again.' });
    } finally {
      setUploading(false);
    }
  }, [currentUserId, sendMessage, scrollToBottom]);

  // Send a location chosen in the LocationPickerModal (map preview + address).
  const handleLocationConfirm = useCallback((latitude: number, longitude: number, address: string) => {
    setLocationPickerOpen(false);
    void sendLocation(latitude, longitude, address);
    scrollToBottom();
  }, [sendLocation, scrollToBottom]);

  const textInputRef = useRef<TextInput>(null);

  // Route an attachment-panel selection. Photos/Camera launch the picker;
  // Location opens the map preview screen. (Document/Poll/Contact were removed.)
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

  // Left input-bar button toggles + <-> keyboard.
  //  - panel closed: open it, THEN dismiss the keyboard. Setting panelInset
  //    first means the unified inset is max(keyboard, panel) throughout the
  //    handoff, so the input bar never drops for a frame.
  //  - panel open: refocus the input; the keyboard-show listener closes the
  //    panel once the keyboard has taken over (again, no inset collapse).
  const handleAttachToggle = useCallback(() => {
    if (!currentUserId) return;
    if (activePanel === 'attach') {
      textInputRef.current?.focus();
    } else {
      // From the emoji panel this just swaps content (keyboard already down).
      setActivePanel('attach');
      Keyboard.dismiss();
    }
  }, [currentUserId, activePanel]);

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

  return (
    <View style={{ flex: 1, backgroundColor: Colors.parchment }}>
      {/* ── Header ── */}
      <SafeAreaView edges={['top']} style={{ backgroundColor: Colors.white }}>
        <View style={chatStyles.header}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={chatStyles.backBtn}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Ionicons name="chevron-back" size={24} color={Colors.asphalt} />
          </TouchableOpacity>

          <View style={chatStyles.headerCenter}>
            <Text style={chatStyles.headerTitle} numberOfLines={1}>{event?.title ?? '...'}</Text>
            {event && (
              <Text style={chatStyles.headerSub} numberOfLines={1}>
                {typingLabel ?? formatEventDate(event.start_time)}
              </Text>
            )}
          </View>

          <TouchableOpacity
            onPress={() => router.push(`/plan/${id}` as any)}
            style={chatStyles.viewPlanBtn}
          >
            <Text style={chatStyles.viewPlanText}>View Plan</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={handleReportMenu}
            style={chatStyles.ellipsisBtn}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Ionicons name="ellipsis-horizontal" size={20} color={Colors.warmGray} />
          </TouchableOpacity>
        </View>

        {/* Ticket banner */}
        {event?.tickets_url && (
          <TouchableOpacity
            style={chatStyles.ticketBanner}
            onPress={() => openUrl(event.tickets_url!)}
          >
            <View style={chatStyles.ticketLeft}>
              <Ionicons name="ticket-outline" size={16} color={Colors.terracotta} />
              <Text style={chatStyles.ticketText}>Tickets available</Text>
            </View>
            <Text style={chatStyles.ticketCta}>Get Tickets</Text>
          </TouchableOpacity>
        )}

        {/* Member avatars row */}
        {event && event.members.length > 0 && (() => {
          const total = event.members.length;
          const isOverflow = total > 5;
          const visibleMembers = !isOverflow || membersExpanded
            ? event.members
            : event.members.slice(0, 4);
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

      {/* ── Messages ──
          The input bar is absolutely positioned above the keyboard on
          both platforms. On Android that means bottom:0 (adjustResize
          shrinks the window). On iOS the new architecture (Fabric) makes
          KeyboardAvoidingView unreliable, so we listen to keyboardWillShow
          and set the bar's bottom to the reported keyboard height. The
          FlatList (inverted) reserves exactly the dock height via
          paddingTop on its content container so new messages never hide
          behind the bar. */}
      <View style={{ flex: 1 }}>
        {loading ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator size="large" color={Colors.terracotta} />
          </View>
        ) : (
          <FlatList
            decelerationRate="normal"
            ref={listRef}
            data={enrichedItems}
            keyExtractor={item => item.id}
            inverted={true}
            style={[
              { flex: 1 },
              Platform.OS === 'ios' && { marginBottom: Math.max(iosKeyboardHeight, panelInset) },
            ]}
            contentContainerStyle={{ paddingBottom: 12, paddingTop: listBottomReservation }}
            showsVerticalScrollIndicator={false}
            removeClippedSubviews={Platform.OS === 'android'}
            automaticallyAdjustContentInsets={false}
            contentInsetAdjustmentBehavior="never"
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            initialNumToRender={20}
            windowSize={10}
            maxToRenderPerBatch={15}
            maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
            onScroll={handleListScroll}
            scrollEventThrottle={16}
            // Inverted list: the header renders at the visual bottom (newest
            // side), so the typing dots sit just above the input bar.
            ListHeaderComponent={typingUsers.length > 0 ? <TypingIndicator /> : null}
            onScrollToIndexFailed={(info) => {
              listRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: true });
              setTimeout(() => {
                listRef.current?.scrollToIndex({ index: info.index, animated: true, viewPosition: 0.5 });
              }, 300);
            }}
            ListEmptyComponent={
              <View style={chatStyles.emptyState}>
                <Text style={chatStyles.emptyEmoji}>{'\uD83D\uDC4B'}</Text>
                <Text style={chatStyles.emptyText}>Say hi to the group!</Text>
              </View>
            }
            ListFooterComponent={event ? (
              <TouchableOpacity
                style={chatStyles.pinnedCard}
                onPress={() => router.push(`/plan/${id}` as any)}
                activeOpacity={0.8}
              >
                <Text style={chatStyles.pinnedTitle} numberOfLines={1}>{event.title}</Text>
                <View style={chatStyles.pinnedRow}>
                  <View style={chatStyles.pinnedDetail}>
                    <Ionicons name="calendar-outline" size={12} color={Colors.terracotta} />
                    <Text style={chatStyles.pinnedDetailText}>{formatEventDate(event.start_time)}</Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => showAddToCalendar(event.title, event.start_time)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Text style={chatStyles.pinnedCalLink}>Add to Calendar</Text>
                  </TouchableOpacity>
                </View>
                <View style={chatStyles.pinnedRow}>
                  <Text style={chatStyles.pinnedSpots}>
                    {capDisplayCount(event.member_count)} going
                  </Text>
                </View>
                {!isPast && (() => {
                  const diff = new Date(event.start_time).getTime() - Date.now();
                  const hours = Math.floor(diff / 3600000);
                  const days = Math.floor(diff / 86400000);
                  if (diff < 0) return null;
                  const label = hours < 1 ? 'Starting soon!'
                    : hours < 24 ? `Tonight at ${new Date(event.start_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`
                    : days === 1 ? 'Tomorrow!'
                    : `Happening in ${days} days`;
                  return <Text style={chatStyles.pinnedCountdown}>{label}</Text>;
                })()}
              </TouchableOpacity>
            ) : null}
            renderItem={({ item, index }) => {
              if ('type' in item && (item.type === 'date' || item.type === 'time')) {
                return (
                  <View style={bubbleStyles.systemRow}>
                    <Text style={bubbleStyles.systemText}>{item.label}</Text>
                  </View>
                );
              }

              const msg = item as ChatMessage;
              const isOwn = msg.user_id === currentUserId;

              // In inverted list: index-1 = newer in time, index+1 = older in time
              const newerItem = enrichedItems[index - 1];
              const newerMsg = newerItem && !('type' in newerItem) ? newerItem as ChatMessage : null;
              const olderItem = enrichedItems[index + 1];
              const olderMsg = olderItem && !('type' in olderItem) ? olderItem as ChatMessage : null;

              // In inverted list: index-1 = newer in time (below visually), index+1 = older in time (above visually)
              const isGroupedWithOlder = !!(olderMsg?.user_id === msg.user_id && isSameDay(olderMsg.created_at, msg.created_at));
              const isGroupedWithNewer = !!(newerMsg?.user_id === msg.user_id && isSameDay(msg.created_at, newerMsg.created_at));

              // Avatar: show on bottom-most message of group (when newer msg is different sender or doesn't exist)
              const showAvatar = !isOwn && !isGroupedWithNewer;
              // Name: show above top-most message of group (when older msg is different sender or doesn't exist)
              const showName = !isOwn && !isGroupedWithOlder;

              const gap = isGroupedWithOlder ? chatStyles.msgGap1
                : msg.reactions?.length ? chatStyles.msgGap18
                : chatStyles.msgGap10;

              return (
                <SwipeableRow
                  containerStyle={gap}
                  enabled={!isPast && msg.message_type === 'user'}
                  onTriggerReply={() => {
                    setReplyingTo({
                      id: msg.id,
                      content: msg.content,
                      senderName: msg.sender?.first_name ?? 'Someone',
                    });
                    setEditingMessageId(null);
                  }}
                >
                  <MessageBubble
                    message={msg}
                    isOwn={isOwn}
                    showAvatar={showAvatar}
                    showName={showName}
                    isGrouped={isGroupedWithNewer}
                    currentUserId={currentUserId}
                    planTitle={event?.title}
                    onPhotoPress={setPhotoViewUrl}
                    onReaction={(msgId, emoji) => toggleReaction(msgId, emoji ?? 'heart')}
                    onMessageLongPress={(msg, own) => setOverlayMessage({ message: msg, isOwn: own })}
                    onReplyTap={(msgId) => {
                      const idx = enrichedItems.findIndex(item => !('type' in item) && item.id === msgId);
                      if (idx >= 0) {
                        listRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.5 });
                      }
                    }}
                    onAvatarPress={(uid) => setMiniProfileUserId(uid)}
                  />
                </SwipeableRow>
              );
            }}
          />
        )}

        {/* Input bar — absolutely positioned so the FlatList can span the
            full KAV area. The measured height is reserved via paddingTop
            on the inverted list's contentContainerStyle, which guarantees
            new messages are never obscured by the bar on any screen size. */}
        {isPast ? (
          <InputBarWrapper
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
              inputBarBottomStyle,
            ]}
            onLayout={(e: LayoutChangeEvent) => setBottomDockHeight(e.nativeEvent.layout.height)}
          >
            <Text style={chatStyles.readOnlyText}>This chat is read-only. {event?.title ?? 'the plan'} has ended.</Text>
          </InputBarWrapper>
        ) : (
          <InputBarWrapper
            style={[
              {
                position: 'absolute',
                left: 0,
                right: 0,
                backgroundColor: Colors.white,
              },
              inputBarBottomStyle,
            ]}
            onLayout={(e: LayoutChangeEvent) => setBottomDockHeight(e.nativeEvent.layout.height)}
          >
            {showCountdown && (
              <Text style={chatStyles.countdownText}>
                {`chat stays active for ${hoursLeft} more hours`}
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
                // glyph (only keypad/dialpad), so the keyboard toggle uses
                // MaterialIcons. Every other input-bar icon stays Ionicons.
                <MaterialIcons name="keyboard" size={26} color={Colors.warmGray} />
              ) : (
                <Ionicons name="add-circle-outline" size={26} color={Colors.warmGray} />
              )}
            </TouchableOpacity>

            {/* Smile button toggles the inline emoji panel; morphs to a keyboard
                icon while that panel is open. */}
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
              onSelectionChange={(e) => { selectionRef.current = e.nativeEvent.selection; }}
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
              // Disable autofill so the Android IME's suggestion / spell-check
              // strip isn't suppressed on multiline inputs (Samsung & Gboard
              // both hide suggestions when autofill is active on a multiline).
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

        {/* Inline panel: sits in the keyboard's footprint at the screen bottom;
            the input bar (offset by panelInset) floats above it. Attachment or
            emoji share the same slot. */}
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
          eventId={id}
        />
      )}

      <LocationPickerModal
        visible={locationPickerOpen}
        onClose={() => setLocationPickerOpen(false)}
        onConfirm={handleLocationConfirm}
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
            {/* Emoji reaction row — only for other people's messages, disabled when read-only */}
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

const chatStyles = StyleSheet.create({
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

  ticketBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: Colors.parchment,
    borderLeftWidth: 3,
    borderLeftColor: Colors.terracotta,
    borderBottomWidth: 1,
    borderBottomColor: Colors.inputBg,
  },
  ticketLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  ticketText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.asphalt },
  ticketCta: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodySM, color: Colors.terracotta },


  pinnedCard: {
    backgroundColor: Colors.cream,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 10,
    marginHorizontal: 16,
    marginBottom: 8,
    marginTop: 4,
  },
  pinnedTitle: {
    fontWeight: '700',
    fontSize: 14,
    color: Colors.darkWarm,
    marginBottom: 6,
  },
  pinnedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pinnedDetail: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  pinnedDetailText: {
    fontSize: 11,
    color: Colors.secondary,
  },
  pinnedCalLink: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.terracotta,
  },
  pinnedSpots: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.secondary,
  },
  pinnedCountdown: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.terracotta,
    marginTop: 6,
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
  emptyEmoji: {
    fontSize: 40,
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
  readOnlyText: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.warmGray, fontStyle: 'italic' },
  countdownText: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: '#78695C',
    fontStyle: 'italic',
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
