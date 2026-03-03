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
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useChatList, ChatPreview } from '../../../hooks/useChatList';
import Colors from '../../../constants/Colors';
import { Fonts, FontSizes } from '../../../constants/Typography';

const CATEGORY_COLORS: Record<string, string> = {
  music: Colors.categoryMusic,
  film: Colors.categoryFilm,
  nightlife: Colors.categoryNightlife,
  food: Colors.categoryFood,
  outdoors: Colors.categoryOutdoors,
  fitness: Colors.categoryFitness,
  art: Colors.categoryArt,
  comedy: Colors.terracotta,
  sports: Colors.categorySports,
  wellness: Colors.categoryWellness,
  default: Colors.terracotta,
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
        <Image
          source={chat.image_url ? { uri: chat.image_url } : require('../../../assets/images/plan-placeholder.png')}
          style={styles.avatar}
          contentFit="cover"
        />
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

  useFocusEffect(
    React.useCallback(() => {
      refetch();
    }, [refetch]),
  );

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
          <ActivityIndicator size="large" color={Colors.terracotta} />
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
            <Ionicons name="chatbubbles-outline" size={40} color={Colors.terracotta} />
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
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={Colors.terracotta} />
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
  container: { flex: 1, backgroundColor: Colors.parchment },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
  },
  headerTitle: {
    fontFamily: Fonts.display,
    fontSize: 28,
    color: Colors.terracotta,
    textShadowColor: Colors.shadowLight,
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { paddingBottom: 32 },

  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.warmGray,
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
    backgroundColor: Colors.white,
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
    backgroundColor: Colors.inputBg,
  },
  unreadDot: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: Colors.terracotta,
    borderWidth: 2,
    borderColor: Colors.white,
  },

  rowContent: { flex: 1, gap: 3 },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  planTitle: { fontSize: 15, fontWeight: '700', color: Colors.asphalt, flex: 1, marginRight: 8 },
  textPast: { color: Colors.warmGray },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  timestamp: { fontSize: 12, color: Colors.warmGray },
  badge: {
    backgroundColor: Colors.terracotta,
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  badgeText: { color: Colors.white, fontSize: 11, fontWeight: '700' },
  rowBottom: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  preview: { fontSize: 13, color: Colors.warmGray, flex: 1 },
  readOnlyPill: {
    backgroundColor: Colors.inputBg,
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  readOnlyText: { fontSize: 11, color: Colors.warmGray, fontStyle: 'italic' },
  memberCount: { fontSize: 12, color: Colors.terracotta, fontWeight: '600' },
  separator: { height: 1, backgroundColor: Colors.inputBg, marginLeft: 84 },

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
    backgroundColor: Colors.emptyIconBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: Colors.asphalt },
  emptySubtitle: { fontSize: 15, color: Colors.warmGray, textAlign: 'center', lineHeight: 22 },
  emptyButton: {
    backgroundColor: Colors.terracotta,
    paddingHorizontal: 28,
    paddingVertical: 13,
    borderRadius: 14,
    marginTop: 8,
  },
  emptyButtonText: { color: Colors.white, fontSize: 15, fontWeight: '700' },
});
