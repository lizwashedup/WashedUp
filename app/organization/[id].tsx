/**
 * The public organization profile (Scene handoff §12/13/16/17,
 * WashedUp_The_Scene_User_Facing_Implementation_Handoff.pdf). Reached by
 * tapping an organization's identity wherever it fronts a standalone event
 * (app/event/[id].tsx's entityCardIdentity) - §16 found "no complete
 * equivalent" for this destination; this file is that missing surface.
 *
 * Minimum content per §12, nothing here is guessed: name, logo, city,
 * concise bio; Follow/Following + follower count; upcoming and past public
 * events; an optional external link; and explicit copy that following
 * gives updates only, never membership, roster, or chat access.
 *
 * `id` is the organizer's user_id (organizer_profiles.user_id /
 * organizer_follows.organizer_user_id) - there is no separate organizations
 * table (Q2, LIZ-OPEN-QUESTIONS.md RESOLVED: one Organization per account).
 *
 * Signed-out visitors can read the whole page (§15 edge states: "Signed
 * out: allow browsing"); only the Follow pill needs a session, and it just
 * stays hidden without one, the same choice app/event/[id].tsx already
 * makes for the same pill.
 */

import React from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useLocalSearchParams, router, Stack, Redirect } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ChevronRight, ExternalLink } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes, LineHeights } from '../../constants/Typography';
import { COMMUNITIES_ENABLED } from '../../constants/FeatureFlags';
import { hapticLight, hapticSuccess, hapticError } from '../../lib/haptics';
import { openUrl } from '../../lib/url';
import { formatEventDateLA } from '../../lib/laDate';
import { formatTicketPrice, normalizeTicketPrice } from '../../lib/ticketPrice';
import { MEMBER_COUNT_THRESHOLD } from '../../lib/socialProof';
import { getOrganizationPage, type OrganizationPageEvent } from '../../lib/organizerProfile';
import {
  getFollowState,
  getFollowerCount,
  recordFollow,
  removeFollow,
  type FollowTarget,
} from '../../lib/organizerFollows';
import { useAuthUserId } from '../../components/yours/state/useAuthUserId';

const AVATAR_SIZE = 88;
const ROW_THUMB_SIZE = 56;

function EventRow({ event }: { event: OrganizationPageEvent }) {
  const price = normalizeTicketPrice(event.ticket_price);
  const metaParts = [
    event.event_date ? formatEventDateLA(event.event_date, { month: 'short', day: 'numeric' }) : null,
    event.venue,
    price !== null ? formatTicketPrice(price) : null,
  ].filter(Boolean);

  return (
    <TouchableOpacity
      style={styles.eventRow}
      activeOpacity={0.85}
      onPress={() => {
        hapticLight();
        router.push(`/event/${event.id}`);
      }}
    >
      {event.image_url ? (
        <Image source={{ uri: event.image_url }} style={styles.eventThumb} contentFit="cover" />
      ) : (
        <View style={[styles.eventThumb, styles.eventThumbFallback]}>
          <Text style={styles.eventThumbInitial}>{event.title[0]?.toUpperCase() ?? '?'}</Text>
        </View>
      )}
      <View style={styles.eventRowBody}>
        <Text style={styles.eventRowTitle} numberOfLines={2}>{event.title}</Text>
        {metaParts.length > 0 && (
          <Text style={styles.eventRowMeta} numberOfLines={1}>{metaParts.join(' · ')}</Text>
        )}
      </View>
      <ChevronRight size={16} color={Colors.textLight} strokeWidth={2} />
    </TouchableOpacity>
  );
}

export default function OrganizationProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { data: userId = null } = useAuthUserId();

  const { data: page, isLoading } = useQuery({
    queryKey: ['organization-page', id],
    queryFn: () => getOrganizationPage(id!),
    enabled: !!id,
    staleTime: 30_000,
  });

  const followTarget: FollowTarget | null = id ? { kind: 'organizer', id } : null;
  const isOwnPage = !!userId && !!id && userId === id;

  const { data: followState } = useQuery({
    queryKey: ['organizer-follow', 'organizer', id, userId],
    queryFn: () => getFollowState(followTarget!, userId!),
    enabled: !!followTarget && !!userId && !isOwnPage,
    staleTime: 30_000,
  });
  const { data: followerCount = null } = useQuery({
    queryKey: ['follower-count', 'organizer', id],
    queryFn: () => getFollowerCount(followTarget!),
    enabled: !!followTarget,
    staleTime: 60_000,
  });

  const followMutation = useMutation({
    mutationFn: async () => {
      if (!followTarget || !userId || !followState) throw new Error('not ready');
      const ok = followState.following
        ? await removeFollow(followTarget, userId)
        : await recordFollow(followTarget, userId);
      if (!ok) throw new Error('follow write failed');
    },
    onSuccess: () => {
      hapticSuccess();
      queryClient.invalidateQueries({ queryKey: ['organizer-follow'] });
      queryClient.invalidateQueries({ queryKey: ['follower-count'] });
    },
    onError: () => hapticError(),
  });

  if (!COMMUNITIES_ENABLED) {
    return <Redirect href="/(tabs)/explore" />;
  }

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
            <ArrowLeft size={22} color={Colors.asphalt} strokeWidth={2.5} />
          </TouchableOpacity>
        </View>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.terracotta} />
        </View>
      </SafeAreaView>
    );
  }

  if (!page) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
            <ArrowLeft size={22} color={Colors.asphalt} strokeWidth={2.5} />
          </TouchableOpacity>
        </View>
        <View style={styles.centered}>
          {/* LIZ COPY (voice match: "this event is not around anymore.") */}
          <Text style={styles.emptyText}>this page isn't around.</Text>
          <TouchableOpacity onPress={() => router.back()} style={styles.goBackBtn}>
            <Text style={styles.goBackText}>go back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const { profile, upcomingEvents, pastEvents } = page;
  const subtitleParts = ['organization', profile.city].filter(Boolean);
  const showFollowerCount = followerCount !== null && followerCount >= MEMBER_COUNT_THRESHOLD;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
          <ArrowLeft size={22} color={Colors.asphalt} strokeWidth={2.5} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {profile.logo_url ? (
          <Image source={{ uri: profile.logo_url }} style={styles.avatar} contentFit="cover" />
        ) : (
          <View style={[styles.avatar, styles.avatarFallback]}>
            <Text style={styles.avatarInitial}>{profile.display_name[0]?.toUpperCase() ?? '?'}</Text>
          </View>
        )}

        <Text style={styles.name}>{profile.display_name}</Text>
        {/* LIZ COPY (Scene handoff §12 mockup: "organization · Los Angeles") */}
        <Text style={styles.subtitle}>{subtitleParts.join(' · ')}</Text>

        {!!profile.bio && <Text style={styles.bio}>{profile.bio}</Text>}

        {isOwnPage ? (
          // LIZ COPY
          <Text style={styles.ownPageNote}>this is your organization's public page.</Text>
        ) : (
          !!userId && !!followState?.available && (
            <TouchableOpacity
              style={[styles.followPill, followState.following && styles.followPillOn]}
              onPress={() => {
                hapticLight();
                followMutation.mutate();
              }}
              disabled={followMutation.isPending}
              activeOpacity={0.85}
            >
              <Text style={[styles.followPillText, followState.following && styles.followPillTextOn]}>
                {followState.following ? 'following' : 'follow'}
              </Text>
            </TouchableOpacity>
          )
        )}

        {showFollowerCount && (
          <Text style={styles.followerCount}>
            {followerCount} {followerCount === 1 ? 'follower' : 'followers'}
          </Text>
        )}

        {/* Scene handoff §12 minimum-page bullet: "clear meaning: following
            provides new-event/organizer updates; it does not create
            membership, roster access, or chat access." */}
        <View style={styles.meansCard}>
          {/* LIZ COPY */}
          <Text style={styles.meansTitle}>following means</Text>
          {/* LIZ COPY */}
          <Text style={styles.meansBody}>
            new-event and organizer updates. no community membership, roster, or chat access.
          </Text>
        </View>

        {!!profile.link_url && (
          <TouchableOpacity
            style={styles.linkRow}
            onPress={() => {
              hapticLight();
              openUrl(profile.link_url!);
            }}
            activeOpacity={0.85}
          >
            <ExternalLink size={14} color={Colors.terracotta} strokeWidth={2} />
            <Text style={styles.linkText} numberOfLines={1}>
              {profile.link_url.replace(/^https?:\/\//, '')}
            </Text>
          </TouchableOpacity>
        )}

        {/* LIZ COPY */}
        <Text style={styles.sectionLabel}>upcoming events</Text>
        {upcomingEvents.length > 0 ? (
          <View style={styles.eventList}>
            {upcomingEvents.map((ev) => <EventRow key={ev.id} event={ev} />)}
          </View>
        ) : (
          // LIZ COPY
          <Text style={styles.emptySection}>nothing on the calendar right now.</Text>
        )}

        {pastEvents.length > 0 && (
          <>
            {/* LIZ COPY */}
            <Text style={[styles.sectionLabel, styles.pastLabel]}>past events</Text>
            <View style={styles.eventList}>
              {pastEvents.map((ev) => <EventRow key={ev.id} event={ev} />)}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.parchment },
  header: { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 8 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  emptyText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyLG, color: Colors.textMedium, textAlign: 'center' },
  goBackBtn: { marginTop: 16, paddingHorizontal: 24, paddingVertical: 12, backgroundColor: Colors.terracotta, borderRadius: 14 },
  goBackText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.white },
  content: { padding: 20, paddingBottom: 60, alignItems: 'center' },
  avatar: { width: AVATAR_SIZE, height: AVATAR_SIZE, borderRadius: AVATAR_SIZE / 2, marginBottom: 14 },
  avatarFallback: { backgroundColor: Colors.terracotta, alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { fontFamily: Fonts.sansBold, fontSize: FontSizes.displayLG, color: Colors.white },
  name: {
    fontFamily: Fonts.displayBold,
    fontSize: FontSizes.displayLG,
    lineHeight: LineHeights.displayLG,
    color: Colors.darkWarm,
    textAlign: 'center',
  },
  subtitle: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Colors.secondary,
    marginTop: 2,
    marginBottom: 12,
  },
  bio: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    lineHeight: LineHeights.bodyMD,
    color: Colors.secondary,
    fontStyle: 'italic',
    textAlign: 'center',
    marginBottom: 16,
    maxWidth: 320,
  },
  ownPageNote: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.tertiary, marginBottom: 4 },
  followPill: {
    borderWidth: 1.5,
    borderColor: Colors.terracotta,
    borderRadius: 999,
    paddingHorizontal: 24,
    paddingVertical: 9,
  },
  followPillOn: { borderColor: Colors.border, backgroundColor: Colors.inputBg },
  followPillText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodySM, color: Colors.terracotta },
  followPillTextOn: { color: Colors.textMedium },
  followerCount: { fontFamily: Fonts.sans, fontSize: FontSizes.caption, color: Colors.tertiary, marginTop: 6 },
  meansCard: {
    backgroundColor: Colors.accentSubtle,
    borderRadius: 14,
    padding: 14,
    marginTop: 18,
    alignSelf: 'stretch',
  },
  meansTitle: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.caption,
    color: Colors.terracotta,
    letterSpacing: 1.2,
    marginBottom: 4,
  },
  meansBody: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, lineHeight: LineHeights.bodySM, color: Colors.secondary },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 14,
    paddingVertical: 4,
  },
  linkText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.terracotta },
  sectionLabel: {
    alignSelf: 'flex-start',
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.caption,
    color: Colors.terracotta,
    letterSpacing: 1.5,
    marginTop: 28,
    marginBottom: 10,
  },
  pastLabel: { marginTop: 24 },
  emptySection: {
    alignSelf: 'flex-start',
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodySM,
    color: Colors.tertiary,
  },
  eventList: { alignSelf: 'stretch', gap: 8 },
  eventRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.cardBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 10,
  },
  eventThumb: { width: ROW_THUMB_SIZE, height: ROW_THUMB_SIZE, borderRadius: 10, overflow: 'hidden' },
  eventThumbFallback: { backgroundColor: Colors.inputBg, alignItems: 'center', justifyContent: 'center' },
  eventThumbInitial: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.terracotta },
  eventRowBody: { flex: 1, gap: 2 },
  eventRowTitle: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.asphalt },
  eventRowMeta: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.secondary },
});
