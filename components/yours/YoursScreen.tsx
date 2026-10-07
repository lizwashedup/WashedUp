/**
 * Root of the rebuilt Yours experience. Derives the screen state purely
 * from the typed hooks and hosts the sticky header/tabs + shared sheets.
 * Only mounted when YOURS_PAGE_ENABLED is true.
 */
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useIsFocused } from '@react-navigation/native';
import { supabase } from '../../lib/supabase';
import { markRequestsSeen, REQUESTS_BADGE_KEY } from '../../lib/yours/requestsSeen';
import { Plus, MessageCircle, CalendarPlus, Users, User } from 'lucide-react-native';
import Colors, { AfterglowColors, CreatorSurfaceColors } from '../../constants/Colors';
import { Fonts, FontSizes, AfterglowType } from '../../constants/Typography';
import { SPACING } from '../../constants/YoursDesign';
import { COMMUNITIES_ENABLED, GROUPS_ENABLED, COMMUNITY_CHAT_GROUPING_ENABLED, CREATOR_PAGES_ENABLED } from '../../constants/FeatureFlags';
import { useAfterglowFonts } from '../../hooks/useAfterglowFonts';
import { COPY } from './state/constants';
import { requestWithDeadline } from '../../lib/requestWithDeadline';
import { useObservedUser } from '../../hooks/useObservedUser';
import { useGetOrCreateDm, isObsoleteDmOperation } from '../../hooks/useGetOrCreateDm';
import { useYoursGrid } from '../../hooks/useYoursGrid';
import { useIncomingRequests } from '../../hooks/useIncomingRequests';
import { usePlanHistoryBacklog } from '../../hooks/usePlanHistoryBacklog';
import { useReferral } from '../../hooks/useReferral';
import { openInviteComposer } from '../../lib/yours/invite';
import { hapticSelection } from '../../lib/haptics';
import { AlbumsGrid } from '../albums/AlbumsGrid';
import YoursHeader from './header/YoursHeader';
import { PageAction } from '../creator/pages/PageFrame';
import { CreatorSpaceEntry } from '../creator/pages/CreatorSpaceEntry';
import YoursTabs, { type YoursTab } from './header/YoursTabs';
import PeopleScreen from './people/PeopleScreen';
import MyPlansView from './screens/MyPlansView';
import FreshStartView from './screens/FreshStartView';
import NewUserEmptyView from './screens/NewUserEmptyView';
import RequestBanner from './requests/RequestBanner';
import PathsSheet from './paths/PathsSheet';
import ProfileCardSheet from './profile/ProfileCardSheet';
import RequestStack from './requests/RequestStack';
import PeopleSearchResults from './search/PeopleSearchResults';
import CirclesDirectory from './circles/CirclesDirectory';
import { MyCommunitiesList } from './communities/MyCommunitiesList';
import MenuCard, { type AnchorRect } from '../menu/MenuCard';
import { buildComposerWithPerson } from '../../lib/composerLink';
import type { YoursGridPerson } from '../../lib/yours/types';
import YoursIntroPopup from './onboarding/YoursIntroPopup';
import {
  resolveYoursIntroVariant,
  hasSeenYoursIntro,
  markYoursIntroSeen,
  type YoursIntroVariant,
} from '../../lib/yours/tabsIntroSeen';

/**
 * Small "+ add" pill shown below the tabs when the populated People body
 * (which has its own "add people" CTA inside PeopleScreen) isn't visible.
 * Per spec the add action is always reachable whether you have 0 people or
 * 50; in populated state PeopleScreen's CTA handles it, otherwise this
 * pill does.
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
  const viewer = useObservedUser();
  const userLoading = viewer.isLoading;
  const userId = userLoading || viewer.error ? undefined : (viewer.viewerId ?? undefined);
  const uid = userId ?? '';
  const identityRetryRef = useRef(false);
  const retryIdentity = async () => {
    if (identityRetryRef.current || viewer.isLoading || !viewer.isCurrent()) return;
    identityRetryRef.current = true;
    try { await viewer.retry(); }
    finally { identityRetryRef.current = false; }
  };
  const peopleRead = useYoursGrid(userId);
  const { data: people = [], isLoading: gridLoading } = peopleRead;
  const { data: requests = [] } = useIncomingRequests(userId);
  const backlogRead = usePlanHistoryBacklog(userId);
  const { data: backlog = [] } = backlogRead;
  const { ensureReferralCode } = useReferral();
  const getOrCreateDm = useGetOrCreateDm();

  const { fonts } = useAfterglowFonts(COMMUNITY_CHAT_GROUPING_ENABLED);
  const appearance = useMemo(() => COMMUNITY_CHAT_GROUPING_ENABLED ? { fonts } : undefined, [fonts]);
  const [tab, setTab] = useState<YoursTab>('myPlans');
  const focused = useIsFocused();
  const mountedRef = useRef(true);
  const scope = useMemo(() => ({ uid, tab, focused }), [uid, tab, focused, viewer.epoch]);
  const lifetimeRef = useRef(scope);
  // Only a committed visit retires the visible screen's handlers. A concurrent
  // section render can be suspended or abandoned while People stays on screen.
  // Auth events below still invalidate the previous account synchronously.
  useLayoutEffect(() => { lifetimeRef.current = scope; }, [scope]);
  const peopleRef = useRef(people);
  peopleRef.current = people;
  type PersonMenu = { person: YoursGridPerson; anchor: AnchorRect; scope: typeof scope; consumed: boolean };
  const [menu, setMenu] = useState<PersonMenu | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<PersonMenu | null>(null);
  const dmIntentRef = useRef<object | null>(null);

  const isCurrentSection = (expected: typeof scope) => mountedRef.current && viewer.isCurrent() && lifetimeRef.current === expected
    && expected.uid === uid && !!uid && expected.focused;
  const isCurrent = (expected: typeof scope) => isCurrentSection(expected) && expected.tab === 'people';
  const closeMenu = (expected: PersonMenu | null) => {
    if (menuRef.current !== expected) return;
    setMenuOpen(false);
    // MenuCard closes immediately before invoking the selected row. Allow
    // that same event, but retire callbacks retained after a plain dismissal.
    void Promise.resolve().then(() => { if (menuRef.current === expected) menuRef.current = null; });
  };
  const handleLongPressPerson = (p: YoursGridPerson, anchor: AnchorRect) => {
    if (!isCurrent(scope) || !peopleRef.current.some(person => person.user_id === p.user_id)) return;
    dmIntentRef.current = null;
    if (!GROUPS_ENABLED) {
      router.push(`/person/${p.user_id}` as never);
      return;
    }
    const next = { person: p, anchor, scope, consumed: false };
    menuRef.current = next;
    setMenu(next);
    setMenuOpen(true);
  };
  const runMenuAction = (expected: PersonMenu, action: (person: YoursGridPerson) => void) => {
    if (menuRef.current !== expected || expected.consumed || !isCurrent(expected.scope)
      || !peopleRef.current.some(person => person.user_id === expected.person.user_id)) return;
    expected.consumed = true;
    dmIntentRef.current = null;
    setMenuOpen(false);
    action(expected.person);
  };
  const openDm = async (p: YoursGridPerson) => {
    if (dmIntentRef.current) return;
    const intent = {};
    const openingScope = lifetimeRef.current;
    dmIntentRef.current = intent;
    const current = () => dmIntentRef.current === intent && isCurrent(openingScope)
      && peopleRef.current.some(person => person.user_id === p.user_id);
    try {
      const circleId = await getOrCreateDm.mutateAsync(p.user_id);
      if (!current()) return;
      if (typeof circleId !== 'string' || !circleId.trim()) throw new Error('DM not confirmed');
      router.push(`/(tabs)/chats/circle/${circleId}` as never);
    } catch (error) {
      if (!isObsoleteDmOperation(error) && current()) Alert.alert('', COPY.keepMessageError);
    } finally {
      if (dmIntentRef.current === intent) dmIntentRef.current = null;
    }
  };

  const [query, setQuery] = useState('');
  const [peopleRecovery, setPeopleRecovery] = useState<{ scope: typeof scope; attempt: object; busy: boolean; failed?: boolean }>();
  const retryRef = useRef<object | null>(null);
  const recovery = peopleRecovery?.scope === scope ? peopleRecovery : undefined;
  const peopleFailure = !!(peopleRead.error || (!people.length && backlogRead.error) || recovery?.failed);
  const retryPeople = async () => {
    if (!isCurrent(scope) || retryRef.current) return;
    const attempt = {}; retryRef.current = attempt;
    setPeopleRecovery({ scope, attempt, busy: true });
    try {
      const refreshed = Promise.all([peopleRead.refetch(), ...(!people.length ? [backlogRead.refetch()] : [])]).then(results => {
        // Reads can finish after the caller's deadline. Only their confirmed
        // success may clear this attempt's feedback in its still-current visit.
        if (isCurrent(scope) && results.every(result => result.isSuccess)) {
          setPeopleRecovery(old => old?.scope === scope && old.attempt === attempt ? undefined : old);
        }
      });
      await requestWithDeadline(refreshed, 12000);
    } catch {
      if (isCurrent(scope) && retryRef.current === attempt) setPeopleRecovery({ scope, attempt, busy: false, failed: true });
    } finally {
      if (retryRef.current === attempt) {
        retryRef.current = null;
        if (isCurrent(scope)) setPeopleRecovery(old => old?.scope === scope ? { ...old, busy: false } : old);
      }
    }
  };
  const openPaths = () => { if (isCurrentSection(scope)) setPathsOpen(true); };
  const openRequestsSheet = () => { if (isCurrentSection(scope)) setRequestsOpen(true); };
  const openAcceptedPerson = (id: string) => {
    if (isCurrent(scope) && peopleRef.current.some(person => person.user_id === id)) router.push(`/person/${id}` as never);
  };
  const [pathsOpen, setPathsOpen] = useState(false);
  const [requestsOpen, setRequestsOpen] = useState(false);
  // The requester to float to the top of the list, captured from a notification
  // deep-link at open time so it survives the URL param being cleared.
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [profileTarget, setProfileTarget] = useState<string | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    menuRef.current = null;
    dmIntentRef.current = null;
    retryRef.current = null;
    setMenuOpen(false);
    if (!focused) { setPathsOpen(false); setRequestsOpen(false); setProfileTarget(null); }
  }, [uid, tab, focused]);
  useEffect(() => {
    const clearPeopleState = () => {
      menuRef.current = null;
      dmIntentRef.current = null;
      setMenu(null);
      setMenuOpen(false);
      setQuery('');
      setPathsOpen(false);
      setRequestsOpen(false);
      setHighlightId(null);
      setProfileTarget(null);
      setIntroVariant(null);
    };
    clearPeopleState();
    mountedRef.current = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      const nextUid = session?.user.id ?? '';
      if (event !== 'SIGNED_OUT' && nextUid === lifetimeRef.current.uid) return;
      lifetimeRef.current = { ...lifetimeRef.current, uid: nextUid };
      clearPeopleState();
    });
    return () => {
      mountedRef.current = false;
      menuRef.current = null;
      dmIntentRef.current = null;
      subscription.unsubscribe();
    };
  }, [uid]);

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
  const { openRequests, tab: tabParam, requesterId } = useLocalSearchParams<{
    openRequests?: string;
    tab?: string;
    requesterId?: string;
  }>();
  // Deep-link into the Circles tab (the Chats > Circles empty state routes here
  // with ?tab=circles). Consume each explicit intent once, then re-arm after
  // its parameter clears; manual tab choices remain untouched. Circles is
  // flag-gated; only this one value is emitted anywhere.
  const tabConsumedRef = useRef(false);
  useEffect(() => {
    if (!tabParam) { tabConsumedRef.current = false; return; }
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
      // Capture the notification's target before clearing the URL, so the list
      // can float that person up even after the param is gone. Opening the list
      // accepts/declines NOTHING.
      setHighlightId(requesterId ?? null);
      setRequestsOpen(true);
      // Consume the flags so they don't re-open/re-highlight on a later tab
      // revisit (the ref only guards within a single mount).
      router.setParams({ openRequests: undefined, requesterId: undefined } as never);
    }
  }, [openRequests, requests.length, requesterId]);

  const invite = async () => {
    if (!isCurrent(scope)) return;
    const current = () => isCurrent(scope);
    try {
      const code = await ensureReferralCode(uid, { isCurrent: current });
      if (!current()) return;
      await openInviteComposer(code, current);
    } catch {
      /* surfaced elsewhere; invite is best-effort */
    }
  };

  const selectTab = (next: YoursTab) => {
    if (next !== tab) { setPathsOpen(false); setRequestsOpen(false); setProfileTarget(null); }
    setTab(next);
  };

  // Create-circle entry point: the 3-step create flow at /circle/new (gated).
  const openCreateCircle = () => {
    if (isCurrentSection(scope)) router.push('/circle/new' as never);
  };

  const state: 'loading' | 'unavailable' | 'populated' | 'fresh' | 'empty' = useMemo(() => {
    if (userLoading || (gridLoading && people.length === 0)) return 'loading';
    if (people.length > 0) return 'populated';
    if (peopleFailure) return 'unavailable';
    if (backlogRead.isLoading) return 'loading';
    if (backlog.length > 0) return 'fresh';
    return 'empty';
  }, [userLoading, gridLoading, people.length, backlog.length, peopleFailure, backlogRead.isLoading]);

  // One-time Yours-tab education pop-up (see lib/yours/tabsIntroSeen.ts).
  // Skipped while a requests deep-link is about to auto-open its own sheet,
  // so the two bottom sheets never fight for the screen on first mount.
  const [introVariant, setIntroVariant] = useState<YoursIntroVariant | null>(null);
  useEffect(() => {
    if (!uid || requestsOpen || state === 'unavailable') return;
    const variant = resolveYoursIntroVariant(state);
    if (!variant) return;
    let cancelled = false;
    hasSeenYoursIntro(variant, uid).then((seen) => {
      if (!cancelled && !seen) setIntroVariant(variant);
    });
    return () => {
      cancelled = true;
    };
  }, [state, uid, requestsOpen]);

  const closeIntro = () => {
    if (introVariant) markYoursIntroSeen(introVariant, uid);
    setIntroVariant(null);
  };

  // The "Your People" body for the active state. Albums tab and loading
  // are handled outside this function so the tabs stay visible.
  const renderPeopleBody = () => {
    if (state === 'loading') return <View style={styles.center}><ActivityIndicator color={Colors.terracotta} accessibilityLabel="Loading your people" /></View>;
    if (state === 'unavailable') return <View style={styles.fill} />;
    if (state === 'populated') {
      return (
        <PeopleScreen
          appearance={appearance}
          people={people}
          query={query}
          onQueryChange={value => { if (isCurrent(scope)) setQuery(value); }}
          searchResults={
            <PeopleSearchResults
              appearance={appearance}
              userId={uid}
              query={query}
              people={people}
              onOpenPerson={openAcceptedPerson}
              onOpenMinimal={(id) => { if (isCurrent(scope)) setProfileTarget(id); }}
            />
          }
          pendingRequests={requests.length}
          onRequestsPress={openRequestsSheet}
          onPersonPress={(p: YoursGridPerson) => openAcceptedPerson(p.user_id)}
          onLongPressPerson={handleLongPressPerson}
          onAddPeople={openPaths}
          onCreateCircle={openCreateCircle}
        />
      );
    }
    if (state === 'fresh') {
      return (
        <FreshStartView
          backlogCount={backlog.length}
          onOpenBacklog={openPaths}
          onInvite={invite}
        />
      );
    }
    return <NewUserEmptyView onInvite={invite} />;
  };

  return (
    <SafeAreaView style={[styles.container, appearance && { backgroundColor: AfterglowColors.paper }]} edges={['top']}>
      <YoursHeader appearance={appearance} />
      {CREATOR_PAGES_ENABLED && !!uid && <CreatorSpaceEntry userId={uid} />}

      <View style={styles.tabRow}>
        <YoursTabs appearance={appearance} active={tab} onChange={selectTab} />
      </View>
      {userLoading ? <View style={styles.center}>
        <ActivityIndicator color={Colors.terracotta} accessibilityLabel="Loading Yours" />
      </View> : !uid ? <View style={styles.peopleRecovery}>
        <Text accessibilityRole="alert" style={[styles.recoveryText, appearance && { fontFamily: fonts.regular }]}>
          Yours couldn’t load. Try again.
        </Text>
        <PageAction quiet compact singleLine title="Try again" onPress={() => { void retryIdentity(); }} />
      </View> : <>
          {tab === 'people' && state !== 'populated' && (
            <View style={{ paddingHorizontal: 20, paddingTop: 12, alignItems: 'flex-end' }}>
              <PageAction primary compact singleLine title="Add people" onPress={openPaths} />
            </View>
          )}

          {/* Incoming-requests banner lives at the Yours level (above the tab
              content, visible on ANY tab). Yours now defaults to My Plans, so
              gating this to the People tab would hide a pending request behind a
              tab switch. The Add pill stays People-only. */}
          {/* Global request banner on every tab EXCEPT the populated People tab,
              which shows its own gift-framed banner inside PeopleScreen (design).
              In the fresh/empty states PeopleScreen never mounts, so the global
              banner must still cover People; a zero-connection user is exactly
              who has a pending incoming request. */}
          {requests.length > 0 && !(tab === 'people' && state === 'populated') && (
            <RequestBanner
              appearance={appearance}
              count={requests.length}
              onPress={openRequestsSheet}
            />
          )}

          {tab === 'people' && <>
            {peopleFailure && <View style={styles.peopleRecovery}>
              <Text accessibilityRole="alert" style={[styles.recoveryText, appearance && { fontFamily: fonts.regular }]}>
                {people.length ? 'Your people couldn’t refresh. Your saved connections are still here.' : 'Your people couldn’t load. Try again.'}
              </Text>
              <PageAction quiet compact singleLine title={recovery?.busy ? 'Trying…' : 'Try again'} disabled={!!recovery?.busy} onPress={() => { void retryPeople(); }} />
            </View>}
            {renderPeopleBody()}
          </>}
          {tab === 'myPlans' && (
            <View style={styles.fill}>
              <MyPlansView userId={uid} />
            </View>
          )}
          {GROUPS_ENABLED && tab === 'circles' && (
            <View style={styles.fill}>
              <CirclesDirectory
                userId={uid}
                appearance={appearance}
                hasPeople={people.length > 0}
                onOpenCircle={(id) =>
                  // Open the circle PAGE (identity, members, plans, action row),
                  // not the chat - the page is the circle's front door; chat is
                  // one action inside it (reachable from the page header).
                  isCurrentSection(scope) && router.push(`/circle/${id}` as never)
                }
                onCreate={openCreateCircle}
                onAddPeople={openPaths}
              />
            </View>
          )}
          {COMMUNITIES_ENABLED && tab === 'communities' && (
            <View style={styles.fill}>
              <MyCommunitiesList
                // The community PAGE is the front door (decision 7); chat is
                // one action inside it, mirroring how circles open.
                onOpen={(id) => { if (isCurrentSection(scope)) router.push(`/community/${id}` as never); }}
                onBrowse={() => { if (isCurrentSection(scope)) router.push('/(tabs)/explore' as never); }}
              />
            </View>
          )}
          {tab === 'albums' && (
            <View style={styles.fill}>
              <AlbumsGrid userId={uid} />
            </View>
          )}
        </>}

      {!!uid && (
        <PathsSheet
          appearance={appearance}
          visible={pathsOpen}
          viewer={viewer}
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
          appearance={appearance}
          visible={requestsOpen}
          onClose={() => {
            setRequestsOpen(false);
            setHighlightId(null);
          }}
          userId={uid}
          requests={requests}
          highlightRequesterId={highlightId}
        />
      )}

      {!!uid && (
        <ProfileCardSheet
          appearance={appearance}
          visible={!!profileTarget}
          onClose={() => setProfileTarget(null)}
          userId={uid}
          targetId={profileTarget}
        />
      )}

      {!!uid && (
        <YoursIntroPopup
          visible={!!introVariant}
          variant={introVariant ?? 'newUser'}
          circlesEnabled={GROUPS_ENABLED}
          onDismiss={closeIntro}
          onAddPeople={() => {
            closeIntro();
            setPathsOpen(true);
          }}
        />
      )}

      <MenuCard
        appearance={appearance}
        visible={menuOpen}
        onClose={() => closeMenu(menu)}
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
                  onPress: () => runMenuAction(menu, person => { void openDm(person); }),
                },
                {
                  key: 'plan',
                  icon: CalendarPlus,
                  label: COPY.menuMakePlan,
                  subtitle: COPY.menuMakePlanSub,
                  // Open the composer with this person pre-attached as a removable
                  // invite chip (the locked rule: a plan from a person is never one
                  // they're not on). Never the generic /post dump.
                  onPress: () => runMenuAction(menu, person => router.push(buildComposerWithPerson(
                    person.user_id, person.first_name_display, person.profile_photo_url,
                  ) as never)),
                },
                {
                  key: 'circle',
                  icon: Users,
                  label: COPY.menuStartCircle,
                  subtitle: COPY.menuStartCircleSub,
                  onPress: () => runMenuAction(menu, person => router.push(`/circle/new?seed=${person.user_id}` as never)),
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
                  onPress: () => runMenuAction(menu, person => router.push(`/profile/${person.user_id}` as never)),
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
  tabRow: { flexShrink: 0 },
  peopleRecovery: { marginHorizontal: 20, marginTop: 12, marginBottom: 4, padding: 12, gap: 4, backgroundColor: CreatorSurfaceColors.sunsetGoldLight, borderWidth: 1, borderColor: CreatorSurfaceColors.goldEdge, borderRadius: 14 },
  recoveryText: { ...AfterglowType.body, fontFamily: Fonts.sans, color: AfterglowColors.ink },
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
