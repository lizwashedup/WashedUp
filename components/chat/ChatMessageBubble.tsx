import React, { memo, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, Pressable, Platform, Linking } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import Colors from '../../constants/Colors';
import type { AfterglowFontFamilies } from '../../constants/Typography';
import { MEMBER_REDESIGN_APPEARANCE_ENABLED } from '../../constants/MemberAppearance';
import { COMMUNITY_CHAT_GROUPING_ENABLED } from '../../constants/FeatureFlags';
import type { ChatMessage } from '../../hooks/useChat';
import { hapticMedium } from '../../lib/haptics';
import { openUrl, soleUrlIn } from '../../lib/url';
import { topicReactionCounts } from '../../lib/communityReactionChips';
import { chatLocationLabel, parsePlanChatLocation } from '../../lib/chatLocation';
import LinkifiedText from '../LinkifiedText';
import { messageActionAccess, messageActionWeb } from './messageActionAccess';
import { ChatBubbleFill } from './ChatBubbleFill';
import { ChatPhotoAttachment } from './ChatPhotoAttachment';
import { createChatMessageAppearance } from './chatMessageAppearance';
import ChatPlanCard from './ChatPlanCard';
import VoicePlayer from './VoicePlayer';
import LinkPreviewCard from './LinkPreviewCard';
import { ChatSizedText } from './ChatSizedText';
import { ChatLocationPreview } from './ChatLocationPreview';
import { ReactionChips } from './ReactionChips';
import { formatMessageTime } from './chatDateFormatting';
import { bubbleStyles } from './chatBubbleStyles';

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
  const canTapToReply = !!onStartReply && message.message_type === 'user' && !message.image_url && !firstUrl;
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

export default MessageBubble;
