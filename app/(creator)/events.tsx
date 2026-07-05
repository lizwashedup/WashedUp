/**
 * Creator mode: events. Read-only this slice: lists live events attributed
 * to the community or the creator. Creation and editing need the operator
 * RPCs plus an owner-read RLS policy on explore_events, which ride the
 * discovery-revival migration (phase 5); the placeholder says so honestly.
 */

import React from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes, LineHeights } from '../../constants/Typography';
import { getCreatorAccess, getCreatorEvents } from '../../lib/creatorMode';
import { supabase } from '../../lib/supabase';

export default function CreatorEventsScreen() {
  const { data: access } = useQuery({ queryKey: ['creator-access'], queryFn: getCreatorAccess });

  const { data: events = [], refetch, isRefetching } = useQuery({
    queryKey: ['creator-events-tab', access?.ledCommunities.map((c) => c.id).join(',')],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      return getCreatorEvents((access?.ledCommunities ?? []).map((c) => c.id), user.id);
    },
    enabled: access != null,
  });

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={Colors.terracotta} />}
      >
        <Text style={styles.title}>events</Text>

        {events.map((e) => (
          <View key={e.id} style={styles.card}>
            <Text style={styles.cardTitle}>{e.title}</Text>
            <Text style={styles.cardMeta}>
              {[e.public_name, e.event_date, e.venue].filter(Boolean).join(' · ')}
            </Text>
          </View>
        ))}

        {events.length === 0 && (
          <Text style={styles.empty}>nothing on the calendar yet.</Text>
        )}

        <View style={styles.placeholderCard}>
          <Text style={styles.placeholderText}>
            posting and editing events from here lands with the discovery
            revival. until then the washedup team posts them for you, fast.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.parchment },
  content: { padding: 20, gap: 10 },
  title: {
    fontFamily: Fonts.display,
    fontSize: FontSizes.displayLG,
    lineHeight: LineHeights.displayLG,
    color: Colors.darkWarm,
    marginBottom: 8,
  },
  card: {
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 16,
  },
  cardTitle: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.darkWarm, marginBottom: 3 },
  cardMeta: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.secondary },
  empty: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.secondary },
  placeholderCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: Colors.borderWarm,
    padding: 16,
    marginTop: 8,
  },
  placeholderText: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.secondary, lineHeight: LineHeights.bodySM },
});
