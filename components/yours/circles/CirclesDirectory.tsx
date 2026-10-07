/** Yours > Circles keeps the original joined collection and suggestions. */
import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, FlatList, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import Colors, { AfterglowColors } from '../../../constants/Colors';
import { SkeletonCircles } from '../../SkeletonCard';
import { Fonts, FontSizes, AfterglowType, type AfterglowFontFamilies } from '../../../constants/Typography';
import { COPY } from '../state/constants';
import { useMyCircles } from '../../../hooks/useMyCircles';
import { useCircleMemberPreviews } from '../../../hooks/useCircleMemberPreviews';
import { useCircleSuggestions, useSetSuggestionStatus, isObsoleteCircleSuggestion } from '../../../hooks/useCircleSuggestions';
import { useObservedUser, type ObservedUser } from '../../../hooks/useObservedUser';
import { isDmCircle } from '../../../lib/circles/display';
import type { MyCircle, CircleSuggestion } from '../../../lib/circles/types';
import CircleCard from './CircleCard';
import CirclesSummaryHeader from './CirclesSummaryHeader';
import CirclesEmptyState from './CirclesEmptyState';
import SuggestionCard from './SuggestionCard';

export type CirclesDirectoryProps = {
  userId: string; hasPeople: boolean; onOpenCircle: (id: string) => void;
  onCreate: () => void; onAddPeople: () => void; appearance?: { fonts: AfterglowFontFamilies };
};
export default function CirclesDirectory(props: CirclesDirectoryProps) {
  const viewer = useObservedUser();
  return <DirectoryVisit key={JSON.stringify([props.userId, viewer.viewerId, viewer.epoch])} {...props} viewer={viewer}/>;
}
type Visit = { focused: boolean; retired: boolean };
type DismissState = { pending: boolean; error: string | null };
function DirectoryVisit({ userId, hasPeople, onOpenCircle, onCreate, onAddPeople, appearance, viewer }: CirclesDirectoryProps & { viewer: ObservedUser }) {
  const router = useRouter(), focused = useIsFocused();
  const visitRef = useRef<Visit>({ focused, retired: false });
  if (visitRef.current.focused !== focused) visitRef.current = { focused, retired: false };
  const visit = visitRef.current, live = useRef(false);
  useLayoutEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const ready = viewer.viewerId === userId && !viewer.isLoading && !viewer.error && viewer.isCurrent();
  const readyRef = useRef(ready); readyRef.current = ready;
  const current = () => live.current && readyRef.current && viewer.isCurrent() && visitRef.current === visit && visit.focused && !visit.retired;
  const readScope = useMemo(() => ({ userId, epoch: viewer.epoch,
    isCurrent: () => live.current && readyRef.current && viewer.isCurrent(),
  }), [userId, viewer.epoch, viewer.isCurrent]);
  const readUserId = ready ? userId : null;
  const { data: rawCircles = [], isLoading, isError, refetch, isRefetching } = useMyCircles(readUserId, readScope);
  // Exactly-two-member unnamed DMs live in Chats; named pairs stay circles.
  const circles = rawCircles.filter(c => !isDmCircle(c.name, c.member_count));
  const { data: memberPreviews = {} } = useCircleMemberPreviews(circles.map(c => c.id), readUserId, readScope);
  // Optional suggestions and member portraits never block the joined directory.
  const { data: rawSuggestions = [] } = useCircleSuggestions(readUserId, readScope);
  const setSuggestionStatus = useSetSuggestionStatus(userId);
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const suggestions = rawSuggestions.filter(s => !dismissed.has(s.id));
  const latest = useRef({ circles, suggestions, onOpenCircle, onCreate, onAddPeople, usable: !isError && !isLoading });
  latest.current = { circles, suggestions, onOpenCircle, onCreate, onAddPeople, usable: !isError && !isLoading };
  const attempts = useRef(new Map<string, { visit: Visit }>());
  const [dismissState, setDismissState] = useState<{ visit: Visit; values: Record<string, DismissState> }>({ visit, values: {} });
  const states = dismissState.visit === visit ? dismissState.values : {};
  const updateDismiss = (id: string, value: DismissState) => setDismissState(previous => ({ visit, values: { ...(previous.visit === visit ? previous.values : {}), [id]: value } }));
  const suggestionCurrent = (id: string) => current() && latest.current.usable && latest.current.suggestions.some(s => s.id === id);
  const onStartSuggestion = (s: CircleSuggestion) => {
    if (!suggestionCurrent(s.id) || attempts.current.get(s.id)?.visit === visit) return;
    const currentSuggestion = latest.current.suggestions.find(candidate => candidate.id === s.id);
    if (!currentSuggestion) return;
    visit.retired = true;
    router.push(`/circle/new?seed=${currentSuggestion.suggested_user_ids.join(',')}&suggestion=${currentSuggestion.id}` as never);
  };
  const onDismissSuggestion = async (s: CircleSuggestion) => {
    if (!suggestionCurrent(s.id) || attempts.current.get(s.id)?.visit === visit) return;
    const attempt = { visit }; attempts.current.set(s.id, attempt);
    updateDismiss(s.id, { pending: true, error: null });
    const owns = () => current() && attempts.current.get(s.id) === attempt;
    try {
      const result = await setSuggestionStatus.mutateAsync({ id: s.id, status: 'dismissed' }, {
        scope: { userId, isCurrent: owns, canDispatch: () => suggestionCurrent(s.id) },
      });
      if (!owns()) return;
      // Only a confirmed pending -> dismissed receipt hides this suggestion.
      // The hook refetches not_found; it is never presented as a successful write.
      if (result !== 'dismissed') throw new Error('Suggestion dismissal was not confirmed.');
      setDismissed(previous => new Set(previous).add(s.id));
    } catch (error) {
      if (owns() && !isObsoleteCircleSuggestion(error)) updateDismiss(s.id, { pending: false, error: 'Couldn’t dismiss this suggestion. Try again.' });
    } finally {
      if (attempts.current.get(s.id) === attempt) {
        attempts.current.delete(s.id);
        if (current()) setDismissState(previous => previous.visit === visit && previous.values[s.id] ? { visit, values: { ...previous.values, [s.id]: { ...previous.values[s.id], pending: false } } } : previous);
      }
    }
  };
  const [retryState, setRetryState] = useState<{ visit: Visit; busy: boolean }>({ visit, busy: false });
  const retrying = retryState.visit === visit && retryState.busy, retryLock = useRef<Visit | null>(null);
  const retry = async () => {
    if (!current() || retryLock.current === visit || isRefetching) return;
    retryLock.current = visit; setRetryState({ visit, busy: true });
    try { await refetch(); } catch { /* The query retains its retryable error state. */ }
    finally { if (retryLock.current === visit) retryLock.current = null; if (current()) setRetryState({ visit, busy: false }); }
  };
  const styled = appearance ? { ...styles, ...afterglow(appearance.fonts) } : styles;
  const loading = <View style={styled.center}><ActivityIndicator color={appearance ? AfterglowColors.clay : Colors.terracotta} accessibilityLabel="Loading circles"/><Text style={styled.loadingText}>Loading your circles…</Text></View>;
  if (viewer.isLoading) return loading;
  if (!ready) return <View style={styled.center}><Text style={styled.errorText}>Couldn’t check your account.</Text><Pressable style={styled.retry} accessibilityRole="button" accessibilityLabel="Try again to check account" onPress={() => { if (live.current) void viewer.retry(); }}><Text numberOfLines={1} style={styled.retryLabel}>Try again</Text></Pressable></View>;
  if (isLoading) return appearance ? loading : <SkeletonCircles/>;
  if (isError) return <View style={styled.center}><Text accessibilityRole="alert" style={styled.errorText}>{COPY.circlesError}</Text><Pressable style={styled.retry} accessibilityRole="button" accessibilityLabel={COPY.circlesRetry} disabled={retrying || isRefetching} accessibilityState={{ disabled: retrying || isRefetching, busy: retrying || isRefetching }} onPress={() => { void retry(); }}><Text numberOfLines={1} style={styled.retryLabel}>{retrying || isRefetching ? 'Trying again…' : COPY.circlesRetry}</Text></Pressable></View>;
  const create = () => { if (current()) latest.current.onCreate(); };
  const addPeople = () => { if (current()) latest.current.onAddPeople(); };
  if (circles.length === 0 && suggestions.length === 0) return <CirclesEmptyState hasPeople={hasPeople} onCreate={create} onAddPeople={addPeople} appearance={appearance}/>;
  const suggestionCards = suggestions.map(s => <SuggestionCard key={s.id} suggestion={s} onStart={onStartSuggestion} onDismiss={s => { void onDismissSuggestion(s); }} appearance={appearance} dismissPending={states[s.id]?.pending} dismissError={states[s.id]?.error}/>);
  return <FlatList<MyCircle> data={circles} keyExtractor={c => c.id}
    ListHeaderComponent={<><CirclesSummaryHeader count={circles.length} onCreate={create} appearance={appearance}/>{!appearance && suggestionCards}</>}
    ListFooterComponent={appearance && suggestions.length ? <View style={styled.suggestions}>{suggestionCards}</View> : null}
    renderItem={({ item, index }) => <CircleCard circle={item} members={memberPreviews[item.id] ?? []} groupPosition={circles.length === 1 ? 'single' : index === 0 ? 'first' : index === circles.length - 1 ? 'last' : 'middle'} onPress={id => { if (current() && latest.current.circles.some(c => c.id === id)) latest.current.onOpenCircle(id); }} appearance={appearance}/>}
    contentContainerStyle={styled.listContent} refreshing={isRefetching} onRefresh={() => { void retry(); }} showsVerticalScrollIndicator={false}/>;

}

const styles = StyleSheet.create({
  loadingText: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.secondary, marginTop: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  listContent: { paddingBottom: 32 },
  suggestions: { paddingTop: 10 },
  rowPressed: { backgroundColor: Colors.warmTint },
  errorText: {
    fontFamily: Fonts.sans,
    fontSize: FontSizes.bodyMD,
    color: Colors.secondary,
    textAlign: 'center',
    marginBottom: 16,
  },
  retry: {
    borderWidth: 1.5,
    borderColor: Colors.terracotta,
    borderRadius: 999,
    paddingHorizontal: 24,
    paddingVertical: 10,
  },
  retryLabel: {
    fontFamily: Fonts.sansBold,
    fontSize: FontSizes.bodySM,
    color: Colors.terracotta,
  },
});

function afterglow(fonts: AfterglowFontFamilies) { return StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: AfterglowColors.paper },
  listContent: { paddingBottom: 32, backgroundColor: AfterglowColors.paper },
  loadingText: { ...AfterglowType.body, fontFamily: fonts.regular, color: AfterglowColors.muted, marginTop: 12 },
  errorText: { ...AfterglowType.body, fontFamily: fonts.regular, color: AfterglowColors.muted, textAlign: 'center', marginBottom: 16 },
  retry: { minHeight: 44, borderWidth: 1, borderColor: AfterglowColors.clay, borderRadius: 4, paddingHorizontal: 20, paddingVertical: 12, justifyContent: 'center' },
  retryLabel: { ...AfterglowType.body, fontFamily: fonts.semibold, color: AfterglowColors.clay },
}); }
