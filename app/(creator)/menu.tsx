/**
 * Creator mode: menu. Numbers plus the symmetric exit (doc 08: switch back
 * lives on the last tab, the way Airbnb does it).
 */

import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { ChevronRight } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { isAdmin } from '../../constants/Admin';
import { Fonts, FontSizes, LineHeights } from '../../constants/Typography';
import { getCreatorAccess, getCommunityMembers, getBroadcasts } from '../../lib/creatorMode';
import { getLeaderCards } from '../../lib/communityLeader';
import { getMyOrganizerProfile } from '../../lib/organizerProfile';
import { useLedCommunity } from '../../lib/selectedCommunity';
import { setViewAsEventHost, useViewAsEventHost } from '../../lib/viewAs';
import { supabase } from '../../lib/supabase';
import { CommunitySwitcher } from '../../components/creator/CommunitySwitcher';

export default function CreatorMenuScreen() {
  const { data: access } = useQuery({ queryKey: ['creator-access'], queryFn: getCreatorAccess });
  const community = useLedCommunity(access);

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

  const { data: organizerProfile = null } = useQuery({
    queryKey: ['organizer-profile'],
    queryFn: getMyOrganizerProfile,
  });
  // slice 0: the identity card wears the leader's own face as the chip
  // (live-resolved via the 41 read; ingredient, never the whole card)
  const { data: leaderCard = null } = useQuery({
    queryKey: ['leader-card', community?.id],
    queryFn: async () => (await getLeaderCards([community!.id])).get(community!.id) ?? null,
    enabled: !!community,
    staleTime: 60_000,
  });

  // admin view-as (doc 00 7-13): the toggle is invisible to non-admins and
  // hides while active (the shell pill carries the exit)
  const queryClient = useQueryClient();
  const viewingAsEventHost = useViewAsEventHost();
  const { data: myUserId = null } = useQuery({
    queryKey: ['my-user-id'],
    queryFn: async () => (await supabase.auth.getUser()).data.user?.id ?? null,
    staleTime: Infinity,
  });

  const activeCount = members.filter((m) => m.status === 'active').length;
  const pendingCount = members.filter((m) => m.status === 'pending').length;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* LIZ COPY */}
        <Text style={styles.kicker}>creator mode</Text>
        <Text style={styles.title}>menu</Text>

        {/* slice 0 (doc 43 track B): the identity card — who you are here.
            community mark + the leader's face chip for a community;
            organizer logo (monogram fallback) for an event host. The face
            is an ingredient, never the whole card; event hosts get the
            organizer profile editor, never a public /o page (guardrail). */}
        <View style={styles.identityCard}>
          <View style={styles.identityMarkWrap}>
            {community ? (
              <>
                <View style={styles.identityMark}>
                  <Text style={styles.identityMarkLetter}>{community.name.slice(0, 1).toLowerCase()}</Text>
                </View>
                {!!leaderCard?.avatar_url && (
                  <Image source={{ uri: leaderCard.avatar_url }} style={styles.identityFaceChip} contentFit="cover" />
                )}
              </>
            ) : organizerProfile?.logo_url ? (
              <Image source={{ uri: organizerProfile.logo_url }} style={styles.identityMark} contentFit="cover" />
            ) : (
              <View style={styles.identityMark}>
                <Text style={styles.identityMarkLetter}>
                  {(organizerProfile?.display_name ?? 'w').slice(0, 1).toLowerCase()}
                </Text>
              </View>
            )}
          </View>
          <View style={styles.identityBody}>
            <Text style={styles.identityName} numberOfLines={1}>
              {community
                ? community.name.toLowerCase()
                : organizerProfile
                  ? organizerProfile.display_name.toLowerCase()
                  : 'your organizer profile'}
            </Text>
            <TouchableOpacity
              onPress={() =>
                community
                  ? router.push(`/community/${community.id}` as never)
                  : router.push('/creator/organizer-profile')
              }
              hitSlop={8}
            >
              {/* LIZ COPY */}
              <Text style={styles.identityLink}>
                {community
                  ? 'view your public page'
                  : organizerProfile
                    ? 'edit your organizer profile'
                    : 'set it up. takes a minute.'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
        <CommunitySwitcher access={access} />

        {/* switch back rides directly beneath the identity card (slice 0) */}
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

        {community && (
          <>
            {/* preview (doc 37 §2): the page as others see it, client-forced */}
            {/* LIZ COPY */}
            <Text style={styles.sectionLabel}>your page</Text>
            <View style={styles.previewCard}>
              <TouchableOpacity
                style={styles.previewRow}
                onPress={() => router.push(`/community/${community.id}?preview=visitor` as never)}
                activeOpacity={0.7}
              >
                {/* LIZ COPY */}
                <Text style={styles.previewText}>see it as a visitor</Text>
                <ChevronRight size={16} color={Colors.warmGray} strokeWidth={2} />
              </TouchableOpacity>
              <View style={styles.previewDivider} />
              <TouchableOpacity
                style={styles.previewRow}
                onPress={() => router.push(`/community/${community.id}?preview=member` as never)}
                activeOpacity={0.7}
              >
                {/* LIZ COPY */}
                <Text style={styles.previewText}>see it as a member</Text>
                <ChevronRight size={16} color={Colors.warmGray} strokeWidth={2} />
              </TouchableOpacity>
            </View>

            <Text style={styles.sectionLabel}>numbers</Text>
            <View style={styles.statsCard}>
              <Stat label="members" value={activeCount} />
              <Stat label="waiting" value={pendingCount} />
              <Stat label="broadcasts" value={broadcasts.length} />
            </View>

            {/* leaders also put on standalone events, so the organizer
                identity (proposal 36) keeps a quiet row; for event hosts
                the identity card above IS this entry */}
            {/* LIZ COPY */}
            <Text style={styles.sectionLabel}>your organizer profile</Text>
            <TouchableOpacity
              style={styles.organizerCard}
              onPress={() => router.push('/creator/organizer-profile')}
              activeOpacity={0.8}
            >
              {organizerProfile?.logo_url ? (
                <Image source={{ uri: organizerProfile.logo_url }} style={styles.organizerLogo} contentFit="cover" />
              ) : null}
              <View style={styles.organizerBody}>
                <Text style={styles.organizerName}>
                  {organizerProfile ? organizerProfile.display_name : 'set up your organizer profile'}
                </Text>
                {/* LIZ COPY */}
                <Text style={styles.organizerMeta}>
                  {organizerProfile ? 'the name your standalone events wear' : 'the name your standalone events wear. takes a minute.'}
                </Text>
              </View>
              <ChevronRight size={18} color={Colors.warmGray} strokeWidth={2} />
            </TouchableOpacity>
          </>
        )}

        {isAdmin(myUserId) && !viewingAsEventHost && (
          <TouchableOpacity
            style={styles.adminViewAs}
            onPress={() => {
              setViewAsEventHost(true);
              queryClient.invalidateQueries({ queryKey: ['creator-access'] });
              // land exactly where a real event host lands
              router.replace('/(creator)/events');
            }}
            hitSlop={8}
          >
            {/* LIZ COPY (admin-only) */}
            <Text style={styles.adminViewAsText}>view as an event host</Text>
          </TouchableOpacity>
        )}
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
  kicker: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.caption,
    color: Colors.terracotta,
    letterSpacing: 1.5,
  },
  identityCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 16,
    marginBottom: 12,
  },
  identityMarkWrap: { width: 56, height: 56 },
  identityMark: {
    width: 56,
    height: 56,
    borderRadius: 14,
    backgroundColor: Colors.accentSubtle,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  identityMarkLetter: { fontFamily: Fonts.display, fontSize: FontSizes.displayMD, color: Colors.terracotta },
  identityFaceChip: {
    position: 'absolute',
    right: -6,
    bottom: -6,
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1.5,
    borderColor: Colors.white,
  },
  identityBody: { flex: 1 },
  identityName: {
    fontFamily: Fonts.display,
    fontSize: FontSizes.displaySM,
    color: Colors.darkWarm,
    marginBottom: 3,
  },
  identityLink: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.terracotta },
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
    marginBottom: 6,
  },
  organizerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 16,
    marginBottom: 28,
  },
  organizerLogo: { width: 40, height: 40, borderRadius: 10 },
  organizerBody: { flex: 1 },
  organizerName: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.darkWarm, marginBottom: 3 },
  organizerMeta: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.secondary },
  previewCard: {
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 28,
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  previewDivider: { height: 1, backgroundColor: Colors.border, marginHorizontal: 16 },
  previewText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Colors.darkWarm },
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
    marginBottom: 28,
  },
  adminViewAs: { alignItems: 'center', marginTop: 28 },
  adminViewAsText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.tertiary },
});
