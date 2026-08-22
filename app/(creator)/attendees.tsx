/**
 * Attendees tab (inventory O-01: "Today / Events / Attendees / More" is the
 * event-host shell's own nav naming -- see app/(creator)/_layout.tsx and
 * organizer-home.tsx's header notes). Previously "who's coming" and the
 * door scanner were reachable only through a link buried inside the Events
 * tab's per-event row or the urgency card; this tab surfaces both directly,
 * across every live event at once, not just the soonest one.
 *
 * Deliberately thin: full search/filter/refund stays on the existing
 * app/creator/attendees.tsx stack screen (doc 100 P0 #1's real surface,
 * financial actions live there and only there). This tab is the at-a-glance
 * list of "which of my events have people, and how do I get to the door
 * scanner", one tap from each into that full screen.
 */

import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Redirect, useRouter } from 'expo-router';
import { useQuery, useQueries } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { ChevronRight, Plus, ScanLine } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { EventAction, EventSpacing, EventSurface, EventType } from '../../constants/EventDesign';
import { FontSizes, LineHeights } from '../../constants/Typography';
import { getCreatorAccess, getCreatorEvents, canManageEvents, creatorLandingRoute, type CommunityEventRow } from '../../lib/creatorMode';
import { getEventAttendees, countAttendees } from '../../lib/ticketAttendees';
import { formatEventDateLA } from '../../lib/laDate';
import { inventoryLabel } from '../../lib/organizerHome';
import { getTiers } from '../../lib/ticketing';
import { sumTierCapacity } from '../../lib/organizerHome';
import { hapticLight } from '../../lib/haptics';
import { supabase } from '../../lib/supabase';

export default function AttendeesTabScreen() {
  const router = useRouter();

  const { data: access } = useQuery({ queryKey: ['creator-access'], queryFn: getCreatorAccess });
  const { data: events = [], isLoading } = useQuery({
    queryKey: ['creator-events-tab', access?.ledCommunities.map((c) => c.id).join(',')],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      return getCreatorEvents((access?.ledCommunities ?? []).map((c) => c.id), user.id);
    },
    enabled: access != null,
  });

  // soonest first, live only -- a draft or past event has no door to work
  const liveEvents = useMemo(
    () =>
      events
        .filter((e): e is CommunityEventRow & { event_date: string } => e.status === 'Live' && !!e.event_date)
        .sort((a, b) => (a.event_date < b.event_date ? -1 : a.event_date > b.event_date ? 1 : 0)),
    [events],
  );

  const attendeeQueries = useQueries({
    queries: liveEvents.map((e) => ({
      queryKey: ['event-attendees', e.id],
      queryFn: () => getEventAttendees(e.id),
      staleTime: 10_000,
    })),
  });
  const tierQueries = useQueries({
    queries: liveEvents.map((e) => ({
      queryKey: ['organizer-home-tiers', e.id],
      queryFn: () => getTiers(e.id),
      staleTime: 10_000,
    })),
  });

  if (access && !access.hasEventHostGrant && !canManageEvents(access)) {
    return <Redirect href={creatorLandingRoute(access)} />;
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* LIZ COPY */}
        <Text style={styles.title}>attendees</Text>

        {!isLoading && liveEvents.length === 0 && (
          <View style={styles.emptyCard}>
            {/* LIZ COPY: invitation, matches organizer-home's own empty pattern */}
            <Text style={styles.emptyText}>nothing live yet. once an event is up, who&rsquo;s coming lives here.</Text>
            <TouchableOpacity style={styles.emptyBtn} onPress={() => router.push('/creator/event-form')} activeOpacity={0.85}>
              <Plus size={16} color={EventAction.onPrimary} strokeWidth={2.5} />
              <Text style={styles.emptyBtnText}>put on an event</Text>
            </TouchableOpacity>
          </View>
        )}

        {liveEvents.map((event, i) => {
          const attendees = attendeeQueries[i]?.data ?? [];
          const tiers = tierQueries[i]?.data ?? [];
          const counts = countAttendees(attendees);
          const capacity = sumTierCapacity(tiers);
          return (
            <View key={event.id} style={styles.eventCard}>
              <TouchableOpacity
                style={styles.eventRow}
                onPress={() => router.push(`/creator/attendees?id=${event.id}` as never)}
                activeOpacity={0.85}
              >
                <EventThumb imageUrl={event.image_url} title={event.title} />
                <View style={styles.eventBody}>
                  <Text style={styles.eventTitle} numberOfLines={1}>{event.title}</Text>
                  <Text style={styles.eventMeta} numberOfLines={1}>{formatEventDateLA(event.event_date)}</Text>
                  <Text style={styles.eventInventory}>{inventoryLabel(counts.sold, capacity)}</Text>
                </View>
                <ChevronRight size={18} color={Colors.tertiary} strokeWidth={2} />
              </TouchableOpacity>
              <View style={styles.eventDivider} />
              <TouchableOpacity
                style={styles.doorRow}
                onPress={() => { hapticLight(); router.push(`/creator/check-in?id=${event.id}` as never); }}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel={`Check in for ${event.title}`}
              >
                <ScanLine size={17} color={EventAction.primary} strokeWidth={2} />
                {/* LIZ COPY */}
                <Text style={styles.doorText}>check in</Text>
                <Text style={styles.doorCount}>{counts.checkedIn} checked in</Text>
              </TouchableOpacity>
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

function EventThumb({ imageUrl, title }: { imageUrl: string | null; title: string }) {
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

const THUMB_SIZE = 48;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: EventSurface.base },
  content: { padding: EventSpacing.md, gap: EventSpacing.sm },
  title: {
    fontFamily: EventType.display,
    fontSize: FontSizes.displayLG,
    lineHeight: LineHeights.displayLG,
    color: Colors.darkWarm,
    marginBottom: EventSpacing.xs,
  },
  emptyCard: {
    backgroundColor: EventSurface.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.borderWarm,
    padding: EventSpacing.md,
    gap: EventSpacing.sm,
  },
  emptyText: { fontFamily: EventType.body, fontSize: FontSizes.bodyMD, lineHeight: LineHeights.bodyMD, color: Colors.secondary },
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

  eventCard: {
    backgroundColor: EventSurface.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.borderWarm,
    overflow: 'hidden',
  },
  eventRow: { flexDirection: 'row', alignItems: 'center', gap: EventSpacing.sm, padding: EventSpacing.md },
  eventBody: { flex: 1, gap: 2 },
  eventTitle: { fontFamily: EventType.bodyBold, fontSize: FontSizes.bodyMD, color: Colors.darkWarm },
  eventMeta: { fontFamily: EventType.body, fontSize: FontSizes.bodySM, color: Colors.secondary },
  eventInventory: { fontFamily: EventType.bodyMedium, fontSize: FontSizes.bodySM, color: Colors.darkWarm, marginTop: 2 },
  thumb: { width: THUMB_SIZE, height: THUMB_SIZE, borderRadius: 10 },
  thumbFallback: { backgroundColor: EventAction.soft, alignItems: 'center', justifyContent: 'center' },
  thumbLetter: { fontFamily: EventType.display, fontSize: FontSizes.bodyLG, color: EventAction.primary },
  eventDivider: { height: 1, backgroundColor: Colors.borderWarm },
  doorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: EventSpacing.md,
    paddingVertical: 12,
    minHeight: 44,
  },
  doorText: { flex: 1, fontFamily: EventType.bodyMedium, fontSize: FontSizes.bodySM, color: EventAction.primary },
  doorCount: { fontFamily: EventType.body, fontSize: FontSizes.caption, color: Colors.tertiary },
});
