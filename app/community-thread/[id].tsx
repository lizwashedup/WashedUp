/**
 * The community's conversation (revised doc 09: no hub screen). Opens like
 * any chat: broadcasts sit inline in the thread, highlighted, from the
 * community, and members react and reply right under them. Members do not
 * post at the top level here (that is the announcement layer); rooms are
 * where members talk, discoverable from the community page. Mute-not-leave
 * in the header, unreads clear on open.
 */

import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, Stack } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Bell, BellOff, CalendarDays } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes, LineHeights } from '../../constants/Typography';
import { BrandedAlert, type BrandedAlertButton } from '../../components/BrandedAlert';
import { BroadcastCard } from '../../components/communities/BroadcastCard';
import { friendlyError } from '../../lib/friendlyError';
import { hapticLight } from '../../lib/haptics';
import {
  getCommunityBroadcasts,
  getCommunityChatPayload,
  getMyBroadcastMute,
  getPinnedCommunityEvent,
  markBroadcastsRead,
  setBroadcastMute,
  type CommunityBroadcast,
} from '../../lib/communityChat';
import { getJoinGate, getMyIntroAnswer } from '../../lib/communityJoin';

export default function CommunityThreadScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const listRef = useRef<FlatList<CommunityBroadcast>>(null);
  const [alertInfo, setAlertInfo] = React.useState<{ title: string; message?: string; buttons?: BrandedAlertButton[] } | null>(null);

  const { data: payload } = useQuery({
    queryKey: ['community-chat-cards'],
    queryFn: getCommunityChatPayload,
  });
  const card = payload?.cards.find((c) => c.community_id === id) ?? null;

  const { data: broadcasts = [], isLoading } = useQuery({
    queryKey: ['community-broadcasts', id],
    queryFn: () => getCommunityBroadcasts(id!),
    enabled: !!id,
  });
  // chat order: oldest at the top, newest at the bottom
  const thread = [...broadcasts].reverse();

  const { data: muted = false } = useQuery({
    queryKey: ['community-mute', id],
    queryFn: () => getMyBroadcastMute(id!),
    enabled: !!id,
  });

  // chat model 7-07: the soonest upcoming Live event sits pinned at the top
  const { data: pinnedEvent = null } = useQuery({
    queryKey: ['community-pinned-event', id],
    queryFn: () => getPinnedCommunityEvent(id!),
    enabled: !!id,
  });

  // a joined thread never looks dead: before the first broadcast, the join
  // welcome and your own posted introduction fill the room (correction 4)
  const emptyThread = !isLoading && thread.length === 0;
  const { data: gate } = useQuery({
    queryKey: ['community-gate', id],
    queryFn: () => getJoinGate(id!),
    enabled: !!id && emptyThread,
  });
  const { data: myIntro = null } = useQuery({
    queryKey: ['my-intro', id],
    queryFn: () => getMyIntroAnswer(id!),
    enabled: !!id && emptyThread,
  });

  useEffect(() => {
    if (!id) return;
    markBroadcastsRead(id)
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ['community-chat-cards'] });
        queryClient.invalidateQueries({ queryKey: ['community-chat-rows'] });
      })
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

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
          <ArrowLeft size={22} color={Colors.asphalt} strokeWidth={2.5} />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.headerTitleTap}
          onPress={() => router.push(`/community/${id}` as never)}
          hitSlop={6}
        >
          <Text style={styles.headerTitle} numberOfLines={1}>{card?.name ?? 'community'}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={handleMute} hitSlop={12}>
          {muted ? (
            <BellOff size={20} color={Colors.tertiary} strokeWidth={2.5} />
          ) : (
            <Bell size={20} color={Colors.terracotta} strokeWidth={2.5} />
          )}
        </TouchableOpacity>
      </View>
      {muted && (
        <Text style={styles.mutedLine}>muted. you still see everything here, it just stays quiet.</Text>
      )}
      {!!pinnedEvent && (
        <TouchableOpacity
          style={styles.pinnedCard}
          onPress={() => router.push(`/event/${pinnedEvent.id}` as never)}
          activeOpacity={0.85}
        >
          <CalendarDays size={18} color={Colors.terracotta} strokeWidth={2.5} />
          <View style={styles.pinnedBody}>
            {/* LIZ COPY */}
            <Text style={styles.pinnedLabel}>up next</Text>
            <Text style={styles.pinnedTitle} numberOfLines={1}>{pinnedEvent.title}</Text>
            <Text style={styles.pinnedMeta} numberOfLines={1}>
              {[
                pinnedEvent.event_date
                  ? new Date(`${pinnedEvent.event_date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
                  : null,
                pinnedEvent.venue || null,
              ].filter(Boolean).join(' at ')}
            </Text>
          </View>
        </TouchableOpacity>
      )}

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.terracotta} />
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={thread}
          keyExtractor={(b) => b.id}
          renderItem={({ item }) => (
            <BroadcastCard broadcast={item} communityName={card?.name ?? ''} onError={showError} />
          )}
          contentContainerStyle={styles.listContent}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          ListEmptyComponent={
            <View>
              {!!gate?.welcomeMessage && (
                <View style={styles.welcomeCard}>
                  <Text style={styles.welcomeFrom}>{card?.name ?? gate.name}</Text>
                  <Text style={styles.welcomeBody}>{gate.welcomeMessage}</Text>
                </View>
              )}
              {!!myIntro && (
                <View style={styles.introCard}>
                  {/* LIZ COPY */}
                  <Text style={styles.introLabel}>your introduction is posted in introductions</Text>
                  <Text style={styles.introBody}>{myIntro}</Text>
                </View>
              )}
              {!gate?.welcomeMessage && !myIntro && (
                <Text style={styles.emptyLine}>it starts here.</Text>
              )}
            </View>
          }
          ListFooterComponent={
            thread.length > 0 ? (
              <Text style={styles.footerNote}>react and reply right under each note.</Text>
            ) : null
          }
        />
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
  headerTitleTap: { flex: 1 },
  headerTitle: {
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
  pinnedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.cardBg,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginHorizontal: 16,
    marginBottom: 6,
  },
  pinnedBody: { flex: 1 },
  pinnedLabel: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.caption,
    color: Colors.terracotta,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  pinnedTitle: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.darkWarm, marginTop: 1 },
  pinnedMeta: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.secondary, marginTop: 1 },
  listContent: { padding: 16, paddingBottom: 40, flexGrow: 1 },
  emptyLine: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.secondary,
    lineHeight: LineHeights.bodyMD,
    textAlign: 'center',
    marginTop: 24,
  },
  welcomeCard: {
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    borderLeftWidth: 3,
    borderLeftColor: Colors.gold,
    padding: 14,
    marginBottom: 10,
  },
  welcomeFrom: { fontFamily: Fonts.sansBold, fontSize: FontSizes.caption, color: Colors.terracotta, marginBottom: 4 },
  welcomeBody: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.darkWarm, lineHeight: LineHeights.bodyMD },
  introCard: {
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 14,
  },
  introLabel: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.caption, color: Colors.tertiary, marginBottom: 4 },
  introBody: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.darkWarm, lineHeight: LineHeights.bodyMD },
  footerNote: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.caption,
    color: Colors.tertiary,
    textAlign: 'center',
    marginTop: 8,
  },
});
