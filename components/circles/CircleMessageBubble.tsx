/**
 * CircleMessageBubble — one message in a circle chat. A lean, self-contained
 * bubble that matches the plan chat's visual language (own = terracotta fill,
 * other = warm divider fill, 18/2 asymmetric radii, sender name · time, a
 * white reaction badge dangling below).
 *
 * Why not reuse the plan chat's bubble: it lives inline in the live, ungated
 * 2860-line plan chat screen. Extracting it would risk that shipped surface, so
 * this is an isolated, gated parallel. (A future DRY pass should extract a
 * shared MessageBubble used by both.) The circle composer sends text only in
 * v1, so text + system are the live paths; audio/image render defensively.
 */
import React, { memo, useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { MapPin } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';
import { CIRCLE_CHAT } from '../../constants/YoursDesign';
import { COPY } from '../yours/state/constants';
import { hapticMedium } from '../../lib/haptics';
import VoicePlayer from '../chat/VoicePlayer';
import type { ChatMessage } from '../../hooks/useChat';

function formatMessageTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

const R = CIRCLE_CHAT.bubbleRadius;
const TAIL = CIRCLE_CHAT.bubbleTail;
const OWN_RADII = {
  borderTopLeftRadius: R,
  borderTopRightRadius: R,
  borderBottomLeftRadius: R,
  borderBottomRightRadius: TAIL,
} as const;
const OTHER_RADII = {
  borderTopLeftRadius: R,
  borderTopRightRadius: R,
  borderBottomLeftRadius: TAIL,
  borderBottomRightRadius: R,
} as const;

/** Parse a location message's JSON payload; null if it isn't valid. */
function parseLocation(content: string): { address: string } | null {
  try {
    const p = JSON.parse(content);
    if (p && typeof p.address === 'string') return { address: p.address };
  } catch {
    /* not a location payload */
  }
  return null;
}

export interface CircleBubbleProps {
  message: ChatMessage;
  isOwn: boolean;
  showAvatar: boolean;
  showName: boolean;
  currentUserId: string;
  onToggleReaction: (messageId: string) => void;
}

function CircleMessageBubbleBase({
  message,
  isOwn,
  showAvatar,
  showName,
  currentUserId,
  onToggleReaction,
}: CircleBubbleProps) {
  // Hooks run unconditionally (before any early return) so hook order is stable
  // regardless of message_type.
  const reactions = message.reactions ?? [];
  const total = reactions.length;
  const uniqueEmojis = useMemo(() => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const r of reactions) {
      if (!seen.has(r.reaction)) {
        seen.add(r.reaction);
        out.push(r.reaction);
      }
    }
    return out;
  }, [reactions]);
  const location = useMemo(
    () => (message.message_type === 'location' ? parseLocation(message.content) : null),
    [message.message_type, message.content],
  );

  if (message.message_type === 'system') {
    return (
      <View style={styles.systemRow}>
        <Text style={styles.systemText}>{message.content}</Text>
      </View>
    );
  }

  const iReacted = reactions.some((r) => r.user_id === currentUserId);
  const radii = isOwn ? OWN_RADII : OTHER_RADII;

  const onLongPress = () => {
    hapticMedium();
    onToggleReaction(message.id);
  };

  return (
    <View style={[styles.row, isOwn ? styles.rowOwn : styles.rowOther, total > 0 && styles.rowWithReaction]}>
      {!isOwn && (
        <View style={styles.avatarSlot}>
          {showAvatar &&
            (message.sender?.avatar_url ? (
              <Image source={{ uri: message.sender.avatar_url }} style={styles.avatar} contentFit="cover" />
            ) : (
              <View style={[styles.avatar, styles.avatarFallback]}>
                <Text style={styles.avatarInitial}>
                  {message.sender?.first_name?.[0]?.toUpperCase() ?? '?'}
                </Text>
              </View>
            ))}
        </View>
      )}

      <View style={[styles.wrapper, isOwn ? styles.wrapperOwn : styles.wrapperOther]}>
        {!isOwn && showName && (
          <Text style={styles.senderLine}>
            <Text style={styles.senderName}>{message.sender?.first_name ?? 'Someone'}</Text>
            <Text style={styles.senderDot}> · </Text>
            <Text style={styles.senderTime}>{formatMessageTime(message.created_at)}</Text>
          </Text>
        )}

        <Pressable onLongPress={onLongPress} delayLongPress={400}>
          {message.message_type === 'audio' && message.audio_url ? (
            <View style={[styles.bubble, styles.bubbleText, isOwn ? styles.bubbleOwn : styles.bubbleOther, radii]}>
              <VoicePlayer uri={message.audio_url} durationSeconds={message.duration_seconds ?? 0} isOwn={isOwn} />
            </View>
          ) : message.image_url ? (
            <Image source={{ uri: message.image_url }} style={[styles.image, radii]} contentFit="cover" />
          ) : location ? (
            <View style={[styles.bubble, styles.bubbleText, styles.locationBubble, isOwn ? styles.bubbleOwn : styles.bubbleOther, radii]}>
              <MapPin size={CIRCLE_CHAT.sendIcon} color={isOwn ? Colors.white : Colors.terracotta} strokeWidth={2} />
              <Text style={[styles.locationLabel, isOwn && styles.messageTextOwn]} numberOfLines={2}>
                {location.address || COPY.circleLocationLabel}
              </Text>
            </View>
          ) : (
            <View style={[styles.bubble, styles.bubbleText, isOwn ? styles.bubbleOwn : styles.bubbleOther, radii]}>
              <Text style={[styles.messageText, isOwn && styles.messageTextOwn]}>{message.content}</Text>
            </View>
          )}

          {total > 0 && (
            <View
              style={[
                styles.reactionBadge,
                isOwn ? styles.reactionBadgeOwn : styles.reactionBadgeOther,
                iReacted && styles.reactionBadgeMine,
              ]}
            >
              {uniqueEmojis.map((emoji) => (
                <Text key={emoji} style={styles.reactionEmoji}>
                  {emoji === 'heart' ? '❤️' : emoji}
                </Text>
              ))}
              {total > 1 && <Text style={styles.reactionCount}>{total}</Text>}
            </View>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const CircleMessageBubble = memo(CircleMessageBubbleBase);
export default CircleMessageBubble;

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 2, paddingHorizontal: 16 },
  rowOwn: { justifyContent: 'flex-end' },
  rowOther: { justifyContent: 'flex-start' },
  rowWithReaction: { marginBottom: 16 },
  avatarSlot: { width: CIRCLE_CHAT.bubbleAvatar, marginRight: 8, alignSelf: 'flex-end' },
  avatar: {
    width: CIRCLE_CHAT.bubbleAvatar,
    height: CIRCLE_CHAT.bubbleAvatar,
    borderRadius: CIRCLE_CHAT.bubbleAvatar / 2,
    backgroundColor: Colors.inputBg,
  },
  avatarFallback: { backgroundColor: Colors.brandSoft, alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { fontFamily: Fonts.sansBold, fontSize: FontSizes.caption, color: Colors.terracotta },
  wrapper: { maxWidth: '80%', gap: 3 },
  wrapperOwn: { alignItems: 'flex-end' },
  wrapperOther: { alignItems: 'flex-start' },
  senderLine: { marginBottom: 2, marginLeft: 4 },
  senderName: { fontFamily: Fonts.sansBold, fontSize: FontSizes.caption, color: Colors.terracotta },
  senderDot: { fontSize: FontSizes.micro, color: Colors.tertiary },
  senderTime: { fontSize: FontSizes.micro, color: Colors.secondary },
  bubble: { overflow: 'hidden' },
  bubbleText: { paddingHorizontal: 14, paddingVertical: 10 },
  bubbleOwn: { backgroundColor: Colors.terracotta },
  bubbleOther: { backgroundColor: Colors.dividerWarm },
  messageText: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyLG, color: Colors.darkWarm, lineHeight: 22 },
  messageTextOwn: { color: Colors.white },
  image: {
    width: CIRCLE_CHAT.imageSide,
    height: CIRCLE_CHAT.imageSide,
    backgroundColor: Colors.inputBg,
  },
  locationBubble: { flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 160 },
  locationLabel: {
    flex: 1,
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodyMD,
    color: Colors.darkWarm,
  },
  systemRow: { alignItems: 'center', marginVertical: 8, paddingHorizontal: 16 },
  systemText: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.caption,
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
    bottom: -CIRCLE_CHAT.reactionDangle,
    shadowColor: Colors.shadowBlack,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  reactionBadgeOwn: { right: 4 },
  reactionBadgeOther: { left: 4 },
  reactionBadgeMine: { backgroundColor: Colors.warmTint },
  reactionEmoji: { fontSize: FontSizes.bodySM },
  reactionCount: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.caption, color: Colors.textMedium, marginLeft: 1 },
});
