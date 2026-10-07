import { ScaledText as Text } from '../../ScaledText';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Alert, ActivityIndicator, Pressable, StyleSheet } from 'react-native';
import Colors, { AfterglowColors } from '../../../constants/Colors';
import { Fonts, FontSizes, AfterglowType, type AfterglowFontFamilies } from '../../../constants/Typography';
import { COPY } from '../state/constants';
import PersonRow from '../paths/PersonRow';
import { usePeopleSearch } from '../../../hooks/usePeopleSearch';
import {
  usePeopleConnectionMutations,
  friendlyConnectionError,
} from '../../../hooks/usePeopleConnectionMutations';
import type { YoursGridPerson, SearchConnectionState } from '../../../lib/yours/types';

type RequestDisplay = 'sending' | 'requested' | 'connected';

/**
 * Inline results: accepted people match names/handles locally; new people are
 * looked up by exact handle only. PeopleScreen owns the mounted input/scroll.
 */
export default function PeopleSearchResults({
  userId,
  query,
  people,
  onOpenPerson,
  onOpenMinimal,
  appearance,
}: {
  userId: string;
  query: string;
  people: YoursGridPerson[];
  onOpenPerson: (id: string) => void;
  onOpenMinimal: (id: string) => void;
  appearance?: { fonts: AfterglowFontFamilies };
}) {
  const q = query.trim().toLowerCase();
  const handleQuery = q.replace(/^@+/, '');
  const queryScope = `${userId}:${handleQuery}`;
  const local = useMemo(
    () => people.filter((p) => {
      const n = (p.first_name_display ?? '').toLowerCase();
      const h = (p.handle ?? '').toLowerCase();
      return n.includes(q) || (!!handleQuery && h.includes(handleQuery));
    }),
    [people, q, handleQuery],
  );
  const lookup = usePeopleSearch(userId, query);
  const { data: remoteRaw = [], isFetching: remoteFetching, isError: remoteError, refetch } = lookup;
  const localIds = useMemo(() => new Set(people.map((p) => p.user_id)), [people]);

  // The hook retains its previous debounced result while a new value settles.
  // Do not display or act on that previous person's row during this interval.
  const [settledScope, setSettledScope] = useState<string | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => setSettledScope(queryScope), 300);
    return () => clearTimeout(timer);
  }, [queryScope]);
  const lookupEnabled = !!userId && handleQuery.length >= 2;
  const settled = settledScope === queryScope;
  const remote = lookupEnabled && settled
    ? remoteRaw.filter((r) => !localIds.has(r.user_id) && r.handle?.replace(/^@+/, '').toLowerCase() === handleQuery)
    : [];
  const searching = lookupEnabled && (!settled || remoteFetching);
  const lookupFailed = lookupEnabled && settled && remoteError && !remoteFetching;
  const { sendRequest } = usePeopleConnectionMutations(userId);

  // An account owns all local request feedback. The synchronous map also locks
  // double taps before React can paint Sending. Query changes keep actual
  // completed outcomes by person, but cannot reopen stale result actions.
  const owner = useRef({ userId, version: 0, requests: new Map<string, RequestDisplay>() });
  if (owner.current.userId !== userId) {
    owner.current = { userId, version: owner.current.version + 1, requests: new Map() };
  }
  const [, repaint] = useState(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const current = useRef({ queryScope, remote });
  current.current = { queryScope, remote };

  const requestOwner = owner.current;
  const handleAdd = async (recipientId: string) => {
    const capturedOwner = requestOwner;
    const visible = current.current.remote.find((r) => r.user_id === recipientId);
    if (!mounted.current || !userId || owner.current !== capturedOwner || capturedOwner.userId !== userId ||
      current.current.queryScope !== queryScope || !visible || visible.connection_state !== 'none' ||
      capturedOwner.requests.has(recipientId)) return;
    capturedOwner.requests.set(recipientId, 'sending');
    repaint((n) => n + 1);
    try {
      const outcome = await sendRequest.mutateAsync({ recipientId, context: 'handle_lookup' });
      if (!mounted.current || owner.current !== capturedOwner) return;
      capturedOwner.requests.set(recipientId,
        outcome === 'now_connected' || outcome === 'already_connected' ? 'connected' : 'requested');
      repaint((n) => n + 1);
      // Refresh this lookup only while it is still the one that initiated the
      // request. Never refetch a different query from an obsolete completion.
      if (current.current.queryScope === queryScope) void refetch();
    } catch (error) {
      if (!mounted.current || owner.current !== capturedOwner) return;
      capturedOwner.requests.delete(recipientId);
      repaint((n) => n + 1);
      if (current.current.queryScope === queryScope) Alert.alert('', friendlyConnectionError(error));
    }
  };
  const displayState = (id: string, server: SearchConnectionState): SearchConnectionState => {
    if (server === 'connected' || server === 'incoming') return server;
    const status = owner.current.requests.get(id);
    return status === 'connected' ? 'connected' : status === 'requested' ? 'requested' : server;
  };
  const fonts = appearance?.fonts;
  const sectionStyle = fonts ? [styles.section, afterglow.section, { fontFamily: fonts.semibold }] : styles.section;
  const titleStyle = fonts ? [styles.emptyTitle, afterglow.emptyTitle, { fontFamily: fonts.semibold }] : styles.emptyTitle;
  const subStyle = fonts ? [styles.emptySub, afterglow.emptySub, { fontFamily: fonts.regular }] : styles.emptySub;
  const accent = fonts ? AfterglowColors.clay : Colors.terracotta;

  return (
    <View style={[styles.list, fonts && afterglow.list]}>
      {local.length > 0 && (
        <>
          <Text style={sectionStyle}>{COPY.searchYoursSection}</Text>
          {local.map((p) => (
            <PersonRow
              key={p.user_id}
              name={p.first_name_display}
              photoUrl={p.profile_photo_url}
              sharedCount={p.shared_count}
              state="connected"
              onAdd={() => {}}
              onPressPerson={() => onOpenPerson(p.user_id)}
              appearance={appearance}
            />
          ))}
        </>
      )}
      {remote.length > 0 && (
        <>
          <Text style={sectionStyle}>{COPY.searchNewSection}</Text>
          {remote.map((r) => (
            <PersonRow
              key={r.user_id}
              name={r.first_name_display}
              photoUrl={r.profile_photo_url}
              sharedCount={r.shared_count}
              state={displayState(r.user_id, r.connection_state)}
              isAdding={owner.current.requests.get(r.user_id) === 'sending'}
              onAdd={() => { void handleAdd(r.user_id); }}
              onPressPerson={() => onOpenMinimal(r.user_id)}
              appearance={appearance}
            />
          ))}
        </>
      )}
      {searching && (
        <View style={styles.feedback} accessibilityLiveRegion="polite">
          <ActivityIndicator color={accent} accessibilityLabel="Looking up handle" />
          <Text style={subStyle}>Looking up handle…</Text>
        </View>
      )}
      {lookupFailed && (
        <View style={styles.feedback} accessibilityLiveRegion="polite">
          <Text style={titleStyle}>Couldn’t look up that handle.</Text>
          <Text style={subStyle}>Your search is still here. Try again.</Text>
          <Pressable
            style={[styles.retry, fonts && afterglow.retry]}
            accessibilityRole="button"
            accessibilityLabel="Retry handle lookup"
            onPress={() => {
              if (current.current.queryScope === queryScope && settled) void refetch();
            }}
          >
            <Text style={[styles.retryText, fonts && afterglow.retryText, fonts && { fontFamily: fonts.semibold }]} numberOfLines={1}>Try again</Text>
          </Pressable>
        </View>
      )}
      {!searching && !lookupFailed && local.length === 0 && remote.length === 0 && (
        <View style={styles.feedback}>
          <Text style={titleStyle}>{fonts ? 'Try a name or handle.' : COPY.searchNoResults}</Text>
          <Text style={subStyle}>{fonts ? 'Search your people by name, or enter a full handle to find someone new.' : COPY.searchNoResultsSub}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: 16, paddingBottom: 32 },
  section: {
    fontFamily: Fonts.sansSemibold, fontSize: FontSizes.caption, color: Colors.terracotta,
    letterSpacing: 1.5, textTransform: 'uppercase', marginTop: 16, marginBottom: 4,
  },
  feedback: { paddingHorizontal: 16, paddingTop: 32, paddingBottom: 16, alignItems: 'center' },
  emptyTitle: { fontFamily: Fonts.display, fontSize: FontSizes.displaySM, color: Colors.asphalt, textAlign: 'center' },
  emptySub: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.secondary, marginTop: 4, textAlign: 'center' },
  retry: { marginTop: 12, minHeight: 44, paddingHorizontal: 16, borderWidth: 1, borderColor: Colors.terracotta, borderRadius: 5, alignItems: 'center', justifyContent: 'center' },
  retryText: { fontFamily: Fonts.sansSemibold, fontSize: FontSizes.bodyMD, color: Colors.terracotta },
});
const afterglow = StyleSheet.create({
  list: { paddingHorizontal: 20, backgroundColor: AfterglowColors.paper },
  section: { ...AfterglowType.section, color: AfterglowColors.clay, letterSpacing: 0, textTransform: 'none', marginTop: 20, marginBottom: 6 },
  emptyTitle: { ...AfterglowType.title, color: AfterglowColors.ink },
  emptySub: { ...AfterglowType.body, color: AfterglowColors.muted },
  retry: { borderColor: AfterglowColors.clay },
  retryText: { ...AfterglowType.body, color: AfterglowColors.clay },
});
