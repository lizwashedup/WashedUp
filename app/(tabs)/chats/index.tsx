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
import ProfileButton from '../../../components/ProfileButton';
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

        <Text style={styles.memberCount}>{formatEventDate(chat.start_time)}</Text>
      </View>
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
        <ProfileButton />
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
          data={activeChats}
          keyExtractor={item => item.eventId}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={Colors.terracotta} />
          }
          contentContainerStyle={styles.listContent}
          ItemSeparatorComponent={ChatSeparator}
          ListHeaderComponent={activeChats.length > 0 ? <Text style={styles.sectionLabel}>Active</Text> : null}
          renderItem={renderChat}
          ListFooterComponent={pastChats.length > 0 ? (
            <View>
              <TouchableOpacity
                style={styles.pastHeader}
                onPress={() => setPastExpanded(prev => !prev)}
                activeOpacity={0.7}
              >
                <Text style={styles.sectionLabel}>Past Plans</Text>
                <View style={styles.pastChevron}>
                  {pastExpanded
                    ? <ChevronDown size={16} color={Colors.warmGray} />
                    : <ChevronRight size={16} color={Colors.warmGray} />}
                  <Text style={styles.pastCount}>{pastChats.length}</Text>
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
    fontSize: FontSizes.displayLG,
    color: Colors.asphalt,
  },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { paddingBottom: 32 },

  sectionLabel: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodySM,
    color: Colors.warmGray,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 8,
  },
  pastHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingRight: 20,
    marginTop: 8,
  },
  pastChevron: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  pastCount: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.warmGray,
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
  planTitle: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.asphalt, flex: 1, marginRight: 8 },
  textPast: { color: Colors.warmGray },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  timestamp: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.warmGray },
  badge: {
    backgroundColor: Colors.terracotta,
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  badgeText: { color: Colors.white, fontFamily: Fonts.sansBold, fontSize: FontSizes.caption },
  rowBottom: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  preview: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.warmGray, flex: 1 },
  readOnlyPill: {
    backgroundColor: Colors.inputBg,
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  readOnlyText: { fontFamily: Fonts.sans, fontSize: FontSizes.caption, color: Colors.warmGray, fontStyle: 'italic' },
  memberCount: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.terracotta },
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
  emptyTitle: { fontFamily: Fonts.sansBold, fontSize: FontSizes.displayMD, color: Colors.asphalt },
  emptySubtitle: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.warmGray, textAlign: 'center', lineHeight: 22 },
  emptyButton: {
    backgroundColor: Colors.terracotta,
    paddingHorizontal: 28,
    paddingVertical: 13,
    borderRadius: 14,
    marginTop: 8,
  },
  emptyButtonText: { color: Colors.white, fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD },
});
