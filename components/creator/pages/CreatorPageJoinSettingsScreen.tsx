import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useCreatorPageScope } from '../../../hooks/useCreatorPageScope';
import { useCreatorPageRead } from '../../../hooks/useCreatorPageRead';
import { useAfterglowFonts } from '../../../hooks/useAfterglowFonts';
import { CreatorSurfaceColors } from '../../../constants/Colors';
import { requestWithDeadline, RequestDeadlineError } from '../../../lib/requestWithDeadline';
import type { CreatorPageScope } from '../../../lib/creatorPageReview';
import { loadPageJoinEditor, persistPageJoinDraft, savePageJoinDraft, resolvePageJoinSave, draftFromPageJoinState,
  type PageJoinDraft, type PageJoinSettings } from '../../../lib/creatorPageJoinSettings';
import { Field } from '../ApplyFormKit';
import { PageFrame, PageAction, pageStyles as s } from './PageFrame';

const ACTION_WAIT_MS = 12_000;
type JoinAction = 'save' | 'leave' | 'load' | 'check';
type JoinAttempt = {
  scope: CreatorPageScope; kind: JoinAction; settled: boolean;
  result?: PageJoinDraft; failed?: boolean;
};

export default function CreatorPageJoinSettingsScreen({ pageId }: { pageId: string }) {
  const { scope, account } = useCreatorPageScope(`joining:${pageId}`), { fonts } = useAfterglowFonts(true, 'creator');
  const read = useCallback((owned: CreatorPageScope) => requestWithDeadline(loadPageJoinEditor(pageId, owned), ACTION_WAIT_MS), [pageId]);
  const saved = useCreatorPageRead(scope, read);
  const [working, setWorking] = useState<{ scope: CreatorPageScope; draft: PageJoinDraft }>();
  const [activity, setActivity] = useState<{ scope: CreatorPageScope; busy?: boolean; message?: string; recovery?: boolean }>();
  const lock = useRef<CreatorPageScope | null>(null);
  const attempt = useRef<JoinAttempt | null>(null);
  const mounted = useRef(true), latestScope = useRef(scope), edit = useRef(0);
  useLayoutEffect(() => { latestScope.current = scope; }, [scope]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const current = (owned: CreatorPageScope) => mounted.current && latestScope.current === owned && owned.isCurrent();
  const own = activity?.scope === scope ? activity : undefined;
  const draft = working?.scope === scope ? working.draft : undefined;
  const ownAttempt = attempt.current?.scope === scope ? attempt.current : undefined;
  useEffect(() => {
    if (scope && saved.data) setWorking(old => old?.scope === scope && !saved.data!.draft.pending
      ? old : { scope, draft: saved.data!.draft });
  }, [scope, saved.data]);
  const busy = !!own?.busy, canEdit = !!scope && !!draft && !busy && !ownAttempt && !saved.loading && !saved.error && !saved.data?.conflict && !draft.pending;
  const run = async (kind: JoinAction, action: (owned: CreatorPageScope) => Promise<PageJoinDraft | void>, complete?: (result?: PageJoinDraft) => void) => {
    if (!scope || !current(scope) || lock.current === scope || attempt.current?.scope === scope) return;
    const owned = scope, original: JoinAttempt = { scope: owned, kind, settled: false };
    lock.current = owned; attempt.current = original; ++edit.current; setActivity({ scope: owned, busy: true });
    // The UI deadline never releases or races the service's serialized storage write.
    // Keep the original attempt until it settles and the creator explicitly checks it.
    const pending = Promise.resolve().then(() => { if (!current(owned)) throw new Error('This page is no longer active.'); return action(owned); }).then(result => {
      original.settled = true; original.result = result || undefined; return result;
    }, error => { original.settled = true; original.failed = true; throw error; });
    try {
      const result = await requestWithDeadline(pending, ACTION_WAIT_MS);
      if (!current(owned) || attempt.current !== original) return;
      attempt.current = null;
      if (result) setWorking({ scope: owned, draft: result });
      complete?.(result || undefined);
    } catch (error) {
      if (!current(owned) || attempt.current !== original) return;
      if (error instanceof RequestDeadlineError) {
        setActivity({ scope: owned, recovery: true, message: kind === 'leave'
          ? 'Your draft is taking longer to save on this device. Stay here and check before leaving.'
          : 'This is taking longer than expected. Your edits are still here. Check the original result before continuing.' });
      } else {
        // A rejected save may already have a durable pending receipt. Read it before retrying.
        try { await saved.refresh(); } catch { /* The hook retains the draft and offers a fresh check. */ }
        if (!current(owned) || attempt.current !== original) return;
        attempt.current = null;
        setActivity({ scope: owned, message: error instanceof Error ? error.message : 'This result could not be confirmed. Check your saved settings.' });
      }
    } finally {
      if (lock.current === owned) lock.current = null;
      if (current(owned)) setActivity(old => old?.scope === owned ? { ...old, busy: false } : old);
    }
  };
  const change = (patch: Partial<PageJoinSettings>) => {
    if (!canEdit || !draft || !scope || !current(scope) || lock.current === scope) return;
    const owned = scope, revision = ++edit.current, next = { ...draft, settings: { ...draft.settings, ...patch } };
    setWorking({ scope: owned, draft: next }); setActivity({ scope: owned });
    void persistPageJoinDraft(next, owned).catch(() => {
      if (current(owned) && edit.current === revision && lock.current !== owned) setActivity({ scope: owned, message: 'Your latest edits are not saved on this device. Keep this page open and try Save settings again.' });
    });
  };
  const check = () => { void (async () => {
    if (!scope || !current(scope) || lock.current === scope) return;
    const owned = scope, original = attempt.current?.scope === scope ? attempt.current : undefined;
    if (original) {
      lock.current = owned; setActivity({ scope: owned, busy: true, recovery: true });
      try {
        await saved.refresh();
        if (!current(owned) || attempt.current !== original) return;
        if (!original.settled) {
          setActivity({ scope: owned, recovery: true, message: 'The original action is still finishing. Your edits are safe here. Check again in a moment.' });
          return;
        }
        attempt.current = null;
        if (original.result) setWorking({ scope: owned, draft: original.result });
        if (original.kind === 'leave' && !original.failed) {
          setActivity({ scope: owned, message: 'Your draft is saved on this device. You can go back when you’re ready.' });
          return;
        }
      } catch (error) {
        if (current(owned)) setActivity({ scope: owned, recovery: true, message: error instanceof RequestDeadlineError
          ? 'The status check took too long. Your edits are still here. Try checking again.'
          : error instanceof Error ? error.message : 'The result could not be checked.' });
        return;
      } finally {
        if (lock.current === owned) lock.current = null;
        if (current(owned)) setActivity(old => old?.scope === owned ? { ...old, busy: false } : old);
      }
    }
    if (!current(owned)) return;
    void run('check', async live => {
      const result = await saved.refresh();
      if (!current(live) || !result) return;
      if (result.confirmed) {
        const next = await resolvePageJoinSave(pageId, live);
        if (current(live)) await saved.refresh();
        return next;
      }
    }, () => {
      if (current(owned)) setActivity({ scope: owned, message: 'Saved status checked.' });
    });
  })(); };
  const save = () => {
    if (!draft || !scope || !current(scope) || saved.error || saved.loading || saved.data?.conflict) return;
    const owned = scope;
    void run('save', live => savePageJoinDraft(draft, live), () => {
      setActivity({ scope: owned, message: 'Joining settings saved.' });
      void saved.refresh().catch(() => undefined);
    });
  };
  const back = () => {
    if (!scope) { if (mounted.current && latestScope.current === scope) router.dismissTo(`/creator/page?id=${pageId}` as never); return; }
    const owned = scope;
    void run('leave', async live => { if (draft) await persistPageJoinDraft(draft, live); }, () => {
      if (current(owned)) router.dismissTo(`/creator/page?id=${pageId}` as never);
    });
  };
  const toggle = (label: string, checked: boolean, onChange: () => void, hint?: string) => <Pressable accessibilityRole="checkbox"
    accessibilityLabel={label} accessibilityState={{ checked, disabled: !canEdit }} disabled={!canEdit} onPress={onChange} style={s.row}>
    <Text style={[s.rowTitle, { fontFamily: fonts.semibold }]}>{checked ? '✓ ' : '○ '}{label}</Text>
    {hint && <Text style={[s.small, { fontFamily: fonts.regular }]}>{hint}</Text>}
  </Pressable>;
  const textField = (label: string, name: 'join_welcome_message' | 'join_intro_question' | 'guidelines_url' | 'join_open_question', maxLength?: number) => <Field
    label={label} value={draft?.settings[name] ?? ''} onChange={value => change({ [name]: value })} editable={canEdit}
    multiline={name !== 'guidelines_url'} autoCapitalize={name === 'guidelines_url' ? 'none' : 'sentences'} maxLength={maxLength} appearance={{ fonts }} />;
  return <PageFrame title="Joining questions" busy={busy} onBack={back}>
    {(account.isLoading || saved.loading) && !saved.data && <Text accessibilityRole="text" style={[s.body, { fontFamily: fonts.regular }]}>Loading joining settings…</Text>}
    {(account.error || saved.error) && <View style={s.notice}><Text accessibilityRole="alert" style={[s.body, { fontFamily: fonts.regular }]}>{saved.error || 'Your account could not be checked.'}</Text>
      <PageAction singleLine title="Try again" disabled={busy} onPress={() => { if (account.error) void account.retry(); else check(); }} /></View>}
    {own?.recovery ? <View style={[s.notice, styles.recovery]}>
      {own.message && <Text accessibilityRole="alert" style={[s.small, { fontFamily: fonts.regular }]}>{own.message}</Text>}
      <PageAction singleLine title="Check status" disabled={busy} onPress={check} />
    </View> : own?.message && own.message !== 'Joining settings saved.' && <Text accessibilityRole="alert" style={[s.body, { fontFamily: fonts.regular }]}>{own.message}</Text>}
    {draft && saved.data && <>
      <Text style={[s.eyebrow, { fontFamily: fonts.semibold }]}>{saved.data.state.name}</Text>
      <Text accessibilityRole="header" style={[s.heading, { fontFamily: fonts.display }]}>A welcoming way in.</Text>
      <Text style={[s.body, { fontFamily: fonts.regular }]}>{saved.data.state.published ? 'These settings apply to new people joining your community.' : 'Prepare how people join. Your page stays private until it is approved and you publish it.'}</Text>
      <Text style={[s.small, { fontFamily: fonts.regular }]}>Every new member provides their contact details and writes an introduction. The introduction is shared after confirmed admission; other answers stay private.</Text>
      {saved.data.conflict ? <View style={s.notice}><Text accessibilityRole="alert" style={[s.body, { fontFamily: fonts.regular }]}>Joining settings changed elsewhere. Your draft is still here. Loading the saved settings replaces your local edits.</Text>
        <PageAction singleLine title="Load saved" disabled={busy || saved.loading || !!ownAttempt} onPress={() => { void run('load', async owned => {
          const latest = await requestWithDeadline(loadPageJoinEditor(pageId, owned), ACTION_WAIT_MS); const next = draftFromPageJoinState(latest.state); await persistPageJoinDraft(next, owned); return next;
        }, () => { void saved.refresh().catch(() => undefined); }); }} /></View> : draft.pending && !own?.recovery ? <View style={s.notice}><Text style={[s.body, { fontFamily: fonts.regular }]}>{saved.data.confirmed ? 'Your settings match the saved version. Finish checking to continue editing.' : 'Your last save is unconfirmed. Check its status before making another change.'}</Text>
        <PageAction singleLine title="Check saved status" disabled={busy || saved.loading || !!ownAttempt} onPress={check} />
        {!saved.data.confirmed && <PageAction singleLine title="Retry same save" disabled={busy || saved.loading || !!saved.error || !!ownAttempt} onPress={save} />}</View> : null}
      {toggle('Request to join', draft.settings.join_policy === 'approval_required', () => change({ join_policy: draft.settings.join_policy === 'open' ? 'approval_required' : 'open' }), 'When on, you approve or decline new requests. When off, eligible people can join without waiting.')}
      <Text style={[s.small, styles.settingsHint, { fontFamily: fonts.regular }]}>{saved.data.state.pending_count ? `${saved.data.state.pending_count} pending request${saved.data.state.pending_count === 1 ? '' : 's'} will stay pending until reviewed. ` : ''}Changing this setting keeps existing members and pending requests as they are.</Text>
      {textField('Welcome message', 'join_welcome_message', 1000)}
      {textField('Introduction prompt', 'join_intro_question', 200)}
      {textField('Guidelines link', 'guidelines_url')}
      <Text accessibilityRole="header" style={[s.section, { fontFamily: fonts.semibold }]}>Private questions</Text>
      {toggle('Reason for joining', draft.settings.join_ask_reason, () => change({ join_ask_reason: !draft.settings.join_ask_reason }))}
      {toggle('How they heard about you', draft.settings.join_ask_source, () => change({ join_ask_source: !draft.settings.join_ask_source }))}
      {(saved.data.state.audience !== 'everyone' || draft.settings.join_ask_rules_confirm) && toggle('Confirm membership requirements', draft.settings.join_ask_rules_confirm, () => change({ join_ask_rules_confirm: !draft.settings.join_ask_rules_confirm }), 'Ask people to confirm they meet this community’s membership requirement.')}
      <View style={styles.customQuestion}>{textField('Your private question', 'join_open_question', 200)}</View>
      <Text style={[s.small, styles.settingsHint, { fontFamily: fonts.regular }]}>Leave your private question blank to remove it from new joining forms. Previously submitted answers are preserved.</Text>
      {own?.message === 'Joining settings saved.' && <Text accessibilityRole="alert" style={[s.body, { fontFamily: fonts.regular }]}>{own.message}</Text>}
      <PageAction singleLine title="Save settings" primary disabled={!canEdit} onPress={save} />
    </>}
  </PageFrame>;
}

const styles = StyleSheet.create({
  settingsHint: { marginBottom: 20 },
  customQuestion: { marginTop: 16 },
  recovery: { backgroundColor: CreatorSurfaceColors.sunsetGoldLight, borderColor: CreatorSurfaceColors.goldEdge, borderRadius: 18 },
});
