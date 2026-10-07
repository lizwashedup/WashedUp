import { EventMediaImage } from '../../components/events/EventMediaImage';
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
 * this tab bar's community screens still use. Primary actions now follow
 * the approved shared creator sunset treatment.
 */

import React, { useMemo } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { AlertTriangle, ChevronRight, Flame, Plus, ScanLine, Ticket, Users } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { EventAction, EventSpacing, EventSurface } from '../../constants/EventDesign';
import { type AfterglowFontFamilies, FontSizes, LineHeights } from '../../constants/Typography';
import { getCreatorAccess, getCreatorEvents } from '../../lib/creatorMode';
import { getMyOrganizerProfile } from '../../lib/organizerProfile';
import { getFollowerCount } from '../../lib/organizerFollows';
import { getFailedPayouts, getTiers, isLowInventory } from '../../lib/ticketing';
import { getEventAttendees, countAttendees } from '../../lib/ticketAttendees';
import { formatEventDateLA } from '../../lib/laDate';
import { daysUntilLabel, failedPayoutLabel, hasUnpublishedTickets, inventoryLabel, lowInventoryLabel, pickNextUpcomingEvent, sumTierCapacity } from '../../lib/organizerHome';
import { supabase } from '../../lib/supabase';
import { useAfterglowFonts } from '../../hooks/useAfterglowFonts';
import { CreatorActionFill } from '../../components/creator/CreatorActionFill';
import { WorkspaceSwitcher } from '../../components/creator/WorkspaceSwitcher';
import { eventBelongsToWorkspace } from '../../lib/workspaceContext';

export default function OrganizerHomeScreen() {
  const { fonts } = useAfterglowFonts(true, 'creator');
  const styles = useMemo(() => createStyles(fonts), [fonts]);
  const router = useRouter();

  const { data: userId = null } = useQuery({
    queryKey: ['my-user-id'],
    queryFn: async () => (await supabase.auth.getUser()).data.user?.id ?? null,
    staleTime: Infinity,
  });

  const profileQuery = useQuery({
    queryKey: ['organizer-profile'],
    queryFn: getMyOrganizerProfile,
  });

  const { data: organizerProfile = null, isPending: organizerProfilePending } = profileQuery;

  // event-host-only has no led communities; shares events.tsx's cache key
  // shape so the two tabs read the same list instead of double-fetching.
  const { data: access } = useQuery({ queryKey: ['creator-access'], queryFn: getCreatorAccess });
  // S-02: isPending (not isLoading) on purpose -- this query stays `enabled:
  // false` (so also not "isFetching") for the whole time access is still
  // loading, and isLoading is isPending && isFetching in this query-client
  // major version. isPending alone stays true across that whole gap, which
  // is what actually gates the false "nothing on the calendar" flash below.
  const eventsQuery = useQuery({
    queryKey: ['creator-events-tab', 'organization'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      return getCreatorEvents([], user.id);
    },
    enabled: access != null,
  });
  const { data: allEvents = [], isPending: eventsPending } = eventsQuery;
  const events = allEvents.filter((event) => eventBelongsToWorkspace(event, 'organization', null));

  const nextEvent = useMemo(() => pickNextUpcomingEvent(events), [events]);
  const draftEvent = useMemo(() => events.find((event) => event.status === 'Draft') ?? null, [events]);
  const draftHasTicketSetup = !!draftEvent && hasUnpublishedTickets(draftEvent.tiers);

  const tiersQuery = useQuery({
    queryKey: ['organizer-home-tiers', nextEvent?.id],
    queryFn: () => getTiers(nextEvent!.id),
    enabled: !!nextEvent,
  });
  const attendeesQuery = useQuery({
    queryKey: ['organizer-home-attendees', nextEvent?.id],
    queryFn: () => getEventAttendees(nextEvent!.id),
    enabled: !!nextEvent,
  });
  const { data: tiers = [] } = tiersQuery;
  const { data: attendees = [] } = attendeesQuery;
  const inventoryError = tiersQuery.isError || attendeesQuery.isError;
  const inventoryPending = tiersQuery.isPending || attendeesQuery.isPending;
  const counts = countAttendees(attendees);
  const capacity = useMemo(() => sumTierCapacity(tiers), [tiers]);

  // Build 35 Screen 01 exception surfacing: the next event's aggregate
  // inventory crossing Liz decision #16's 90%-sold threshold (isLowInventory,
  // lib/ticketing.ts), read at the same roll-up level this screen already
  // shows via inventoryLabel below, not a new per-tier concept. null capacity
  // (an open-ended event) never counts as low, same contract isLowInventory
  // already enforces for cap <= 0.
  const capacityLeft = capacity != null ? capacity - counts.sold : null;
  const showLowInventory = !inventoryError && !inventoryPending && !!nextEvent && capacityLeft != null && isLowInventory(capacityLeft, capacity!);

  // dormant until proposal 68 applies (lib/organizerFollows.ts): null hides
  // this section entirely rather than showing a fake zero.
  const followersQuery = useQuery({
    queryKey: ['organizer-follower-count', userId],
    queryFn: () => getFollowerCount({ kind: 'organizer', id: userId! }),
    enabled: !!userId,
    staleTime: 60_000,
  });

  // Build 35 Screen 01 exception surfacing: ticket_payouts.status='failed'
  // across this organizer's events. Empty array hides the card entirely,
  // same "no fake zero" convention as followerCount above.
  const payoutsQuery = useQuery({
    queryKey: ['organizer-home-failed-payouts', userId, 'organization'],
    queryFn: () => getFailedPayouts([], userId!),
    enabled: !!userId && access != null,
    staleTime: 30_000,
  });

  const { data: followerCount = null } = followersQuery;
  const { data: failedPayouts = [] } = payoutsQuery;
  const producerName = organizerProfile?.display_name || 'Your events';
  const inventoryText = inventoryError ? 'Ticket counts unavailable' : inventoryPending ? 'Checking tickets…' : inventoryLabel(counts.sold, capacity);
  const checkInText = attendeesQuery.isError ? 'Check-in count unavailable' : attendeesQuery.isPending ? 'Checking attendance…' : `${counts.checkedIn} of ${counts.sold} checked in`;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* LIZ COPY */}
        <Text style={styles.kicker}>creator mode</Text>
        <Text style={styles.title}>{producerName}</Text>
        <WorkspaceSwitcher access={access} />

        {/* Build 35 Screen 01: exception-first surfacing. Rises above the
            routine next-event card on purpose -- a stuck payout matters
            regardless of which event it's on. failure_message is an
            internal Stripe/webhook string, never shown here verbatim. */}
        {payoutsQuery.isError && <OrganizationReadState label="Payout status" query={payoutsQuery} />}
        {failedPayouts.length > 0 && (
          <TouchableOpacity
            accessibilityRole="button"
            style={styles.exceptionCard}
            onPress={() => router.push('/creator/payouts' as never)}
            activeOpacity={0.85}
          >
            <AlertTriangle size={20} color={EventAction.error} strokeWidth={2} />
            <View style={styles.urgencyBody}>
              {/* LIZ COPY */}
              <Text style={styles.exceptionKicker}>payout issue</Text>
              <Text style={styles.urgencyTitle}>{failedPayoutLabel(failedPayouts.length)}</Text>
              <Text style={styles.urgencyMeta}>
                {failedPayouts.length === 1
                  ? `${failedPayouts[0].eventTitle} · we're retrying automatically`
                  : "we're retrying automatically · see getting paid"}
              </Text>
            </View>
            <ChevronRight size={18} color={Colors.tertiary} strokeWidth={2} />
          </TouchableOpacity>
        )}

        {/* Build 35 Screen 01 exception surfacing: real scarcity, not a fake
            countdown -- same isLowInventory threshold already proven on the
            tickets screen's per-tier badge. Rises with the payout card, above
            the routine next-event card below. */}
        {showLowInventory && (
          <TouchableOpacity
            accessibilityRole="button"
            style={styles.lowInventoryCard}
            onPress={() => router.push(`/creator/tickets?id=${nextEvent!.id}` as never)}
            activeOpacity={0.85}
          >
            <Flame size={20} color={EventAction.scarcity} strokeWidth={2} />
            <View style={styles.urgencyBody}>
              {/* LIZ COPY */}
              <Text style={styles.lowInventoryKicker}>almost sold out</Text>
              <Text style={styles.urgencyTitle}>{lowInventoryLabel(capacityLeft!)}</Text>
              <Text style={styles.urgencyMeta}>{nextEvent!.title}</Text>
            </View>
            <ChevronRight size={18} color={Colors.tertiary} strokeWidth={2} />
          </TouchableOpacity>
        )}

        {!eventsPending && draftEvent && (
          <TouchableOpacity
            accessibilityRole="button"
            style={styles.draftCard}
            onPress={() => router.push(
              (draftHasTicketSetup
                ? `/creator/tickets?id=${draftEvent.id}`
                : `/creator/event-form?id=${draftEvent.id}`) as never,
            )}
            activeOpacity={0.85}
            accessibilityLabel={`Continue draft: ${draftEvent.title}`}
          >
            <View style={styles.urgencyBody}>
              <Text style={styles.draftKicker}>draft saved</Text>
              <Text style={styles.urgencyTitle}>{draftEvent.title}</Text>
              <Text style={styles.urgencyMeta}>
                {draftHasTicketSetup
                  ? 'your ticket is saved. finish making it sellable.'
                  : 'only you can see it. keep shaping it.'}
              </Text>
            </View>
            <ChevronRight size={18} color={Colors.tertiary} strokeWidth={2} />
          </TouchableOpacity>
        )}

        {eventsQuery.isError && <OrganizationReadState label="Events" query={eventsQuery} />}
        {eventsPending ? (
          <View style={[styles.emptyCard, styles.loadingCard]}>
            <ActivityIndicator size="small" color={EventAction.primary} />
            <Text style={styles.emptyText}>Loading your events…</Text>
          </View>
        ) : nextEvent ? (
          <TouchableOpacity
            accessibilityRole="button"
            style={styles.urgencyCard}
            accessibilityLabel={`Attendees for ${nextEvent.title}`}
            accessibilityHint={inventoryText}
            onPress={() => router.push(`/creator/attendees?id=${nextEvent.id}` as never)}
            activeOpacity={0.85}
          >
            <NextEventThumb eventId={nextEvent.id} imageUrl={nextEvent.image_url} title={nextEvent.title} />
            <View style={styles.urgencyBody}>
              {/* LIZ COPY: real urgency, not a countdown gimmick */}
              <Text style={styles.urgencyWhen}>{daysUntilLabel(nextEvent.event_date!)}</Text>
              <Text style={styles.urgencyTitle}>{nextEvent.title}</Text>
              <Text style={styles.urgencyMeta}>
                {[formatEventDateLA(nextEvent.event_date ?? ''), nextEvent.venue].filter(Boolean).join(' · ')}
              </Text>
              <Text style={styles.urgencyInventory}>{inventoryText}</Text>
            </View>
            <ChevronRight size={18} color={Colors.tertiary} strokeWidth={2} />
          </TouchableOpacity>
        ) : !draftEvent && !eventsQuery.isError ? (
          // LIZ COPY: invitation, never a bare "nothing yet" (matches events.tsx's own empty hint)
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>nothing on the calendar yet. put one on and it lives here.</Text>
            <TouchableOpacity accessibilityRole="button" style={styles.emptyBtn} onPress={() => router.push('/creator/event-form')} activeOpacity={0.85}>
              <CreatorActionFill />
              <View style={styles.actionContent}>
                <Plus size={16} color={EventAction.onPrimary} strokeWidth={2.5} />
                <Text style={styles.emptyBtnText}>put on an event</Text>
              </View>
            </TouchableOpacity>
          </View>
        ) : null}

        {nextEvent && inventoryError && <OrganizationReadState label="Ticket counts" query={{ isFetching: tiersQuery.isFetching || attendeesQuery.isFetching, refetch: () => Promise.all([tiersQuery.refetch(), attendeesQuery.refetch()]) }} />}
        {nextEvent && (
          <TouchableOpacity
            accessibilityRole="button"
            style={styles.linkRow}
            onPress={() => router.push(`/creator/attendees?id=${nextEvent.id}` as never)}
            activeOpacity={0.8}
          >
            <Ticket size={18} color={EventAction.primary} strokeWidth={2} />
            <View style={{ flex: 1 }}>
              {/* LIZ COPY */}
              <Text style={styles.linkRowTitle}>who's coming</Text>
              <Text style={styles.linkRowMeta}>{inventoryText}</Text>
            </View>
            <ChevronRight size={18} color={Colors.tertiary} strokeWidth={2} />
          </TouchableOpacity>
        )}

        {/* O-01: entry/scanner surfaced directly on this home screen, not
            only reachable through the events tab's per-event row */}
        {nextEvent && (
          <TouchableOpacity
            accessibilityRole="button"
            style={styles.linkRow}
            onPress={() => { router.push(`/creator/check-in?id=${nextEvent.id}` as never); }}
            activeOpacity={0.8}
          >
            <ScanLine size={18} color={EventAction.primary} strokeWidth={2} />
            <View style={{ flex: 1 }}>
              {/* LIZ COPY */}
              <Text style={styles.linkRowTitle}>check in</Text>
              <Text style={styles.linkRowMeta}>{checkInText}</Text>
            </View>
            <ChevronRight size={18} color={Colors.tertiary} strokeWidth={2} />
          </TouchableOpacity>
        )}

        {/* dormant until proposal 68 applies (lib/organizerFollows.ts): the
            section simply does not exist for anyone until then, no fake zero */}
        {followersQuery.isError && <OrganizationReadState label="Followers" query={followersQuery} />}
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
            accessibilityRole="button"
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
        <TouchableOpacity accessibilityRole="button" style={styles.linkRow} onPress={() => router.push('/creator/payouts' as never)} activeOpacity={0.8}>
          <View style={{ flex: 1 }}>
            {/* LIZ COPY — updated 2026-09-01: "orders" -> "purchases" per Scene handoff §14
                (no backend vocab in copy); matches creator/payouts.tsx's own "purchases"
                section label */}
            <Text style={styles.linkRowTitle}>getting paid</Text>
            <Text style={styles.linkRowMeta}>purchases, payouts, and stripe setup live here.</Text>
          </View>
          <ChevronRight size={18} color={Colors.tertiary} strokeWidth={2} />
        </TouchableOpacity>

        {profileQuery.isError && <OrganizationReadState label="Organization details" query={profileQuery} />}
        <TouchableOpacity accessibilityRole="button" style={styles.linkRow} onPress={() => router.push('/creator/organizer-profile')} activeOpacity={0.8}>
          <View style={{ flex: 1 }}>
            {/* LIZ COPY */}
            <View style={styles.linkRowTitleLine}>
              <Text style={styles.linkRowTitle}>your organization</Text>
              {!organizerProfilePending && !profileQuery.isError && !organizerProfile && (
                <View style={styles.setupBadge} accessibilityLabel="organization setup needed">
                  <Text style={styles.setupBadgeText}>set up</Text>
                </View>
              )}
            </View>
            <Text style={styles.linkRowMeta}>
              {organizerProfile ? 'the name your events wear' : profileQuery.isError ? 'Details could not be loaded.' : organizerProfilePending ? 'Loading organization details…' : 'set it up. takes a minute.'}
            </Text>
          </View>
          <ChevronRight size={18} color={Colors.tertiary} strokeWidth={2} />
        </TouchableOpacity>

        {/* O-01: "put on another event" moves to the end of the scroll (was
            rendering third, right after the urgency card); everything above
            it is about the event already up, this is the next action once
            you've read all of that, not a distraction ahead of it */}
        {nextEvent && (
          <TouchableOpacity accessibilityRole="button" style={styles.postBtn} onPress={() => router.push('/creator/event-form')} activeOpacity={0.85}>
            <CreatorActionFill />
            <View style={styles.actionContent}>
              <Plus size={16} color={EventAction.onPrimary} strokeWidth={2.5} />
              <Text style={styles.postBtnText}>put on another event</Text>
            </View>
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function NextEventThumb({ eventId, imageUrl, title }: { eventId: string; imageUrl: string | null; title: string }) {
  const { fonts } = useAfterglowFonts(true, 'creator');
  const styles = useMemo(() => createStyles(fonts), [fonts]);
  const [brokenReference, setBrokenReference] = React.useState<string | null>(null);
  if (imageUrl && brokenReference !== imageUrl) {
    return <EventMediaImage eventId={eventId} reference={imageUrl} style={styles.thumb} contentFit="cover" onError={() => setBrokenReference(imageUrl)} />;
  }
  return (
    <View style={[styles.thumb, styles.thumbFallback]}>
      <Text style={styles.thumbLetter}>{title.slice(0, 1).toLowerCase()}</Text>
    </View>
  );
}

const THUMB_SIZE = 56;

function OrganizationReadState({ label, query }: { label: string; query: { isFetching: boolean; refetch: () => Promise<unknown> } }) {
  const { fonts } = useAfterglowFonts(true, 'creator');
  const styles = useMemo(() => createStyles(fonts), [fonts]);
  return <View style={styles.readState} accessibilityLiveRegion="polite">
    <Text style={styles.linkRowTitle}>{label} unavailable</Text>
    <TouchableOpacity style={styles.retry} accessibilityRole="button" accessibilityLabel={`Retry ${label.toLowerCase()}`} disabled={query.isFetching} onPress={() => void query.refetch()}>
      <Text style={styles.retryText}>{query.isFetching ? 'Checking…' : 'Retry'}</Text>
    </TouchableOpacity>
  </View>;
}

function createStyles(fonts: AfterglowFontFamilies) { return StyleSheet.create({
  readState: { paddingVertical: 12, gap: 4 },
  retry: { minHeight: 44, minWidth: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  retryText: { fontFamily: fonts.medium, fontSize: FontSizes.bodySM, color: EventAction.primary },
  actionContent: { zIndex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center' },
  container: { flex: 1, backgroundColor: EventSurface.base },
  content: { padding: EventSpacing.md, gap: EventSpacing.sm },
  kicker: {
    fontFamily: fonts.semibold,
    fontSize: FontSizes.caption,
    color: EventAction.primary,
    letterSpacing: 1.5,
  },
  title: {
    fontFamily: fonts.display,
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
  draftCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: EventSpacing.sm,
    backgroundColor: EventSurface.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: EventAction.primary,
    padding: EventSpacing.md,
    marginTop: EventSpacing.xs,
  },
  draftKicker: {
    fontFamily: fonts.semibold,
    fontSize: FontSizes.caption,
    color: EventAction.primary,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
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
    fontFamily: fonts.semibold,
    fontSize: FontSizes.caption,
    color: EventAction.error,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  lowInventoryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: EventSpacing.sm,
    backgroundColor: EventSurface.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: EventAction.scarcity,
    padding: EventSpacing.md,
    marginTop: EventSpacing.xs,
  },
  lowInventoryKicker: {
    fontFamily: fonts.semibold,
    fontSize: FontSizes.caption,
    color: EventAction.scarcity,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  urgencyBody: { flex: 1, minWidth: 0, gap: 4 },
  urgencyWhen: {
    fontFamily: fonts.semibold,
    fontSize: FontSizes.caption,
    color: EventAction.scarcity,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  urgencyTitle: { fontFamily: fonts.semibold, fontSize: FontSizes.bodyLG, lineHeight: LineHeights.bodyLG, color: Colors.darkWarm },
  urgencyMeta: { fontFamily: fonts.regular, fontSize: FontSizes.bodySM, lineHeight: LineHeights.bodySM, color: Colors.secondary },
  urgencyInventory: { fontFamily: fonts.medium, fontSize: FontSizes.bodySM, color: Colors.darkWarm, marginTop: 2 },

  thumb: { width: THUMB_SIZE, height: THUMB_SIZE, borderRadius: 12, alignSelf: 'flex-start' },
  thumbFallback: { backgroundColor: EventAction.soft, alignItems: 'center', justifyContent: 'center' },
  thumbLetter: { fontFamily: fonts.display, fontSize: FontSizes.displaySM, color: EventAction.primary },

  emptyCard: {
    backgroundColor: EventSurface.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.borderWarm,
    padding: EventSpacing.md,
    gap: EventSpacing.sm,
    marginTop: EventSpacing.xs,
  },
  emptyText: { fontFamily: fonts.regular, fontSize: FontSizes.bodyMD, lineHeight: LineHeights.bodyMD, color: Colors.secondary },
  loadingCard: { alignItems: 'center', justifyContent: 'center', minHeight: 64 },
  emptyBtn: {
    minHeight: 44, overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: EventAction.primary,
    borderRadius: 24,
    paddingVertical: 12,
  },
  emptyBtnText: { fontFamily: fonts.semibold, fontSize: FontSizes.bodyMD, color: EventAction.onPrimary },

  postBtn: {
    minHeight: 44, overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: EventAction.primary,
    borderRadius: 24,
    paddingVertical: 12,
    marginTop: EventSpacing.xs,
  },
  postBtnText: { fontFamily: fonts.semibold, fontSize: FontSizes.bodyMD, color: EventAction.onPrimary },

  sectionLabel: {
    fontFamily: fonts.semibold,
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
  followersCount: { fontFamily: fonts.display, fontSize: FontSizes.displaySM, color: Colors.darkWarm },
  followersLabel: { flex: 1, fontFamily: fonts.regular, fontSize: FontSizes.bodySM, lineHeight: LineHeights.bodySM, color: Colors.secondary },

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
  linkRowTitle: { fontFamily: fonts.semibold, fontSize: FontSizes.bodyMD, color: Colors.darkWarm },
  linkRowTitleLine: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: EventSpacing.xs },
  setupBadge: {
    backgroundColor: EventAction.successFill,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Colors.gold,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  setupBadgeText: { fontFamily: fonts.semibold, fontSize: FontSizes.micro, color: Colors.brandDeep },
  linkRowMeta: { fontFamily: fonts.regular, fontSize: FontSizes.bodySM, lineHeight: LineHeights.bodySM, color: Colors.secondary, marginTop: 2 },
});

}
