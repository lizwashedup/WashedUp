/**
 * Root of the rebuilt Yours experience. Derives the screen state purely
 * from the typed hooks and hosts the sticky header/tabs + shared sheets.
 * Only mounted when YOURS_PAGE_ENABLED is true.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { markRequestsSeen, REQUESTS_BADGE_KEY } from '../../lib/yours/requestsSeen';
import { Plus, MessageCircle, CalendarPlus, Users, User } from 'lucide-react-native';
import Colors from '../../constants/Colors';
import { Fonts, FontSizes } from '../../constants/Typography';
import { SPACING } from '../../constants/YoursDesign';
import { GROUPS_ENABLED } from '../../constants/FeatureFlags';
import { COPY } from './state/constants';
import { useAuthUserId } from './state/useAuthUserId';
import { useGetOrCreateDm } from '../../hooks/useGetOrCreateDm';
import { useYoursGrid } from '../../hooks/useYoursGrid';
import { useIncomingRequests } from '../../hooks/useIncomingRequests';
import { usePlanHistoryBacklog } from '../../hooks/usePlanHistoryBacklog';
import { useReferral } from '../../hooks/useReferral';
import { openInviteComposer } from '../../lib/yours/invite';
import { hapticSelection } from '../../lib/haptics';
import { AlbumsGrid } from '../albums/AlbumsGrid';
import YoursHeader from './header/YoursHeader';
import YoursTabs, { type YoursTab } from './header/YoursTabs';
import PopulatedView from './screens/PopulatedView';
import FreshStartView from './screens/FreshStartView';
import NewUserEmptyView from './screens/NewUserEmptyView';
import RequestBanner from './requests/RequestBanner';
import PathsSheet from './paths/PathsSheet';
import ProfileCardSheet from './profile/ProfileCardSheet';
import RequestStack from './requests/RequestStack';
import PeopleSearchBar from './search/PeopleSearchBar';
import PeopleSearchResults from './search/PeopleSearchResults';
import CirclesDirectory from './circles/CirclesDirectory';
import MenuCard, { type AnchorRect } from '../menu/MenuCard';
import { buildComposerWithPerson } from '../../lib/composerLink';
import type { YoursGridPerson } from '../../lib/yours/types';

/**
 * Small "+ add" pill shown below the tabs when the populated grid (which
 * has its own in-grid AddGridCell) isn't visible. Per spec the add action
 * is always reachable whether you have 0 people or 50; in populated state
 * the grid cell handles it, otherwise this pill does.
 */
function AddPill({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      onPress={() => {
        hapticSelection();
        onPress();
      }}
      style={styles.addPill}
      accessibilityRole="button"
      accessibilityLabel="Add people"
      hitSlop={10}
    >
      <Plus size={16} color={Colors.terracotta} strokeWidth={2.5} />
      <Text style={styles.addPillText}>add</Text>
    </Pressable>
  );
}

export default function YoursScreen() {
  const { data: userId, isLoading: userLoading } = useAuthUserId();
  const uid = userId ?? '';
  const { data: people = [], isLoading: gridLoading } = useYoursGrid(userId);
  const { data: requests = [] } = useIncomingRequests(userId);
  const { data: backlog = [] } = usePlanHistoryBacklog(userId);
  const { ensureReferralCode } = useReferral();
  const getOrCreateDm = useGetOrCreateDm();

  // Long-press a face: bloom the shared MenuCard from the avatar (Message, Make
  // a plan, Start a circle, then a divider and the passive View profile). With
  // circles off, fall back to the original behavior (open their keep page).
  const [menu, setMenu] = useState<{ person: YoursGridPerson; anchor: AnchorRect } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const handleLongPressPerson = (p: YoursGridPerson, anchor: AnchorRect) => {
    if (!GROUPS_ENABLED) {
      router.push(`/person/${p.user_id}` as never);
      return;
    }
    setMenu({ person: p, anchor });
    setMenuOpen(true);
  };

  const openDm = (p: YoursGridPerson) => {
    if (getOrCreateDm.isPending) return; // guard a double-tap mid-open
    getOrCreateDm.mutate(p.user_id, {
      onSuccess: (circleId) => router.push(`/(tabs)/chats/circle/${circleId}` as never),
      onError: () => Alert.alert('', COPY.keepMessageError),
    });
  };

  const [tab, setTab] = useState<YoursTab>('people');
  const [query, setQuery] = useState('');
  const [pathsOpen, setPathsOpen] = useState(false);
  const [requestsOpen, setRequestsOpen] = useState(false);
  const [profileTarget, setProfileTarget] = useState<string | null>(null);
  const queryClient = useQueryClient();

  // Opening the Requests surface marks the loop "seen": clears the Yours tab
  // count badge (independent of accept/decline) and re-shows only for a request
  // that arrives later. Source of truth for the list stays the server.
  useEffect(() => {
    if (!requestsOpen) return;
    markRequestsSeen();
    queryClient.invalidateQueries({ queryKey: REQUESTS_BADGE_KEY });
  }, [requestsOpen, queryClient]);

  // A people_request notification routes here with ?openRequests=1 so the
  // accept card stack opens directly instead of the user hunting for the
  // banner. Consume it once, only when there is actually a request waiting.
  const { openRequests, tab: tabParam } = useLocalSearchParams<{
    openRequests?: string;
    tab?: string;
  }>();
  // Deep-link into the Circles tab (the Chats > Circles empty state routes here
  // with ?tab=circles). Consume once per mount, mirroring the openRequests
  // guard below, so it never re-asserts over a later manual tab tap. Circles is
  // flag-gated; only this one value is emitted anywhere.
  const tabConsumedRef = useRef(false);
  useEffect(() => {
    if (tabConsumedRef.current) return;
    if (tabParam === 'circles' && GROUPS_ENABLED) {
      tabConsumedRef.current = true;
      setTab('circles');
      router.setParams({ tab: undefined } as never);
    } else if (tabParam === 'people') {
      // people_request notifications route here with ?tab=people so the user
      // lands on People (not their last-used tab) where the requests live.
      tabConsumedRef.current = true;
      setTab('people');
      router.setParams({ tab: undefined } as never);
    }
  }, [tabParam]);

  const autoOpenedRequestsRef = useRef(false);
  useEffect(() => {
    if (openRequests !== '1') {
      autoOpenedRequestsRef.current = false;
      return;
    }
    if (autoOpenedRequestsRef.current) return;
    if (requests.length > 0) {
      autoOpenedRequestsRef.current = true;
      setRequestsOpen(true);
      // Consume the flag so it doesn't re-open the stack on a later tab
      // revisit (the ref only guards within a single mount).
      router.setParams({ openRequests: undefined } as never);
    }
  }, [openRequests, requests.length]);

  // Track which user ids have already been seen so the light-up plays
  // once for a freshly added person and never on scroll recycle.
  const seenRef = useRef<Set<string>>(new Set());
  const [lightUpIds, setLightUpIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    const fresh = new Set<string>();
    for (const p of people) {
      if (!seenRef.current.has(p.user_id)) {
        if (seenRef.current.size > 0) fresh.add(p.user_id);
        seenRef.current.add(p.user_id);
      }
    }
    if (fresh.size) {
      setLightUpIds(fresh);
      const t = setTimeout(() => setLightUpIds(new Set()), 1500);
      return () => clearTimeout(t);
    }
  }, [people]);

  const invite = async () => {
    try {
      const code = await ensureReferralCode(uid);
      await openInviteComposer(code);
    } catch {
      /* surfaced elsewhere; invite is best-effort */
    }
  };

  // Create-circle entry point: the 3-step create flow at /circle/new (gated).
  const openCreateCircle = () => {
    router.push('/circle/new' as never);
  };

  const state: 'loading' | 'populated' | 'fresh' | 'empty' = useMemo(() => {
    if (userLoading || (gridLoading && people.length === 0)) return 'loading';
    if (people.length > 0) return 'populated';
    if (backlog.length > 0) return 'fresh';
    return 'empty';
  }, [userLoading, gridLoading, people.length, backlog.length]);

  // The "Your People" body for the active state. Albums tab and loading
  // are handled outside this function so the tabs stay visible.
  const renderPeopleBody = () => {
    if (state === 'populated') {
      const searching = query.trim().length > 0;
      return (
        <View style={styles.fill}>
          <PeopleSearchBar value={query} onChange={setQuery} />
          {searching ? (
            <PeopleSearchResults
              userId={uid}
              query={query}
              people={people}
              onOpenPerson={(id) => router.push(`/person/${id}` as never)}
              onOpenMinimal={(id) => setProfileTarget(id)}
            />
          ) : (
            <PopulatedView
              userId={uid}
              activeTab="people"
              people={people}
              requestCount={requests.length}
              lightUpIds={lightUpIds}
              onAdd={() => setPathsOpen(true)}
              onOpenRequests={() => setRequestsOpen(true)}
              onPressPerson={(p: YoursGridPerson) =>
                router.push(`/person/${p.user_id}` as never)
              }
              onLongPressPerson={handleLongPressPerson}
              onPressPill={(p: YoursGridPerson) =>
                p.upcoming_event_id &&
                router.push(`/plan/${p.upcoming_event_id}` as never)
              }
            />
          )}
        </View>
      );
    }
    if (state === 'fresh') {
      return (
        <FreshStartView
          backlogCount={backlog.length}
          onOpenBacklog={() => setPathsOpen(true)}
          onInvite={invite}
        />
      );
    }
    return <NewUserEmptyView onInvite={invite} />;
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <YoursHeader />

      {state === 'loading' ? (
        <View style={styles.center}>
          <ActivityIndicator color={Colors.terracotta} />
        </View>
      ) : (
        <>
          {/* Tabs always render once we know the state — per spec, Your
              People + Albums are always visible. */}
          <View style={styles.tabRow}>
            <View style={{ flex: 1 }}>
              <YoursTabs active={tab} onChange={setTab} />
            </View>
            {/* Persistent + add pill. In populated state the AvatarGrid's
                in-grid AddGridCell handles add, so the pill hides to avoid
                a duplicate affordance. */}
            {tab === 'people' && state !== 'populated' && (
              <AddPill onPress={() => setPathsOpen(true)} />
            )}
          </View>

          {/* Requests entry is reachable in ANY people state (was hidden once
              populated, which stranded incoming requests). */}
          {tab === 'people' && requests.length > 0 && (
            <RequestBanner
              count={requests.length}
              onPress={() => setRequestsOpen(true)}
            />
          )}

          {tab === 'people' && renderPeopleBody()}
          {GROUPS_ENABLED && tab === 'circles' && (
            <View style={styles.fill}>
              <CirclesDirectory
                userId={uid}
                hasPeople={people.length > 0}
                onOpenCircle={(id) =>
                  router.push(`/(tabs)/chats/circle/${id}` as never)
                }
                onCreate={openCreateCircle}
                onAddPeople={() => setPathsOpen(true)}
              />
            </View>
          )}
          {tab === 'albums' && (
            <View style={styles.fill}>
              <AlbumsGrid userId={uid} />
            </View>
          )}
        </>
      )}

      {!!uid && (
        <PathsSheet
          visible={pathsOpen}
          onClose={() => setPathsOpen(false)}
          userId={uid}
          backlogCount={backlog.length}
          onPressPerson={(id) => {
            setPathsOpen(false);
            setProfileTarget(id);
          }}
        />
      )}

      {!!uid && requestsOpen && (
        <RequestStack
          visible={requestsOpen}
          onClose={() => setRequestsOpen(false)}
          userId={uid}
          requests={requests}
        />
      )}

      {!!uid && (
        <ProfileCardSheet
          visible={!!profileTarget}
          onClose={() => setProfileTarget(null)}
          userId={uid}
          targetId={profileTarget}
        />
      )}

      <MenuCard
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        anchor={menu?.anchor ?? null}
        placement="avatar"
        anchorAvatar={
          menu
            ? { name: menu.person.first_name_display, photoUrl: menu.person.profile_photo_url }
            : undefined
        }
        rows={
          menu
            ? [
                {
                  key: 'message',
                  icon: MessageCircle,
                  label: COPY.menuMessage,
                  subtitle: COPY.menuMessageSub,
                  onPress: () => openDm(menu.person),
                },
                {
                  key: 'plan',
                  icon: CalendarPlus,
                  label: COPY.menuMakePlan,
                  subtitle: COPY.menuMakePlanSub,
                  // Open the composer with this person pre-attached as a removable
                  // invite chip (the locked rule: a plan from a person is never one
                  // they're not on). Never the generic /post dump.
                  onPress: () => router.push(buildComposerWithPerson(
                    menu.person.user_id,
                    menu.person.first_name_display,
                    menu.person.profile_photo_url,
                  ) as never),
                },
                {
                  key: 'circle',
                  icon: Users,
                  label: COPY.menuStartCircle,
                  subtitle: COPY.menuStartCircleSub,
                  onPress: () => router.push(`/circle/new?seed=${menu.person.user_id}` as never),
                },
                {
                  key: 'profile',
                  icon: User,
                  label: COPY.menuViewProfile,
                  subtitle: COPY.menuViewProfileSub,
                  muted: true,
                  dividerBefore: true,
                  // The dedicated individual profile page ("just {name}"),
                  // distinct from the keep page at /person/[id].
                  onPress: () => router.push(`/profile/${menu.person.user_id}` as never),
                },
              ]
            : []
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.parchment },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  fill: { flex: 1 },
  tabRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 16,
  },
  addPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1.5,
    borderColor: Colors.terracotta,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    minHeight: 32,
    marginTop: SPACING.addPillOffsetTop,
  },
  addPillText: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodySM,
    color: Colors.terracotta,
  },
});
