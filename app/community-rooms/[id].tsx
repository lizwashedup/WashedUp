import React, { useCallback, useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { AfterglowColors as Colors } from '../../constants/Colors';
import { COMMUNITY_CHAT_GROUPING_ENABLED, CREATOR_PAGES_ENABLED } from '../../constants/FeatureFlags';
import { useAfterglowFonts } from '../../hooks/useAfterglowFonts';
import { ChatContextHeader } from '../../components/chat/ChatContextHeader';
import { CommunityRoomDirectory } from '../../components/chats/CommunityRoomDirectory';
export default function CommunityRoomsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>(), router = useRouter(), { fonts } = useAfterglowFonts();
  const [focused, setFocused] = useState(false);
  useFocusEffect(useCallback(() => { setFocused(true); return () => setFocused(false); }, []));
  return <SafeAreaView style={styles.page} edges={['top','bottom']}><Stack.Screen options={{ headerShown: false }} />
    <ChatContextHeader title="Community chats" contextLabel="Community chats" fonts={fonts}
      onBack={() => router.canGoBack() ? router.back() : router.replace('/(tabs)/chats')}
      onViewContext={() => router.push(`/community/${id}` as never)} />
    <ScrollView contentContainerStyle={styles.content}>
      {CREATOR_PAGES_ENABLED && COMMUNITY_CHAT_GROUPING_ENABLED && !!id && <CommunityRoomDirectory communityId={id} enabled={focused}
        onOpen={room => router.push((room.storage === 'broadcast' ? `/community-thread/${room.id}` : `/community-topic/${room.id}`) as never)} />}
    </ScrollView>
  </SafeAreaView>;
}
const styles = StyleSheet.create({ page: { flex: 1, backgroundColor: Colors.paper }, content: { paddingHorizontal: 20, paddingBottom: 24 } });
