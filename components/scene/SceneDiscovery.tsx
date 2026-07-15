/**
 * Scene discovery (doc 10 phase 5): Event Discovery + Communities, the
 * public half of the app. Events read as LISTINGS, poster first, marquee
 * title in the display face, deliberately not the warm Plans card (locked
 * decision 12); the full design pass sharpens this later per 15a. The
 * communities rail renders only when a community exists (Liz: no empty
 * state). Behind COMMUNITIES_ENABLED via the ScenePage export.
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes, LineHeights } from '../../constants/Typography';
import ProfileButton from '../ProfileButton';
import { hapticLight } from '../../lib/haptics';
import { EVENT_CATEGORIES } from '../../lib/creatorEvents';
import { EventPoster } from './EventPoster';
import { CommunityCard } from './CommunityCard';
import {
  getDiscoverableCommunities,
  getSceneEvents,
  type SceneEvent,
} from '../../lib/sceneDiscovery';
import { getLeaderCards } from '../../lib/communityLeader';

const RAIL_CARD_WIDTH = 260;
const RAIL_COVER_HEIGHT = 110;
// size follows importance: this many lead events render full-size
const FULL_SIZE_COUNT = 3;

export function SceneDiscovery() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const [category, setCategory] = useState<string | null>(null);

  const { data: events = [], refetch, isRefetching } = useQuery({
    queryKey: ['scene-events'],
    queryFn: getSceneEvents,
  });
  const { data: communities = [], refetch: refetchCommunities } = useQuery({
    queryKey: ['scene-communities'],
    queryFn: getDiscoverableCommunities,
  });

  // the people-first pack (decision 15 made visible): community cards lead
  // with the leader's face, live-resolved from her profile. Pre-apply (or on
  // any error) the map is empty and cards simply show no face.
  const communityIdsKey = communities.map((c) => c.id).sort().join(',');
  const { data: leaderCards = new Map() } = useQuery({
    queryKey: ['leader-cards', communityIdsKey],
    queryFn: () => getLeaderCards(communities.map((c) => c.id)),
    enabled: communities.length > 0,
  });

  // pilot-era rows carry capitalized categories ('Community'); compare and
  // display on the lowercase side so the chips match every era
  const filtered = category
    ? events.filter((e) => e.category?.toLowerCase() === category)
    : events;
  const usedCategories = EVENT_CATEGORIES.filter((c) =>
    events.some((e) => e.category?.toLowerCase() === c),
  );

  const renderFeatured = (e: SceneEvent) => (
    <EventPoster key={e.id} event={e} width={width} onPress={() => router.push(`/event/${e.id}` as never)} />
  );
  const renderCompact = (e: SceneEvent) => (
    <EventPoster
      key={e.id}
      event={e}
      width={width}
      variant="compact"
      onPress={() => router.push(`/event/${e.id}` as never)}
    />
  );

  // Liz's second pass (doc 37 amended): the rail lives at the TOP of the
  // feed, directly under the filter row — reference placement — with the
  // reference card anatomy (cover, overlapping face chip, by-line, member
  // threshold, the creator's one-line message)
  const communitiesRail = communities.length > 0 && (
    <>
      <View style={styles.railHeader}>
        <Text style={styles.sectionLabel}>communities</Text>
        <TouchableOpacity onPress={() => router.push('/communities' as never)} hitSlop={8}>
          {/* LIZ COPY */}
          <Text style={styles.seeAll}>see all</Text>
        </TouchableOpacity>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail}>
        {communities.map((c) => (
          <CommunityCard
            key={c.id}
            community={c}
            leaderCard={leaderCards.get(c.id) ?? null}
            width={RAIL_CARD_WIDTH}
            onPress={() => router.push(`/community/${c.id}` as never)}
          />
        ))}
      </ScrollView>
    </>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>
          The <Text style={styles.headerTitleItalic}>Scene</Text>
        </Text>
        <ProfileButton />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={() => { refetch(); refetchCommunities(); }}
            tintColor={Colors.terracotta}
          />
        }
      >
        {/* the IA fix (doc 37): this row is the CATEGORY axis only —
            source (community vs standalone) lives on each card's byline */}
        {usedCategories.length > 1 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            {[null, ...usedCategories].map((c) => (
              <TouchableOpacity
                key={c ?? 'all'}
                style={[styles.chip, category === c && styles.chipOn]}
                onPress={() => { hapticLight(); setCategory(c); }}
              >
                <Text style={[styles.chipText, category === c && styles.chipTextOn]}>{c ?? 'all'}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        {communitiesRail}

        <Text style={[styles.sectionLabel, communities.length > 0 ? styles.sectionGap : undefined]}>happening in LA</Text>
        {filtered.length === 0 ? (
          <Text style={styles.emptyLine}>
            the calendar is filling up. check back in a beat.
          </Text>
        ) : (
          <>
            {/* size follows importance, never source (standing rule): the
                first few events render full-size whatever put them on;
                compact is the deeper-feed rhythm. Attribution, not size,
                marks the source (byline + corner chip). */}
            {filtered.slice(0, FULL_SIZE_COUNT).map(renderFeatured)}
            {filtered.slice(FULL_SIZE_COUNT).map(renderCompact)}
          </>
        )}

        {/* the supply funnel: every browser is a possible creator. quiet,
            visible, never shouting. LIZ COPY */}
        <View style={styles.creatorCard}>
          <Text style={styles.creatorText}>
            run a community or throw events? bring it to washedup.
          </Text>
          <TouchableOpacity
            style={styles.creatorBtn}
            onPress={() => router.push('/creator/apply' as never)}
          >
            <Text style={styles.creatorBtnText}>tell us about it</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
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
    paddingVertical: 10,
  },
  headerTitle: { fontFamily: Fonts.display, fontSize: FontSizes.displayLG, color: Colors.darkWarm },
  headerTitleItalic: { fontFamily: Fonts.displayItalic },
  content: { padding: 20, paddingBottom: 60 },
  sectionLabel: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.caption,
    color: Colors.terracotta,
    letterSpacing: 1.5,
    marginBottom: 10,
  },
  sectionGap: { marginTop: 24 },
  railHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  seeAll: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.terracotta, marginBottom: 10 },
  rail: { gap: 12 },
  chipRow: { gap: 8, marginBottom: 14 },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.cardBg,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  chipOn: { backgroundColor: Colors.terracotta, borderColor: Colors.terracotta },
  chipText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.darkWarm },
  chipTextOn: { color: Colors.white },
  emptyLine: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.secondary,
    lineHeight: LineHeights.bodyMD,
  },
  creatorCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: Colors.borderWarm,
    padding: 16,
    marginTop: 12,
    gap: 12,
    alignItems: 'center',
  },
  creatorText: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.secondary,
    lineHeight: LineHeights.bodyMD,
    textAlign: 'center',
  },
  creatorBtn: {
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: Colors.terracotta,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  creatorBtnText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.terracotta },
});
