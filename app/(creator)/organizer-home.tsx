/**
 * Organizer/producer home (CTO scope item 06; design spec item 04
 * "Distinct community-creator and organization/producer workspace shells";
 * inventory row O-01 "Native Producer Space home": header -> show urgency ->
 * live inventory -> ... -> Create organization event, nav Today/Events/.../
 * More). This replaces the old approach of handing an event-host-only grant
 * a cut-down copy of the community leader's Today tab (a persistent-
 * community feed concept that never applied to a standalone producer).
 *
 * O-09 (explicit absence of membership and room): this screen and its data
 * never touch community/member/join/door/room concepts, only events,
 * tickets, and follows.
 *
 * Landing tab for an event-host-only grant (lib/creatorMode.ts
 * creatorLandingRoute); leaders never see this tab (app/(creator)/_layout.tsx
 * hides it via href when isLeaderAccess is true).
 *
 * New Block B screen: uses the Q2 event-surface tokens (constants/
 * EventDesign.ts) already adopted by the sibling ticket screens (tickets.tsx,
 * attendees.tsx, door.tsx, payouts.tsx), not the older parchment/asphalt set
 * this tab bar's community screens still use. Primary actions are 10px
 * radius, never a pill (Figma-ready build spec, supersedes the older pill
 * guidance for this surface).
 */

import React, { useMemo } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { AlertTriangle, ChevronRight, Plus, ScanLine, Ticket, Users } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { EventAction, EventSpacing, EventSurface, EventType } from '../../constants/EventDesign';
import { FontSizes, LineHeights } from '../../constants/Typography';
import { getCreatorAccess, getCreatorEvents } from '../../lib/creatorMode';
import { getMyOrganizerProfile } from '../../lib/organizerProfile';
import { getFollowerCount } from '../../lib/organizerFollows';
import { getFailedPayouts, getTiers } from '../../lib/ticketing';
import { getEventAttendees, countAttendees } from '../../lib/ticketAttendees';
import { formatEventDateLA } from '../../lib/laDate';
import { daysUntilLabel, failedPayoutLabel, inventoryLabel, pickNextUpcomingEvent, sumTierCapacity } from '../../lib/organizerHome';
import { supabase } from '../../lib/supabase';

export default function OrganizerHomeScreen() {
  const router = useRouter();

  const { data: userId = null } = useQuery({
    queryKey: ['my-user-id'],
    queryFn: async () => (await supabase.auth.getUser()).data.user?.id ?? null,
    staleTime: Infinity,
  });

  const { data: organizerProfile = null } = useQuery({
    queryKey: ['organizer-profile'],
    queryFn: getMyOrganizerProfile,
  });

  // event-host-only has no led communities; shares events.tsx's cache key
  // shape so the two tabs read the same list instead of double-fetching.
  const { data: access } = useQuery({ queryKey: ['creator-access'], queryFn: getCreatorAccess });
  // S-02: isPending (not isLoading) on purpose -- this query stays `enabled:
  // false` (so also not "isFetching") for the whole time access is still
  // loading, and isLoading is isPending && isFetching in this query-client
  // major version. isPending alone stays true across that whole gap, which
  // is what actually gates the false "nothing on the calendar" flash below.
  const { data: events = [], isPending: eventsPending } = useQuery({
    queryKey: ['creator-events-tab', access?.ledCommunities.map((c) => c.id).join(',')],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      return getCreatorEvents((access?.ledCommunities ?? []).map((c) => c.id), user.id);
    },
    enabled: access != null,
  });

  const nextEvent = useMemo(() => pickNextUpcomingEvent(events), [events]);

  const { data: tiers = [] } = useQuery({
    queryKey: ['organizer-home-tiers', nextEvent?.id],
    queryFn: () => getTiers(nextEvent!.id),
    enabled: !!nextEvent,
  });
  const { data: attendees = [] } = useQuery({
    queryKey: ['organizer-home-attendees', nextEvent?.id],
    queryFn: () => getEventAttendees(nextEvent!.id),
    enabled: !!nextEvent,
  });
  const counts = countAttendees(attendees);
  const capacity = useMemo(() => sumTierCapacity(tiers), [tiers]);

  // dormant until proposal 68 applies (lib/organizerFollows.ts): null hides
  // this section entirely rather than showing a fake zero.
  const { data: followerCount = null } = useQuery({
    queryKey: ['organizer-follower-count', userId],
    queryFn: () => getFollowerCount({ kind: 'organizer', id: userId! }),
    enabled: !!userId,
    staleTime: 60_000,
  });

  // Build 35 Screen 01 exception surfacing: ticket_payouts.status='failed'
  // across this organizer's events. Empty array hides the card entirely,
  // same "no fake zero" convention as followerCount above.
  const { data: failedPayouts = [] } = useQuery({
    queryKey: ['organizer-home-failed-payouts', userId, access?.ledCommunities.map((c) => c.id).join(',')],
    queryFn: () => getFailedPayouts((access?.ledCommunities ?? []).map((c) => c.id), userId!),
    enabled: !!userId && access != null,
    staleTime: 30_000,
  });

  const producerName = organizerProfile?.display_name?.toLowerCase() || 'your events';

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* LIZ COPY */}
        <Text style={styles.kicker}>creator mode</Text>
        <Text style={styles.title}>{producerName}</Text>

        {/* Build 35 Screen 01: exception-first surfacing. Rises above the
            routine next-event card on purpose -- a stuck payout matters
            regardless of which event it's on. failure_message is an
            internal Stripe/webhook string, never shown here verbatim. */}
        {failedPayouts.length > 0 && (
          <TouchableOpacity
            style={styles.exceptionCard}
            onPress={() => router.push('/creator/payouts' as never)}
            activeOpacity={0.85}
          >
            <AlertTriangle size={20} color={EventAction.error} strokeWidth={2} />
            <View style={styles.urgencyBody}>
              {/* LIZ COPY */}
              <Text style={styles.exceptionKicker}>payout issue</Text>
              <Text style={styles.urgencyTitle}>{failedPayoutLabel(failedPayouts.length)}</Text>
              <Text style={styles.urgencyMeta} numberOfLines={1}>
                {failedPayouts.length === 1
                  ? `${failedPayouts[0].eventTitle} · we're retrying automatically`
                  : "we're retrying automatically · see getting paid"}
              </Text>
            </View>
            <ChevronRight size={18} color={Colors.tertiary} strokeWidth={2} />
          </TouchableOpacity>
        )}

        {eventsPending ? (
          <View style={[styles.emptyCard, styles.loadingCard]}>
            <ActivityIndicator size="small" color={EventAction.primary} />
          </View>
        ) : nextEvent ? (
          <TouchableOpacity
            style={styles.urgencyCard}
            onPress={() => router.push(`/creator/attendees?id=${nextEvent.id}` as never)}
            activeOpacity={0.85}
          >
            <NextEventThumb imageUrl={nextEvent.image_url} title={nextEvent.title} />
            <View style={styles.urgencyBody}>
              {/* LIZ COPY: real urgency, not a countdown gimmick */}
              <Text style={styles.urgencyWhen}>{daysUntilLabel(nextEvent.event_date!)}</Text>
              <Text style={styles.urgencyTitle} numberOfLines={1}>{nextEvent.title}</Text>
              <Text style={styles.urgencyMeta} numberOfLines={1}>
                {[formatEventDateLA(nextEvent.event_date ?? ''), nextEvent.venue].filter(Boolean).join(' · ')}
              </Text>
              <Text style={styles.urgencyInventory}>{inventoryLabel(counts.sold, capacity)}</Text>
            </View>
            <ChevronRight size={18} color={Colors.tertiary} strokeWidth={2} />
          </TouchableOpacity>
        ) : (
          // LIZ COPY: invitation, never a bare "nothing yet" (matches events.tsx's own empty hint)
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>nothing on the calendar yet. put one on and it lives here.</Text>
            <TouchableOpacity style={styles.emptyBtn} onPress={() => router.push('/creator/event-form')} activeOpacity={0.85}>
              <Plus size={16} color={EventAction.onPrimary} strokeWidth={2.5} />
              {/* LIZ COPY */}
              <Text style={styles.emptyBtnText}>put on an event</Text>
            </TouchableOpacity>
          </View>
        )}

        {nextEvent && (
          <TouchableOpacity
            style={styles.linkRow}
            onPress={() => router.push(`/creator/attendees?id=${nextEvent.id}` as never)}
            activeOpacity={0.8}
          >
            <Ticket size={18} color={EventAction.primary} strokeWidth={2} />
            <View style={{ flex: 1 }}>
              {/* LIZ COPY */}
              <Text style={styles.linkRowTitle}>who's coming</Text>
              <Text style={styles.linkRowMeta}>{inventoryLabel(counts.sold, capacity)}</Text>
            </View>
            <ChevronRight size={18} color={Colors.tertiary} strokeWidth={2} />
          </TouchableOpacity>
        )}

        {/* O-01: entry/scanner surfaced directly on this home screen, not
            only reachable through the events tab's per-event row */}
        {nextEvent && (
          <TouchableOpacity
            style={styles.linkRow}
            onPress={() => { router.push(`/creator/check-in?id=${nextEvent.id}` as never); }}
            activeOpacity={0.8}
          >
            <ScanLine size={18} color={EventAction.primary} strokeWidth={2} />
            <View style={{ flex: 1 }}>
              {/* LIZ COPY */}
              <Text style={styles.linkRowTitle}>check in</Text>
              <Text style={styles.linkRowMeta}>{counts.checkedIn} of {counts.sold} checked in</Text>
            </View>
            <ChevronRight size={18} color={Colors.tertiary} strokeWidth={2} />
          </TouchableOpacity>
        )}

        {/* dormant until proposal 68 applies (lib/organizerFollows.ts): the
            section simply does not exist for anyone until then, no fake zero */}
        {followerCount != null && (
          <View style={styles.followersCard}>
            <Users size={18} color={EventAction.primary} strokeWidth={2} />
            {/* LIZ COPY */}
            <Text style={styles.followersCount}>{followerCount}</Text>
            <Text style={styles.followersLabel}>
              {followerCount === 1 ? 'person following your events' : 'people following your events'}
            </Text>
          </View>
        )}

        {/* O-03: dormant with the same follower-count gate above -- no point
            offering to message an audience that doesn't exist as a concept yet */}
        {followerCount != null && (
          <TouchableOpacity
            style={styles.linkRow}
            onPress={() => router.push('/organizer-broadcast' as never)}
            activeOpacity={0.8}
          >
            <View style={{ flex: 1 }}>
              {/* LIZ COPY */}
              <Text style={styles.linkRowTitle}>message your followers</Text>
              <Text style={styles.linkRowMeta}>a quick update, right to their feed.</Text>
            </View>
            <ChevronRight size={18} color={Colors.tertiary} strokeWidth={2} />
          </TouchableOpacity>
        )}

        <Text style={styles.sectionLabel}>money</Text>
        <TouchableOpacity style={styles.linkRow} onPress={() => router.push('/creator/payouts' as never)} activeOpacity={0.8}>
          <View style={{ flex: 1 }}>
            {/* LIZ COPY — updated 2026-09-01: "orders" -> "purchases" per Scene handoff §14
                (no backend vocab in copy); matches creator/payouts.tsx's own "purchases"
                section label */}
            <Text style={styles.linkRowTitle}>getting paid</Text>
            <Text style={styles.linkRowMeta}>purchases, payouts, and stripe setup live here.</Text>
          </View>
          <ChevronRight size={18} color={Colors.tertiary} strokeWidth={2} />
        </TouchableOpacity>

        <TouchableOpacity style={styles.linkRow} onPress={() => router.push('/creator/organizer-profile')} activeOpacity={0.8}>
          <View style={{ flex: 1 }}>
            {/* LIZ COPY */}
            <Text style={styles.linkRowTitle}>your organization</Text>
            <Text style={styles.linkRowMeta}>
              {organizerProfile ? 'the name your events wear' : 'set it up. takes a minute.'}
            </Text>
          </View>
          <ChevronRight size={18} color={Colors.tertiary} strokeWidth={2} />
        </TouchableOpacity>

        {/* O-01: "put on another event" moves to the end of the scroll (was
            rendering third, right after the urgency card); everything above
            it is about the event already up, this is the next action once
            you've read all of that, not a distraction ahead of it */}
        {nextEvent && (
          <TouchableOpacity style={styles.postBtn} onPress={() => router.push('/creator/event-form')} activeOpacity={0.85}>
            <Plus size={16} color={EventAction.onPrimary} strokeWidth={2.5} />
            {/* LIZ COPY */}
            <Text style={styles.postBtnText}>put on another event</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function NextEventThumb({ imageUrl, title }: { imageUrl: string | null; title: string }) {
  const [broken, setBroken] = React.useState(false);
  if (imageUrl && !broken) {
    return <Image source={{ uri: imageUrl }} style={styles.thumb} contentFit="cover" onError={() => setBroken(true)} />;
  }
  return (
    <View style={[styles.thumb, styles.thumbFallback]}>
      <Text style={styles.thumbLetter}>{title.slice(0, 1).toLowerCase()}</Text>
    </View>
  );
}

const THUMB_SIZE = 56;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: EventSurface.base },
  content: { padding: EventSpacing.md, gap: EventSpacing.sm },
  kicker: {
    fontFamily: EventType.bodyBold,
    fontSize: FontSizes.caption,
    color: EventAction.primary,
    letterSpacing: 1.5,
  },
  title: {
    fontFamily: EventType.display,
    fontSize: FontSizes.displayLG,
    lineHeight: LineHeights.displayLG,
    color: Colors.darkWarm,
    marginBottom: EventSpacing.xs,
  },

  urgencyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: EventSpacing.sm,
    backgroundColor: EventSurface.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.borderWarm,
    padding: EventSpacing.md,
    marginTop: EventSpacing.xs,
  },
  exceptionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: EventSpacing.sm,
    backgroundColor: EventSurface.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: EventAction.error,
    padding: EventSpacing.md,
    marginTop: EventSpacing.xs,
  },
  exceptionKicker: {
    fontFamily: EventType.bodyBold,
    fontSize: FontSizes.caption,
    color: EventAction.error,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  urgencyBody: { flex: 1, gap: 2 },
  urgencyWhen: {
    fontFamily: EventType.bodyBold,
    fontSize: FontSizes.caption,
    color: EventAction.scarcity,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  urgencyTitle: { fontFamily: EventType.bodyBold, fontSize: FontSizes.bodyLG, color: Colors.darkWarm },
  urgencyMeta: { fontFamily: EventType.body, fontSize: FontSizes.bodySM, color: Colors.secondary },
  urgencyInventory: { fontFamily: EventType.bodyMedium, fontSize: FontSizes.bodySM, color: Colors.darkWarm, marginTop: 2 },

  thumb: { width: THUMB_SIZE, height: THUMB_SIZE, borderRadius: 12 },
  thumbFallback: { backgroundColor: EventAction.soft, alignItems: 'center', justifyContent: 'center' },
  thumbLetter: { fontFamily: EventType.display, fontSize: FontSizes.displaySM, color: EventAction.primary },

  emptyCard: {
    backgroundColor: EventSurface.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.borderWarm,
    padding: EventSpacing.md,
    gap: EventSpacing.sm,
    marginTop: EventSpacing.xs,
  },
  emptyText: { fontFamily: EventType.body, fontSize: FontSizes.bodyMD, lineHeight: LineHeights.bodyMD, color: Colors.secondary },
  loadingCard: { alignItems: 'center', justifyContent: 'center', minHeight: 64 },
  emptyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: EventAction.primary,
    borderRadius: 10,
    paddingVertical: 12,
  },
  emptyBtnText: { fontFamily: EventType.bodyBold, fontSize: FontSizes.bodyMD, color: EventAction.onPrimary },

  postBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: EventAction.primary,
    borderRadius: 10,
    paddingVertical: 12,
    marginTop: EventSpacing.xs,
  },
  postBtnText: { fontFamily: EventType.bodyBold, fontSize: FontSizes.bodyMD, color: EventAction.onPrimary },

  sectionLabel: {
    fontFamily: EventType.bodyBold,
    fontSize: FontSizes.caption,
    color: Colors.tertiary,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginTop: EventSpacing.sm,
    marginBottom: 2,
  },

  followersCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: EventSurface.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.borderWarm,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  followersCount: { fontFamily: EventType.displayBold, fontSize: FontSizes.displaySM, color: Colors.darkWarm },
  followersLabel: { fontFamily: EventType.body, fontSize: FontSizes.bodySM, color: Colors.secondary },

  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: EventSurface.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.borderWarm,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  linkRowTitle: { fontFamily: EventType.bodyBold, fontSize: FontSizes.bodyMD, color: Colors.darkWarm },
  linkRowMeta: { fontFamily: EventType.body, fontSize: FontSizes.bodySM, color: Colors.secondary, marginTop: 2 },
});
