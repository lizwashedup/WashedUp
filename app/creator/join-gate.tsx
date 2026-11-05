import { useAfterglowFonts } from '../../hooks/useAfterglowFonts';
import { ScaledText as Text } from '../../components/ScaledText';
import { CreatorScreenHeader } from '../../components/creator/CreatorScreenHeader';
/**
 * Creator mode: the join gate settings (doc 09). The three original things a
 * leader writes once and every joiner sees: the welcome message at the top
 * of the join popup, the intro question whose answer becomes the newcomer's
 * introduction in chat, and the guidelines link behind the required
 * checkbox. Saved straight to communities through leader RLS. Functionally
 * minimal per decision 15a.
 *
 * Liz decision #11 (2026-09-03) adds up to 3 more optional questions behind
 * CONFIGURABLE_JOIN_QUESTIONS_ENABLED: a private reason-for-joining toggle, a
 * private source toggle, a rules-confirmation toggle (only offered when this
 * community has a real eligibility restriction), and one leader-authored
 * open-ended question. Read separately for legacy schema compatibility;
 * successfully loaded questions save atomically with the original fields.
 */

import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  ScrollView,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Colors from '../../constants/Colors';
import { type AfterglowFontFamilies, FontSizes, LineHeights } from '../../constants/Typography';
import { BrandedAlert, type BrandedAlertButton } from '../../components/BrandedAlert';
import { KEYBOARD_DONE_ACCESSORY_ID } from '../../components/keyboard/KeyboardDoneBar';
import { friendlyError } from '../../lib/friendlyError';
import { hapticSuccess, hapticLight } from '../../lib/haptics';
import {
  getCreatorAccess,
  getJoinGateSettings,
  getCommunityMemberCounts,
  getJoinQuestionsConfig,
  getCommunityRestrictedGender,
  type JoinPolicy,
} from '../../lib/creatorMode';
import { useCreatorPageScope } from '../../hooks/useCreatorPageScope';
import type { CreatorPageScope } from '../../lib/creatorPageReview';
import { requestWithDeadline } from '../../lib/requestWithDeadline';
import { useLedCommunity } from '../../lib/selectedCommunity';
import { JOIN_GATE_ENABLED, CONFIGURABLE_JOIN_QUESTIONS_ENABLED } from '../../constants/FeatureFlags';
import { JoinCommunityPopup } from '../../components/communities/JoinCommunityPopup';
import { CommunityJoiningChoice } from '../../components/creator/CommunityJoiningChoice';
import { changeCommunityJoiningMethod, checkCommunityJoiningSave, readCommunityJoiningAttempt, readCommunityJoiningMethod, readCommunityOpenJoining,
  saveCommunityJoiningDetails, JoiningSettingsOutcomeUnknown, type JoiningAttempt } from '../../lib/communityJoiningSettings';

export default function JoinGateScreen() {
  const { scope, account, focused } = useCreatorPageScope('legacy-joining-settings');
  const reader = useId();
  const ready = !!scope && !account.isLoading && !account.error;
  const accessRead = useQuery({
    queryKey: ['creator-access', account.viewerId, account.epoch, reader],
    enabled: ready,
    retry: false,
    staleTime: 0,
    refetchOnMount: 'always',
    queryFn: async () => {
      if (!account.viewerId || !account.isCurrent()) throw new Error('This account changed.');
      const access = await requestWithDeadline(getCreatorAccess(account.viewerId), 12_000);
      if (!account.isCurrent()) throw new Error('This account changed.');
      return access;
    },
  });
  const access = ready && account.isCurrent() && !accessRead.isError && accessRead.isFetchedAfterMount ? accessRead.data : undefined;
  const community = useLedCommunity(access);
  const { fonts } = useAfterglowFonts(true, 'creator');
  const styles = useMemo(() => createStyles(fonts), [fonts]);
  const router = useRouter();
  // Deployed communities_update / setter permissions currently admit these two roles.
  const canEdit = community && ['leader', 'co_leader'].includes(community.role);
  if (scope && access && community && canEdit) {
    return <JoinGateEditor key={`${account.viewerId}:${account.epoch}:${community.id}`} community={community}
      scope={scope} />;
  }
  const failed = !!account.error || accessRead.isError;
  return <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
    <Stack.Screen options={{ headerShown: false }} />
    <CreatorScreenHeader title="Joining settings" onBack={() => router.back()} />
    <View style={styles.centered}>
      {access && community && !canEdit ? <Text style={styles.hint}>Only this community’s leader or co-leader can change joining settings.</Text> : failed ? <>
        <Text style={styles.hint}>Could not check your creator access. Try again.</Text>
        <TouchableOpacity style={styles.previewBtn} accessibilityRole="button" onPress={() => {
          if (!focused || !account.isCurrent() || (scope && !scope.isCurrent())) return;
          if (account.error) void account.retry();
          else if (account.isCurrent()) void accessRead.refetch();
        }}><Text style={styles.previewBtnText}>Retry</Text></TouchableOpacity>
      </> : account.viewerId === null ? <Text style={styles.hint}>Sign in to manage joining settings.</Text>
        : account.isLoading || !access ? <ActivityIndicator size="large" color={Colors.terracotta} />
        : <Text style={styles.hint}>no community on this account yet.</Text>}
    </View>
  </SafeAreaView>;
}

function JoinGateEditor({ community, scope }: {
  community: NonNullable<ReturnType<typeof useLedCommunity>>; scope: CreatorPageScope;
}) {
  const { fonts } = useAfterglowFonts(true, 'creator');
  const styles = useMemo(() => createStyles(fonts), [fonts]);
  const router = useRouter();
  const queryClient = useQueryClient();
  const [welcome, setWelcome] = useState('');
  const [question, setQuestion] = useState('');
  const [guidelines, setGuidelines] = useState('');
  const [seeded, setSeeded] = useState(false);
  // Liz decision #11 (2026-09-03): up to 3 more optional questions.
  const [askReason, setAskReason] = useState(false);
  const [askSource, setAskSource] = useState(false);
  const [askRulesConfirm, setAskRulesConfirm] = useState(false);
  const [openQuestion, setOpenQuestion] = useState('');
  const [questionsSeeded, setQuestionsSeeded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uncertain, setUncertain] = useState<JoiningAttempt | null>(null);
  const uncertainRef = useRef<JoiningAttempt | null>(null);
  const rememberUncertain = (attempt: JoiningAttempt | null) => { uncertainRef.current = attempt; setUncertain(attempt); };
  const [journal, setJournal] = useState<{ scope: CreatorPageScope; ready: boolean; error: boolean } | null>(null);
  const journalReady = journal?.scope === scope && journal.ready;
  const journalError = journal?.scope === scope && journal.error;
  const [alertInfo, setAlertInfo] = useState<{ title: string; message?: string; buttons?: BrandedAlertButton[] } | null>(null);

  const latestScope = useRef(scope), mounted = useRef(false), actionLock = useRef(false);
  useLayoutEffect(() => { latestScope.current = scope; }, [scope]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const current = () => mounted.current && latestScope.current === scope && scope.isCurrent();
  const restoreAttempt = (attempt: JoiningAttempt | null) => {
    rememberUncertain(attempt);
    if (attempt?.kind === 'details') {
      setWelcome(attempt.details.settings.join_welcome_message ?? '');
      setQuestion(attempt.details.settings.join_intro_question ?? '');
      setGuidelines(attempt.details.settings.guidelines_url ?? ''); setSeeded(true);
      if (attempt.details.questions) {
        setAskReason(attempt.details.questions.askReason); setAskSource(attempt.details.questions.askSource);
        setAskRulesConfirm(attempt.details.questions.askRulesConfirm); setOpenQuestion(attempt.details.questions.openQuestion ?? ''); setQuestionsSeeded(true);
      }
    }
  };
  const loadAttempt = async () => {
    if (!current()) return;
    setJournal({ scope, ready: false, error: false });
    try {
      const saved = await readCommunityJoiningAttempt(community.id, scope);
      if (!current()) return;
      // A currently visible unconfirmed save remains held even if its journal
      // could not be written; no new remote write happens during this read.
      if (saved) restoreAttempt(saved);
      setJournal({ scope, ready: true, error: false });
    } catch { if (current()) setJournal({ scope, ready: false, error: true }); }
  };
  useEffect(() => { void loadAttempt(); }, [scope, community.id]);
  const settingsKey = ['join-gate', community.id, scope.userId];
  const { data: settings, isLoading, isError: settingsError, isFetching, isFetchedAfterMount, refetch } = useQuery({
    queryKey: settingsKey,
    queryFn: async () => {
      if (!current()) throw new Error('These settings are no longer active.');
      const result = await requestWithDeadline(getJoinGateSettings(community.id), 12_000);
      if (!current()) throw new Error('These settings are no longer active.');
      return result;
    },
    retry: false,
    staleTime: 0,
  });

  // Method changes remain explicit immediate saves, serialized with field saves.
  const policyRead = useQuery({
    queryKey: ['join-policy', community.id, scope.userId],
    queryFn: () => readCommunityJoiningMethod(community.id, scope),
    enabled: JOIN_GATE_ENABLED,
    retry: false, staleTime: 0, refetchOnMount: 'always',
  });
  const fetchedPolicy = policyRead.isFetchedAfterMount && !policyRead.isError ? policyRead.data ?? null : null;
  const openJoining = useQuery({ queryKey: ['community-open-joining', community.id, scope.userId],
    queryFn: () => readCommunityOpenJoining(community.id, scope), enabled: JOIN_GATE_ENABLED,
    retry: false, staleTime: 0, refetchOnMount: 'always' });
  const supportsOpen = openJoining.isFetchedAfterMount && !openJoining.isError && openJoining.data === true;
  const [joinPolicy, setJoinPolicyState] = useState<JoinPolicy | null>(null);
  const [previewVisible, setPreviewVisible] = useState(false);
  useEffect(() => { setJoinPolicyState(fetchedPolicy); }, [fetchedPolicy]);

  // inventory C-08: live counts next to the picker, and the source for the
  // "you have N waiting" confirm copy below.
  const { data: counts } = useQuery({
    queryKey: ['creator-member-counts', community.id, scope.userId],
    queryFn: () => getCommunityMemberCounts(community!.id),
    enabled: !!community,
  });

  // Liz decision #11 (2026-09-03): self-flipping, same double-gate shape as
  // join_policy above -- hidden until both the flag is on AND the column
  // read succeeds.
  const questionsRead = useQuery({
    queryKey: ['join-questions-config', community.id, scope.userId],
    queryFn: () => getJoinQuestionsConfig(community!.id),
    enabled: !!community && CONFIGURABLE_JOIN_QUESTIONS_ENABLED,
  });

  const questionsConfig = questionsRead.isFetchedAfterMount && !questionsRead.isError && !questionsRead.isFetching
    ? questionsRead.data ?? null : null;

  // Gates the rules-confirmation toggle: only offered when this community
  // actually has a real eligibility restriction (Liz's own condition).
  const { data: restrictedGender = null } = useQuery({
    queryKey: ['community-restricted-gender', community.id, scope.userId],
    queryFn: () => getCommunityRestrictedGender(community!.id),
    enabled: !!community && CONFIGURABLE_JOIN_QUESTIONS_ENABLED,
  });

  const commitJoinPolicy = async (policy: 'open' | 'approval_required') => {
    if (!current() || !journalReady || actionLock.current || uncertainRef.current || !seeded || settingsError || policyRead.isFetching || policyRead.isError || policy === 'open' && !supportsOpen) return;
    actionLock.current = true; setSaving(true);
    try {
      await changeCommunityJoiningMethod(community.id, policy, scope);
      if (!current()) return;
      setJoinPolicyState(policy);
      queryClient.setQueryData(['join-policy', community.id, scope.userId], policy);
    } catch (error) {
      if (!current()) return;
      if (error instanceof JoiningSettingsOutcomeUnknown) restoreAttempt(error.attempt ?? { kind: 'method', method: policy });
      setAlertInfo({ title: error instanceof JoiningSettingsOutcomeUnknown ? 'Check this save' : 'That did not save', message: friendlyError(error, 'Your joining method could not be saved.') });
    } finally { actionLock.current = false; if (mounted.current) setSaving(false); }
  };

  // inventory C-08: switching away from "you approve them" never touches
  // anyone already waiting -- they stay pending until reviewed one by one --
  // but a leader should not learn that only after the fact, so it is a real
  // confirm step, not an instant optimistic flip, whenever people are
  // actually waiting right now.
  const setJoinPolicyLocal = (policy: 'open' | 'approval_required') => {
    if (!current() || !journalReady || actionLock.current || uncertainRef.current || !seeded || settingsError || policy === joinPolicy) return;
    const pendingCount = counts?.pending ?? 0;
    if (joinPolicy === 'approval_required') {
      setAlertInfo({
        title: pendingCount > 0 ? `Switch off review with ${pendingCount} waiting?` : 'Switch to open joining?',
        message: 'New requests will skip manual approval. Existing requests still need your review. Eligibility restrictions stay the same.',
        buttons: [
          { text: 'Keep reviewing', style: 'cancel' },
          { text: 'Switch anyway', onPress: () => commitJoinPolicy(policy) },
        ],
      });
      return;
    }
    commitJoinPolicy(policy);
  };

  useEffect(() => {
    if (current() && settings && !settingsError && isFetchedAfterMount && !isFetching && !seeded) {
      setWelcome(settings.join_welcome_message ?? '');
      setQuestion(settings.join_intro_question ?? '');
      setGuidelines(settings.guidelines_url ?? '');
      setSeeded(true);
    }
  }, [settings, settingsError, isFetchedAfterMount, isFetching, seeded, scope]);

  useEffect(() => {
    if (current() && questionsConfig && !questionsSeeded) {
      setAskReason(questionsConfig.askReason);
      setAskSource(questionsConfig.askSource);
      setAskRulesConfirm(questionsConfig.askRulesConfirm);
      setOpenQuestion(questionsConfig.openQuestion ?? '');
      setQuestionsSeeded(true);
    }
  }, [questionsConfig, questionsSeeded, scope]);

  const handleSave = async () => {
    if (!current() || !journalReady || actionLock.current || uncertainRef.current || !seeded || !settings || settingsError || isLoading || isFetching) return;
    const url = guidelines.trim();
    if (url && !/^https?:\/\//i.test(url)) {
      setAlertInfo({ title: 'Check the link', message: 'The guidelines link needs to start with https://' });
      return;
    }
    actionLock.current = true;
    setSaving(true);
    const attempt: JoiningAttempt = { kind: 'details', details: {
      settings: { join_welcome_message: welcome, join_intro_question: question, guidelines_url: guidelines },
      questions: CONFIGURABLE_JOIN_QUESTIONS_ENABLED && questionsConfig && questionsSeeded
        ? { askReason, askSource, askRulesConfirm, openQuestion: openQuestion.trim() || null } : null,
    } };
    try {
      await saveCommunityJoiningDetails(community.id, attempt.details, scope);
      if (!current()) return;
      queryClient.invalidateQueries({ queryKey: ['join-questions-config', community.id] });
      hapticSuccess();
      queryClient.invalidateQueries({ queryKey: settingsKey });
      setAlertInfo({ title: 'Saved', message: 'Your joining settings have been updated.' });
    } catch (e) {
      if (!current()) return;
      if (e instanceof JoiningSettingsOutcomeUnknown) restoreAttempt(e.attempt ?? attempt);
      setAlertInfo({ title: e instanceof JoiningSettingsOutcomeUnknown ? 'Check this save' : 'That did not save', message: friendlyError(e, 'Try again in a moment.') });
    } finally {
      actionLock.current = false;
      if (mounted.current) setSaving(false);
    }
  };

  const checkSave = async () => {
    const attempt = uncertainRef.current;
    if (!current() || actionLock.current || !attempt) return;
    actionLock.current = true; setSaving(true);
    try {
      const matches = await checkCommunityJoiningSave(community.id, attempt, scope);
      if (!current()) return;
      if (!matches) throw new Error('The saved values don’t match yet. Your edits are still here; check again before making another change.');
      if (attempt.kind === 'method') {
        setJoinPolicyState(attempt.method);
        queryClient.setQueryData(['join-policy', community.id, scope.userId], attempt.method);
      }
      rememberUncertain(null);
      setAlertInfo({ title: 'Save confirmed', message: 'These settings are saved.' });
    } catch (error) { if (current()) setAlertInfo({ title: 'Still unconfirmed', message: friendlyError(error, 'Try checking again.') }); }
    finally { actionLock.current = false; if (mounted.current) setSaving(false); }
  };

  const retrySave = async () => {
    const attempt = uncertainRef.current;
    if (!current() || !journalReady || actionLock.current || !attempt) return;
    actionLock.current = true; setSaving(true);
    try {
      if (attempt.kind === 'method') await changeCommunityJoiningMethod(community.id, attempt.method, scope);
      else await saveCommunityJoiningDetails(community.id, attempt.details, scope);
      if (!current()) return;
      if (attempt.kind === 'method') setJoinPolicyState(attempt.method);
      rememberUncertain(null);
      setAlertInfo({ title: 'Saved', message: 'Your joining settings have been updated.' });
      void queryClient.invalidateQueries({ queryKey: settingsKey });
      void policyRead.refetch();
    } catch (error) { if (current()) setAlertInfo({ title: 'Still unconfirmed', message: friendlyError(error, 'Try checking again.') }); }
    finally { actionLock.current = false; if (mounted.current) setSaving(false); }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <CreatorScreenHeader title="Joining settings" onBack={() => { if (current()) router.back(); }} />

        {journalError && <View style={styles.recovery}><Text style={styles.hint} accessibilityRole="alert">Couldn’t check your last save. Try again before editing.</Text><TouchableOpacity style={styles.previewBtn} accessibilityRole="button" onPress={() => void loadAttempt()}><Text style={styles.previewBtnText}>Retry check</Text></TouchableOpacity></View>}
        {uncertain && <View style={styles.recovery}>
          <Text style={styles.hint} accessibilityRole="alert">This save is unconfirmed. Check the saved settings before making another change.</Text>
          <TouchableOpacity style={styles.previewBtn} accessibilityRole="button" onPress={() => void checkSave()} disabled={saving}>
            <Text style={styles.previewBtnText}>{saving ? 'Checking…' : 'Check save'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.previewBtn} accessibilityRole="button" onPress={() => void retrySave()} disabled={saving || !journalReady}><Text style={styles.previewBtnText}>Retry same save</Text></TouchableOpacity>
        </View>}

        {settingsError ? (
          <View style={styles.centered}>
            <Text style={styles.hint}>Could not load your joining settings. Retry to check your saved settings before editing.</Text>
            <TouchableOpacity style={styles.previewBtn} accessibilityRole="button" disabled={isFetching} onPress={() => { if (current()) void refetch(); }}>
              <Text style={styles.previewBtnText}>{isFetching ? 'Checking…' : 'Retry'}</Text>
            </TouchableOpacity>
          </View>
        ) : isLoading || !settings || !seeded || !journalReady ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={Colors.terracotta} />
          </View>
        ) : !community ? (
          <View style={styles.centered}>
            <Text style={styles.hint}>no community on this account yet.</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <Text style={styles.title}>How people join</Text>
            <Text style={styles.hint}>
              Set the joining process and the welcome people see for {community.name}.
            </Text>

            {JOIN_GATE_ENABLED && (policyRead.isFetching || openJoining.isFetching) && <ActivityIndicator accessibilityLabel="Checking joining method" color={Colors.terracotta} />}
            {JOIN_GATE_ENABLED && (policyRead.isError || openJoining.isError) && <View>
              <Text style={styles.hint}>Couldn’t check the joining method.</Text>
              <TouchableOpacity style={styles.previewBtn} accessibilityRole="button" disabled={saving || !!uncertain} onPress={() => { if (current()) { void policyRead.refetch(); void openJoining.refetch(); } }}>
                <Text style={styles.previewBtnText}>Retry method</Text>
              </TouchableOpacity>
            </View>}
            {JOIN_GATE_ENABLED && joinPolicy !== null && openJoining.isFetchedAfterMount && !openJoining.isError && !openJoining.isFetching && !supportsOpen && <View>
              <Text style={styles.fieldLabel}>Current method</Text>
              <Text style={styles.policyPreview}>Review requests</Text>
              <Text style={styles.fieldHint}>People ask to join, and you approve each person. Open joining isn’t available for this community yet. Your existing requests and members stay the same.</Text>
            </View>}
            {JOIN_GATE_ENABLED && joinPolicy !== null && supportsOpen && (
              <>
                <CommunityJoiningChoice value={joinPolicy}
                  onChange={policy => { hapticLight(); setJoinPolicyLocal(policy); }}
                  disabled={saving || !!uncertain || policyRead.isFetching || policyRead.isError || openJoining.isFetching}
                  hint="Your eligibility rules stay the same. People already waiting still need your review." />
                {counts && <Text style={styles.policyPreview}>{counts.active} in the community{counts.pending > 0 ? ` · ${counts.pending} waiting for review` : ''}</Text>}
                {joinPolicy === 'invite_only' && (
                  <Text style={styles.policyNote}>
                    This community has an older Invite only setting. It currently uses request review. Choose Open or Review requests to change it.
                  </Text>
                )}
              </>
            )}

            <Text style={styles.fieldLabel}>Welcome message</Text>
            <Text style={styles.fieldHint}>Shown at the start of the joining form.</Text>
            <TextInput
              style={[styles.input, styles.inputMultiline]}
              accessibilityLabel="Welcome message"
              value={welcome}
              editable={!saving && !uncertain}
              onChangeText={(value) => { if (current() && journalReady && !actionLock.current && !uncertainRef.current) setWelcome(value); }}
              multiline
              maxLength={1000}
              placeholder="hey, glad you found us."
              placeholderTextColor={Colors.inkSoft}
              inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
            />

            <Text style={styles.fieldLabel}>Introduction question</Text>
            <Text style={styles.fieldHint}>
              Their answer is shared as an introduction in the community chat when they join.
            </Text>
            <TextInput
              style={styles.input}
              accessibilityLabel="Introduction question"
              value={question}
              editable={!saving && !uncertain}
              onChangeText={(value) => { if (current() && journalReady && !actionLock.current && !uncertainRef.current) setQuestion(value); }}
              maxLength={200}
              placeholder="what's your go-to taco spot?"
              placeholderTextColor={Colors.inkSoft}
              inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
            />

            {/* Liz decision #11 (2026-09-03): up to 5 questions total,
                counting the intro question above -- none of these are
                required for every community. */}
            {CONFIGURABLE_JOIN_QUESTIONS_ENABLED && questionsConfig !== null && (
              <>
                <Text style={styles.fieldLabel}>more questions</Text>
                <Text style={styles.fieldHint}>
                  up to 5 questions total, including your intro question above.
                  turn on whichever ones you want -- none of these are required.
                </Text>

                <TouchableOpacity
                  style={[styles.policyPill, styles.policyPillWide, askReason && styles.policyPillOn]}
                  accessibilityRole="checkbox" accessibilityState={{ checked: askReason }}
                  disabled={saving || !!uncertain}
                  onPress={() => { if (!current() || !journalReady || actionLock.current || uncertainRef.current) return; hapticLight(); setAskReason((v) => !v); }}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.policyText, askReason && styles.policyTextOn]}>
                    ask their reason for joining
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.policyPill, styles.policyPillWide, askSource && styles.policyPillOn]}
                  accessibilityRole="checkbox" accessibilityState={{ checked: askSource }}
                  disabled={saving || !!uncertain}
                  onPress={() => { if (!current() || !journalReady || actionLock.current || uncertainRef.current) return; hapticLight(); setAskSource((v) => !v); }}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.policyText, askSource && styles.policyTextOn]}>
                    ask how they heard about you
                  </Text>
                </TouchableOpacity>

                {/* Liz's own condition: only offered when this community has
                    a genuine eligibility restriction. */}
                {restrictedGender !== null && (
                  <TouchableOpacity
                    style={[styles.policyPill, styles.policyPillWide, askRulesConfirm && styles.policyPillOn]}
                    accessibilityRole="checkbox" accessibilityState={{ checked: askRulesConfirm }}
                  disabled={saving || !!uncertain}
                  onPress={() => { if (!current() || !journalReady || actionLock.current || uncertainRef.current) return; hapticLight(); setAskRulesConfirm((v) => !v); }}
                    activeOpacity={0.85}
                  >
                    <Text style={[styles.policyText, askRulesConfirm && styles.policyTextOn]}>
                      require a rules confirmation
                    </Text>
                  </TouchableOpacity>
                )}

                <Text style={[styles.fieldLabel, { marginTop: 12 }]}>your own question</Text>
                <Text style={styles.fieldHint}>write one more question, or leave this blank to skip it.</Text>
                <TextInput
                  style={styles.input}
                  accessibilityLabel="Additional question"
              value={openQuestion}
                  editable={!saving && !uncertain}
                  onChangeText={(value) => { if (current() && journalReady && !actionLock.current && !uncertainRef.current) setOpenQuestion(value); }}
                  maxLength={200}
                  placeholder="ask anything else you want to know"
                  placeholderTextColor={Colors.inkSoft}
                  inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
                />
              </>
            )}

            <Text style={styles.fieldLabel}>Guidelines link</Text>
            <Text style={styles.fieldHint}>
              People accept these guidelines when joining. Leave this empty to use the WashedUp guidelines.
            </Text>
            <TextInput
              style={styles.input}
              accessibilityLabel="Guidelines link"
              value={guidelines}
              editable={!saving && !uncertain}
              onChangeText={(value) => { if (current() && journalReady && !actionLock.current && !uncertainRef.current) setGuidelines(value); }}
              autoCapitalize="none"
              keyboardType="url"
              placeholder="https://"
              placeholderTextColor={Colors.inkSoft}
              inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
            />

            <TouchableOpacity style={styles.previewBtn} accessibilityRole="button" accessibilityLabel="Preview joining form" onPress={() => { if (current() && seeded && !settingsError) { hapticLight(); setPreviewVisible(true); } }}>
              <Text style={styles.previewBtnText}>Preview</Text>
            </TouchableOpacity>

            <TouchableOpacity style={[styles.saveBtn, (saving || !!uncertain) && styles.saveBtnBusy]} accessibilityRole="button" accessibilityLabel="Save joining settings"
              accessibilityState={{ disabled: saving || !!uncertain, busy: saving }} onPress={handleSave} disabled={saving || !!uncertain}>
              {saving ? (
                <ActivityIndicator size="small" color={Colors.white} />
              ) : (
                <Text style={styles.saveBtnText}>Save</Text>
              )}
            </TouchableOpacity>
          </ScrollView>
        )}
      </KeyboardAvoidingView>

      {community && (
        <JoinCommunityPopup
          visible={previewVisible && scope.isCurrent()}
          previewMode
          gate={{
            communityId: community.id,
            name: community.name,
            welcomeMessage: welcome || null,
            introQuestion: question || null,
            guidelinesUrl: guidelines || null,
            askReason,
            askSource,
            askRulesConfirm,
            openQuestion: openQuestion.trim() || null,
          }}
          joinsInstantly={joinPolicy === 'open'}
          onClose={() => { if (current()) setPreviewVisible(false); }}
          onRequested={() => { if (current()) setPreviewVisible(false); }}
        />
      )}

      <BrandedAlert
        visible={!!alertInfo && scope.isCurrent()}
        title={alertInfo?.title ?? ''}
        message={alertInfo?.message}
        buttons={alertInfo?.buttons}
        onClose={() => { if (current()) setAlertInfo(null); }}
      />
    </SafeAreaView>
  );
}

function createStyles(fonts: AfterglowFontFamilies) { return StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.parchment },
  recovery: { padding: 20, gap: 8 },
  flex: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 8 },
  headerBtn: { padding: 4 },
  content: { padding: 20, paddingBottom: 60 },
  title: {
    fontFamily: fonts.display,
    fontSize: FontSizes.displayLG,
    lineHeight: LineHeights.displayLG,
    color: Colors.darkWarm,
    marginBottom: 8,
  },
  hint: {
    fontFamily: fonts.regular,
    fontSize: FontSizes.bodySM,
    color: Colors.secondary,
    lineHeight: LineHeights.bodySM,
    marginBottom: 18,
  },
  fieldLabel: {
    fontFamily: fonts.semibold,
    fontSize: FontSizes.caption,
    color: Colors.terracotta,
    letterSpacing: 1.5,
    marginBottom: 2,
  },
  fieldHint: { fontFamily: fonts.regular, fontSize: FontSizes.caption, color: Colors.tertiary, marginBottom: 6 },
  policyPreview: { fontFamily: fonts.medium, fontSize: FontSizes.caption, color: Colors.terracotta, marginBottom: 8 },
  policyNote: { fontFamily: fonts.regular, fontSize: FontSizes.caption, color: Colors.tertiary, marginTop: -4, marginBottom: 16 },
  input: {
    backgroundColor: Colors.inputBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: fonts.regular,
    fontSize: FontSizes.bodyMD,
    color: Colors.darkWarm,
    marginBottom: 16,
  },
  inputMultiline: { minHeight: 90, textAlignVertical: 'top' },
  policyRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  policyPill: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  policyPillOn: { borderColor: Colors.terracotta, backgroundColor: Colors.brandSoft },
  // overrides policyPill's flex:1 (meant for the two-pill row) so this
  // standalone third pill renders as its own full-width block instead
  policyPillWide: { flex: 0, marginTop: 8, marginBottom: 8 },
  policyText: { fontFamily: fonts.medium, fontSize: FontSizes.bodySM, color: Colors.darkWarm },
  policyTextOn: { fontFamily: fonts.semibold, color: Colors.terracotta },
  saveBtn: {
    backgroundColor: Colors.terracotta,
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  saveBtnBusy: { opacity: 0.6 },
  saveBtnText: { fontFamily: fonts.semibold, fontSize: FontSizes.bodyLG, color: Colors.white },
  previewBtn: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: Colors.terracotta,
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 10,
  },
  previewBtnText: { fontFamily: fonts.medium, fontSize: FontSizes.bodyMD, color: Colors.terracotta },
});
}
