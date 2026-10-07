import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AfterglowColors as C } from '../../constants/Colors';
import { AfterglowType as T } from '../../constants/Typography';
import { useAfterglowFonts } from '../../hooks/useAfterglowFonts';
import { useCreatorPageScope } from '../../hooks/useCreatorPageScope';
import { useCreatorPageRead } from '../../hooks/useCreatorPageRead';
import type { CreatorPageScope } from '../../lib/creatorPageReview';
import { friendlyError } from '../../lib/friendlyError';
import { waitForCommunityJoin } from '../../lib/communityJoinWait';
import { RequestDeadlineError } from '../../lib/requestWithDeadline';
import { getJoinGate, type JoinAnswers } from '../../lib/communityJoin';
import { readCreatorCommunityJoinGate, readOwnCommunityMembership, readCommunityJoinAttempt, checkCommunityJoinRequest,
  sendCommunityJoinRequest, cancelCommunityJoinRequest, finishCommunityJoinRequest,
  type CommunityJoinAttempt, type CommunityJoinReceipt, type CreatorCommunityJoinGate } from '../../lib/creatorCommunityJoin';
import { JoinCommunityPopup } from './JoinCommunityPopup';
import { PageAction } from '../creator/pages/PageFrame';

interface Props { communityId: string; visible: boolean; legacyJoinsInstantly: boolean; onClose(): void; onConfirmed(): void; onOpen?(): void; }
export function CommunityJoinEntry({ communityId, visible, legacyJoinsInstantly, onClose, onConfirmed, onOpen }: Props) {
  const observed = useCreatorPageScope(`community-admission:${communityId}`), { fonts } = useAfterglowFonts();
  const visit = useMemo(() => ({}), [visible, observed.scope]);
  const latest = useRef(visit);
  useLayoutEffect(() => { latest.current = visit; }, [visit]);
  const scope = useMemo<CreatorPageScope | null>(() => visible && observed.scope ? {
    userId: observed.scope.userId, isCurrent: () => latest.current === visit && observed.scope!.isCurrent(),
  } : null, [visible, observed.scope, visit]);
  const read = useCallback((owned: CreatorPageScope) => waitForCommunityJoin(owned, async reading => {
    const gate = await readCreatorCommunityJoinGate(communityId, reading);
    if (!reading.isCurrent()) throw Error('This visit has changed.');
    if (!gate) { const legacy = await getJoinGate(communityId); if (!reading.isCurrent()) throw Error('This visit has changed.'); return { legacy }; }
    const attempt = await readCommunityJoinAttempt(communityId, reading);
    if (!reading.isCurrent()) throw Error('This visit has changed.');
    const receipt = attempt ? await checkCommunityJoinRequest(communityId, reading) : null;
    if (!reading.isCurrent()) throw Error('This visit has changed.');
    const membership = await readOwnCommunityMembership(communityId, reading);
    if (!reading.isCurrent()) throw Error('This visit has changed.');
    return { gate, attempt, receipt, membership };
  }), [communityId]);
  const saved = useCreatorPageRead(scope, read);
  const readRetained = useCallback((owned: CreatorPageScope) => waitForCommunityJoin(owned, reading => readCommunityJoinAttempt(communityId, reading)), [communityId]);
  const retained = useCreatorPageRead(!visible ? observed.scope : null, readRetained);
  const [activity, setActivity] = useState<{ scope: CreatorPageScope; busy?: boolean; message?: string; localAttempt?: CommunityJoinAttempt | null; receipt?: CommunityJoinReceipt | null; uncertain?: boolean; questionsChanged?: boolean }>();
  const own = activity?.scope === scope ? activity : undefined;
  const lock = useRef<{ scope: CreatorPageScope } | null>(null);
  const memory = useRef<{ scope: CreatorPageScope; gate: CreatorCommunityJoinGate; answers: JoinAnswers } | null>(null);
  useLayoutEffect(() => {
    if (memory.current && memory.current.scope !== scope) memory.current = null;
  }, [scope]);
  const [generation, setGeneration] = useState(0);
  const data = saved.data;
  const pending = own?.localAttempt !== undefined ? own.localAttempt : data?.attempt;
  const result = own?.receipt !== undefined ? own.receipt : data?.receipt;
  const status = result?.current_status ?? data?.membership?.status;
  const joined = result?.outcome !== 'cancelled' && (status === 'active' || status === 'pending');
  const resolved = !!result || (!pending && joined);
  const busy = !!own?.busy;
  const formLocked = busy || !!pending || !!own?.uncertain || joined || !!result;
  const message = busy ? 'Checking your joining request…' : own?.message ?? (result?.outcome === 'cancelled' ? 'The unfinished request is cancelled. You can review the questions and start again.'
    : status === 'active' ? 'You’re in. Your community membership is confirmed.'
    : status === 'pending' ? 'Your request is saved and waiting for review.'
    : result ? 'This request is finished. Your current membership has changed; continue to the community for its current status.'
    : pending || own?.uncertain ? 'Your request is not yet confirmed. Check its status before starting another.' : undefined);
  const close = () => { if (scope?.isCurrent()) onClose(); };
  async function run(operation: (owned: CreatorPageScope) => Promise<CommunityJoinReceipt | null>, finish: 'close' | 'restart' | 'review' | null = null) {
    if (!scope?.isCurrent() || lock.current?.scope === scope) return;
    const owned = scope, task = { scope: owned };
    lock.current = task;
    const current = () => owned.isCurrent() && lock.current === task;
    const operationScope = { userId: owned.userId, isCurrent: current };
    let failed = false, timedOut = false;
    setActivity(old => ({ ...(old?.scope === owned ? old : {}), scope: owned, busy: true }));
    try {
      const receipt = await waitForCommunityJoin(operationScope, operation);
      if (!current()) return;
      if (finish === 'review') {
        if (receipt?.outcome === 'submitted') finish = null;
        else {
          if (receipt?.outcome !== 'cancelled') throw Error('The earlier request is still unconfirmed.');
          setActivity({ scope: owned, receipt, busy: true, questionsChanged: false });
          await waitForCommunityJoin(operationScope, checking => finishCommunityJoinRequest(communityId, checking));
          if (!current()) return;
        }
      }
      if (finish) {
        memory.current = null;
        if (finish === 'close') { onConfirmed(); return; }
        await saved.refresh();
        if (current()) { setActivity({ scope: owned, localAttempt: null, receipt: null }); setGeneration(n => n + 1); }
      } else setActivity(old => ({ ...(old?.scope === owned ? old : {}), scope: owned, receipt,
        questionsChanged: receipt ? false : old?.questionsChanged,
        message: receipt ? undefined : 'Still unconfirmed. You can check again or cancel the unfinished request.' }));
    } catch (failure) {
      failed = true; timedOut = failure instanceof RequestDeadlineError;
      if (current()) setActivity(old => ({ ...(old?.scope === owned ? old : {}), scope: owned,
        uncertain: timedOut || old?.uncertain,
        questionsChanged: old?.questionsChanged || (failure as { code?: string } | null)?.code === 'PT409',
        message: friendlyError(failure, 'This request could not be confirmed. Please check its status.') }));
    } finally {
      // Keep this UI attempt owned until its bounded bookkeeping settles. The
      // service's independent mutex remains held until its real promise settles.
      if (current()) {
        try {
          const attempt = await waitForCommunityJoin(operationScope, reading => readCommunityJoinAttempt(communityId, reading));
          if (current()) setActivity(old => ({ ...(old?.scope === owned ? old : {}), scope: owned, busy: false,
            localAttempt: attempt, uncertain: timedOut || (failed && !!old?.uncertain) }));
        } catch {
          if (current()) setActivity(old => ({ ...(old?.scope === owned ? old : {}), scope: owned, busy: false, uncertain: true }));
        }
      }
      if (lock.current === task) lock.current = null;
    }
  }
  if (!visible) return onOpen && (retained.data || retained.error) ? <View style={{ paddingHorizontal: 20, paddingVertical: 8, backgroundColor: C.paper }}>
    <PageAction title="Check joining request" onPress={() => { if (observed.scope?.isCurrent()) onOpen(); }} />
  </View> : null;
  // The native host stays mounted as loading/recovery becomes either form.
  // Only the keyed form content resets when identity or question generation changes.
  const present = (content: React.ReactNode) => <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>{content}</Modal>;
  if (data?.legacy) return present(<JoinCommunityPopup embedded key={`${scope?.userId}:${communityId}`} visible gate={data.legacy} joinsInstantly={legacyJoinsInstantly} onClose={close} onRequested={() => { if (scope?.isCurrent()) onConfirmed(); }} />);
  const gate = data?.gate;
  if (!scope || !gate) return present(
    <SafeAreaView style={{ flex: 1, backgroundColor: C.paper }}>
      <View style={{ padding: 20, gap: 16 }}>
        <PageAction title="Close" onPress={onClose} />
        <Text accessibilityRole="header" style={{ ...T.pageSection, fontFamily: fonts.semibold, color: C.ink }}>Join this community</Text>
        {(saved.loading || observed.account.isLoading) && <ActivityIndicator accessibilityLabel="Loading joining questions" color={C.clay} />}
        <Text style={{ ...T.body, fontFamily: fonts.regular, color: C.ink }}>{observed.account.error?.message ?? saved.error ?? (!scope && !observed.account.isLoading ? 'Sign in to join this community.' : !saved.loading ? 'This community is unavailable.' : 'Checking the current joining questions…')}</Text>
        <PageAction title="Try again" onPress={() => { if (scope) void saved.refresh().catch(() => undefined); else void observed.account.retry(); }} />
      </View>
    </SafeAreaView>
  );
  const canRetry = pending && memory.current?.scope === scope && !result && !own?.questionsChanged;
  const footer = <View style={{ gap: 8, marginVertical: 12 }}>
    {!!saved.error && <Text style={{ ...T.body, fontFamily: fonts.regular, color: C.muted }}>{saved.error}</Text>}
    {resolved ? <PageAction title={result?.outcome === 'cancelled' ? 'Review questions' : 'Continue'} disabled={busy}
      onPress={() => void run(owned => pending ? finishCommunityJoinRequest(communityId, owned) : Promise.resolve(null), result?.outcome === 'cancelled' ? 'restart' : 'close')} /> : null}
    {(pending || own?.uncertain) && !result ? <>
      <PageAction title="Check request status" disabled={busy} onPress={() => void run(owned => checkCommunityJoinRequest(communityId, owned))} />
      {canRetry && <PageAction title="Retry same request" disabled={busy} onPress={() => void run(owned => sendCommunityJoinRequest(memory.current!.gate, memory.current!.answers, owned))} />}
      {own?.questionsChanged
        ? <PageAction title="Review updated questions" disabled={busy} onPress={() => void run(owned => cancelCommunityJoinRequest(communityId, owned), 'review')} />
        : <PageAction title="Cancel unfinished request" disabled={busy} onPress={() => void run(owned => cancelCommunityJoinRequest(communityId, owned))} /> }
      <Text style={{ ...T.caption, fontFamily: fonts.regular, color: C.muted }}>If your request already went through, we’ll show its status. Cancelling here won’t leave a community.</Text>
    </> : null}
  </View>;
  return present(<JoinCommunityPopup embedded key={`${scope.userId}:${communityId}:${generation}`} visible gate={gate} joinsInstantly={gate.creatorPagePolicy === 'open'} onClose={close} onRequested={onConfirmed}
    flow={{ locked: formLocked, busy, message, footer, submit: async answers => {
      if (!scope.isCurrent() || lock.current?.scope === scope) return;
      memory.current = { scope, gate, answers };
      await run(owned => sendCommunityJoinRequest(gate, answers, owned));
    } }} />);
}
