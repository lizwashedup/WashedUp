/**
 * The communities see-all screen (the rail header's "see all", reference
 * placement). A vertical run of the same reference community cards; a
 * stack screen with its own back control, never a dead end. Functionally
 * minimal per decision 15a.
 */

import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes, LineHeights } from '../../constants/Typography';
import { CommunityCard } from '../../components/scene/CommunityCard';
import { getDiscoverableCommunities } from '../../lib/sceneDiscovery';
import { getLeaderCards } from '../../lib/communityLeader';

const SCREEN_PADDING = 20;

export default function CommunitiesScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();

  const { data: communities = [] } = useQuery({
    queryKey: ['scene-communities'],
    queryFn: getDiscoverableCommunities,
  });
  const communityIdsKey = communities.map((c) => c.id).sort().join(',');
  const { data: leaderCards = new Map() } = useQuery({
    queryKey: ['leader-cards', communityIdsKey],
    queryFn: () => getLeaderCards(communities.map((c) => c.id)),
    enabled: communities.length > 0,
  });

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
          <ArrowLeft size={22} color={Colors.asphalt} strokeWidth={2.5} />
        </TouchableOpacity>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>communities</Text>
        {communities.map((c) => (
          <CommunityCard
            key={c.id}
            community={c}
            leaderCard={leaderCards.get(c.id) ?? null}
            width={width - SCREEN_PADDING * 2}
            onPress={() => router.push(`/community/${c.id}` as never)}
          />
        ))}
        {communities.length === 0 && (
          /* LIZ COPY */
          <Text style={styles.empty}>communities are coming. check back in a beat.</Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.parchment },
  header: { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 8 },
  content: { padding: SCREEN_PADDING, gap: 14 },
  title: {
    fontFamily: Fonts.display,
    fontSize: FontSizes.displayLG,
    lineHeight: LineHeights.displayLG,
    color: Colors.darkWarm,
    marginBottom: 4,
  },
  empty: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.secondary },
});
