import React, {useCallback, useEffect, useRef, useState} from 'react';
import {ActivityIndicator, AppState, StyleSheet, Text, View} from 'react-native';
import {router} from 'expo-router';
import {useCreatorPageScope} from '../../../hooks/useCreatorPageScope';
import {useAfterglowFonts} from '../../../hooks/useAfterglowFonts';
import {LinearGradient} from 'expo-linear-gradient';
import {createPageEventReuseOperation} from '../../../lib/creatorPageEventReuseOperation';
import {AfterglowColors, CreatorSurfaceColors} from '../../../constants/Colors';
import {CreatorPageScopeExpired, type CreatorPageScope} from '../../../lib/creatorPageReview';
import {getPageEventSaveState} from '../../../lib/creatorPageEventSave';
import {getPageEventReuseSelection, getPageEventReuseWorkspace, readPageEventReuseEntry, acknowledgePageEventReuseEntry,
  preparePageEventReuseEntry, startPageEventReuseEntry, type PageEventReuseEntryState} from '../../../lib/creatorPageEventReuseEntry';
import type {PageEventReuseSource, PageEventReuseProgress} from '../../../lib/creatorPageEventReuse';
import {PageAction, PageFrame, pageStyles as s} from './PageFrame';

export default function CreatorPageEventReuseScreen({pageId, source}: {pageId: string; source: PageEventReuseSource}) {
  const sourceKey = `${source.kind}:${source.eventId}:${source.kind === 'template' ? source.templateId : ''}`;
  const {scope, account} = useCreatorPageScope(`reuse:${pageId}:${sourceKey}`), {fonts} = useAfterglowFonts(true, 'creator');
  type Visit = {scope: CreatorPageScope; loading?: boolean; busy?: boolean; title?: string; pageName?: string;
    operation?: 'copy' | 'keep'; original?: PageEventReuseEntryState; pending?: boolean; error?: string; progress?: PageEventReuseProgress; paused?: boolean; categories?: string[]};
  const [visit, setVisit] = useState<Visit>();
  type Operation = ReturnType<typeof createPageEventReuseOperation> & {owner: CreatorPageScope; task?: ReturnType<typeof startPageEventReuseEntry>};
  const lock = useRef<Operation | null>(null);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; lock.current?.cancel(); }; }, []);
  const current = (owned: CreatorPageScope) => mounted.current && owned.isCurrent();
  const show = (owned: CreatorPageScope, patch: Partial<Visit>) => {
    if (current(owned)) setVisit(v => ({...(v?.scope === owned ? v : {scope: owned}), ...patch}));
  };
  const state = visit?.scope === scope ? visit : undefined;
  const begin = (owner: CreatorPageScope): Operation => {
    const operation: Operation = {...createPageEventReuseOperation({userId: owner.userId,
      isCurrent: () => AppState.currentState === 'active' && current(owner)}, () => operation.task?.cancel()), owner};
    lock.current = operation; return operation;
  };
  const finish = (operation: Operation) => {
    operation.finish();
    if (lock.current !== operation) return;
    lock.current = null; show(operation.owner, {loading: false, busy: false});
  };
  const showResult = (operation: Operation, original: PageEventReuseEntryState) => {
    if (!operation.scope.isCurrent() || lock.current !== operation) return;
    show(operation.owner, {original, title: original.event?.fields.title ?? original.saved?.fields?.title ?? original.attempt.title,
      categories: original.attempt.categories, pending: !['saved', 'kept'].includes(original.stage), progress: undefined});
  };
  const check = useCallback(async () => {
    if (!scope?.isCurrent() || lock.current?.owner === scope) return;
    const operation = begin(scope), owned = operation.scope;
    show(scope, {loading: true, error: undefined, title: undefined, original: undefined, paused: false, progress: undefined});
    try {
      const attempt = await operation.wait(readPageEventReuseEntry(pageId, owned), 25_000);
      if (attempt) {
        operation.task = startPageEventReuseEntry(pageId, owned, 'check');
        showResult(operation, await operation.wait(operation.task.done, 25_000));
      } else {
        const page = await operation.wait(getPageEventReuseWorkspace(pageId, owned), 25_000);
        const selected = await operation.wait(getPageEventReuseSelection(source, owned), 25_000);
        show(scope, {title: selected.title, categories: selected.categories, pageName: page.name, pending: false});
      }
    } catch {
      if (lock.current === operation) show(scope, {error: 'Couldn’t check this copy. Try again to load the event or recover an earlier copy.', title: undefined});
    } finally { finish(operation); }
  }, [scope, pageId, sourceKey]);
  useEffect(() => { void check(); return () => { lock.current?.cancel(); }; }, [check]);
  useEffect(() => {
    const listener = AppState.addEventListener('change', next => {
      if (next !== 'active' && scope && lock.current?.owner === scope) { lock.current.cancel(); show(scope, {paused: true}); }
    });
    return () => listener.remove();
  }, [scope]);

  const resume = async () => {
    if (!scope?.isCurrent() || lock.current?.owner === scope || state?.loading || state?.busy || state?.error || !state?.title || state.original?.stage === 'conflict') return;
    const operation = begin(scope), owned = operation.scope;
    show(scope, {busy: true, error: undefined, paused: false, operation: 'copy'});
    try {
      const prepared = await operation.wait(preparePageEventReuseEntry(pageId, source, owned), 25_000);
      // A newly selected source cannot silently resume an earlier pending copy.
      if (!prepared.created && (!state.original || state.original.attempt.eventId !== prepared.attempt.eventId)) {
        show(scope, {pending: true, error: 'An earlier copy needs your attention. Check it before continuing.', title: undefined}); return;
      }
      operation.task = startPageEventReuseEntry(pageId, owned, 'retry', progress => {
        if (owned.isCurrent() && lock.current === operation) show(scope, {progress});
      });
      // Each service request has its own deadline; media retains progress-based
      // stall detection, so a healthy large transfer is not cut short here.
      showResult(operation, await operation.wait(operation.task.done));
    } catch {
      if (lock.current === operation) show(scope, {pending: true, error: 'This copy is not confirmed. Check the saved attempt to continue with the same event.'});
    } finally { finish(operation); }
  };
  const keep = async () => {
    if (!scope?.isCurrent() || lock.current?.owner === scope || state?.loading || state?.busy || !state?.original
      || !['conflict', 'stopping', 'kept'].includes(state.original.stage)) return;
    const operation = begin(scope);
    show(scope, {busy: true, error: undefined, paused: false, operation: 'keep'});
    try {
      operation.task = startPageEventReuseEntry(pageId, operation.scope, 'keep');
      showResult(operation, await operation.wait(operation.task.done));
    } catch {
      if (lock.current === operation) show(scope, {error: 'Couldn’t finish keeping this event. Your existing event and recovery details are preserved. Check again to continue.'});
    } finally { finish(operation); }
  };
  const open = async () => {
    if (!scope?.isCurrent() || lock.current?.owner === scope || !['saved', 'kept'].includes(state?.original?.stage ?? '')) return;
    const original = state!.original!, operation = begin(scope), owned = operation.scope;
    show(scope, {busy: true, error: undefined, paused: false, operation: undefined});
    try {
      const event = await operation.wait(getPageEventSaveState(pageId, original.attempt.eventId, owned), 25_000);
      if (event.eventId !== original.attempt.eventId || event.pageId !== pageId) throw new CreatorPageScopeExpired();
      await operation.wait(acknowledgePageEventReuseEntry(original.attempt, owned), 25_000);
      router.replace(`/creator/event-form?id=${original.attempt.eventId}&pageId=${pageId}${original.entry === 'team' ? '&team=1' : ''}` as never);
    } catch {
      if (lock.current === operation) show(scope, {error: 'Couldn’t open the saved event. Check your access and try again.'});
    } finally { finish(operation); }
  };
  const busy = !!state?.busy || !!state?.loading;
  const text = [s.body, {fontFamily: fonts.regular}], small = [s.small, {fontFamily: fonts.regular}];
  return <PageFrame title={source.kind === 'template' ? 'Use template' : 'Duplicate event'} busy={busy}>
    {(account.isLoading || state?.loading) && <ActivityIndicator accessibilityLabel="Checking event copy" color={AfterglowColors.clay} />}
    {(account.error || state?.error) && <View style={[s.notice, styles.notice]}>
      <Text accessibilityRole="alert" style={small}>{account.error ? 'Couldn’t check this account. Try again.' : state?.error}</Text>
      <PageAction title="Check copy" singleLine disabled={busy} onPress={() => void (account.error ? account.retry() : check())} />
    </View>}
    {!account.isLoading && !scope && !account.error && <Text style={text}>Sign in to prepare an event for this page.</Text>}
    {state?.title && !state.error && scope?.isCurrent() && <>
      <LinearGradient colors={[CreatorSurfaceColors.sunsetGoldLight, AfterglowColors.white]} start={{x: 0, y: 0}} end={{x: 1, y: 1}} style={styles.source}>
        {state.pageName && <Text style={small}>{state.pageName}</Text>}
        <Text accessibilityRole="header" style={[s.heading, styles.title, {fontFamily: fonts.display}]}>{state.title}</Text>
        {!!state.categories?.length && <View style={styles.categories}>{state.categories.map(category => <Text key={category} style={[small, styles.category]}>{category.charAt(0).toUpperCase() + category.slice(1)}</Text>)}</View>}
      </LinearGradient>
      <Text accessibilityRole={state.original?.stage === 'conflict' ? 'alert' : undefined} style={text}>{state.original?.stage === 'conflict'
        ? state.original.conflict === 'source'
          ? 'The source changed after this copy started. Keep the event without continuing this copy, then review it. If creation was interrupted, the same private draft will be recovered.'
          : 'The destination changed after this copy started. Keep its newer content and review it. The original copy will be checked first.'
        : state.original?.stage === 'stopping' ? 'Keeping this event is not confirmed yet. Continue the original recovery; it will not restart copying.'
        : state.original?.stage === 'kept' ? 'Your event is kept. Open it to review its content. Its publication status has not changed.'
        : state.original?.stage === 'saved'
        ? 'Your copy is saved. Open it to choose dates, review ticket settings and decide when to publish.'
        : state.pending ? 'Continue this original copy into the same saved draft. Its dates will be blank for you to choose again.'
          : 'Create a private draft with this event’s story and media. Choose fresh dates and review ticket settings before publishing.'}</Text>
      {state.progress && <Text accessibilityRole="progressbar" accessibilityValue={{min: 0, max: state.progress.total, now: state.progress.completed}} style={small}>{state.progress.completed} of {state.progress.total} media items copied</Text>}
      {state.paused && <Text accessibilityRole="alert" style={small}>{state.operation === 'keep' ? 'Recovery paused. Check the original attempt before continuing.' : 'Copy paused. Its original attempt is kept for a check.'}</Text>}
      {['saved', 'kept'].includes(state.original?.stage ?? '') ? <>
        <View style={styles.actions}><PageAction primary title="Open event" singleLine disabled={busy} onPress={() => void open()} />
        {state.original?.cleanupPending && <><Text style={small}>Your event is saved. Its original copy files still need cleanup; they remain available for recovery.</Text><PageAction title={state.original?.stage === 'kept' ? 'Finish cleanup' : 'Check copy'} singleLine disabled={busy} onPress={() => void (state.original?.stage === 'kept' ? keep() : check())} /></>}
      </View></> : ['conflict', 'stopping'].includes(state.original?.stage ?? '') ? <View style={styles.actions}>
        <PageAction primary title="Keep event" singleLine disabled={busy} onPress={() => void keep()} />
        <PageAction title="Check copy" singleLine disabled={busy} onPress={() => void check()} />
      </View> : <PageAction primary title={state.pending ? 'Resume copy' : 'Create draft'} singleLine disabled={busy} onPress={() => void resume()} />}
    </>}
    {state?.busy && <View style={styles.pause}><PageAction title={state.operation === 'keep' ? 'Pause recovery' : 'Pause copy'} singleLine onPress={() => { lock.current?.cancel(); if (scope) show(scope, {paused: true}); }} /></View>}
  </PageFrame>;
}

const styles = StyleSheet.create({
  source: {padding: 20, gap: 10, borderRadius: 20, borderWidth: 1, borderColor: CreatorSurfaceColors.goldEdge, marginBottom: 24},
  title: {marginBottom: 0},
  categories: {flexDirection: 'row', flexWrap: 'wrap', gap: 8},
  category: {backgroundColor: AfterglowColors.white, color: AfterglowColors.ink, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12},
  actions: {gap: 12},
  pause: {marginTop: 12},
  notice: {backgroundColor: CreatorSurfaceColors.sunsetGoldLight, borderColor: CreatorSurfaceColors.goldEdge, borderRadius: 16},
});
