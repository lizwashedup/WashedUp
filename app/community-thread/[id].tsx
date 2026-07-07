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
import { ArrowLeft, Bell, BellOff } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes, LineHeights } from '../../constants/Typography';
import { BrandedAlert, type BrandedAlertButton } from '../../components/BrandedAlert';
import { BroadcastCard } from '../../components/communities/BroadcastCard';
import { friendlyError } from '../../lib/friendlyError';
import { hapticLight } from '../../lib/haptics';
import {
  getCommunityBroadcasts,
  getCommunityChatCards,
  getMyBroadcastMute,
  markBroadcastsRead,
  setBroadcastMute,
  type CommunityBroadcast,
} from '../../lib/communityChat';

export default function CommunityThreadScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const listRef = useRef<FlatList<CommunityBroadcast>>(null);
  const [alertInfo, setAlertInfo] = React.useState<{ title: string; message?: string; buttons?: BrandedAlertButton[] } | null>(null);

  const { data: cards = [] } = useQuery({
    queryKey: ['community-chat-cards'],
    queryFn: getCommunityChatCards,
  });
  const card = cards.find((c) => c.community_id === id) ?? null;

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
            <Text style={styles.emptyLine}>it starts here.</Text>
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
  listContent: { padding: 16, paddingBottom: 40, flexGrow: 1 },
  emptyLine: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.secondary,
    lineHeight: LineHeights.bodyMD,
    textAlign: 'center',
    marginTop: 24,
  },
  footerNote: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.caption,
    color: Colors.tertiary,
    textAlign: 'center',
    marginTop: 8,
  },
});
