/**
 * A community conversation or room row in the Chats list, wearing the
 * app's native chat clothes (mirrors ChatRow: avatar, title, preview,
 * timestamp, unread). Community rows open the community's conversation;
 * room rows carry the community name as a small secondary label and open
 * their thread. Revised doc 09: no hub screen, chats are just chats.
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';
import type { CommunityChatRowData } from '../../lib/communityChat';

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
}

export const CommunityChatRow = React.memo(function CommunityChatRow({ row, onPress }: Props) {
  const hasUnread = row.unread > 0;
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={[styles.row, hasUnread && styles.rowUnread]}
    >
      <View
        style={[
          styles.avatar,
          row.kind === 'community' && row.accent ? { backgroundColor: row.accent } : null,
        ]}
      >
        <Text style={[styles.avatarInitial, row.kind === 'community' && row.accent ? styles.avatarInitialOnAccent : null]}>
          {row.title.slice(0, 1).toLowerCase()}
        </Text>
      </View>

      <View style={styles.content}>
        <View style={styles.top}>
          <View style={styles.titleRow}>
            {hasUnread && <View style={styles.unreadDot} />}
            <Text style={styles.title} numberOfLines={1}>{row.title}</Text>
          </View>
          {row.lastAt && <Text style={styles.timestamp}>{formatTime(row.lastAt)}</Text>}
        </View>
        {!!row.secondary && (
          <Text style={styles.secondary} numberOfLines={1}>{row.secondary}</Text>
        )}
        <Text style={styles.preview} numberOfLines={1}>{row.preview}</Text>
      </View>

      {hasUnread && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{row.unread > 9 ? '9+' : row.unread}</Text>
        </View>
      )}
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
  avatarInitial: { fontFamily: Fonts.display, fontSize: FontSizes.displayMD, color: Colors.terracotta },
  avatarInitialOnAccent: { color: Colors.white },
  content: { flex: 1, gap: 2 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.terracotta },
  title: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.darkWarm, flex: 1 },
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
