/**
 * Creator mode: events. Slice 0 of the launch design pass (doc 43 track B):
 * SEGMENTED, poster-led cards with the text in its own zone (never over the
 * image), warm header, empty-state hints per segment. Data unchanged:
 * owner-read RLS list plus the batch-15 operator RPCs; tap to manage,
 * "put it on again" only on completed/cancelled.
 *
 * C-16: the original 4 segments (upcoming/drafts/templates/past) are now 6
 * -- needs attention / next / drafts / later / past / templates -- derived
 * from deriveEventState()/needsAttention() (lib/organizerHome.ts) over the
 * batched RSVP/ticket/room data getCreatorEvents() now returns per event.
 * "templates" is a separate data source (saved shells, not events) and is
 * carried forward unchanged rather than folded into the 5 event-state
 * segments.
 */

import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Plus, X } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes, LineHeights } from '../../constants/Typography';
import { getCreatorAccess, getCreatorEvents, type CommunityEventRow } from '../../lib/creatorMode';
import { deleteEventTemplate, listEventTemplates } from '../../lib/creatorEvents';
import { deriveEventState, needsAttention, pickNextUpcomingEvent, type EventState } from '../../lib/organizerHome';
import { formatEventDateLA } from '../../lib/laDate';
import { hapticLight } from '../../lib/haptics';
import { supabase } from '../../lib/supabase';

type Segment = 'attention' | 'next' | 'drafts' | 'later' | 'past' | 'templates';

const SEGMENTS: { key: Segment; label: string }[] = [
  // LIZ COPY: segment labels
  { key: 'attention', label: 'needs attention' },
  { key: 'next', label: 'next' },
  { key: 'drafts', label: 'drafts' },
  { key: 'later', label: 'later' },
  { key: 'past', label: 'past' },
  { key: 'templates', label: 'templates' },
];

// LIZ COPY: the per-segment empty states, invitations not absences
const EMPTY_HINTS: Record<Segment, string> = {
  attention: 'nothing needs a look right now.',
  next: 'nothing lined up next. put one on and it lives here.',
  drafts: 'events you save before publishing land here. only you see them.',
  later: 'nothing further out yet.',
  past: 'completed, cancelled, and archived events settle here.',
  templates: 'save any event as a template and it lives here, ready to put on again.',
};

// LIZ COPY: why a card landed in "needs attention"
function attentionReason(status: string, state: EventState): string {
  if (status === 'Draft') return 'still a draft, past its date';
  if (state === 'ended') return "this happened — mark it completed or cancelled";
  return "starts soon, nobody's said they're going yet";
}

function PosterThumb({ imageUrl, title }: { imageUrl: string | null; title: string }) {
  const [broken, setBroken] = useState(false);
  if (imageUrl && !broken) {
    return (
      <Image
        source={{ uri: imageUrl }}
        style={styles.thumb}
        contentFit="cover"
        onError={() => setBroken(true)}
      />
    );
  }
  return (
    <View style={[styles.thumb, styles.thumbFallback]}>
      <Text style={styles.thumbLetter}>{title.slice(0, 1).toLowerCase()}</Text>
    </View>
  );
}

export default function CreatorEventsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [segment, setSegment] = useState<Segment>('attention');
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

  const { data: templates = [] } = useQuery({
    queryKey: ['event-templates'],
    queryFn: listEventTemplates,
  });
  const removeTemplate = useMutation({
    mutationFn: (id: string) => deleteEventTemplate(id),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['event-templates'] }),
  });

  // C-16: needsAttention takes priority -- an event never appears in both
  // "needs attention" and its state-derived home (next/later/drafts/past).
  const attention = events.filter((e) => needsAttention(e));
  const attentionIds = new Set(attention.map((e) => e.id));
  const drafts = events.filter((e) => !attentionIds.has(e.id) && deriveEventState(e) === 'draft');
  const past = events.filter((e) => {
    if (attentionIds.has(e.id)) return false;
    const s = deriveEventState(e);
    return s === 'ended' || s === 'cancelled' || s === 'archived';
  });
  const upcomingPool = events.filter((e) => {
    if (attentionIds.has(e.id)) return false;
    const s = deriveEventState(e);
    return s === 'scheduled' || s === 'on_sale' || s === 'sold_out' || s === 'live';
  });
  const next = pickNextUpcomingEvent(upcomingPool);
  const later = upcomingPool.filter((e) => e.id !== next?.id);

  const renderEventCard = (
    e: CommunityEventRow,
    opts?: { past?: boolean; draft?: boolean; attention?: boolean },
  ) => {
    const state = deriveEventState(e);
    return (
    // S-04: this card used to be ONE outer TouchableOpacity wrapping the
    // poster, the title/meta text, AND the tickets/who's-coming/check-in
    // links below. A Touchable defaults accessible=true, which merges its
    // whole subtree into a single opaque screen-reader stop -- so every
    // nested action link was silently unreachable by VoiceOver/TalkBack,
    // sighted-only despite looking tappable. Fixed by making the outer a
    // plain View and giving "tap to manage" its own accessible region
    // around just the title/meta text, sibling to the real action links
    // (same visual layout either way: a bare TouchableOpacity adds no box
    // styling of its own).
    <View key={e.id} style={[styles.card, opts?.past && styles.cardPast]}>
      <TouchableOpacity
        onPress={() => router.push(`/creator/event-form?id=${e.id}` as never)}
        activeOpacity={0.85}
        accessible={false}
      >
        <PosterThumb imageUrl={e.image_url} title={e.title} />
      </TouchableOpacity>
      <View style={styles.cardBody}>
        <TouchableOpacity
          onPress={() => router.push(`/creator/event-form?id=${e.id}` as never)}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={`${e.title}${e.event_date ? `, ${formatEventDateLA(e.event_date)}` : ''}`}
          accessibilityHint={opts?.draft ? 'Keep shaping this draft' : 'Manage this event'}
        >
          <View style={styles.cardTitleRow}>
            <Text style={styles.cardTitle} numberOfLines={1}>{e.title}</Text>
            {!!e.community_id && (
              // inventory C-17: the spec requires every community-hosted
              // event to carry this label wherever it's listed
              <View style={styles.communityBadge}>
                {/* LIZ COPY */}
                <Text style={styles.communityBadgeText}>community</Text>
              </View>
            )}
          </View>
          <Text style={styles.cardMeta} numberOfLines={1}>
            {opts?.draft
              ? /* LIZ COPY */ `only you see it${e.event_date ? ` · ${formatEventDateLA(e.event_date)}` : ''}`
              : opts?.past
                ? `${e.status.toLowerCase()}${e.event_date ? ` · ${formatEventDateLA(e.event_date)}` : ''}`
                : [
                    formatEventDateLA(e.event_date ?? ''),
                    e.venue,
                    // LIZ COPY: only worth a word when it changes what to do
                    state === 'sold_out' ? 'sold out' : state === 'on_sale' ? 'on sale' : null,
                  ].filter(Boolean).join(' · ')}
          </Text>
          {!!e.public_name && !opts?.draft && (
            <Text style={styles.cardByline} numberOfLines={1}>put on by {e.public_name}</Text>
          )}
          {opts?.attention && (
            <Text style={styles.cardAttentionReason} numberOfLines={1}>
              {attentionReason(e.status, state)}
            </Text>
          )}
          {!opts?.draft && !opts?.past && e.roomArchived === true && (
            // C-24's room auto-closes ~48h after start; this is the only
            // signal of that on the events list itself
            <Text style={styles.cardByline} numberOfLines={1}>chat closed</Text>
          )}
        </TouchableOpacity>
        {opts?.past ? (
          <TouchableOpacity
            onPress={() => router.push(`/creator/event-form?duplicateFrom=${e.id}` as never)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Put ${e.title} on again`}
          >
            {/* LIZ COPY: duplicate = same event, fresh date */}
            <Text style={styles.cardAction}>put it on again</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.cardActionRow}>
            {/* LIZ COPY -- decorative label, not itself interactive; the
                real "manage" affordance is the title/meta region above */}
            <Text style={styles.cardActionQuiet}>{opts?.draft ? 'keep shaping it' : 'manage'}</Text>
            <TouchableOpacity
              onPress={() => router.push(`/creator/tickets?id=${e.id}` as never)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`Tickets for ${e.title}`}
            >
              {/* copy to the taste gate (launch sprint 7-21) */}
              <Text style={styles.cardAction}>tickets</Text>
            </TouchableOpacity>
            {!opts?.draft && (
              <>
                <TouchableOpacity
                  onPress={() => router.push(`/creator/attendees?id=${e.id}` as never)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`Who's coming to ${e.title}`}
                >
                  {/* copy to the taste gate (spec 100) */}
                  <Text style={styles.cardAction}>who's coming</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => router.push(`/creator/check-in?id=${e.id}` as never)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`Check in for ${e.title}`}
                >
                  {/* copy to the taste gate (spec 100 P0 #5). O-09: was "at the door" */}
                  <Text style={styles.cardAction}>check in</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        )}
      </View>
    </View>
    );
  };

  const segmentBody = () => {
    switch (segment) {
      case 'attention':
        return attention.length > 0
          ? attention.map((e) => renderEventCard(e, { attention: true, draft: e.status === 'Draft' }))
          : <Text style={styles.empty}>{EMPTY_HINTS.attention}</Text>;
      case 'next':
        return next
          ? renderEventCard(next)
          : <Text style={styles.empty}>{EMPTY_HINTS.next}</Text>;
      case 'drafts':
        return drafts.length > 0
          ? drafts.map((e) => renderEventCard(e, { draft: true }))
          : <Text style={styles.empty}>{EMPTY_HINTS.drafts}</Text>;
      case 'later':
        return later.length > 0
          ? later.map((e) => renderEventCard(e))
          : <Text style={styles.empty}>{EMPTY_HINTS.later}</Text>;
      case 'past':
        return past.length > 0
          ? past.map((e) => renderEventCard(e, { past: true }))
          : <Text style={styles.empty}>{EMPTY_HINTS.past}</Text>;
      case 'templates':
        // S-04: same nested-touchable fix as renderEventCard above -- the
        // outer used to be one TouchableOpacity, silently swallowing the
        // delete "X" from screen readers.
        return templates.length > 0 ? (
          templates.map((t) => (
            <View key={t.id} style={styles.card}>
              <TouchableOpacity
                style={styles.templateTapArea}
                onPress={() => router.push(`/creator/event-form?templateId=${t.id}` as never)}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel={t.name}
                accessibilityHint="Tap to put it on"
              >
                <PosterThumb imageUrl={t.fields.image_url || null} title={t.name} />
                <View style={styles.cardBody}>
                  <Text style={styles.cardTitle} numberOfLines={1}>{t.name}</Text>
                  {/* LIZ COPY */}
                  <Text style={styles.cardMeta}>tap to put it on</Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => removeTemplate.mutate(t.id)}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={`Delete template: ${t.name}`}
              >
                <X size={16} color={Colors.tertiary} strokeWidth={2.5} />
              </TouchableOpacity>
            </View>
          ))
        ) : (
          <Text style={styles.empty}>{EMPTY_HINTS.templates}</Text>
        );
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={Colors.terracotta} />}
      >
        {/* LIZ COPY */}
        <Text style={styles.kicker}>creator mode</Text>
        <Text style={styles.title}>events</Text>

        <TouchableOpacity
          style={styles.postBtn}
          onPress={() => router.push('/creator/event-form')}
          accessibilityRole="button"
          accessibilityLabel="Put on an event"
        >
          <Plus size={16} color={Colors.white} strokeWidth={2.5} />
          <Text style={styles.postBtnText}>put on an event</Text>
        </TouchableOpacity>

        {/* the house underline-tab pattern, full width */}
        <View style={styles.segmentRow} accessibilityRole="tablist">
          {SEGMENTS.map((s) => (
            <TouchableOpacity
              key={s.key}
              style={styles.segment}
              onPress={() => { hapticLight(); setSegment(s.key); }}
              accessibilityRole="tab"
              accessibilityLabel={s.label}
              accessibilityState={{ selected: segment === s.key }}
            >
              <Text style={[styles.segmentText, segment === s.key && styles.segmentTextOn]}>
                {s.label}
              </Text>
              <View style={[styles.segmentUnderline, segment === s.key && styles.segmentUnderlineOn]} />
            </TouchableOpacity>
          ))}
        </View>

        {segmentBody()}
      </ScrollView>
    </SafeAreaView>
  );
}

const THUMB_SIZE = 64;
const UNDERLINE_HEIGHT = 2.5;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.parchment },
  content: { padding: 20, gap: 10 },
  kicker: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.caption,
    color: Colors.terracotta,
    letterSpacing: 1.5,
  },
  title: {
    fontFamily: Fonts.display,
    fontSize: FontSizes.displayLG,
    lineHeight: LineHeights.displayLG,
    color: Colors.darkWarm,
    marginBottom: 4,
  },
  postBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: Colors.terracotta,
    borderRadius: 999,
    paddingVertical: 12,
    marginBottom: 4,
  },
  postBtnText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.white },
  segmentRow: { flexDirection: 'row', marginBottom: 6 },
  // S-04: paddingVertical was 8 (roughly a 30pt tap target with this text
  // size); 12 brings the real tap area near the 44pt minimum without
  // changing the tab row's proportions much.
  segment: { flex: 1, alignItems: 'center', paddingVertical: 12 },
  segmentText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.warmGray },
  segmentTextOn: { color: Colors.darkWarm, fontFamily: Fonts.sansBold },
  segmentUnderline: { height: UNDERLINE_HEIGHT, alignSelf: 'stretch', marginTop: 6, backgroundColor: 'transparent' },
  segmentUnderlineOn: { backgroundColor: Colors.terracotta },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 12,
  },
  cardPast: { opacity: 0.7 },
  // S-04: the templates card's tappable region (poster + name), sized to
  // fill the row up to the delete "X" -- same visual slot `cardBody` (flex:
  // 1) held before the nested-touchable accessibility fix split them apart.
  templateTapArea: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  thumb: { width: THUMB_SIZE, height: THUMB_SIZE, borderRadius: 12 },
  thumbFallback: { backgroundColor: Colors.accentSubtle, alignItems: 'center', justifyContent: 'center' },
  thumbLetter: { fontFamily: Fonts.display, fontSize: FontSizes.displaySM, color: Colors.terracotta },
  cardBody: { flex: 1 },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardTitle: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.darkWarm, marginBottom: 2, flexShrink: 1 },
  communityBadge: {
    backgroundColor: Colors.accentSubtle,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  communityBadgeText: {
    fontFamily: Fonts.sansBold,
    fontSize: 10,
    color: Colors.terracotta,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  cardMeta: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.secondary },
  cardByline: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.caption, color: Colors.tertiary, marginTop: 2 },
  cardAttentionReason: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.caption, color: Colors.terracotta, marginTop: 2 },
  cardAction: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.bodySM,
    color: Colors.terracotta,
    marginTop: 6,
  },
  cardActionQuiet: {
    fontFamily: Fonts.sansMedium,
    fontSize: FontSizes.caption,
    color: Colors.tertiary,
    marginTop: 6,
  },
  cardActionRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', gap: 14, rowGap: 8 },
  empty: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.secondary, marginTop: 8 },
});
