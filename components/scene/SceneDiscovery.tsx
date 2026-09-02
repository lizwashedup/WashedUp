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
 * Exact information architecture / search / filter behavior beyond the
 * existing category chips is explicitly an open question in spec item 01
 * ("OPEN_QUESTIONS: Exact information architecture, search/filter
 * behavior...") and the atmosphere-led hero + time-filter treatment in
 * SC-02 is design-pass work under item 10, deferred to Liz's next design
 * pass per that item's own OPEN_QUESTIONS. Not invented here.
 *
 * The ScenePage owns release gating. Its events destination can ship while the
 * Communities destination remains hidden behind COMMUNITIES_ENABLED.
 */

import React, { useState } from 'react';
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
import Colors from '../../constants/Colors';
import { Fonts, FontSizes, LineHeights } from '../../constants/Typography';
import ProfileButton from '../ProfileButton';
import { hapticLight } from '../../lib/haptics';
import { EVENT_CATEGORIES } from '../../lib/creatorEvents';
import { friendlyError } from '../../lib/friendlyError';
import { EventPoster } from './EventPoster';
import { CommunityCard } from './CommunityCard';
import {
  getDiscoverableCommunities,
  getSceneEvents,
  type SceneEvent,
} from '../../lib/sceneDiscovery';
import { getLeaderCards } from '../../lib/communityLeader';

type SceneDestination = 'events' | 'communities';

const DESTINATIONS: ReadonlyArray<readonly [SceneDestination, string]> = [
  ['events', 'events'],
  ['communities', 'communities'],
];

// size follows importance: this many lead events render full-size
const FULL_SIZE_COUNT = 3;

export function SceneDiscovery({ communitiesEnabled = false }: { communitiesEnabled?: boolean }) {
  // SC-01: one shared shell, two destination states, retained selection —
  // plain component state is enough (the tab navigator keeps Scene mounted
  // across a bottom-tab switch); Events leads by default (item 04/07: "join
  // event is primary" is the general framing throughout the CTO scope).
  const [destination, setDestination] = useState<SceneDestination>('events');
  // SC-01: which destinations have ever been visited this mount, so a
  // switched-away destination stays mounted (display:none) instead of
  // unmounting -- keeps its ScrollView's native scroll offset on return.
  const [visited, setVisited] = useState<Set<SceneDestination>>(() => new Set([destination]));

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>
          The <Text style={styles.headerTitleItalic}>Scene</Text>
        </Text>
        <ProfileButton />
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
              accessibilityLabel={label}
              activeOpacity={0.7}
            >
              {/* selected destination reads terracotta (SC-02); other
                  actions stay warm dark / tertiary */}
              <Text style={[styles.destinationText, on && styles.destinationTextOn]}>{label}</Text>
              <View style={[styles.destinationUnderline, on && styles.destinationUnderlineOn]} />
            </TouchableOpacity>
          );
        })}
      </View>

      {visited.has('events') && (
        <View style={[styles.destinationBody, destination !== 'events' && styles.destinationBodyHidden]}>
          <EventsDestination communitiesEnabled={communitiesEnabled} />
        </View>
      )}
      {communitiesEnabled && visited.has('communities') && (
        <View style={[styles.destinationBody, destination !== 'communities' && styles.destinationBodyHidden]}>
          <CommunitiesDestination />
        </View>
      )}
    </SafeAreaView>
  );
}

// ─── Events destination (SC-02) ──────────────────────────────────────────

function EventsDestination({ communitiesEnabled }: { communitiesEnabled: boolean }) {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const [category, setCategory] = useState<string | null>(null);

  // TODAY item G (8/27): isPending, not isLoading, is what actually gates the
  // false "calendar is filling up" / recruit-card flash below -- isLoading in
  // this query-client major version is isPending && isFetching, so it can go
  // false mid-fetch (e.g. a paused/backgrounded request) while we still have
  // no real data yet. isPending alone stays true for the whole gap. Same
  // pattern already proven correct in (creator)/organizer-home.tsx S-02.
  const { data: events = [], isPending, isError, error, refetch, isRefetching } = useQuery({
    queryKey: ['scene-events', communitiesEnabled ? 'all' : 'standalone'],
    queryFn: () => getSceneEvents(communitiesEnabled),
  });

  // pilot-era rows carry capitalized categories ('Community'); compare and
  // display on the lowercase side so the chips match every era
  const filtered = category
    ? events.filter((e) => e.category?.toLowerCase() === category)
    : events;
  const usedCategories = EVENT_CATEGORIES.filter((c) =>
    events.some((e) => e.category?.toLowerCase() === c),
  );

  const renderFeatured = (e: SceneEvent) => (
    <EventPoster key={e.id} event={e} width={width} onPress={() => router.push(`/event/${e.id}` as never)} />
  );
  const renderCompact = (e: SceneEvent) => (
    <EventPoster
      key={e.id}
      event={e}
      width={width}
      variant="compact"
      onPress={() => router.push(`/event/${e.id}` as never)}
    />
  );

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={isRefetching} onRefresh={() => refetch()} tintColor={Colors.terracotta} />
      }
    >
      {/* the category axis only — community-vs-standalone lives on each
          card's own kicker label (eventKickerLabel), never here */}
      {usedCategories.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {[null, ...usedCategories].map((c) => (
            <TouchableOpacity
              key={c ?? 'all'}
              style={[styles.chip, category === c && styles.chipOn]}
              onPress={() => { hapticLight(); setCategory(c); }}
            >
              <Text style={[styles.chipText, category === c && styles.chipTextOn]}>{c ?? 'all'}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      <Text style={styles.sectionLabel}>happening in LA</Text>
      {isPending ? (
        // Real content hasn't resolved yet -- show a plain loading state,
        // never the "calendar is filling up" empty-state copy or the
        // recruit card below, both of which claim to know there's nothing
        // here when we simply haven't asked yet (TODAY item G, 8/27).
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={Colors.terracotta} />
        </View>
      ) : isError ? (
        <View style={styles.errorWrap}>
          <Text style={styles.errorText}>
            {friendlyError(error, "couldn't load what's happening. check your connection and try again.")}
          </Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => refetch()} accessibilityRole="button" accessibilityLabel="try again">
            <Text style={styles.retryBtnText}>try again</Text>
          </TouchableOpacity>
        </View>
      ) : filtered.length === 0 ? (
        <Text style={styles.emptyLine}>
          the calendar is filling up. check back in a beat.
        </Text>
      ) : (
        <>
          {/* size follows importance, never source (standing rule): the
              first few events render full-size whatever put them on;
              compact is the deeper-feed rhythm. Attribution, not size,
              marks the source (byline + corner chip / community kicker). */}
          {filtered.slice(0, FULL_SIZE_COUNT).map(renderFeatured)}
          {filtered.slice(FULL_SIZE_COUNT).map(renderCompact)}
        </>
      )}

      {!isPending && communitiesEnabled && <CreatorRecruitCard />}
    </ScrollView>
  );
}

// ─── Communities destination (SC-03) ─────────────────────────────────────

function CommunitiesDestination() {
  const router = useRouter();
  const { width } = useWindowDimensions();

  // isPending (not isLoading), same reasoning as EventsDestination above:
  // it is what actually distinguishes "we haven't asked yet" from "we asked
  // and there are zero communities" -- the second state is what earns the
  // recruit-card invitation below, not the first (TODAY item G, 8/27).
  const { data: communities = [], isPending, isError, error, refetch, isRefetching } = useQuery({
    queryKey: ['scene-communities'],
    queryFn: getDiscoverableCommunities,
  });
  const communityIdsKey = communities.map((c) => c.id).sort().join(',');
  const { data: leaderCards = new Map() } = useQuery({
    queryKey: ['leader-cards', communityIdsKey],
    queryFn: () => getLeaderCards(communities.map((c) => c.id)),
    enabled: communities.length > 0,
  });

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={isRefetching} onRefresh={() => refetch()} tintColor={Colors.terracotta} />
      }
    >
      {isPending ? (
        // Real content hasn't resolved yet -- a plain loading state, never
        // the recruit-card invitation below, which is only earned once we
        // actually know there are zero communities (TODAY item G, 8/27).
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={Colors.terracotta} />
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

          {communities.length > 0 && (
            <View style={styles.communitiesList}>
              {communities.map((c) => (
                <CommunityCard
                  key={c.id}
                  community={c}
                  leaderCard={leaderCards.get(c.id) ?? null}
                  width={width - 40}
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
          <CreatorRecruitCard />
        </>
      )}
    </ScrollView>
  );
}

// ─── Shared: the supply funnel (every browser is a possible creator) ─────

function CreatorRecruitCard() {
  const router = useRouter();
  return (
    <View style={styles.creatorCard}>
      <Text style={styles.creatorText}>
        run a community or throw events? bring it to washedup.
      </Text>
      <TouchableOpacity
        style={styles.creatorBtn}
        onPress={() => router.push('/creator/apply' as never)}
      >
        <Text style={styles.creatorBtnText}>tell us about it</Text>
      </TouchableOpacity>
    </View>
  );
}

const UNDERLINE_HEIGHT = 2.5;

const styles = StyleSheet.create({
  // Q2 token set (new Scene/Block-B screen): cream, not the legacy parchment
  container: { flex: 1, backgroundColor: Colors.cream },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  headerTitle: { fontFamily: Fonts.display, fontSize: FontSizes.displayLG, color: Colors.darkWarm },
  headerTitleItalic: { fontFamily: Fonts.display },

  // ── SC-01 destination shell: full-width underline tabs, never pill
  //    bubbles (repo tabs law) ──
  destinationRow: { flexDirection: 'row', paddingHorizontal: 20 },
  destinationTab: { flex: 1, alignItems: 'center', paddingVertical: 8 },
  destinationText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodyMD, color: Colors.tertiary },
  destinationTextOn: { color: Colors.darkWarm, fontFamily: Fonts.sansBold },
  destinationUnderline: {
    height: UNDERLINE_HEIGHT,
    alignSelf: 'stretch',
    marginTop: 6,
    borderRadius: 2,
    backgroundColor: 'transparent',
  },
  destinationUnderlineOn: { backgroundColor: Colors.terracotta },
  destinationBody: { flex: 1 },
  destinationBodyHidden: { display: 'none' },
  errorWrap: { alignItems: 'center', paddingVertical: 8, marginBottom: 4, gap: 10 },
  loadingWrap: { alignItems: 'center', paddingVertical: 40 },
  errorText: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.secondary, lineHeight: LineHeights.bodyMD, textAlign: 'center' },
  retryBtn: { borderRadius: 999, borderWidth: 1.5, borderColor: Colors.terracotta, paddingHorizontal: 20, paddingVertical: 9 },
  retryBtnText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodySM, color: Colors.terracotta },

  content: { padding: 20, paddingBottom: 60 },
  sectionLabel: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.caption,
    color: Colors.terracotta,
    letterSpacing: 1.5,
    marginBottom: 10,
  },
  communitiesList: { gap: 14, marginBottom: 4 },
  chipRow: { gap: 8, marginBottom: 14 },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.cardBg,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  chipOn: { backgroundColor: Colors.terracotta, borderColor: Colors.terracotta },
  chipText: { fontFamily: Fonts.sansMedium, fontSize: FontSizes.bodySM, color: Colors.darkWarm },
  chipTextOn: { color: Colors.white },
  emptyLine: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.secondary,
    lineHeight: LineHeights.bodyMD,
  },
  creatorCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: Colors.borderWarm,
    padding: 16,
    marginTop: 12,
    gap: 12,
    alignItems: 'center',
  },
  creatorText: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.secondary,
    lineHeight: LineHeights.bodyMD,
    textAlign: 'center',
  },
  creatorBtn: {
    // 10px action radius, no pill-shaped buttons (Figma-ready spec,
    // supersedes the older pill guidance)
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: Colors.terracotta,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  creatorBtnText: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.terracotta },
});
