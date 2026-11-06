import { formatLocalPlanDateTime as formatEventDate } from '../../lib/planDateLabels';
import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Image } from 'expo-image';
import type { ChatPreview } from '../../hooks/useChatList';
import type { AfterglowFontFamilies } from '../../constants/Typography';
import { getPlanChatTiming } from '../../lib/planChatExpiry';
import CircleCover from '../yours/circles/CircleCover';
import { ChatInboxRow } from './ChatInboxRow';
import { styles } from './chatInboxStyles';

function formatTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'now';
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}


export const ChatRow = React.memo(function ChatRow({
  chat,
  onPress,
  onLongPress,
  conversationFonts,
}: {
  conversationFonts?: AfterglowFontFamilies;
  chat: ChatPreview;
  onPress: () => void;
  // Circle rows only (doc 120): long-press opens the delete-chat /
  // leave-circle confirm. Undefined on plan rows, so they are untouched.
  onLongPress?: () => void;
}) {
  const hasUnread = chat.unread_count > 0;
  if (conversationFonts) {
    const hours = chat.kind === 'event' && !chat.is_past
      ? getPlanChatTiming(chat.start_time, chat.end_time).remainingHours : null;
    return <ChatInboxRow
      identity={`${chat.kind}:${chat.conversationId}`} title={chat.title}
      preview={chat.last_message ?? (chat.preview_unavailable ? 'Open conversation' : 'Be the first to say hello.')}
      timestamp={chat.last_message_at ? formatTime(chat.last_message_at) : null}
      image={chat.image_url} person={chat.is_dm} unread={chat.unread_count}
      fonts={conversationFonts} onPress={onPress} onLongPress={onLongPress}
      metadata={chat.kind === 'event' ? formatEventDate(chat.start_time) : null}
      lifecycle={hours !== null && hours > 0 ? `Chat closes in ${hours} ${hours === 1 ? 'hour' : 'hours'}` : null}
      past={chat.is_past}
    />;
  }

  return (
    <TouchableOpacity
      onPress={onPress}
      onLongPress={onLongPress}
      activeOpacity={0.7}
      style={[styles.row, hasUnread && styles.rowUnread, chat.is_past && styles.rowPast]}
    >
      <View style={styles.avatarContainer}>
        {chat.kind === 'circle' && !chat.is_dm ? (
          // Real circle rows use the same monogram cover as the Yours > Circles
          // directory, not the w-logo plan placeholder. (DMs fall through to the
          // image branch to show the counterpart's face.)
          <CircleCover name={chat.title} coverUrl={null} />
        ) : chat.image_url ? (
          <Image
            source={{ uri: chat.image_url }}
            style={styles.avatar}
            contentFit="cover"
          />
        ) : (
          <View style={[styles.avatar, styles.avatarPlaceholder]}>
            <Image
              source={require('../../assets/images/w-logo-waves.png')}
              style={styles.avatarIcon}
              contentFit="contain"
            />
          </View>
        )}
      </View>

      <View style={styles.rowContent}>
        <View style={styles.rowTop}>
          <View style={styles.titleRow}>
            {hasUnread && <View style={styles.unreadDot} />}
            <Text style={[styles.planTitle, chat.is_past && styles.textPast]} numberOfLines={1}>
              {chat.title}
            </Text>
          </View>
          {chat.last_message_at && (
            <Text style={styles.timestamp}>{formatTime(chat.last_message_at)}</Text>
          )}
        </View>

        <View style={styles.rowBottom}>
          <Text style={[styles.preview, chat.is_past && styles.textPast]} numberOfLines={1}>
            {chat.last_message ?? (chat.preview_unavailable ? 'Open conversation' : 'No messages yet')}
          </Text>
        </View>

        {/* Plan date pill + the 48h expiry countdown are event-only. Circle
            chats are persistent and have no plan date (start_time is just the
            circle's created_at), so neither belongs on a circle row. */}
        {chat.kind === 'event' && (
          <>
            <View style={styles.datePill}>
              <Text style={styles.datePillText}>{formatEventDate(chat.start_time)}</Text>
            </View>
            {!chat.is_past && new Date(chat.start_time) < new Date() && (() => {
              const hl = getPlanChatTiming(chat.start_time, chat.end_time).remainingHours;
              if (hl === null || hl <= 0) return null;
              return (
                <Text style={styles.countdownText}>
                  {`chat stays active for ${hl} more ${hl === 1 ? 'hour' : 'hours'}`}
                </Text>
              );
            })()}
          </>
        )}
      </View>

      {hasUnread && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{chat.unread_count > 9 ? '9+' : chat.unread_count}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
});

