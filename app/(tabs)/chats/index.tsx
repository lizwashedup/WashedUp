import React, { useMemo, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { ChevronDown, ChevronRight } from 'lucide-react-native';
import { useChatList, ChatPreview } from '../../../hooks/useChatList';
import { SkeletonChatList } from '../../../components/SkeletonCard';
import ProfileButton from '../../../components/ProfileButton';
import Colors from '../../../constants/Colors';
import { Fonts, FontSizes } from '../../../constants/Typography';

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

function formatEventDate(dateString: string): string {
  const d = new Date(dateString);
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrowStart = new Date(todayStart.getTime() + 86400000);
  const dateStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());

  const timeStr = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  if (dateStart.getTime() === todayStart.getTime()) return `Today at ${timeStr}`;
  if (dateStart.getTime() === tomorrowStart.getTime()) return `Tomorrow at ${timeStr}`;
  const dayStr = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  return `${dayStr} at ${timeStr}`;
}

const ChatSeparator = () => <View style={styles.separator} />;

const ChatRow = React.memo(function ChatRow({ chat, onPress }: { chat: ChatPreview; onPress: () => void }) {
  const hasUnread = chat.unread_count > 0;

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={[styles.row, hasUnread && styles.rowUnread, chat.is_past && styles.rowPast]}
    >
      <View style={styles.avatarContainer}>
        {chat.image_url ? (
          <Image
            source={{ uri: chat.image_url }}
            style={styles.avatar}
            contentFit="cover"
          />
        ) : chat.member_avatars.length >= 4 ? (
          <View style={styles.avatarGrid}>
            {chat.member_avatars.slice(0, 4).map((url, i) => (
              <Image key={i} source={{ uri: url }} style={styles.gridPhoto} contentFit="cover" />
            ))}
          </View>
        ) : chat.member_avatars.length >= 2 ? (
          <View style={styles.avatarDuo}>
            {chat.member_avatars.slice(0, 2).map((url, i) => (
              <Image key={i} source={{ uri: url }} style={[styles.duoPhoto, i === 1 && { marginLeft: -6 }]} contentFit="cover" />
            ))}
          </View>
        ) : chat.member_avatars.length === 1 ? (
          <Image source={{ uri: chat.member_avatars[0] }} style={styles.avatarSingle} contentFit="cover" />
        ) : (
          <View style={[styles.avatar, styles.avatarPlaceholder]}>
            <Ionicons name="people-outline" size={22} color="#A09385" />
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
            {chat.last_message ?? 'No messages yet'}
          </Text>
        </View>

        <View style={styles.datePill}>
          <Text style={styles.datePillText}>{formatEventDate(chat.start_time)}</Text>
        </View>
      </View>

      {hasUnread && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{chat.unread_count > 9 ? '9+' : chat.unread_count}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
});

export default function ChatsScreen() {
  const router = useRouter();
  const { chats, loading, refetch } = useChatList();
  const [refreshing, setRefreshing] = React.useState(false);
  const [pastExpanded, setPastExpanded] = React.useState(false);

  useFocusEffect(
    React.useCallback(() => {
      refetch();
    }, [refetch]),
  );

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await refetch(); } finally { setRefreshing(false); }
  }, [refetch]);

  const activeChats = useMemo(() => chats.filter(c => !c.is_past), [chats]);
  const pastChats = useMemo(() => chats.filter(c => c.is_past), [chats]);

  const renderChat = useCallback(({ item }: { item: ChatPreview }) => (
    <ChatRow
      chat={item}
      onPress={() => router.push(`/(tabs)/chats/${item.eventId}` as any)}
    />
  ), [router]);

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Chats</Text>
          <ProfileButton />
        </View>
        <SkeletonChatList />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Chats</Text>
        <ProfileButton />
      </View>

      {chats.length === 0 ? (
        <View style={styles.emptyState}>
          <View style={styles.emptyIcon}>
            <Ionicons name="chatbubbles-outline" size={40} color="#B5522E" />
          </View>
          <Text style={styles.emptyTitle}>Join a plan to start chatting</Text>
          <Text style={styles.emptySubtitle}>
            A group chat opens once 2 people are going.
          </Text>
          <TouchableOpacity
            style={styles.emptyButton}
            onPress={() => router.push('/(tabs)/plans')}
          >
            <Text style={styles.emptyButtonText}>Browse Plans</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={activeChats}
          keyExtractor={item => item.eventId}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={Colors.terracotta} />
          }
          contentContainerStyle={styles.listContent}
          ItemSeparatorComponent={ChatSeparator}
          ListHeaderComponent={activeChats.length > 0 ? <Text style={styles.sectionLabel}>Active</Text> : null}
          renderItem={renderChat}
          ListEmptyComponent={
            <View style={styles.noActiveState}>
              <Text style={styles.noActiveText}>No active chats — join a plan to start chatting</Text>
              <TouchableOpacity
                style={styles.noActiveButton}
                onPress={() => router.push('/(tabs)/plans')}
              >
                <Text style={styles.noActiveButtonText}>Browse Plans</Text>
              </TouchableOpacity>
            </View>
          }
          ListFooterComponent={pastChats.length > 0 ? (
            <View>
              <TouchableOpacity
                style={styles.pastHeader}
                onPress={() => setPastExpanded(prev => !prev)}
                activeOpacity={0.7}
              >
                <View style={styles.pastHeaderLeft}>
                  {pastExpanded
                    ? <ChevronDown size={16} color="#A09385" />
                    : <ChevronRight size={16} color="#A09385" />}
                  <Text style={styles.pastLabel}>Past Plans ({pastChats.length})</Text>
                </View>
              </TouchableOpacity>
              {pastExpanded && pastChats.map((chat, i) => (
                <React.Fragment key={chat.eventId}>
                  {i > 0 && <View style={styles.separator} />}
                  <ChatRow
                    chat={chat}
                    onPress={() => router.push(`/(tabs)/chats/${chat.eventId}` as any)}
                  />
                </React.Fragment>
              ))}
            </View>
          ) : null}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FAF5EC' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: '#2C1810',
  },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { paddingBottom: 32 },

  sectionLabel: {
    fontWeight: '700',
    fontSize: 11,
    color: '#B5522E',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 8,
  },

  pastHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    marginTop: 8,
  },
  pastHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  pastLabel: {
    fontWeight: '600',
    fontSize: 14,
    color: '#78695C',
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    gap: 12,
  },
  rowUnread: {
    backgroundColor: '#FAF0E8',
  },
  rowPast: { opacity: 0.55 },

  avatarContainer: { position: 'relative' },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 12,
    backgroundColor: '#F5EDE0',
  },
  avatarPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarGrid: {
    width: 52,
    height: 52,
    borderRadius: 12,
    overflow: 'hidden',
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  gridPhoto: {
    width: 26,
    height: 26,
  },
  avatarDuo: {
    width: 52,
    height: 52,
    borderRadius: 12,
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  duoPhoto: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  avatarSingle: {
    width: 52,
    height: 52,
    borderRadius: 12,
  },

  rowContent: { flex: 1, gap: 2 },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  titleRow: { flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 8, gap: 6 },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#B5522E',
  },
  planTitle: { fontWeight: '700', fontSize: 15, color: '#2C1810', flex: 1 },
  textPast: { color: '#A09385' },
  timestamp: { fontSize: 12, color: '#A09385' },

  badge: {
    backgroundColor: '#B5522E',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  badgeText: { color: '#FFFFFF', fontWeight: '700', fontSize: 11 },

  rowBottom: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  preview: { fontSize: 13, color: '#78695C', flex: 1 },
  datePill: {
    alignSelf: 'flex-start',
    backgroundColor: '#F5EDE0',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginTop: 4,
  },
  datePillText: { fontSize: 10, fontWeight: '500', color: '#78695C' },
  separator: { height: 1, backgroundColor: '#F5EDE0', marginLeft: 84 },

  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    gap: 12,
  },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#F5E8E2',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  emptyTitle: { fontWeight: '700', fontSize: 20, color: '#2C1810', textAlign: 'center' },
  emptySubtitle: { fontSize: 15, color: '#78695C', textAlign: 'center', lineHeight: 22 },
  emptyButton: {
    backgroundColor: '#B5522E',
    paddingHorizontal: 28,
    paddingVertical: 13,
    borderRadius: 999,
    marginTop: 8,
  },
  emptyButtonText: { color: '#FFFFFF', fontWeight: '700', fontSize: 15 },

  noActiveState: {
    alignItems: 'center',
    paddingVertical: 40,
    paddingHorizontal: 32,
    gap: 12,
  },
  noActiveText: { fontSize: 15, color: '#78695C', textAlign: 'center' },
  noActiveButton: {
    backgroundColor: '#B5522E',
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 999,
  },
  noActiveButtonText: { color: '#FFFFFF', fontWeight: '700', fontSize: 13 },
});
