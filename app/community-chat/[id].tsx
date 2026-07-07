/**
 * The community container (doc 09 section 3): one community = one card in
 * Chats, and this is its inside. Broadcast pinned at top (react, reply in
 * thread), topics below (joined with unread, joinable under that), mute in
 * the header. WhatsApp Communities logic, WashedUp voice. NEW plumbing
 * beside plan and circle chat; nothing existing is touched. Functionally
 * minimal per decision 15a.
 */

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, Stack } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Bell, BellOff, ChevronRight } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes, LineHeights } from '../../constants/Typography';
import { BrandedAlert, type BrandedAlertButton } from '../../components/BrandedAlert';
import { BroadcastCard } from '../../components/communities/BroadcastCard';
import { friendlyError } from '../../lib/friendlyError';
import { hapticLight, hapticSuccess } from '../../lib/haptics';
import {
  getCommunityBroadcasts,
  getCommunityChatCards,
  getMyBroadcastMute,
  joinTopic,
  markBroadcastsRead,
  setBroadcastMute,
} from '../../lib/communityChat';

export default function CommunityChatScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [joiningTopicId, setJoiningTopicId] = useState<string | null>(null);
  const [alertInfo, setAlertInfo] = useState<{ title: string; message?: string; buttons?: BrandedAlertButton[] } | null>(null);

  const { data: cards = [] } = useQuery({
    queryKey: ['community-chat-cards'],
    queryFn: getCommunityChatCards,
  });
  const card = cards.find((c) => c.community_id === id) ?? null;

  const { data: broadcasts = [], isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['community-broadcasts', id],
    queryFn: () => getCommunityBroadcasts(id!),
    enabled: !!id,
  });

  const { data: muted = false } = useQuery({
    queryKey: ['community-mute', id],
    queryFn: () => getMyBroadcastMute(id!),
    enabled: !!id,
  });

  // opening the container reads the broadcast layer (the card badge clears)
  useEffect(() => {
    if (!id) return;
    markBroadcastsRead(id)
      .then(() => queryClient.invalidateQueries({ queryKey: ['community-chat-cards'] }))
      .catch(() => {});
  }, [id, queryClient]);

  const showError = (title: string, message: string) => setAlertInfo({ title, message });

  const handleMute = async () => {
    if (!id) return;
    try {
      await setBroadcastMute(id, !muted);
      hapticLight();
      queryClient.invalidateQueries({ queryKey: ['community-mute', id] });
    } catch (e) {
      showError('That did not save', friendlyError(e, 'Try again in a moment.'));
    }
  };

  const handleJoinTopic = async (topicId: string) => {
    setJoiningTopicId(topicId);
    try {
      await joinTopic(topicId);
      hapticSuccess();
      await queryClient.invalidateQueries({ queryKey: ['community-chat-cards'] });
      router.push(`/community-topic/${topicId}` as never);
    } catch (e) {
      showError('That did not work', friendlyError(e, 'Try again in a moment.'));
    } finally {
      setJoiningTopicId(null);
    }
  };

  const joinedTopics = (card?.topics ?? []).filter((t) => t.joined);
  const joinableTopics = (card?.topics ?? []).filter((t) => !t.joined);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
          <ArrowLeft size={22} color={Colors.asphalt} strokeWidth={2.5} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{card?.name ?? 'community'}</Text>
        <TouchableOpacity onPress={handleMute} hitSlop={12}>
          {muted ? (
            <BellOff size={20} color={Colors.tertiary} strokeWidth={2.5} />
          ) : (
            <Bell size={20} color={Colors.terracotta} strokeWidth={2.5} />
          )}
        </TouchableOpacity>
      </View>
      {muted && <Text style={styles.mutedLine}>muted. you still see everything here, it just stays quiet.</Text>}

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.terracotta} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={Colors.terracotta} />}
        >
          <Text style={styles.sectionLabel}>from the leader</Text>
          {broadcasts.length === 0 ? (
            <Text style={styles.emptyLine}>nothing announced yet. it will land here first.</Text>
          ) : (
            broadcasts.map((b) => (
              <BroadcastCard key={b.id} broadcast={b} onError={showError} />
            ))
          )}

          {joinedTopics.length > 0 && (
            <>
              <Text style={[styles.sectionLabel, styles.sectionGap]}>your rooms</Text>
              {joinedTopics.map((t) => (
                <TouchableOpacity
                  key={t.id}
                  style={styles.topicRow}
                  onPress={() => router.push(`/community-topic/${t.id}` as never)}
                >
                  <View style={styles.topicText}>
                    <Text style={styles.topicName}>{t.name}</Text>
                    {t.last_message_at ? (
                      <Text style={styles.topicMeta}>
                        last message {new Date(t.last_message_at).toLocaleDateString()}
                      </Text>
                    ) : (
                      <Text style={styles.topicMeta}>quiet so far</Text>
                    )}
                  </View>
                  {t.unread > 0 && (
                    <View style={styles.unreadDot}>
                      <Text style={styles.unreadText}>{t.unread > 99 ? '99' : t.unread}</Text>
                    </View>
                  )}
                  <ChevronRight size={18} color={Colors.tertiary} strokeWidth={2.5} />
                </TouchableOpacity>
              ))}
            </>
          )}

          {joinableTopics.length > 0 && (
            <>
              <Text style={[styles.sectionLabel, styles.sectionGap]}>rooms to join</Text>
              {joinableTopics.map((t) => (
                <View key={t.id} style={styles.topicRow}>
                  <View style={styles.topicText}>
                    <Text style={styles.topicName}>{t.name}</Text>
                  </View>
                  {joiningTopicId === t.id ? (
                    <ActivityIndicator size="small" color={Colors.terracotta} />
                  ) : (
                    <TouchableOpacity style={styles.joinPill} onPress={() => handleJoinTopic(t.id)}>
                      <Text style={styles.joinPillText}>join in</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ))}
            </>
          )}
        </ScrollView>
      )}

      <BrandedAlert
        visible={!!alertInfo}
        title={alertInfo?.title ?? ''}
        message={alertInfo?.message}
        buttons={alertInfo?.buttons}
        onClose={() => setAlertInfo(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.parchment },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  headerTitle: {
    flex: 1,
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodyLG,
    color: Colors.darkWarm,
    textAlign: 'center',
  },
  mutedLine: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.caption,
    color: Colors.tertiary,
    textAlign: 'center',
    marginBottom: 4,
  },
  content: { padding: 20, paddingBottom: 60 },
  sectionLabel: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.caption,
    color: Colors.terracotta,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  sectionGap: { marginTop: 24 },
  emptyLine: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.secondary, lineHeight: LineHeights.bodySM },
  topicRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 14,
    marginBottom: 10,
  },
  topicText: { flex: 1 },
  topicName: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.darkWarm },
  topicMeta: { fontFamily: Fonts.sans, fontSize: FontSizes.caption, color: Colors.tertiary, marginTop: 2 },
  unreadDot: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: Colors.terracotta,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  unreadText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.caption, color: Colors.white },
  joinPill: {
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: Colors.terracotta,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  joinPillText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodySM, color: Colors.terracotta },
});
