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
import {
  getDiscoverableCommunities,
  getSceneEvents,
  type SceneEvent,
} from '../../lib/sceneDiscovery';
import { HOUSE_MARK_LABEL, isHouseCommunity } from '../../lib/houseCommunity';

const POSTER_RATIO = 0.56;
const RAIL_CARD_WIDTH = 220;
const RAIL_COVER_HEIGHT = 110;

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

  const filtered = category ? events.filter((e) => e.category === category) : events;
  const usedCategories = EVENT_CATEGORIES.filter((c) => events.some((e) => e.category === c));

  const renderEvent = (e: SceneEvent) => (
    <TouchableOpacity
      key={e.id}
      style={styles.poster}
      onPress={() => router.push(`/event/${e.id}` as never)}
      activeOpacity={0.85}
    >
      {e.image_url ? (
        <Image source={{ uri: e.image_url }} style={[styles.posterImage, { height: (width - 40) * POSTER_RATIO }]} contentFit="cover" />
      ) : (
        <View style={[styles.posterImage, styles.posterFallback, { height: (width - 40) * POSTER_RATIO }]}>
          <Text style={styles.posterFallbackText}>{e.title.slice(0, 1).toLowerCase()}</Text>
        </View>
      )}
      <View style={styles.posterBody}>
        {!!e.category && <Text style={styles.posterCategory}>{e.category}</Text>}
        <Text style={styles.posterTitle} numberOfLines={2}>{e.title}</Text>
        <Text style={styles.posterMeta}>
          {[
            e.event_date ? new Date(e.event_date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : null,
            e.venue,
          ].filter(Boolean).join('  ')}
        </Text>
        {!!e.public_name && <Text style={styles.posterBy}>put on by {e.public_name}</Text>}
      </View>
    </TouchableOpacity>
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
        {communities.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>communities</Text>
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
                    <Text style={styles.railName} numberOfLines={1}>{c.name}</Text>
                    <Text style={styles.railMeta} numberOfLines={1}>
                      {c.member_count} in
                      {c.next_event_title ? `  next: ${c.next_event_title}` : ''}
                    </Text>
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </>
        )}

        <Text style={[styles.sectionLabel, communities.length > 0 && styles.sectionGap]}>
          happening in LA
        </Text>
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
          <Text style={styles.emptyLine}>
            the calendar is filling up. check back in a beat.
          </Text>
        ) : (
          filtered.map(renderEvent)
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
  railName: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.darkWarm },
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
  poster: {
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
    marginBottom: 16,
  },
  posterImage: { width: '100%' },
  posterFallback: { backgroundColor: Colors.accentSubtle, alignItems: 'center', justifyContent: 'center' },
  posterFallbackText: { fontFamily: Fonts.display, fontSize: FontSizes.displayLG, color: Colors.terracotta },
  posterBody: { padding: 14 },
  posterCategory: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.caption,
    color: Colors.terracotta,
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  posterTitle: {
    fontFamily: Fonts.display,
    fontSize: FontSizes.displayMD,
    lineHeight: LineHeights.displayMD,
    color: Colors.darkWarm,
  },
  posterMeta: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.secondary, marginTop: 6 },
  posterBy: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.caption, color: Colors.tertiary, marginTop: 4 },
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
