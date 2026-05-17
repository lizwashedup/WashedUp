/**
 * Root of the rebuilt Yours experience. Derives the screen state purely
 * from the typed hooks and hosts the sticky header/tabs + shared sheets.
 * Only mounted when YOURS_PAGE_ENABLED is true.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import Colors from '../../constants/Colors';
import { useAuthUserId } from './state/useAuthUserId';
import { useYoursGrid } from '../../hooks/useYoursGrid';
import { useIncomingRequests } from '../../hooks/useIncomingRequests';
import { usePlanHistoryBacklog } from '../../hooks/usePlanHistoryBacklog';
import { useReferral } from '../../hooks/useReferral';
import { openInviteComposer } from '../../lib/yours/invite';
import YoursHeader from './header/YoursHeader';
import YoursTabs, { type YoursTab } from './header/YoursTabs';
import PopulatedView from './screens/PopulatedView';
import FreshStartView from './screens/FreshStartView';
import NewUserEmptyView from './screens/NewUserEmptyView';
import PathsSheet from './paths/PathsSheet';
import ProfileCardSheet from './profile/ProfileCardSheet';
import RequestStack from './requests/RequestStack';
import type { YoursGridPerson } from '../../lib/yours/types';

export default function YoursScreen() {
  const { data: userId, isLoading: userLoading } = useAuthUserId();
  const uid = userId ?? '';
  const { data: people = [], isLoading: gridLoading } = useYoursGrid(userId);
  const { data: requests = [] } = useIncomingRequests(userId);
  const { data: backlog = [] } = usePlanHistoryBacklog(userId);
  const { ensureReferralCode } = useReferral();

  const [tab, setTab] = useState<YoursTab>('people');
  const [pathsOpen, setPathsOpen] = useState(false);
  const [requestsOpen, setRequestsOpen] = useState(false);
  const [profileTarget, setProfileTarget] = useState<string | null>(null);

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

  const state: 'loading' | 'populated' | 'fresh' | 'empty' = useMemo(() => {
    if (userLoading || (gridLoading && people.length === 0)) return 'loading';
    if (people.length > 0) return 'populated';
    if (backlog.length > 0) return 'fresh';
    return 'empty';
  }, [userLoading, gridLoading, people.length, backlog.length]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <YoursHeader onAdd={() => setPathsOpen(true)} />
      {state === 'populated' && (
        <YoursTabs active={tab} onChange={setTab} />
      )}

      {state === 'loading' && (
        <View style={styles.center}>
          <ActivityIndicator color={Colors.terracotta} />
        </View>
      )}

      {state === 'populated' && (
        <PopulatedView
          userId={uid}
          activeTab={tab}
          people={people}
          requestCount={requests.length}
          lightUpIds={lightUpIds}
          onOpenRequests={() => setRequestsOpen(true)}
          onPressPerson={(p: YoursGridPerson) => setProfileTarget(p.user_id)}
          onLongPressPerson={(p: YoursGridPerson) =>
            setProfileTarget(p.user_id)
          }
          onPressPill={(p: YoursGridPerson) =>
            p.upcoming_event_id &&
            router.push(`/plan/${p.upcoming_event_id}` as never)
          }
        />
      )}

      {state === 'fresh' && (
        <FreshStartView
          backlogCount={backlog.length}
          onOpenBacklog={() => setPathsOpen(true)}
          onInvite={invite}
        />
      )}

      {state === 'empty' && <NewUserEmptyView onInvite={invite} />}

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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.parchment },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
