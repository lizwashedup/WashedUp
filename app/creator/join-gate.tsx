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
 * open-ended question. Saved separately from the three original fields (see
 * updateJoinQuestionsConfig) so an unmigrated column can never break them.
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
import { useRouter, Stack, Redirect } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Colors from '../../constants/Colors';
import { type AfterglowFontFamilies, FontSizes, LineHeights } from '../../constants/Typography';
import { BrandedAlert, type BrandedAlertButton } from '../../components/BrandedAlert';
import { KEYBOARD_DONE_ACCESSORY_ID } from '../../components/keyboard/KeyboardDoneBar';
import { friendlyError } from '../../lib/friendlyError';
import { hapticSuccess, hapticLight } from '../../lib/haptics';
import {
  getCreatorAccess,
  canManageMembers,
  creatorLandingRoute,
  getJoinGateSettings,
  updateJoinGateSettings,
  getJoinPolicy,
  setJoinPolicy,
  getCommunityMemberCounts,
  getJoinQuestionsConfig,
  updateJoinQuestionsConfig,
  getCommunityRestrictedGender,
  type JoinPolicy,
} from '../../lib/creatorMode';
import { useCreatorPageScope } from '../../hooks/useCreatorPageScope';
import type { CreatorPageScope } from '../../lib/creatorPageReview';
import { requestWithDeadline } from '../../lib/requestWithDeadline';
import { useLedCommunity } from '../../lib/selectedCommunity';
import { JOIN_GATE_ENABLED, CONFIGURABLE_JOIN_QUESTIONS_ENABLED } from '../../constants/FeatureFlags';
import { JoinCommunityPopup } from '../../components/communities/JoinCommunityPopup';

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
  if (access && !canManageMembers(access)) return <Redirect href={creatorLandingRoute(access)} />;
  if (scope && access && community) {
    return <JoinGateEditor key={`${account.viewerId}:${account.epoch}:${community.id}`} community={community}
      scope={scope} />;
  }
  const failed = !!account.error || accessRead.isError;
  return <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
    <Stack.Screen options={{ headerShown: false }} />
    <CreatorScreenHeader title="Joining settings" onBack={() => router.back()} />
    <View style={styles.centered}>
      {failed ? <>
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
  const [alertInfo, setAlertInfo] = useState<{ title: string; message?: string; buttons?: BrandedAlertButton[] } | null>(null);

  const latestScope = useRef(scope), mounted = useRef(false), actionLock = useRef(false);
  useLayoutEffect(() => { latestScope.current = scope; }, [scope]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const current = () => mounted.current && latestScope.current === scope && scope.isCurrent();
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

  // proposal 91: self-flipping join-policy toggle. null until the column
  // lands, then the toggle persists each tap immediately (its own write,
  // separate from the text-field save).
  const { data: fetchedPolicy = null } = useQuery({
    queryKey: ['join-policy', community.id, scope.userId],
    queryFn: () => getJoinPolicy(community!.id),
    enabled: !!community,
  });
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

  const commitJoinPolicy = async (policy: JoinPolicy) => {
    if (!current() || actionLock.current || !seeded || settingsError) return;
    const prev = joinPolicy;
    setJoinPolicyState(policy); // optimistic
    const ok = await setJoinPolicy(community.id, policy);
    if (!current()) return;
    if (!ok) {
      setJoinPolicyState(prev); // revert on a no-op/denied write
      setAlertInfo({ title: 'That did not save', message: 'give it another try.' });
    }
  };

  // inventory C-08: switching away from "you approve them" never touches
  // anyone already waiting -- they stay pending until reviewed one by one --
  // but a leader should not learn that only after the fact, so it is a real
  // confirm step, not an instant optimistic flip, whenever people are
  // actually waiting right now.
  const setJoinPolicyLocal = (policy: JoinPolicy) => {
    if (!current() || !seeded || settingsError || policy === joinPolicy) return;
    const pendingCount = counts?.pending ?? 0;
    if (joinPolicy === 'approval_required' && pendingCount > 0) {
      setAlertInfo({
        title: `Switch off review with ${pendingCount} waiting?`,
        message: `They stay exactly as they are, pending, until you approve or decline them yourself. This only changes what happens to new requests from here on.`,
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
    if (!current() || actionLock.current || !seeded || !settings || settingsError || isLoading || isFetching) return;
    const url = guidelines.trim();
    if (url && !/^https?:\/\//i.test(url)) {
      setAlertInfo({ title: 'Check the link', message: 'The guidelines link needs to start with https://' });
      return;
    }
    actionLock.current = true;
    setSaving(true);
    try {
      await updateJoinGateSettings(community.id, {
        join_welcome_message: welcome,
        join_intro_question: question,
        guidelines_url: guidelines,
      });
      // Liz decision #11: a separate write (different columns, same table),
      // only attempted once the section has actually loaded -- questionsConfig
      // null means either the flag is off or the migration has not landed,
      // and in both cases the section above never rendered so there is
      // nothing here for the leader to have changed.
      if (!current()) return;
      if (CONFIGURABLE_JOIN_QUESTIONS_ENABLED && questionsConfig && questionsSeeded) {
        await updateJoinQuestionsConfig(community.id, {
          askReason,
          askSource,
          askRulesConfirm,
          openQuestion: openQuestion.trim() || null,
        });
        if (!current()) return;
        queryClient.invalidateQueries({ queryKey: ['join-questions-config', community.id] });
      }
      hapticSuccess();
      queryClient.invalidateQueries({ queryKey: settingsKey });
      setAlertInfo({ title: 'saved', message: 'your join gate is set. every joiner sees it.' });
    } catch (e) {
      if (!current()) return;
      setAlertInfo({ title: 'That did not save', message: friendlyError(e, 'Try again in a moment.') });
    } finally {
      actionLock.current = false;
      if (mounted.current) setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <CreatorScreenHeader title="Joining settings" onBack={() => { if (current()) router.back(); }} />

        {settingsError ? (
          <View style={styles.centered}>
            <Text style={styles.hint}>Could not load your joining settings. Retry to check your saved settings before editing.</Text>
            <TouchableOpacity style={styles.previewBtn} accessibilityRole="button" disabled={isFetching} onPress={() => { if (current()) void refetch(); }}>
              <Text style={styles.previewBtnText}>{isFetching ? 'Checking…' : 'Retry'}</Text>
            </TouchableOpacity>
          </View>
        ) : isLoading || !settings || !seeded ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={Colors.terracotta} />
          </View>
        ) : !community ? (
          <View style={styles.centered}>
            <Text style={styles.hint}>no community on this account yet.</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <Text style={styles.title}>your join gate</Text>
            <Text style={styles.hint}>
              what people see when they join {community.name}. all three make
              the door feel like yours.
            </Text>

            <Text style={styles.fieldLabel}>your welcome message</Text>
            <Text style={styles.fieldHint}>shows at the top of the join popup, in your voice.</Text>
            <TextInput
              style={[styles.input, styles.inputMultiline]}
              accessibilityLabel="Welcome message"
              value={welcome}
              onChangeText={(value) => { if (current() && !actionLock.current) setWelcome(value); }}
              multiline
              maxLength={1000}
              placeholder="hey, glad you found us."
              placeholderTextColor={Colors.inkSoft}
              inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
            />

            {/* proposal 91: the join policy toggle renders only when the
                JOIN_GATE_ENABLED flag is on AND the join_policy column read
                succeeds (getJoinPolicy non-null). Flag off, or column absent,
                keeps it hidden with no dead control. Both platforms flip in
                lockstep on the same flag. Proposal 91's default is OPEN:
                anyone joins instantly, and approval is the opt-in. */}
            {JOIN_GATE_ENABLED && joinPolicy !== null && (
              <>
                <Text style={styles.fieldLabel}>who gets in</Text>
                <Text style={styles.fieldHint}>
                  open lets anyone join instantly. approval means you review each request.
                </Text>
                {counts && (
                  <Text style={styles.policyPreview}>
                    {counts.active} in the community
                    {counts.pending > 0 ? ` · ${counts.pending} waiting for review` : ''}
                  </Text>
                )}
                <View style={styles.policyRow}>
                  <TouchableOpacity
                    style={[styles.policyPill, joinPolicy === 'open' && styles.policyPillOn]}
                    accessibilityRole="radio" accessibilityState={{ selected: joinPolicy === 'open' }}
                    onPress={() => { hapticLight(); setJoinPolicyLocal('open'); }}
                    activeOpacity={0.85}
                  >
                    {/* copy to the taste gate */}
                    <Text style={[styles.policyText, joinPolicy === 'open' && styles.policyTextOn]}>
                      anyone can join
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.policyPill, joinPolicy === 'approval_required' && styles.policyPillOn]}
                    accessibilityRole="radio" accessibilityState={{ selected: joinPolicy === 'approval_required' }}
                    onPress={() => { hapticLight(); setJoinPolicyLocal('approval_required'); }}
                    activeOpacity={0.85}
                  >
                    {/* copy to the taste gate */}
                    <Text style={[styles.policyText, joinPolicy === 'approval_required' && styles.policyTextOn]}>
                      you approve them
                    </Text>
                  </TouchableOpacity>
                </View>
                {/* inventory C-08: invite_only added to the JoinPolicy type
                    and offered here, same self-flipping shape as the two
                    pills above. Deliberately NOT built: real invite-code
                    generation/redemption -- that is its own, larger feature
                    (bigger-rocks list), not a "small" wire-up. Selecting it
                    today behaves like "you approve them" server-side (fails
                    closed into review, never silently opens the door) until
                    that larger feature ships. */}
                <TouchableOpacity
                  style={[styles.policyPill, styles.policyPillWide, joinPolicy === 'invite_only' && styles.policyPillOn]}
                  accessibilityRole="radio" accessibilityState={{ selected: joinPolicy === 'invite_only' }}
                    onPress={() => { hapticLight(); setJoinPolicyLocal('invite_only'); }}
                  activeOpacity={0.85}
                >
                  {/* copy to the taste gate */}
                  <Text style={[styles.policyText, joinPolicy === 'invite_only' && styles.policyTextOn]}>
                    invite only
                  </Text>
                </TouchableOpacity>
                {joinPolicy === 'invite_only' && (
                  <Text style={styles.policyNote}>
                    invite codes aren't built yet. for now, invite only works like "you approve them": you review every request.
                  </Text>
                )}
              </>
            )}

            <Text style={styles.fieldLabel}>your intro question</Text>
            <Text style={styles.fieldHint}>
              their answer becomes their introduction, posted into the community chat
              when you approve them.
            </Text>
            <TextInput
              style={styles.input}
              accessibilityLabel="Introduction question"
              value={question}
              onChangeText={(value) => { if (current() && !actionLock.current) setQuestion(value); }}
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
                  onPress={() => { if (!current() || actionLock.current) return; hapticLight(); setAskReason((v) => !v); }}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.policyText, askReason && styles.policyTextOn]}>
                    ask their reason for joining
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.policyPill, styles.policyPillWide, askSource && styles.policyPillOn]}
                  accessibilityRole="checkbox" accessibilityState={{ checked: askSource }}
                  onPress={() => { if (!current() || actionLock.current) return; hapticLight(); setAskSource((v) => !v); }}
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
                  onPress={() => { if (!current() || actionLock.current) return; hapticLight(); setAskRulesConfirm((v) => !v); }}
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
                  onChangeText={(value) => { if (current() && !actionLock.current) setOpenQuestion(value); }}
                  maxLength={200}
                  placeholder="ask anything else you want to know"
                  placeholderTextColor={Colors.inkSoft}
                  inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
                />
              </>
            )}

            <Text style={styles.fieldLabel}>guidelines link</Text>
            <Text style={styles.fieldHint}>
              joiners accept these before they can ask. leave empty to use the
              washedup guidelines.
            </Text>
            <TextInput
              style={styles.input}
              accessibilityLabel="Guidelines link"
              value={guidelines}
              onChangeText={(value) => { if (current() && !actionLock.current) setGuidelines(value); }}
              autoCapitalize="none"
              keyboardType="url"
              placeholder="https://"
              placeholderTextColor={Colors.inkSoft}
              inputAccessoryViewID={KEYBOARD_DONE_ACCESSORY_ID}
            />

            <TouchableOpacity style={styles.previewBtn} onPress={() => { if (current() && seeded && !settingsError) { hapticLight(); setPreviewVisible(true); } }}>
              <Text style={styles.previewBtnText}>preview</Text>
            </TouchableOpacity>

            <TouchableOpacity style={[styles.saveBtn, saving && styles.saveBtnBusy]} onPress={handleSave} disabled={saving}>
              {saving ? (
                <ActivityIndicator size="small" color={Colors.white} />
              ) : (
                <Text style={styles.saveBtnText}>save</Text>
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
