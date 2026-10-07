import {useCreatorPageScope} from '../../hooks/useCreatorPageScope';
import {useCreatorPageRead} from '../../hooks/useCreatorPageRead';
import {listCreatorEventTemplates,deleteCreatorEventTemplate,creatorTemplateRoute,type PageEventLibraryTemplate} from '../../lib/creatorPageEventTemplateLibrary';
import type {CreatorPageScope} from '../../lib/creatorPageReview';
import { EventMediaImage } from '../../components/events/EventMediaImage';
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

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Plus, X, ArrowUpRight, FileText, Ticket, Users, ScanLine, Wallet, RotateCcw } from 'lucide-react-native';
import Colors, { CreatorSurfaceColors } from '../../constants/Colors';
import { type AfterglowFontFamilies, FontSizes, LineHeights } from '../../constants/Typography';
import { getCreatorAccess, getCreatorEvents, type CommunityEventRow } from '../../lib/creatorMode';
import { deleteEventTemplate, listEventTemplates, type EventTemplate } from '../../lib/creatorEvents';
import { deriveEventState, hasUnpublishedTickets, needsAttention, pickNextUpcomingEvent, type EventState } from '../../lib/organizerHome';
import { formatEventDateLA } from '../../lib/laDate';
import { hapticLight } from '../../lib/haptics';
import { supabase } from '../../lib/supabase';
import { CREATOR_PAGES_ENABLED, EVENT_SUMMARY_ENABLED } from '../../constants/FeatureFlags';
import { useLedCommunity } from '../../lib/selectedCommunity';
import { eventBelongsToWorkspace, useWorkspace } from '../../lib/workspaceContext';
import { useAfterglowFonts } from '../../hooks/useAfterglowFonts';
import { CreatorActionFill } from '../../components/creator/CreatorActionFill';
import { WorkspaceSwitcher } from '../../components/creator/WorkspaceSwitcher';
import { CommunitySwitcher } from '../../components/creator/CommunitySwitcher';

type Segment = 'attention' | 'next' | 'drafts' | 'later' | 'past' | 'templates';

const SEGMENTS: { key: Segment; label: string }[] = [
  // LIZ COPY: segment labels
  { key: 'attention', label: 'Needs attention' },
  { key: 'next', label: 'Next event' },
  { key: 'drafts', label: 'Drafts' },
  { key: 'later', label: 'Other events' },
  { key: 'past', label: 'Past' },
  { key: 'templates', label: 'Templates' },
];

// LIZ COPY: the per-segment empty states, invitations not absences
const EMPTY_HINTS: Record<Segment, string> = {
  attention: 'Nothing needs your attention right now.',
  next: 'No next event here yet. Create one, or check Needs attention.',
  drafts: 'Unpublished events you can keep working on appear here.',
  later: 'No other events here yet.',
  past: 'Completed, cancelled and archived events stay here.',
  templates: 'Save an event as a template to use it again.',
};

// LIZ COPY: why a card landed in "needs attention"
function attentionReason(status: string, state: EventState): string {
  if (status === 'Draft') return 'still a draft, past its date';
  if (state === 'ended') return "this happened — mark it completed or cancelled";
  return "starts soon, nobody's said they're going yet";
}

function PosterThumb({ eventId, imageUrl, title }: { eventId: string; imageUrl: string | null; title: string }) {
  const { fonts } = useAfterglowFonts(true, 'creator');
  const styles = useMemo(() => createStyles(fonts), [fonts]);
  const [brokenReference, setBrokenReference] = useState<string | null>(null);
  if (imageUrl && brokenReference !== imageUrl) {
    return (
      <EventMediaImage
        eventId={eventId} reference={imageUrl}
        style={styles.thumb}
        contentFit="cover"
        onError={() => setBrokenReference(imageUrl)}
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
  const { width, fontScale } = useWindowDimensions();
  const singleColumnActions = width < 360 || fontScale > 1.2;
  const { fonts } = useAfterglowFonts(true, 'creator');
  const styles = useMemo(() => createStyles(fonts), [fonts]);
  const router = useRouter();
  const queryClient = useQueryClient();
  const [segment, setSegment] = useState<Segment>('attention');
  const { data: access } = useQuery({ queryKey: ['creator-access'], queryFn: getCreatorAccess });
  const workspace = useWorkspace(access);
  const community = useLedCommunity(access);

  const eventsQuery = useQuery({
    queryKey: ['creator-events-tab', workspace, community?.id],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      return getCreatorEvents(workspace === 'community' && community ? [community.id] : [], user.id);
    },
    enabled: access != null && workspace != null,
  });
  const { data: allEvents = [], refetch, isRefetching } = eventsQuery;
  const events = allEvents.filter((event) =>
    eventBelongsToWorkspace(event, workspace, community?.id ?? null),
  );

  const {scope: templateAccountScope,account: templateAccount} = useCreatorPageScope('creator-template-library');
  const templateEpoch = useRef(0);
  const [templateVisit,setTemplateVisit] = useState({active: AppState.currentState === 'active',epoch: 0});
  useEffect(() => {
    if (!CREATOR_PAGES_ENABLED) return;
    const listener = AppState.addEventListener('change', next => {
      templateEpoch.current += 1; setTemplateVisit({active: next === 'active',epoch: templateEpoch.current});
    });
    return () => listener.remove();
  }, []);
  const templateScope = useMemo<CreatorPageScope | null>(() => templateAccountScope && templateVisit.active ? {
    userId: templateAccountScope.userId,
    isCurrent: () => templateAccountScope.isCurrent() && AppState.currentState === 'active' && templateVisit.epoch === templateEpoch.current,
  } : null, [templateAccountScope,templateVisit]);
  const readTemplates = useCallback((owned: CreatorPageScope) => listCreatorEventTemplates(owned), []);
  const pageTemplates = useCreatorPageRead(CREATOR_PAGES_ENABLED ? templateScope : null, readTemplates);
  const { data: ordinaryTemplates = [] } = useQuery({
    queryKey: ['event-templates'],
    queryFn: listEventTemplates,
    enabled: !CREATOR_PAGES_ENABLED,
  });
  const templates: (EventTemplate | PageEventLibraryTemplate)[] = CREATOR_PAGES_ENABLED
    ? templateScope?.isCurrent() && !pageTemplates.loading && !pageTemplates.error ? pageTemplates.data ?? [] : []
    : ordinaryTemplates;
  const removeTemplate = useMutation({
    mutationFn: (template: EventTemplate | PageEventLibraryTemplate) => {
      if (!CREATOR_PAGES_ENABLED) return deleteEventTemplate(template.id);
      if (!templateScope?.isCurrent() || !('user_id' in template)) throw new Error('Check the current template library.');
      return deleteCreatorEventTemplate(template, templateScope);
    },
    onSettled: () => { queryClient.invalidateQueries({ queryKey: ['event-templates'] }); if (CREATOR_PAGES_ENABLED) void pageTemplates.refresh().catch(() => undefined); },
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
    const manageRoute = opts?.draft
      ? `/creator/event-form?id=${e.id}`
      : EVENT_SUMMARY_ENABLED
        ? `/creator/event-summary?id=${e.id}`
        : `/creator/attendees?id=${e.id}`;
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
        onPress={() => router.push(manageRoute as never)}
        activeOpacity={0.85}
        accessible={false}
      >
        <PosterThumb eventId={e.id} imageUrl={e.image_url} title={e.title} />
      </TouchableOpacity>
      <View style={styles.cardBody}>
        <TouchableOpacity
          onPress={() => router.push(manageRoute as never)}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={`${e.title}${e.event_date ? `, ${formatEventDateLA(e.event_date)}` : ''}`}
          accessibilityHint={
            opts?.draft
              ? 'Keep shaping this draft'
              : EVENT_SUMMARY_ENABLED
                ? 'Open this event summary'
                : 'Open attendees for this event'
          }
        >
          <View style={styles.cardTitleRow}>
            <Text style={styles.cardTitle}>{e.title}</Text>
            {!!e.community_id && (
              // inventory C-17: the spec requires every community-hosted
              // event to carry this label wherever it's listed
              <View style={styles.communityBadge}>
                {/* LIZ COPY */}
                <Text style={styles.communityBadgeText}>community</Text>
              </View>
            )}
          </View>
          <Text style={styles.cardMeta}>
            {opts?.draft
              ? /* LIZ COPY */ `Draft${e.event_date ? ` · ${formatEventDateLA(e.event_date)}` : ''}`
              : opts?.past
                ? `${e.status.toLowerCase()}${e.event_date ? ` · ${formatEventDateLA(e.event_date)}` : ''}`
                : [
                    formatEventDateLA(e.event_date ?? ''),
                    e.venue,
                    // LIZ COPY: only worth a word when it changes what to do.
                    // Audit finding (75-threshold spec item 2): a "scheduled"
                    // event with tiers that were set up but never turned on
                    // read identically to one with no tickets at all -- this
                    // is the third case that closes that gap.
                    state === 'sold_out'
                      ? 'sold out'
                      : state === 'on_sale'
                        ? 'on sale'
                        : hasUnpublishedTickets(e.tiers)
                          ? 'tickets not on sale yet'
                          : null,
                  ].filter(Boolean).join(' · ')}
          </Text>
          {!!e.public_name && !opts?.draft && (
            <Text style={styles.cardByline}>put on by {e.public_name}</Text>
          )}
          {opts?.attention && (
            <Text style={styles.cardAttentionReason}>
              {attentionReason(e.status, state)}
            </Text>
          )}
          {!opts?.draft && !opts?.past && e.roomArchived === true && (
            // C-24's room auto-closes ~48h after start; this is the only
            // signal of that on the events list itself
            <Text style={styles.cardByline}>chat closed</Text>
          )}
        </TouchableOpacity>
      </View>
        {opts?.past ? (
          <TouchableOpacity
            style={[styles.cardActionTarget, singleColumnActions && styles.cardActionFull]}
            onPress={() => router.push(`/creator/event-form?duplicateFrom=${e.id}` as never)}
            accessibilityRole="button"
            accessibilityLabel={`Put ${e.title} on again`}
          >
            {/* LIZ COPY: duplicate = same event, fresh date */}
            <RotateCcw size={16} color={Colors.terracotta} accessible={false} /><Text style={styles.cardAction}>Put it on again</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.cardActionRow}>
            {/* LIZ COPY -- decorative label, not itself interactive; the
                real "manage" affordance is the title/meta region above */}
            {opts?.draft && <Text style={styles.cardActionQuiet}>keep shaping it</Text>}
            {EVENT_SUMMARY_ENABLED && !opts?.draft && (
              <TouchableOpacity
            style={[styles.cardActionTarget, styles.cardActionSummary]}
                onPress={() => router.push(`/creator/event-summary?id=${e.id}` as never)}
                accessibilityRole="button"
                accessibilityLabel={`Summary for ${e.title}`}
              >
                {/* copy to the taste gate */}
                <FileText size={18} color={Colors.terracotta} accessible={false} /><Text style={[styles.cardAction, styles.cardActionSummaryLabel]}>Summary</Text><ArrowUpRight size={16} color={Colors.terracotta} accessible={false} />
              </TouchableOpacity>
            )}
            <TouchableOpacity
            style={[styles.cardActionTarget, singleColumnActions && styles.cardActionFull]}
              onPress={() => router.push(`/creator/tickets?id=${e.id}` as never)}
              accessibilityRole="button"
              accessibilityLabel={`Tickets for ${e.title}`}
            >
              {/* copy to the taste gate (launch sprint 7-21) */}
              <Ticket size={16} color={Colors.terracotta} accessible={false} /><Text style={styles.cardAction}>Tickets</Text>
            </TouchableOpacity>
            {!opts?.draft && (
              <>
                <TouchableOpacity
            style={[styles.cardActionTarget, singleColumnActions && styles.cardActionFull]}
                  onPress={() => router.push(`/creator/attendees?id=${e.id}` as never)}
                  accessibilityRole="button"
                  accessibilityLabel={`Who's coming to ${e.title}`}
                >
                  {/* copy to the taste gate (spec 100) */}
                  <Users size={16} color={Colors.terracotta} accessible={false} /><Text style={styles.cardAction}>Who's coming</Text>
                </TouchableOpacity>
                <TouchableOpacity
            style={[styles.cardActionTarget, singleColumnActions && styles.cardActionFull]}
                  onPress={() => router.push(`/creator/check-in?id=${e.id}` as never)}
                  accessibilityRole="button"
                  accessibilityLabel={`Check in for ${e.title}`}
                >
                  {/* copy to the taste gate (spec 100 P0 #5). O-09: was "at the door" */}
                  <ScanLine size={16} color={Colors.terracotta} accessible={false} /><Text style={styles.cardAction}>Check in</Text>
                </TouchableOpacity>
                {EVENT_SUMMARY_ENABLED && (
                  <TouchableOpacity
            style={[styles.cardActionTarget, singleColumnActions && styles.cardActionFull]}
                    onPress={() => router.push(`/creator/event-money?id=${e.id}` as never)}
                    accessibilityRole="button"
                    accessibilityLabel={`Money for ${e.title}`}
                  >
                    {/* copy to the taste gate (Build 35 Screen 07) */}
                    <Wallet size={16} color={Colors.terracotta} accessible={false} /><Text style={styles.cardAction}>Money</Text>
                  </TouchableOpacity>
                )}
              </>
            )}
          </View>
        )}
    </View>
    );
  };

  const segmentBody = () => {
    if (segment !== 'templates' && eventsQuery.isPending) return <Text style={styles.empty} accessibilityLiveRegion="polite">Loading your events…</Text>;
    if (segment !== 'templates' && eventsQuery.isError && events.length === 0) return null;
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
        if (CREATOR_PAGES_ENABLED && (templateAccount.isLoading || pageTemplates.loading)) return <Text style={styles.empty}>Checking your templates…</Text>;
        if (CREATOR_PAGES_ENABLED && (!templateScope?.isCurrent() || templateAccount.error || pageTemplates.error)) return <View>
          <Text accessibilityRole="alert" style={styles.empty}>Couldn’t load your templates. Check this account and your page access, then try again.</Text>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Check template library" onPress={() => void (templateAccount.error ? templateAccount.retry() : pageTemplates.refresh()).catch(() => undefined)}><Text style={styles.empty}>Check templates</Text></TouchableOpacity>
        </View>;
        // S-04: same nested-touchable fix as renderEventCard above -- the
        // outer used to be one TouchableOpacity, silently swallowing the
        // delete "X" from screen readers.
        return templates.length > 0 ? (
          <>{CREATOR_PAGES_ENABLED && removeTemplate.isError && <Text accessibilityRole="alert" style={styles.empty}>Couldn’t confirm that deletion. Check your templates before trying again.</Text>}{templates.map((t) => (
            <View key={t.id} style={styles.card}>
              <TouchableOpacity
                style={styles.templateTapArea}
                onPress={() => { if (!CREATOR_PAGES_ENABLED || templateScope?.isCurrent()) router.push(creatorTemplateRoute(t) as never); }}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel={t.name}
                accessibilityHint={'source_page_id' in t && t.source_page_id ? 'Prepare a private event draft from this template' : 'Tap to put it on'}
              >
                <PosterThumb eventId={'source_event_id' in t ? t.source_event_id ?? '' : ''} imageUrl={t.fields.image_url || null} title={t.name} />
                <View style={styles.cardBody}>
                  <Text style={styles.cardTitle}>{t.name}</Text>
                  {/* LIZ COPY */}
                  <Text style={styles.cardMeta}>{'source_page_id' in t && t.source_page_id ? 'prepare a private event draft' : 'tap to put it on'}</Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.templateDelete}
                onPress={() => removeTemplate.mutate(t)}
                disabled={removeTemplate.isPending}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={`Delete template: ${t.name}`}
              >
                <X size={16} color={Colors.tertiary} strokeWidth={2.5} />
              </TouchableOpacity>
            </View>
          ))}</>
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
        <Text style={styles.title}>Events</Text>
        <WorkspaceSwitcher access={access} stayOnEvents />
        {workspace === 'community' && <CommunitySwitcher access={access} />}

        <TouchableOpacity
          style={styles.postBtn}
          onPress={() => router.push('/creator/event-form')}
          accessibilityRole="button"
          accessibilityLabel="New event"
        >
          <CreatorActionFill />
          <View style={styles.postBtnContent}>
            <Plus size={16} color={Colors.white} strokeWidth={2.5} />
            <Text style={styles.postBtnText}>New event</Text>
          </View>
        </TouchableOpacity>

        {/* Six labels cannot stay readable in one compressed phone-width
            row. Keep the underline-tab pattern and let the row scroll. */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.segmentScroll}
          contentContainerStyle={styles.segmentRow}
          accessibilityRole="tablist"
        >
          {SEGMENTS.map((s) => (
            <TouchableOpacity
              key={s.key}
              style={styles.segment}
              onPress={() => { hapticLight(); setSegment(s.key); }}
              accessibilityRole="tab"
              accessibilityLabel={s.label}
              aria-selected={segment === s.key}
              accessibilityState={{ selected: segment === s.key }}
            >
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.85}
                style={[styles.segmentText, segment === s.key && styles.segmentTextOn]}
              >
                {s.label}
              </Text>
              <View style={[styles.segmentUnderline, segment === s.key && styles.segmentUnderlineOn]} />
            </TouchableOpacity>
          ))}
        </ScrollView>

        {segment !== 'templates' && eventsQuery.isError && <View style={styles.readState} accessibilityLiveRegion="polite">
          <Text style={styles.cardTitle}>Events unavailable</Text>
          <Text style={styles.cardMeta}>{events.length ? 'Showing saved events. Retry to check for changes.' : 'Your events couldn’t be loaded. Try again.'}</Text>
          <TouchableOpacity style={styles.retry} accessibilityRole="button" accessibilityLabel="Retry events" disabled={eventsQuery.isFetching} onPress={() => void refetch()}>
            <Text style={styles.cardAction}>{eventsQuery.isFetching ? 'Checking…' : 'Retry'}</Text>
          </TouchableOpacity>
        </View>}
        {segment === 'next' && next && <Text style={styles.cardMeta}>Your next scheduled event. Events needing a review appear in Needs attention.</Text>}
        {segment === 'later' && later.length > 0 && <Text style={styles.cardMeta}>Your other events, including any without a date.</Text>}
        {segmentBody()}
      </ScrollView>
    </SafeAreaView>
  );
}

const THUMB_SIZE = 64;
const UNDERLINE_HEIGHT = 2.5;

function createStyles(fonts: AfterglowFontFamilies) { return StyleSheet.create({
  segmentScroll: { flexGrow: 0, flexShrink: 0 },
  postBtnContent: { zIndex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  readState: { paddingVertical: 12, gap: 4 },
  retry: { minHeight: 44, minWidth: 44, alignSelf: 'flex-start', justifyContent: 'center' },
  container: { flex: 1, backgroundColor: Colors.parchment },
  content: { padding: 20, gap: 10 },
  kicker: {
    fontFamily: fonts.semibold,
    fontSize: FontSizes.caption,
    color: Colors.terracotta,
    letterSpacing: 1.5,
  },
  title: {
    fontFamily: fonts.display,
    fontSize: FontSizes.displayLG,
    lineHeight: LineHeights.displayLG,
    color: Colors.darkWarm,
    marginBottom: 4,
  },
  postBtn: {
    minHeight: 44, overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: Colors.terracotta,
    borderRadius: 999,
    paddingVertical: 12,
    marginBottom: 4,
  },
  postBtnText: { fontFamily: fonts.semibold, fontSize: FontSizes.bodyMD, color: Colors.white },
  segmentRow: { flexDirection: 'row', gap: 8, paddingRight: 20, marginBottom: 6 },
  // S-04: paddingVertical was 8 (roughly a 30pt tap target with this text
  // size); 12 brings the real tap area near the 44pt minimum without
  // changing the tab row's proportions much.
  segment: { flexShrink: 0, minHeight: 44, alignItems: 'center', paddingHorizontal: 10, paddingVertical: 12 },
  segmentText: { fontFamily: fonts.medium, fontSize: FontSizes.bodySM, color: Colors.warmGray },
  segmentTextOn: { color: Colors.darkWarm, fontFamily: fonts.semibold },
  segmentUnderline: { height: UNDERLINE_HEIGHT, alignSelf: 'stretch', marginTop: 6, backgroundColor: 'transparent' },
  segmentUnderlineOn: { backgroundColor: Colors.terracotta },
  card: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
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
  templateDelete: { width: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  templateTapArea: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  thumb: { width: THUMB_SIZE, height: THUMB_SIZE, borderRadius: 12 },
  thumbFallback: { backgroundColor: Colors.accentSubtle, alignItems: 'center', justifyContent: 'center' },
  thumbLetter: { fontFamily: fonts.display, fontSize: FontSizes.displaySM, color: Colors.terracotta },
  cardBody: { flex: 1, minWidth: 0 },
  cardTitleRow: { alignItems: 'flex-start', gap: 4 },
  cardTitle: { fontFamily: fonts.semibold, fontSize: FontSizes.bodyMD, lineHeight: LineHeights.bodyMD, color: Colors.darkWarm, marginBottom: 2, flexShrink: 1 },
  communityBadge: {
    backgroundColor: Colors.accentSubtle,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  communityBadgeText: {
    fontFamily: fonts.semibold,
    fontSize: FontSizes.micro,
    color: Colors.terracotta,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  cardMeta: { fontFamily: fonts.regular, fontSize: FontSizes.bodySM, lineHeight: LineHeights.bodySM, color: Colors.secondary },
  cardByline: { fontFamily: fonts.medium, fontSize: FontSizes.caption, color: Colors.tertiary, marginTop: 2 },
  cardAttentionReason: { fontFamily: fonts.medium, fontSize: FontSizes.caption, color: Colors.terracotta, marginTop: 2 },
  cardAction: {
    fontFamily: fonts.medium,
    fontSize: FontSizes.bodySM,
    color: Colors.darkWarm,
  },
  cardActionQuiet: {
    fontFamily: fonts.medium,
    fontSize: FontSizes.caption,
    color: Colors.tertiary,
    marginTop: 6,
  },
  cardActionTarget: {
    flexBasis: '47%', flexGrow: 1, minHeight: 46, minWidth: 44,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start', gap: 8,
    paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.cardBg,
    shadowColor: Colors.darkWarm, shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 2,
  },
  cardActionFull: { flexBasis: '100%' },
  cardActionSummary: { flexBasis: '100%', backgroundColor: Colors.parchment, borderColor: CreatorSurfaceColors.goldEdge },
  cardActionSummaryLabel: { flex: 1 },
  cardActionRow: { flexBasis: '100%', flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  empty: { fontFamily: fonts.regular, fontSize: FontSizes.bodyMD, color: Colors.secondary, marginTop: 8 },
});

}
