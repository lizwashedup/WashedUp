import React from 'react';
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
import { Ionicons } from '@expo/vector-icons';
import { useChatList, ChatPreview } from '../../../hooks/useChatList';

const CATEGORY_COLORS: Record<string, string> = {
  music: '#7C5CBF', film: '#5C7CBF', nightlife: '#BF5C7C',
  food: '#BF7C5C', outdoors: '#5CBF7C', fitness: '#5CBFBF',
  art: '#BF5CBF', comedy: '#C4652A', sports: '#5C7CBF',
  wellness: '#5CBF9C', default: '#C4652A',
};

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
  if (diffDays < 7) return `${diffDays}d`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function ChatRow({ chat, onPress }: { chat: ChatPreview; onPress: () => void }) {
  const catColor = CATEGORY_COLORS[chat.category?.toLowerCase() ?? ''] ?? CATEGORY_COLORS.default;

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={[styles.row, chat.is_past && styles.rowPast]}
    >
      <View style={styles.avatarContainer}>
        {chat.image_url ? (
          <Image source={{ uri: chat.image_url }} style={styles.avatar} contentFit="cover" />
        ) : (
          <View style={[styles.avatar, { backgroundColor: catColor + '30' }]}>
            <Ionicons name="calendar-outline" size={20} color={catColor} />
          </View>
        )}
        {chat.unread_count > 0 && <View style={styles.unreadDot} />}
      </View>

      <View style={styles.rowContent}>
        <View style={styles.rowTop}>
          <Text style={[styles.planTitle, chat.is_past && styles.textPast]} numberOfLines={1}>
            {chat.title}
          </Text>
          <View style={styles.rowRight}>
            {chat.last_message_at && (
              <Text style={styles.timestamp}>{formatTime(chat.last_message_at)}</Text>
            )}
            {chat.unread_count > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{chat.unread_count > 9 ? '9+' : chat.unread_count}</Text>
              </View>
            )}
          </View>
        </View>

        <View style={styles.rowBottom}>
          <Text style={[styles.preview, chat.is_past && styles.textPast]} numberOfLines={1}>
            {chat.last_message ?? 'No messages yet'}
          </Text>
          {chat.is_past && (
            <View style={styles.readOnlyPill}>
              <Text style={styles.readOnlyText}>Read only</Text>
            </View>
          )}
        </View>

        <Text style={styles.memberCount}>{chat.member_count} people</Text>
      </View>
    </TouchableOpacity>
  );
}

export default function ChatsScreen() {
  const router = useRouter();
  const { chats, loading, refetch } = useChatList();
  const [refreshing, setRefreshing] = React.useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const activeChats = chats.filter(c => !c.is_past);
  const pastChats = chats.filter(c => c.is_past);

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Chats</Text>
        </View>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#C4652A" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Chats</Text>
      </View>

      {chats.length === 0 ? (
        <View style={styles.emptyState}>
          <View style={styles.emptyIcon}>
            <Ionicons name="chatbubbles-outline" size={40} color="#C4652A" />
          </View>
          <Text style={styles.emptyTitle}>No chats yet</Text>
          <Text style={styles.emptySubtitle}>
            Join a plan and a group chat opens once{'\n'}2 people are going.
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
          data={chats}
          keyExtractor={item => item.eventId}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#C4652A" />
          }
          contentContainerStyle={styles.listContent}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          ListHeaderComponent={activeChats.length > 0 ? <Text style={styles.sectionLabel}>Active</Text> : null}
          renderItem={({ item, index }) => {
            const isFirstPast = item.is_past && (index === 0 || !chats[index - 1].is_past);
            return (
              <>
                {isFirstPast && (
                  <Text style={[styles.sectionLabel, { marginTop: 24 }]}>Past Plans</Text>
                )}
                <ChatRow
                  chat={item}
                  onPress={() => router.push(`/(tabs)/chats/${item.eventId}` as any)}
                />
              </>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFF8F0' },
  header: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F0E6D3',
  },
  headerTitle: { fontSize: 28, fontWeight: '800', color: '#1A1A1A', letterSpacing: -0.5 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { paddingBottom: 32 },

  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#9B8B7A',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 8,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: '#FFFFFF',
    gap: 12,
  },
  rowPast: { opacity: 0.55 },

  avatarContainer: { position: 'relative' },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F0E6D3',
  },
  unreadDot: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#C4652A',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },

  rowContent: { flex: 1, gap: 3 },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  planTitle: { fontSize: 15, fontWeight: '700', color: '#1A1A1A', flex: 1, marginRight: 8 },
  textPast: { color: '#9B8B7A' },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  timestamp: { fontSize: 12, color: '#9B8B7A' },
  badge: {
    backgroundColor: '#C4652A',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  badgeText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
  rowBottom: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  preview: { fontSize: 13, color: '#9B8B7A', flex: 1 },
  readOnlyPill: {
    backgroundColor: '#F0E6D3',
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  readOnlyText: { fontSize: 11, color: '#9B8B7A', fontStyle: 'italic' },
  memberCount: { fontSize: 12, color: '#C4652A', fontWeight: '600' },
  separator: { height: 1, backgroundColor: '#F0E6D3', marginLeft: 84 },

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
    backgroundColor: '#FFF0E8',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: '#1A1A1A' },
  emptySubtitle: { fontSize: 15, color: '#9B8B7A', textAlign: 'center', lineHeight: 22 },
  emptyButton: {
    backgroundColor: '#C4652A',
    paddingHorizontal: 28,
    paddingVertical: 13,
    borderRadius: 14,
    marginTop: 8,
  },
  emptyButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
});
