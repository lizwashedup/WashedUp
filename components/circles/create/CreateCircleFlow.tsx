/** The existing people -> identity -> invite-policy Circle creation journey. */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator, KeyboardAvoidingView, Platform, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { ChevronLeft, X } from 'lucide-react-native';
import Colors, { AfterglowColors } from '../../../constants/Colors';
import { Fonts, FontSizes, AfterglowType, type AfterglowFontFamilies } from '../../../constants/Typography';
import { CIRCLE_CREATE } from '../../../constants/YoursDesign';
import { COPY } from '../../yours/state/constants';
import { hapticSelection } from '../../../lib/haptics';
import { useObservedUser, type ObservedUser } from '../../../hooks/useObservedUser';
import { useYoursGrid } from '../../../hooks/useYoursGrid';
import { useCreateCircle, isObsoleteCircleCreation, isUnconfirmedCircleCreation, type CreateCircleReceipt } from '../../../hooks/useCreateCircle';
import { pickCoverPhoto } from '../../../lib/circles/pickCover';
import { useSetSuggestionStatus } from '../../../hooks/useCircleSuggestions';
import type { CircleInvitePolicy } from '../../../lib/circles/types';
import IdentityStep from './IdentityStep';
import PeopleStep from './PeopleStep';
import PermissionsStep from './PermissionsStep';

const TOTAL_STEPS = 3, MIN_OTHERS = 2;
type Appearance = { fonts: AfterglowFontFamilies };
type Visit = { focused: boolean; retired: boolean };
type Working = 'photos' | 'creating' | 'setup' | null;
export default function CreateCircleFlow({ appearance }: { appearance?: Appearance } = {}) {
  const viewer = useObservedUser();
  const params = useLocalSearchParams<{ seed?: string; suggestion?: string }>();
  const seed = typeof params.seed === 'string' ? params.seed : undefined;
  const suggestion = typeof params.suggestion === 'string' ? params.suggestion : undefined;
  return <CreationVisit key={JSON.stringify([viewer.viewerId, viewer.epoch, seed, suggestion])} viewer={viewer} seed={seed} suggestion={suggestion} appearance={appearance}/>;
}
function CreationVisit({ viewer, seed, suggestion, appearance }: { viewer: ObservedUser; seed?: string; suggestion?: string; appearance?: Appearance }) {
  const router = useRouter(), insets = useSafeAreaInsets(), focused = useIsFocused();
  const live = useRef(false), visitRef = useRef<Visit>({ focused, retired: false });
  if (visitRef.current.focused !== focused) visitRef.current = { focused, retired: false };
  const visit = visitRef.current;
  useLayoutEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const ready = !!viewer.viewerId && !viewer.isLoading && !viewer.error && viewer.isCurrent();
  const readyRef = useRef(ready); readyRef.current = ready;
  const current = useCallback(() => live.current && readyRef.current && viewer.isCurrent() && visitRef.current === visit && visit.focused && !visit.retired, [visit, viewer.isCurrent]);
  const userId = ready ? viewer.viewerId : null;
  const grid = useYoursGrid(userId), people = grid.data ?? [];
  const createCircle = useCreateCircle(userId), setSuggestionStatus = useSetSuggestionStatus(userId);
  const [step, setStep] = useState(1), pageRevision = useRef(0);
  const [name, setName] = useState(''), [description, setDescription] = useState('');
  const [coverBase64, setCoverBase64] = useState<string | null>(null), [coverPreviewUri, setCoverPreviewUri] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [policy, setPolicy] = useState<CircleInvitePolicy>('only_me'), [adminIds, setAdminIds] = useState<Set<string>>(() => new Set());
  const [receipt, setReceipt] = useState<CreateCircleReceipt | null>(null), [unconfirmed, setUnconfirmed] = useState(false);
  const [failure, setFailure] = useState<string | null>(null), [pickError, setPickError] = useState<string | null>(null);
  const pending = useRef<{ visit: Visit; kind: Working } | null>(null);
  const [workingState, setWorkingState] = useState<{ visit: Visit; kind: Working }>({ visit, kind: null });
  const working = workingState.visit === visit ? workingState.kind : null;
  const busy = working !== null || createCircle.isPending;
  const latest = useRef({ step, people, selected, adminIds, receipt, unconfirmed, name, description, policy, coverBase64, usable: !grid.isLoading && !grid.isError });
  latest.current = { step, people, selected, adminIds, receipt, unconfirmed, name, description, policy, coverBase64, usable: !grid.isLoading && !grid.isError };
  const seedApplied = useRef(false), convertedAttempted = useRef(false);
  useEffect(() => {
    if (seedApplied.current || !seed || people.length === 0 || grid.isLoading || grid.isError) return;
    seedApplied.current = true;
    const ids = new Set(seed.split(',').filter(Boolean));
    setSelected(new Set(people.filter(person => ids.has(person.user_id)).map(person => person.user_id)));
  }, [seed, people, grid.isLoading, grid.isError]);
  // A connection that disappears while this draft is open cannot remain an
  // invisible selected member or administrator in the submitted Circle.
  useEffect(() => {
    if (grid.isLoading || grid.isError) return;
    const available = new Set(people.map(person => person.user_id));
    setSelected(previous => [...previous].some(id => !available.has(id)) ? new Set([...previous].filter(id => available.has(id))) : previous);
    setAdminIds(previous => [...previous].some(id => !available.has(id)) ? new Set([...previous].filter(id => available.has(id))) : previous);
  }, [people, grid.isLoading, grid.isError]);
  const selectedPeople = useMemo(() => people.filter(person => selected.has(person.user_id)), [people, selected]);
  const selectedIds = useMemo(() => new Set(selectedPeople.map(person => person.user_id)), [selectedPeople]);
  const draftEditable = () => current() && !pending.current && !latest.current.receipt && !latest.current.unconfirmed;
  const move = (next: number) => { pageRevision.current++; setStep(next); setFailure(null); };
  const exit = () => { if (!live.current || visitRef.current !== visit || visit.retired) return; visit.retired = true; router.back(); };
  const back = () => {
    if (!live.current || visitRef.current !== visit || visit.retired) return;
    if (step === 1 || receipt || unconfirmed || working === 'creating' || working === 'setup') exit();
    else move(step - 1);
  };
  const toggleSelected = (id: string) => {
    if (!draftEditable() || !latest.current.usable || !latest.current.people.some(person => person.user_id === id)) return;
    const next = new Set(latest.current.selected);
    if (next.has(id)) { next.delete(id); setAdminIds(previous => { const value = new Set(previous); value.delete(id); return value; }); }
    else next.add(id);
    latest.current.selected = next; setSelected(next);
  };
  const toggleAdmin = (id: string) => {
    if (!draftEditable() || !latest.current.selected.has(id) || !latest.current.people.some(person => person.user_id === id)) return;
    const next = new Set(latest.current.adminIds); next.has(id) ? next.delete(id) : next.add(id);
    latest.current.adminIds = next; setAdminIds(next);
  };
  const finishAttempt = (attempt: { visit: Visit; kind: Working }) => {
    if (pending.current !== attempt) return;
    pending.current = null;
    if (current()) setWorkingState({ visit, kind: null });
  };
  const onPickCover = async () => {
    if (!draftEditable()) return;
    const attempt = { visit, kind: 'photos' as const }, revision = pageRevision.current;
    pending.current = attempt; setWorkingState(attempt); setPickError(null);
    const owns = () => current() && pending.current === attempt && pageRevision.current === revision;
    try { const picked = await pickCoverPhoto(); if (owns() && picked) { setCoverBase64(picked.base64); setCoverPreviewUri(picked.uri); } }
    catch { if (owns()) setPickError('Couldn’t open your photos. Try again.'); }
    finally { finishAttempt(attempt); }
  };
  const openCircle = (confirmed: CreateCircleReceipt) => {
    if (!current()) return;
    visit.retired = true; router.replace(`/circle/${confirmed.circleId}` as never);
  };
  const recordConversion = async () => {
    if (!suggestion || convertedAttempted.current || !current() || !userId) return;
    convertedAttempted.current = true;
    try { await setSuggestionStatus.mutateAsync({ id: suggestion, status: 'converted' }, { scope: { userId, isCurrent: current } }); }
    catch { /* Conversion is best-effort after confirmed Circle creation. */ }
  };
  const applyReceipt = async (result: CreateCircleReceipt, attempt: { visit: Visit; kind: Working }, convert: boolean) => {
    if (!current() || pending.current !== attempt) return;
    latest.current.receipt = result; setReceipt(result); setFailure(null);
    if (convert) await recordConversion();
    if (!current() || pending.current !== attempt) return;
    if (result.policyApplied && result.coverApplied) openCircle(result);
  };
  const submit = async () => {
    if (!draftEditable() || !latest.current.usable || !userId) return;
    const draft = latest.current, memberIds = draft.people.filter(person => draft.selected.has(person.user_id)).map(person => person.user_id);
    if (memberIds.length < MIN_OTHERS) { move(1); setFailure(COPY.circleStep2NeedMore); return; }
    if (!draft.name.trim()) { move(2); setFailure('Enter a circle name.'); return; }
    const attempt = { visit, kind: 'creating' as const }; pending.current = attempt; setWorkingState(attempt); setFailure(null);
    try {
      const result = await createCircle.mutateAsync({ name: draft.name.trim(), description: draft.description.trim() || null,
        memberUserIds: memberIds, invitePolicy: draft.policy,
        adminUserIds: draft.policy === 'chosen' ? [...draft.adminIds].filter(id => memberIds.includes(id)) : [], coverBase64: draft.coverBase64,
      }, { scope: { userId, isCurrent: current } });
      await applyReceipt(result, attempt, true);
    } catch (error) {
      if (!current() || pending.current !== attempt || isObsoleteCircleCreation(error)) return;
      if (isUnconfirmedCircleCreation(error)) { latest.current.unconfirmed = true; setUnconfirmed(true); }
      else setFailure(COPY.circleCreateError);
    } finally { finishAttempt(attempt); }
  };
  const retrySetup = async () => {
    if (!current() || pending.current || !latest.current.receipt) return;
    const confirmed = latest.current.receipt, attempt = { visit, kind: 'setup' as const };
    pending.current = attempt; setWorkingState(attempt); setFailure(null);
    try { await applyReceipt(await createCircle.retrySetupAsync(confirmed.circleId), attempt, false); }
    catch (error) { if (current() && pending.current === attempt && !isObsoleteCircleCreation(error)) setFailure('Those details didn’t save. Your circle is still there.'); }
    finally { finishAttempt(attempt); }
  };
  const onPrimary = () => {
    if (!draftEditable() || !latest.current.usable || busy || latest.current.step !== step) return;
    hapticSelection();
    if (latest.current.step === 1 && selectedPeople.length < MIN_OTHERS) return;
    if (latest.current.step === 2 && !latest.current.name.trim()) return;
    if (latest.current.step < TOTAL_STEPS) { const next = latest.current.step + 1; latest.current.step = next; move(next); }
    else void submit();
  };
  const [peopleRetry, setPeopleRetry] = useState<{ visit: Visit; busy: boolean }>({ visit, busy: false });
  const retryingPeople = peopleRetry.visit === visit && peopleRetry.busy, retryPeopleLock = useRef<Visit | null>(null);
  const retryPeople = async () => {
    if (!current() || retryPeopleLock.current === visit) return;
    retryPeopleLock.current = visit; setPeopleRetry({ visit, busy: true });
    try { await grid.refetch(); } catch { /* Query keeps its explicit retry state. */ }
    finally { if (retryPeopleLock.current === visit) retryPeopleLock.current = null; if (current()) setPeopleRetry({ visit, busy: false }); }
  };
  const styled = appearance ? { ...styles, ...afterglow(appearance.fonts) } : styles;
  const ink = appearance ? AfterglowColors.ink : Colors.asphalt, accent = appearance ? AfterglowColors.clay : Colors.terracotta;
  const closeAction = step === 1 || !!receipt || unconfirmed || working === 'creating' || working === 'setup';
  const canAdvance = ready && !busy && !grid.isLoading && !grid.isError && (step === 1 ? selectedPeople.length >= MIN_OTHERS : step === 2 ? name.trim().length > 0 : true);
  const primaryLabel = step < TOTAL_STEPS ? COPY.circleCreateNext : appearance ? 'Create circle' : COPY.circleCreateMake;
  const headerTitle = appearance ? 'New circle' : selectedPeople.length > 0 ? COPY.circleCreateBuildTitleN(selectedPeople.length + 1) : COPY.circleCreateBuildTitle;
  const button = (label: string, action: () => void, secondary = false, disabled = false) => <Pressable onPress={action} disabled={disabled} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} style={[secondary ? styled.secondary : styled.primary, disabled && styled.primaryDisabled]}><Text numberOfLines={1} style={secondary ? styled.secondaryLabel : styled.primaryLabel}>{label}</Text></Pressable>;
  const loading = (label: string) => <View style={styled.status}><ActivityIndicator color={accent}/><Text style={styled.body}>{label}</Text></View>;
  const renderBody = () => {
    if (viewer.isLoading) return loading('Checking your account…');
    if (!ready) return <View style={styled.status}><Text style={styled.body}>Couldn’t check your account.</Text>{button('Try again', () => { if (live.current) void viewer.retry(); }, true)}</View>;
    if (unconfirmed) return <ScrollView contentContainerStyle={styled.completed}><Text style={styled.completedTitle}>Check your circles</Text><Text style={styled.body}>We couldn’t confirm whether your circle was created. Check your circles before starting again.</Text>{button('View circles', exit)}</ScrollView>;
    if (receipt) return <ScrollView contentContainerStyle={styled.completed}><Text style={styled.completedTitle}>Circle created</Text><Text style={styled.body}>{receipt.policyApplied && receipt.coverApplied ? 'Your circle is ready.' : 'Your circle is there. We couldn’t finish saving these details:'}</Text>
      {!receipt.policyApplied && <Text style={styled.detail}>Who can add people</Text>}{!receipt.coverApplied && <Text style={styled.detail}>Cover photo</Text>}
      {failure && <Text accessibilityRole="alert" style={styled.error}>{failure}</Text>}
      {working && loading(receipt.policyApplied && receipt.coverApplied ? 'Finishing…' : 'Saving the remaining details…')}
      {(!receipt.policyApplied || !receipt.coverApplied) && button(working ? 'Saving…' : 'Try again', () => { void retrySetup(); }, false, busy)}
      {button('View circle', () => openCircle(receipt), true)}
    </ScrollView>;
    if (grid.isLoading) return loading('Loading your people…');
    if (grid.isError) return <View style={styled.status}><Text accessibilityRole="alert" style={styled.body}>Your people didn’t load.</Text>{button(retryingPeople ? 'Trying again…' : 'Try again', () => { void retryPeople(); }, true, retryingPeople)}</View>;
    if (step === 1) return <PeopleStep people={people} selected={selectedIds} onToggle={toggleSelected} onAddPeople={exit} appearance={appearance}/>;
    if (step === 2) return <IdentityStep name={name} description={description} coverPreviewUri={coverPreviewUri} onName={value => { if (draftEditable()) setName(value); }} onDescription={value => { if (draftEditable()) setDescription(value); }} onPickCover={() => { void onPickCover(); }} picking={working === 'photos'} pickError={pickError} appearance={appearance}/>;
    return <PermissionsStep circleName={name.trim()} policy={policy} onPolicy={value => { if (draftEditable()) setPolicy(value); }} selectedPeople={selectedPeople} adminIds={adminIds} onToggleAdmin={toggleAdmin} appearance={appearance}/>;
  };
  return <SafeAreaView style={styled.container} edges={['top']}>
    <View style={styled.header}>
      <Pressable onPress={back} style={styled.back} accessibilityRole="button" accessibilityLabel={closeAction ? 'Close circle creation' : 'Back'}>{closeAction ? <X size={24} color={ink}/> : <ChevronLeft size={24} color={ink}/>}</Pressable>
      <Text style={styled.headerTitle}>{headerTitle}</Text>
      {!receipt && !unconfirmed && (appearance ? <Text accessibilityLabel={`Step ${step} of ${TOTAL_STEPS}`} style={styled.progress}>{step} of {TOTAL_STEPS}</Text> : <View style={styled.dots}>{Array.from({ length: TOTAL_STEPS }).map((_, i) => <View key={i} style={[styled.dot, i + 1 === step && styled.dotOn]}/>)}</View>)}
    </View>
    <KeyboardAvoidingView style={styled.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={styled.flex}>{renderBody()}</View>
      {!receipt && !unconfirmed && ready && !grid.isLoading && !grid.isError && people.length > 0 && <View style={[styled.footer, { paddingBottom: insets.bottom + 12 }]}>
        {step === 1 && selectedPeople.length > 0 && selectedPeople.length < MIN_OTHERS && <Text style={styled.hint}>{COPY.circleStep2NeedMore}</Text>}
        {failure && <Text accessibilityRole="alert" style={styled.error}>{failure}</Text>}
        <Pressable onPress={onPrimary} disabled={!canAdvance} style={[styled.primary, !canAdvance && styled.primaryDisabled]} accessibilityRole="button" accessibilityLabel={working === 'creating' ? 'Creating circle…' : primaryLabel} accessibilityState={{ disabled: !canAdvance, busy }}>
          {working === 'creating' ? <ActivityIndicator color={Colors.white}/> : <Text numberOfLines={1} style={styled.primaryLabel}>{primaryLabel}</Text>}
        </Pressable>
      </View>}
    </KeyboardAvoidingView>
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.parchment }, flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, gap: 12 },
  back: { minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { flex: 1, minWidth: 0, fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.asphalt },
  dots: { flexDirection: 'row', gap: CIRCLE_CREATE.stepDotGap, width: 24, justifyContent: 'flex-end' }, dot: { width: CIRCLE_CREATE.stepDot, height: CIRCLE_CREATE.stepDot, borderRadius: CIRCLE_CREATE.stepDot / 2, backgroundColor: Colors.borderWarm }, dotOn: { backgroundColor: Colors.terracotta },
  progress: { fontFamily: Fonts.sans, fontSize: FontSizes.caption, color: Colors.secondary },
  footer: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border, gap: 8 },
  hint: { fontFamily: Fonts.sans, fontSize: FontSizes.bodySM, color: Colors.secondary, textAlign: 'center' },
  primary: { minHeight: CIRCLE_CREATE.footerBtnHeight, borderRadius: 999, backgroundColor: Colors.terracotta, alignItems: 'center', justifyContent: 'center', paddingVertical: 12, paddingHorizontal: 16 }, primaryDisabled: { opacity: 0.4 },
  primaryLabel: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.white },
  secondary: { minHeight: 44, paddingHorizontal: 16, paddingVertical: 12, borderWidth: 1, borderRadius: 4, borderColor: Colors.terracotta, alignItems: 'center', justifyContent: 'center' }, secondaryLabel: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyMD, color: Colors.terracotta },
  status: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24 }, body: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyLG, color: Colors.secondary },
  completed: { flexGrow: 1, padding: 24, gap: 16 }, completedTitle: { fontFamily: Fonts.displayBold, fontSize: FontSizes.displayMD, color: Colors.asphalt }, detail: { fontFamily: Fonts.sansBold, fontSize: FontSizes.bodyLG, color: Colors.asphalt }, error: { fontFamily: Fonts.sans, fontSize: FontSizes.bodyMD, color: Colors.errorRed },
});
function afterglow(fonts: AfterglowFontFamilies) { return StyleSheet.create({
  container: { ...styles.container, backgroundColor: AfterglowColors.paper },
  headerTitle: { ...styles.headerTitle, ...AfterglowType.contextTitle, fontFamily: fonts.semibold, color: AfterglowColors.ink },
  progress: { ...AfterglowType.caption, fontFamily: fonts.regular, color: AfterglowColors.muted },
  footer: { ...styles.footer, borderTopColor: AfterglowColors.line },
  hint: { ...AfterglowType.body, fontFamily: fonts.regular, color: AfterglowColors.muted, textAlign: 'center' },
  primary: { ...styles.primary, borderRadius: 4, backgroundColor: AfterglowColors.clay }, primaryLabel: { ...AfterglowType.title, fontFamily: fonts.semibold, color: AfterglowColors.white },
  secondary: { ...styles.secondary, borderColor: AfterglowColors.clay }, secondaryLabel: { ...AfterglowType.body, fontFamily: fonts.semibold, color: AfterglowColors.clay },
  body: { ...AfterglowType.body, fontFamily: fonts.regular, color: AfterglowColors.muted }, completedTitle: { ...AfterglowType.identity, fontFamily: fonts.display, color: AfterglowColors.ink },
  detail: { ...AfterglowType.title, fontFamily: fonts.semibold, color: AfterglowColors.ink }, error: { ...AfterglowType.body, fontFamily: fonts.regular, color: Colors.errorRed },
}); }
