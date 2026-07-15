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
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes, LineHeights } from '../../constants/Typography';
import ProfileButton from '../ProfileButton';
import { hapticLight } from '../../lib/haptics';
import { EVENT_CATEGORIES } from '../../lib/creatorEvents';
import { EventPoster } from './EventPoster';
import {
  getDiscoverableCommunities,
  getSceneEvents,
  type SceneEvent,
} from '../../lib/sceneDiscovery';
import { getLeaderCards } from '../../lib/communityLeader';
import { HOUSE_MARK_LABEL, isHouseCommunity } from '../../lib/houseCommunity';

const RAIL_CARD_WIDTH = 220;
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

  // slice 1 (doc 37): the communities rail lives BETWEEN feed sections —
  // one featured card, a couple of compact cards, the rail, then the rest
  const communitiesRail = communities.length > 0 && (
    <>
      <Text style={[styles.sectionLabel, styles.sectionGap]}>communities</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail}>
        {communities.map((c) => (
          <TouchableOpacity
            key={c.id}
            style={styles.railCard}
            onPress={() => router.push(`/community/${c.id}` as never)}
            activeOpacity={0.85}
          >
            {c.cover_image ? (
              <Image source={{ uri: c.cover_image }} style={styles.railCover} contentFit="cover" />
            ) : (
              <View style={[styles.railCover, { backgroundColor: c.accent_color ?? Colors.accentSubtle }]} />
            )}
            <View style={styles.railBody}>
              {isHouseCommunity(c.handle) && (
                <Text style={styles.houseMark}>{HOUSE_MARK_LABEL}</Text>
              )}
              <View style={styles.railNameRow}>
                {!!leaderCards.get(c.id)?.avatar_url && (
                  <Image
                    source={{ uri: leaderCards.get(c.id)!.avatar_url! }}
                    style={styles.railFace}
                    contentFit="cover"
                  />
                )}
                <Text style={styles.railName} numberOfLines={1}>{c.name}</Text>
              </View>
              <Text style={styles.railMeta} numberOfLines={1}>
                {c.member_count} in
                {c.next_event_title ? `  next: ${c.next_event_title}` : ''}
              </Text>
            </View>
          </TouchableOpacity>
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
        <Text style={styles.sectionLabel}>happening in LA</Text>
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

        {filtered.length === 0 ? (
          <>
            <Text style={styles.emptyLine}>
              the calendar is filling up. check back in a beat.
            </Text>
            {communitiesRail}
          </>
        ) : (
          <>
            {/* size follows importance, never source (Liz's slice-1 review,
                now a standing rule): the first few events render full-size
                whatever put them on; compact is the deeper-feed rhythm, not
                a tier community events live in. Attribution, not size, marks
                the source (byline + corner chip). */}
            {filtered.slice(0, FULL_SIZE_COUNT).map(renderFeatured)}
            {communitiesRail}
            {filtered.length > FULL_SIZE_COUNT && <View style={styles.sectionGap} />}
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
  rail: { gap: 12 },
  railCard: {
    width: RAIL_CARD_WIDTH,
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  railCover: { width: '100%', height: RAIL_COVER_HEIGHT },
  railBody: { padding: 12 },
  houseMark: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.caption,
    color: Colors.terracotta,
    letterSpacing: 1,
    marginBottom: 2,
  },
  railNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  railFace: { width: 28, height: 28, borderRadius: 14 },
  railName: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.darkWarm, flexShrink: 1 },
  railMeta: { fontFamily: Fonts.sans, fontSize: FontSizes.caption, color: Colors.secondary, marginTop: 2 },
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
