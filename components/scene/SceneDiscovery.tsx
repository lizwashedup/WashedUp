import {eventMatchesCategory} from '../../lib/eventCategories';
import { useSceneCommunities } from '../../hooks/useSceneCommunities';
import { CREATOR_PAGES_ENABLED } from '../../constants/FeatureFlags';
import { usePublicPageScope } from '../../hooks/usePublicPageScope';
/**
 * Scene discovery (doc 10 phase 5, restructured for CTO scope item 01 /
 * design-spec item 02, 2026-08-17): two distinct destinations — Events and
 * Communities — sharing one header and a full-width underline-tab shell
 * (SC-01, the house tab pattern also used in app/(creator)/events.tsx and
 * app/(tabs)/chats/index.tsx). They no longer blend into one feed: the
 * combined rail-on-top-of-feed layout this replaces is gone.
 *
 * Events read as LISTINGS, poster first, marquee title in the display face
 * (locked decision 12); a community event keeps its "community" label
 * wherever it surfaces (SC-02, via eventKickerLabel). Communities is a full
 * vertical browse (SC-03), not a rail teaser — it supersedes the old
 * app/communities "see all" screen as the real browse surface; that route
 * is left in place as a harmless standalone deep link, nothing links to it
 * from here anymore.
 *
 * Selected September discovery direction: independent inline query drafts and
 * applied searches per destination. Category selection and loaded result sets
 * stay intact; applying a search starts at the top, while returning from a
 * detail keeps the mounted destination and its browsing position. Remaining
 * city/date form parity is tracked in the completion checklist.
 *
 * The ScenePage owns release gating. Its events destination can ship while the
 * Communities destination remains hidden behind COMMUNITIES_ENABLED.
 */

import React, { useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SceneSearch } from './SceneSearch';
import { useScenePullRefresh } from './useScenePullRefresh';
import { ScaledText } from '../ScaledText';
import { SceneFilterForm } from './SceneFilterForm';
import { emptySceneFilters, sceneEventMatches, sceneCommunityMatches, sceneFilterCount, compareSceneEventDates, type SceneFilters } from '../../lib/sceneFilters';
import { formatEventDateLA } from '../../lib/laDate';
import { communityFilterOptions } from '../../lib/communityDiscoveryFilters';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import Colors, { CreatorSurfaceColors, SceneDetailColors as Scene } from '../../constants/Colors';
import { LinearGradient } from 'expo-linear-gradient';
import { Fonts, FontSizes, LineHeights } from '../../constants/Typography';
import ProfileButton from '../ProfileButton';
import { hapticLight } from '../../lib/haptics';
import { EVENT_CATEGORIES } from '../../lib/creatorEvents';
import { friendlyError } from '../../lib/friendlyError';
import { EventPoster } from './EventPoster';
import { CommunityCard } from './CommunityCard';
import {
  getSceneEvents,
  type SceneEvent,
} from '../../lib/sceneDiscovery';
import { getLeaderCards } from '../../lib/communityLeader';

type SceneDestination = 'events' | 'communities';

const DESTINATIONS: ReadonlyArray<readonly [SceneDestination, string]> = [
  ['communities', 'communities'],
  ['events', 'events'],
];

// size follows importance: this many lead events render full-size
// Selected Scene composition: two square artwork columns; one at narrow widths or larger text.
function sceneColumnWidth(width: number, fontScale: number, available = width - 40) { return width >= 360 && fontScale <= 1.3 ? (available - 12) / 2 : available; }

export function SceneDiscovery({ communitiesEnabled = false }: { communitiesEnabled?: boolean }) {
  // Communities leads when available; retain Events behind the community gate.
  // Keep mounted tab state so returning preserves searches and scroll position.
  const [destination, setDestination] = useState<SceneDestination>(() =>
    communitiesEnabled ? 'communities' : 'events');
  // SC-01: which destinations have ever been visited this mount, so a
  // switched-away destination stays mounted (display:none) instead of
  // unmounting -- keeps its ScrollView's native scroll offset on return.
  const [visited, setVisited] = useState<Set<SceneDestination>>(() => new Set([destination]));

  return (
    <LinearGradient colors={[Scene.upper, Scene.middle, Scene.lower]} locations={Scene.gradientLocations} style={styles.container}>
    <SafeAreaView style={styles.safe} edges={['top']}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <Text style={styles.headerTitle}>
          The <Text style={styles.headerTitleItalic}>Scene</Text>
        </Text>
        <ProfileButton surface="scene" />
      </View>

      {/* the house underline-tab pattern, full width, two-way split.
          Loading/empty/error inside either destination preserve this shell
          (SC-01). */}
      <View style={styles.destinationRow}>
        {DESTINATIONS.filter(([key]) => key !== 'communities' || communitiesEnabled).map(([key, label]) => {
          const on = destination === key;
          return (
            <TouchableOpacity
              key={key}
              style={styles.destinationTab}
              onPress={() => {
                if (!on) {
                  hapticLight();
                  setDestination(key);
                  setVisited((v) => (v.has(key) ? v : new Set(v).add(key)));
                }
              }}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              aria-selected={on}
              accessibilityLabel={label}
              activeOpacity={0.7}
            >
              {/* selected destination reads terracotta (SC-02); other
                  actions stay warm dark / tertiary */}
              <ScaledText style={[styles.destinationText, on && styles.destinationTextOn]}>{label}</ScaledText>
              <View style={[styles.destinationUnderline, on && styles.destinationUnderlineOn]} />
            </TouchableOpacity>
          );
        })}
      </View>

      {visited.has('events') && (
        <View style={[styles.destinationBody, destination !== 'events' && styles.destinationBodyHidden]}>
          <EventsDestination communitiesEnabled={communitiesEnabled} active={destination === 'events'} />
        </View>
      )}
      {communitiesEnabled && visited.has('communities') && (
        <View style={[styles.destinationBody, destination !== 'communities' && styles.destinationBodyHidden]}>
          <CommunitiesDestination active={destination === 'communities'} />
        </View>
      )}
    </SafeAreaView>
    </LinearGradient>
  );
}

// ─── Events destination (SC-02) ──────────────────────────────────────────

function EventsDestination({ communitiesEnabled, active }: { communitiesEnabled: boolean; active: boolean }) {
  const router = useRouter();
  const { width, fontScale } = useWindowDimensions();
  const [gridWidth, setGridWidth] = useState<number>();
  const [category, setCategory] = useState<string | null>(null);
  const [filters, setFilters] = useState(emptySceneFilters);
  const query = filters.query;
  const [filterOpen, setFilterOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const scroll = useRef<ScrollView>(null);
  const applyQuery = (value: string) => { setFilters(v => ({ ...v, query: value })); scroll.current?.scrollTo({ y: 0, animated: false }); };
  const clearFilters = () => { setDraft(''); setCategory(null); setFilters(emptySceneFilters()); scroll.current?.scrollTo({ y: 0, animated: false }); };
  const { scope: pageScope, account } = usePublicPageScope('scene-events');

  // TODAY item G (8/27): isPending, not isLoading, is what actually gates the
  // false "calendar is filling up" / recruit-card flash below -- isLoading in
  // this query-client major version is isPending && isFetching, so it can go
  // false mid-fetch (e.g. a paused/backgrounded request) while we still have
  // no real data yet. isPending alone stays true for the whole gap. Same
  // pattern already proven correct in (creator)/organizer-home.tsx S-02.
  const eventRead = useQuery({
    queryKey: ['scene-events', communitiesEnabled ? 'all' : 'standalone', ...(CREATOR_PAGES_ENABLED ? [account.epoch, account.viewerId] : [])],
    queryFn: () => getSceneEvents(communitiesEnabled, CREATOR_PAGES_ENABLED ? pageScope! : undefined),
    enabled: !CREATOR_PAGES_ENABLED || !!pageScope && pageScope.isCurrent(),
  });
  const events = CREATOR_PAGES_ENABLED && !pageScope ? [] : eventRead.data ?? [];
  const isPending = CREATOR_PAGES_ENABLED && account.error ? false : eventRead.isPending;
  const isError = eventRead.isError || (CREATOR_PAGES_ENABLED && !!account.error);
  const error = CREATOR_PAGES_ENABLED && account.error ? account.error : eventRead.error;
  const refetch = () => CREATOR_PAGES_ENABLED && account.error ? account.retry() : eventRead.refetch();
  const pullRefresh = useScenePullRefresh(refetch, JSON.stringify([communitiesEnabled, account.epoch, account.viewerId]), active);

  // pilot-era rows carry capitalized categories ('Community'); compare and
  // display on the lowercase side so the chips match every era
  const filtered = events.filter(e => (!category || eventMatchesCategory(e,category)) && sceneEventMatches(e, filters)).sort(compareSceneEventDates);
  const usedCategories = EVENT_CATEGORIES.filter((c) =>
    events.some((e) => eventMatchesCategory(e,c)),
  );

  const cardWidth = sceneColumnWidth(width, fontScale, gridWidth);

  return (
    <ScrollView ref={scroll} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={pullRefresh.refreshing} onRefresh={pullRefresh.onRefresh} tintColor={Scene.text} />
      }
    >
      <SceneSearch kind="events" draft={draft} setDraft={setDraft} onApply={applyQuery} onOpenFilters={() => setFilterOpen(true)} filterCount={sceneFilterCount(filters)} />
      <AppliedFilterSummary filters={filters} />
      {filterOpen && <SceneFilterForm kind="events" applied={filters} onCancel={() => setFilterOpen(false)} onApply={value => {
        setFilters(value); setDraft(value.query); setFilterOpen(false); scroll.current?.scrollTo({ y: 0, animated: false });
      }} />}
      {/* the category axis only — community-vs-standalone lives on each
          card's own kicker label (eventKickerLabel), never here */}
      {usedCategories.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {[null, ...usedCategories].map((c) => (
            <TouchableOpacity
              key={c ?? 'all'} accessibilityRole="button" accessibilityLabel={`Category: ${c ?? 'all'}`} accessibilityState={{ selected: category === c }}
              style={[styles.chip, category === c && styles.chipOn]}
              onPress={() => { hapticLight(); setCategory(c); scroll.current?.scrollTo({ y: 0, animated: false }); }}
            >
              <Text style={[styles.chipText, category === c && styles.chipTextOn]}>{c ?? 'all'}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      <Text style={styles.sectionLabel}>{sceneFilterCount(filters) || category ? 'matching events' : 'happening in LA'}</Text>
      {isPending ? (
        // Real content hasn't resolved yet -- show a plain loading state,
        // never the "calendar is filling up" empty-state copy or the
        // recruit card below, both of which claim to know there's nothing
        // here when we simply haven't asked yet (TODAY item G, 8/27).
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={Scene.text} />
        </View>
      ) : (<>
      {isError && (
        <View style={styles.errorWrap}>
          <Text style={styles.errorText}>
            {friendlyError(error, "couldn't load what's happening. check your connection and try again.")}
          </Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => refetch()} accessibilityRole="button" accessibilityLabel="try again">
            <Text style={styles.retryBtnText}>try again</Text>
          </TouchableOpacity>
        </View>
      )}
      {filtered.length === 0 ? (!isError && (
        sceneFilterCount(filters) || category ? <View style={styles.emptyResults}>
          <Text style={styles.emptyLine}>Try another search or clear your filters to see what’s happening.</Text>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Clear event filters" style={styles.retryBtn} onPress={clearFilters}><Text style={styles.retryBtnText}>Clear filters</Text></TouchableOpacity>
        </View> : <Text style={styles.emptyLine}>No upcoming events yet.</Text>
      )) : (
        <View style={styles.eventGrid} onLayout={event => setGridWidth(event.nativeEvent.layout.width)}>
          {filtered.map(event => <EventPoster key={event.id} event={event} width={cardWidth} variant="grid"
            onPress={() => router.push(`/event/${event.id}` as never)} />)}
        </View>
      )}

      </>)}
      {!isPending && !isError && <SceneApplicationNotice />}
    </ScrollView>
  );
}

// ─── Communities destination (SC-03) ─────────────────────────────────────

function CommunitiesDestination({ active }: { active: boolean }) {
  const router = useRouter();
  const { width, fontScale } = useWindowDimensions();
  const [gridWidth, setGridWidth] = useState<number>();
  const [filters, setFilters] = useState(emptySceneFilters);
  const query = filters.query;
  const [filterOpen, setFilterOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const scroll = useRef<ScrollView>(null);
  const applyQuery = (value: string) => { setFilters(v => ({ ...v, query: value })); scroll.current?.scrollTo({ y: 0, animated: false }); };
  const clearSearch = () => { setDraft(''); setFilters(emptySceneFilters()); scroll.current?.scrollTo({ y: 0, animated: false }); };

  // isPending (not isLoading), same reasoning as EventsDestination above:
  // it is what actually distinguishes "we haven't asked yet" from "we asked
  // and there are zero communities" -- the second state is what earns the
  // recruit-card invitation below, not the first (TODAY item G, 8/27).
  const { data: communities, identity, isPending, isError, error, refetch } = useSceneCommunities();
  const pullRefresh = useScenePullRefresh(refetch, JSON.stringify(identity), active);
  const communityOptions = communityFilterOptions(communities);
  const filtered = communities.filter(c => sceneCommunityMatches(c, filters));
  const communityIdsKey = communities.map((c) => c.id).sort().join(',');
  const { data: leaderCards = new Map() } = useQuery({
    queryKey: ['leader-cards', communityIdsKey, ...identity],
    queryFn: () => getLeaderCards(communities.map((c) => c.id)),
    enabled: communities.length > 0,
  });

  return (
    <ScrollView ref={scroll} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={pullRefresh.refreshing} onRefresh={pullRefresh.onRefresh} tintColor={Scene.text} />
      }
    >
      <SceneSearch kind="communities" draft={draft} setDraft={setDraft} onApply={applyQuery} onOpenFilters={() => setFilterOpen(true)} filterCount={sceneFilterCount(filters)} />
      <AppliedFilterSummary filters={filters} />
      {filterOpen && <SceneFilterForm key={identity.join(':')} kind="communities" applied={filters} communityOptions={communityOptions} onCancel={() => setFilterOpen(false)} onApply={value => {
        setFilters(previous => ({ ...previous, area: value.area, category: value.category }));
        setFilterOpen(false); scroll.current?.scrollTo({ y: 0, animated: false });
      }} />}
      {isPending ? (
        // Real content hasn't resolved yet -- a plain loading state, never
        // the recruit-card invitation below, which is only earned once we
        // actually know there are zero communities (TODAY item G, 8/27).
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={Scene.text} />
        </View>
      ) : (
        <>
          {isError && (
            <View style={styles.errorWrap}>
              <Text style={styles.errorText}>
                {friendlyError(error, "couldn't load communities. check your connection and try again.")}
              </Text>
              <TouchableOpacity style={styles.retryBtn} onPress={() => refetch()} accessibilityRole="button" accessibilityLabel="try again">
                <Text style={styles.retryBtnText}>try again</Text>
              </TouchableOpacity>
            </View>
          )}

          {filtered.length > 0 && (
            <View style={styles.communitiesList} onLayout={event => setGridWidth(event.nativeEvent.layout.width)}>
              {filtered.map((c) => (
                <CommunityCard
                  key={c.id}
                  community={c}
                  leaderCard={leaderCards.get(c.id) ?? null}
                  width={sceneColumnWidth(width, fontScale, gridWidth)}
                  surface="scene"
                  onPress={() => router.push(`/community/${c.id}` as never)}
                />
              ))}
            </View>
          )}

          {/* THE EMPTY-STATE RULE (Liz, 2026-07-15, carried over from the old
              combined feed): zero ACTIVE communities never shows a bare "no
              communities" line — the recruiting card below is the invitation
              and it always renders, so the destination is never a dead end.
              "Always" means once we know the real state, not during the
              isPending window above. */}
          {!isError && filtered.length === 0 && sceneFilterCount(filters) > 0 && <View style={styles.emptyResults}>
            <Text style={styles.emptyLine}>Try another category or area, or clear your search to find your people.</Text>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Clear community filters" style={styles.retryBtn} onPress={clearSearch}><Text style={styles.retryBtnText}>Clear filters</Text></TouchableOpacity>
          </View>}
          {!isError && <SceneApplicationNotice />}
        </>
      )}
    </ScrollView>
  );
}

function AppliedFilterSummary({ filters }: { filters: SceneFilters }) {
  const parts = [filters.category, filters.area, filters.from ? `From ${formatEventDateLA(filters.from)}` : '', filters.through ? `Through ${formatEventDateLA(filters.through)}` : ''].filter(Boolean);
  return parts.length ? <Text style={styles.filterSummary}>{parts.join(' · ')}</Text> : null;
}

function SceneApplicationNotice() {
  const router = useRouter();
  return (
    <LinearGradient
      colors={[CreatorSurfaceColors.sunsetGoldLight, CreatorSurfaceColors.sunsetGoldMiddle, CreatorSurfaceColors.sunsetGoldWarm]}
      start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
      style={styles.applicationNotice}
    >
      <Text accessibilityRole="header" style={styles.applicationTitle}>Start a community or organization</Text>
      <Text style={styles.applicationBody}>Have a community or club, or put on events? Apply to manage your community or post events through your organization.</Text>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="Apply to be part of Scene"
        activeOpacity={0.85}
        style={styles.applicationButton}
        onPress={() => router.push('/creator/apply' as never)}
      >
        <Text numberOfLines={1} style={styles.applicationButtonText}>Apply</Text>
      </TouchableOpacity>
    </LinearGradient>
  );
}

const UNDERLINE_HEIGHT = 2.5;

const styles = StyleSheet.create({
  // Q2 token set (new Scene/Block-B screen): cream, not the legacy parchment
  container: { flex: 1 },
  safe: { flex: 1 },
  eventGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  headerTitle: { fontFamily: Fonts.displayBold, fontSize: FontSizes.displayLG, color: Scene.text },
  headerTitleItalic: { fontFamily: Fonts.display },

  // ── SC-01 destination shell: full-width underline tabs, never pill
  //    bubbles (repo tabs law) ──
  destinationRow: { flexDirection: 'row', paddingHorizontal: 20 },
  destinationTab: { flex: 1, minHeight: 44, alignItems: 'center', paddingVertical: 8 },
  destinationText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Scene.supporting },
  destinationTextOn: { color: Scene.text, fontFamily: Fonts.sansBold },
  destinationUnderline: {
    height: UNDERLINE_HEIGHT,
    alignSelf: 'stretch',
    marginTop: 6,
    borderRadius: 2,
    backgroundColor: 'transparent',
  },
  destinationUnderlineOn: { backgroundColor: Scene.action },
  destinationBody: { flex: 1 },
  destinationBodyHidden: { display: 'none' },
  errorWrap: { alignItems: 'center', paddingVertical: 8, marginBottom: 4, gap: 10 },
  loadingWrap: { alignItems: 'center', paddingVertical: 40 },
  errorText: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Scene.supporting, lineHeight: LineHeights.bodyMD, textAlign: 'center' },
  retryBtn: { minHeight: 44, justifyContent: 'center', borderRadius: 999, borderWidth: 1.5, borderColor: Scene.supporting, paddingHorizontal: 20, paddingVertical: 9 },
  retryBtnText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodySM, color: Scene.text },

  content: { padding: 20, paddingBottom: 60 },
  sectionLabel: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.caption,
    color: Scene.text,
    letterSpacing: 1.5,
    marginBottom: 10,
  },
  communitiesList: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 4 },
  chipRow: { gap: 8, marginBottom: 14 },
  filterSummary: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, lineHeight: LineHeights.bodySM, color: Scene.supporting, marginBottom: 12 },
  emptyResults: { gap: 12, alignItems: 'flex-start', paddingVertical: 12 },
  chip: {
    minHeight: 44, justifyContent: 'center',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Scene.supporting,
    backgroundColor: Scene.lower,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  chipOn: { backgroundColor: Scene.action, borderColor: Scene.action },
  chipText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Scene.text },
  chipTextOn: { color: Scene.actionText },
  emptyLine: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Scene.supporting,
    lineHeight: LineHeights.bodyMD,
  },
  applicationNotice: { borderRadius: 20, padding: 20, gap: 12, marginTop: 24, marginBottom: 20 },
  applicationTitle: { fontFamily: Fonts.displayBold, fontSize: FontSizes.displayMD, lineHeight: LineHeights.displayMD, color: Scene.text },
  applicationBody: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, lineHeight: LineHeights.bodyMD, color: Scene.text },
  applicationButton: { alignSelf: 'flex-start', minHeight: 44, borderRadius: 999, paddingHorizontal: 24, paddingVertical: 12, justifyContent: 'center', backgroundColor: Colors.terracotta },
  applicationButtonText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.white, textAlign: 'center' },
});
