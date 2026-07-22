/**
 * Yours > Communities (decision 7: communities get a page on Yours). One
 * entry per community you belong to, rendered as its OWN card shape,
 * deliberately not the warm plan card: a cover-first banner with the
 * community's accent. Tapping opens the member-side community page, the
 * block tree the creator designed. Functionally minimal per decision 15a.
 */

import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl } from 'react-native';
import { Image } from 'expo-image';
import { useQuery } from '@tanstack/react-query';
import Colors from '../../../constants/Colors';
import { Fonts, FontSizes, LineHeights } from '../../../constants/Typography';
import { getMyCommunities } from '../../../lib/communityPage';
import { HOUSE_MARK_LABEL, isHouseCommunity } from '../../../lib/houseCommunity';

const COVER_HEIGHT = 120;

interface Props {
  onOpen: (communityId: string) => void;
  onBrowse: () => void;
}

export function MyCommunitiesList({ onOpen, onBrowse }: Props) {
  const { data: communities = [], refetch, isRefetching } = useQuery({
    queryKey: ['my-communities'],
    queryFn: getMyCommunities,
  });

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={Colors.terracotta} />}
    >
      {communities.map((c) => (
        <TouchableOpacity key={c.id} style={styles.card} onPress={() => onOpen(c.id)} activeOpacity={0.85}>
          {c.cover_image ? (
            <Image source={{ uri: c.cover_image }} style={styles.cover} contentFit="cover" />
          ) : (
            <View style={[styles.cover, { backgroundColor: c.accent_color ?? Colors.accentSubtle }]} />
          )}
          <View style={[styles.accentBar, c.accent_color ? { backgroundColor: c.accent_color } : null]} />
          <View style={styles.body}>
            {isHouseCommunity(c.handle) && (
              <Text style={styles.houseMark}>{HOUSE_MARK_LABEL}</Text>
            )}
            <Text style={styles.name} numberOfLines={1}>{c.name}</Text>
            <Text style={styles.meta}>
              {c.member_count !== null ? `${c.member_count} in` : ' '}
              {/* LIZ COPY (decision 16): community creator; co-runner placeholder */}
              {c.role === 'leader' ? ' · community creator' : c.role === 'co_leader' ? ' · helps run it' : ''}
            </Text>
          </View>
        </TouchableOpacity>
      ))}

      {communities.length === 0 && (
        <View style={styles.emptyWrap}>
          {/* LIZ COPY */}
          <Text style={styles.emptyText}>
            the communities you join live here, with their pages, their people,
            and their plans.
          </Text>
          <TouchableOpacity style={styles.emptyBtn} onPress={onBrowse}>
            <Text style={styles.emptyBtnText}>browse the scene</Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 60 },
  card: {
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
    marginBottom: 14,
  },
  cover: { width: '100%', height: COVER_HEIGHT },
  accentBar: { height: 3, backgroundColor: Colors.gold },
  body: { padding: 14 },
  // terracotta, not gold: gold text on light grounds is banned (documented
  // exceptions only); the card's gold accent bar carries the house warmth
  houseMark: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.caption,
    color: Colors.terracotta,
    letterSpacing: 1,
    marginBottom: 2,
  },
  name: {
    fontFamily: Fonts.display,
    fontSize: FontSizes.displayMD,
    lineHeight: LineHeights.displayMD,
    color: Colors.darkWarm,
  },
  meta: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.secondary, marginTop: 4 },
  emptyWrap: { alignItems: 'center', gap: 14, marginTop: 32, paddingHorizontal: 12 },
  emptyText: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.secondary,
    lineHeight: LineHeights.bodyMD,
    textAlign: 'center',
  },
  emptyBtn: {
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: Colors.terracotta,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  emptyBtnText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.terracotta },
});
