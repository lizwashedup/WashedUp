import { EventMediaImage } from '../events/EventMediaImage';
import React from 'react';
import { ChatSizedText } from '../chat/ChatSizedText';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { Home } from 'lucide-react-native';
import { AfterglowColors as Colors } from '../../constants/Colors';
import { AfterglowType, type AfterglowFontFamilies } from '../../constants/Typography';

interface Props {
  identity: string;
  title: string;
  preview: string;
  timestamp?: string | null;
  image?: string | null;
  /** Exact source event, supplied by the existing community-room adapter. */
  eventId?: string | null;
  unread: number;
  fonts: AfterglowFontFamilies;
  metadata?: string | null;
  lifecycle?: string | null;
  community?: boolean;
  person?: boolean;
  past?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
}

/** Shared presentation only. Routing, room identity, reads and notification
 * preferences belong to the source adapter, never to this row. */
export const ChatInboxRow = React.memo(function ChatInboxRow({
  identity, title, preview, timestamp, image, eventId, unread, fonts, metadata, lifecycle,
  community, person, past, onPress, onLongPress,
}: Props) {
  const count = Number.isFinite(unread) ? Math.max(0, Math.floor(unread)) : 0;
  const label = [
    `${title}${count ? `, ${count} unread ${count === 1 ? 'message' : 'messages'}` : ''}`,
    community ? 'Community' : null, metadata, preview, timestamp, lifecycle,
    past ? 'Past chat' : null,
  ].filter((part): part is string => !!part)
    .map(part => /[.!?]$/.test(part) ? part : `${part}.`).join(' ');
  return (
    <TouchableOpacity
      onPress={onPress} onLongPress={onLongPress} activeOpacity={0.7}
      accessibilityRole="button" accessibilityLabel={label}
      accessibilityHint={onLongPress ? 'Touch and hold for chat options.' : undefined}
      style={[styles.row, count > 0 && styles.unread]}
    >
      {image ? <EventMediaImage eventId={eventId ?? ''} reference={image} style={[styles.image, person && styles.person]} contentFit="cover" recyclingKey={identity} /> : (
        <View style={[styles.image, styles.placeholder, person && styles.person]}>
          <Text allowFontScaling={false} accessible={false} aria-hidden style={[styles.initial, { fontFamily: fonts.display }]}>{Array.from(title.trim())[0]?.toUpperCase()}</Text>
        </View>
      )}
      <View style={styles.content}>
        <View style={styles.top}>
          <View style={styles.titleLine}>
            <ChatSizedText style={[styles.title, { fontFamily: fonts.semibold }]} numberOfLines={2}>{title}</ChatSizedText>
            {community && <Home size={12} color={Colors.clay} strokeWidth={2} style={styles.marker} />}
          </View>
          {!!timestamp && <ChatSizedText style={[styles.time, { fontFamily: fonts.regular }]}>{timestamp}</ChatSizedText>}
        </View>
        <View style={styles.previewLine}>
          <ChatSizedText style={[styles.preview, { fontFamily: fonts.regular }]} numberOfLines={1}>{preview}</ChatSizedText>
          {count > 0 && <View style={styles.badge}><ChatSizedText style={[styles.badgeText, { fontFamily: fonts.semibold }]}>{count > 99 ? '99+' : count}</ChatSizedText></View>}
        </View>
        {!!metadata && <ChatSizedText style={[styles.meta, { fontFamily: fonts.medium }]} numberOfLines={2}>{metadata}</ChatSizedText>}
        {!!lifecycle && <ChatSizedText style={[styles.meta, { fontFamily: fonts.regular }]}>{lifecycle}</ChatSizedText>}
      </View>
    </TouchableOpacity>
  );
});

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 94, paddingHorizontal: 20, paddingVertical: 16, gap: 12 },
  unread: { backgroundColor: Colors.unread },
  image: { width: 52, height: 52, borderRadius: 8, backgroundColor: Colors.avatar },
  person: { borderRadius: 26 },
  placeholder: { alignItems: 'center', justifyContent: 'center' },
  initial: { ...AfterglowType.identity, color: Colors.clay },
  content: { flex: 1, minWidth: 0, gap: 6 },
  top: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  titleLine: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { ...AfterglowType.title, color: Colors.ink, flexShrink: 1 },
  marker: { flexShrink: 0 },
  time: { ...AfterglowType.timestamp, color: Colors.muted, flexShrink: 0, paddingTop: 2 },
  previewLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  preview: { ...AfterglowType.body, color: Colors.muted, flex: 1 },
  badge: { minWidth: 21, minHeight: 21, paddingHorizontal: 5, paddingVertical: 2, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.clay },
  badgeText: { ...AfterglowType.timestamp, color: Colors.white },
  meta: { ...AfterglowType.caption, color: Colors.muted },
});
