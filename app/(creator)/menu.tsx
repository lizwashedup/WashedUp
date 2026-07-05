/**
 * Creator mode: menu. Numbers plus the symmetric exit (doc 08: switch back
 * lives on the last tab, the way Airbnb does it).
 */

import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes, LineHeights } from '../../constants/Typography';
import { getCreatorAccess, getCommunityMembers, getBroadcasts } from '../../lib/creatorMode';

export default function CreatorMenuScreen() {
  const { data: access } = useQuery({ queryKey: ['creator-access'], queryFn: getCreatorAccess });
  const community = access?.ledCommunities[0] ?? null;

  const { data: members = [] } = useQuery({
    queryKey: ['creator-members', community?.id],
    queryFn: () => getCommunityMembers(community!.id),
    enabled: !!community,
  });
  const { data: broadcasts = [] } = useQuery({
    queryKey: ['creator-broadcasts', community?.id],
    queryFn: () => getBroadcasts(community!.id),
    enabled: !!community,
  });

  const activeCount = members.filter((m) => m.status === 'active').length;
  const pendingCount = members.filter((m) => m.status === 'pending').length;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>menu</Text>

        {community && (
          <>
            <Text style={styles.sectionLabel}>numbers</Text>
            <View style={styles.statsCard}>
              <Stat label="members" value={activeCount} />
              <Stat label="waiting" value={pendingCount} />
              <Stat label="broadcasts" value={broadcasts.length} />
            </View>
          </>
        )}

        <TouchableOpacity
          style={styles.switchBtn}
          onPress={() => router.replace('/(tabs)/profile')}
          activeOpacity={0.85}
        >
          <Text style={styles.switchBtnText}>switch back to you</Text>
        </TouchableOpacity>
        <Text style={styles.switchHint}>
          your plans, chats, and people are exactly where you left them.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.parchment },
  content: { padding: 20 },
  title: {
    fontFamily: Fonts.display,
    fontSize: FontSizes.displayLG,
    lineHeight: LineHeights.displayLG,
    color: Colors.darkWarm,
    marginBottom: 12,
  },
  sectionLabel: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.caption,
    color: Colors.terracotta,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  statsCard: {
    flexDirection: 'row',
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 16,
    marginBottom: 28,
  },
  stat: { flex: 1, alignItems: 'center' },
  statValue: { fontFamily: Fonts.displayBold, fontSize: FontSizes.displayMD, color: Colors.darkWarm },
  statLabel: { fontFamily: Fonts.sans, fontSize: FontSizes.caption, color: Colors.secondary, marginTop: 2 },
  switchBtn: {
    borderWidth: 1.5,
    borderColor: Colors.terracotta,
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: 'center',
  },
  switchBtnText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.terracotta },
  switchHint: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.tertiary,
    textAlign: 'center',
    marginTop: 10,
  },
});
