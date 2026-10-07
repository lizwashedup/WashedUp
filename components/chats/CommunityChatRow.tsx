import { EventMediaImage } from '../events/EventMediaImage';
/**
 * A community conversation or room row in the Chats list, wearing the
 * app's native chat clothes (mirrors ChatRow: avatar, title, preview,
 * timestamp, unread). Community rows open the community's conversation;
 * room rows carry the community name as a small secondary label and open
 * their thread. The optional grouped inbox reuses this presentation for
 * parents and the original rooms without changing their identities.
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { Home } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes, type AfterglowFontFamilies } from '../../constants/Typography';
import type { CommunityChatRowData } from '../../lib/communityChat';
import { communityNotificationLabel } from '../../lib/communityChatNotificationPresentation';
import { ChatInboxRow } from './ChatInboxRow';

function formatTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMins = Math.floor((now.getTime() - date.getTime()) / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  if (diffMins < 1) return 'now';
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

interface Props {
  row: CommunityChatRowData;
  onPress: () => void;
  /** The development-only directory opts into the reviewed visual system. */
  conversationFonts?: AfterglowFontFamilies;
  showCommunityContext?: boolean;
}

export const CommunityChatRow = React.memo(function CommunityChatRow({ row, onPress, conversationFonts, showCommunityContext = false }: Props) {
  const hasUnread = row.unread > 0;
  const notificationLabel = communityNotificationLabel(row);
  const timestamp = row.lastAt ? formatTime(row.lastAt) : null;
  if (conversationFonts) return <ChatInboxRow
    identity={row.key} title={row.title} preview={row.preview} timestamp={timestamp}
    eventId={row.eventId} image={row.image} unread={row.unread} fonts={conversationFonts} onPress={onPress}
    community={showCommunityContext && row.kind === 'community'}
    metadata={[showCommunityContext ? row.secondary : null, notificationLabel].filter(Boolean).join(' · ') || null}
  />;
  const label = [
    `${row.title}${hasUnread ? `, ${row.unread} unread ${row.unread === 1 ? 'message' : 'messages'}` : ''}`,
    row.secondary, notificationLabel, row.preview, timestamp,
  ].filter(Boolean).join('. ');
  return (
    <TouchableOpacity onPress={onPress} accessibilityRole="button" accessibilityLabel={label} activeOpacity={0.7} style={[styles.row, hasUnread && styles.rowUnread]}>
      {row.image ? <EventMediaImage eventId={row.eventId ?? ''} reference={row.image} style={styles.avatarImage} contentFit="cover" recyclingKey={row.key} /> : (
        <View style={[styles.avatar, row.kind === 'community' && row.accent ? { backgroundColor: row.accent } : null]}>
          <Text style={[styles.avatarInitial, row.kind === 'community' && row.accent ? styles.avatarInitialOnAccent : null]}>{row.title.slice(0, 1).toLowerCase()}</Text>
        </View>
      )}
      <View style={styles.content}>
        <View style={styles.top}>
          <View style={styles.titleRow}>
            {hasUnread && <View style={styles.unreadDot} />}
            <Text style={styles.title} numberOfLines={1}>{row.title}</Text>
            <Home size={12} color={row.accent ?? Colors.terracotta} strokeWidth={2.5} />
          </View>
          {timestamp && <Text style={styles.timestamp}>{timestamp}</Text>}
        </View>
        {!!row.secondary && <Text style={styles.secondary} numberOfLines={1}>{row.secondary}</Text>}
        {!!notificationLabel && <Text style={styles.secondary}>{notificationLabel}</Text>}
        <Text style={styles.preview} numberOfLines={1}>{row.preview}</Text>
      </View>
      {hasUnread && <View style={styles.badge}><Text style={styles.badgeText}>{row.unread > 9 ? '9+' : row.unread}</Text></View>}
    </TouchableOpacity>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    gap: 12,
  },
  rowUnread: { backgroundColor: Colors.accentSubtle },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 12,
    backgroundColor: Colors.inputBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImage: { width: 52, height: 52, borderRadius: 12, backgroundColor: Colors.inputBg },
  avatarInitial: { fontFamily: Fonts.display, fontSize: FontSizes.displayMD, color: Colors.terracotta },
  avatarInitialOnAccent: { color: Colors.white },
  content: { flex: 1, gap: 2 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.terracotta },
  // flexShrink (not flex) so the community marker hugs the title text
  title: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.darkWarm, flexShrink: 1 },
  timestamp: { fontFamily: Fonts.sans, fontSize: FontSizes.caption, color: Colors.tertiary },
  secondary: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.caption, color: Colors.tertiary },
  preview: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.secondary },
  badge: {
    backgroundColor: Colors.terracotta,
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  badgeText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.caption, color: Colors.white },
});
