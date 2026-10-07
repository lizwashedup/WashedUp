import { useCallback, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { supabase } from '../lib/supabase';
import { acceptWaitlistException, declineWaitlistException } from '../lib/waitlistExceptions';
import { getParticipationNoticeStatus, type ParticipationAssentContext } from '../lib/participationTerms';
import { ChangedPlanParticipationAccount, ObsoletePlanParticipation, recordScopedPlanAssent, requirePlanParticipationAccount,
  requirePlanParticipationCurrent, type PlanParticipationScope } from '../lib/planParticipationScope';

type Options = {
  eventId: string; viewerId: string | null; epoch: number; isCurrent: () => boolean;
  available: boolean; organizerUserId: string | null; organizerName: string;
  onNotice: (isCurrent: () => boolean) => void;
  onNoticeComplete: (isCurrent: () => boolean) => void | Promise<void>;
  onAccepted: () => void; onDeclined: () => void;
  onError: (error: unknown, kind: 'accept' | 'decline') => void;
};
type Stage = 'status' | 'notice' | 'assent' | 'dispatch' | 'notification';
type Entry = { pending: Call | null; completed: boolean };
type Call = PlanParticipationScope & {
  kind: 'accept' | 'decline'; eventId: string; entry: Entry; stage: Stage;
  context: ParticipationAssentContext;
};

/** Existing exception RPCs remain authoritative (RETURNS void). This controller
 * only owns the initiating account/plan/focused visit and its immediate lock. */
export function usePlanExceptionActions(options: Options) {
  const latest = useRef(options); latest.current = options;
  const entries = useRef(new Map<string, Entry>());
  const key = JSON.stringify([options.viewerId, options.eventId]);
  if (!entries.current.has(key)) entries.current.set(key, { pending: null, completed: false });
  const entry = entries.current.get(key)!;
  const owner = useMemo(() => ({ entry }), [options.eventId, options.viewerId, options.epoch]);
  const ownerRef = useRef(owner); ownerRef.current = owner;
  const visit = useRef<object | null>(null);
  const [renderedVisit, setRenderedVisit] = useState<object | null>(null);
  const [, setRevision] = useState(0);
  useFocusEffect(useCallback(() => {
    const value = {}; visit.current = value; setRenderedVisit(value);
    return () => {
      if (visit.current !== value) return;
      visit.current = null;
      // A retired read/notice can be abandoned. A dispatched write keeps its
      // per-plan lock until it settles, even if the same screen is revisited.
      const pending = ownerRef.current.entry.pending;
      if (pending && pending.stage !== 'dispatch' && pending.stage !== 'notification') pending.entry.pending = null;
    };
  }, []));
  const isCurrent = useCallback(() => !!renderedVisit && visit.current === renderedVisit && ownerRef.current === owner && options.isCurrent(),
    [renderedVisit, owner, options.isCurrent]);
  const publish = (changed: Entry) => {
    if (visit.current && ownerRef.current.entry === changed && latest.current.isCurrent()) setRevision(value => value + 1);
  };
  const release = (call: Call) => { if (call.entry.pending === call) { call.entry.pending = null; publish(call.entry); } };
  const start = (kind: Call['kind']): Call | null => {
    const value = latest.current;
    if (!isCurrent() || !value.viewerId || !value.eventId || !value.available || entry.pending || entry.completed) return null;
    const call: Call = {
      kind, eventId: value.eventId, viewerId: value.viewerId, entry, stage: 'status',
      isCurrent: () => isCurrent() && entry.pending === call,
      context: { listingType: 'plan', listingId: value.eventId, organizerUserId: value.organizerUserId, organizerName: value.organizerName, action: 'join' },
    };
    entry.pending = call; publish(entry);
    return call;
  };
  const report = (error: unknown, call: Call) => {
    if (!(error instanceof ObsoletePlanParticipation) && call.isCurrent()) latest.current.onError(error, call.kind);
  };
  const dispatch = async (call: Call) => {
    await requirePlanParticipationAccount(call);
    if (!latest.current.available) throw new Error('This invitation changed. Check the plan before trying again.');
    call.stage = 'dispatch';
    await (call.kind === 'accept' ? acceptWaitlistException(call.eventId) : declineWaitlistException(call.eventId));
    call.entry.completed = true;
    requirePlanParticipationCurrent(call);
    call.stage = 'notification';
    // Original notification cleanup remains best-effort, but cannot run as a
    // replacement account or turn confirmed membership into a failed accept.
    let accountChanged = false;
    try {
      await requirePlanParticipationAccount(call);
      await supabase.from('app_notifications').update({ status: call.kind === 'accept' ? 'acted' : 'read' })
        .eq('type', 'exception_invite').eq('event_id', call.eventId).eq('user_id', call.viewerId);
    } catch (error) { accountChanged = error instanceof ChangedPlanParticipationAccount; }
    if (!accountChanged && call.isCurrent()) {
      if (call.kind === 'accept') latest.current.onAccepted(); else latest.current.onDeclined();
    }
  };
  const requestAccept = async () => {
    const call = start('accept'); if (!call) return;
    try {
      await requirePlanParticipationAccount(call);
      const { needsAssent } = await getParticipationNoticeStatus();
      requirePlanParticipationCurrent(call);
      if (needsAssent) {
        call.stage = 'notice'; latest.current.onNotice(call.isCurrent); publish(call.entry);
        return;
      }
      await dispatch(call);
    } catch (error) { report(error, call); }
    finally { if (call.stage !== 'notice') release(call); }
  };
  const decline = async () => {
    const call = start('decline'); if (!call) return;
    try { await dispatch(call); } catch (error) { report(error, call); } finally { release(call); }
  };
  const agree = async (noticeGuard: () => boolean) => {
    const call = entry.pending;
    if (!call || call.kind !== 'accept' || call.stage !== 'notice' || call.isCurrent !== noticeGuard || !isCurrent() || !call.isCurrent()) return false;
    call.stage = 'assent'; publish(call.entry);
    try {
      const ok = await recordScopedPlanAssent(call.context, call);
      if (!ok) { call.stage = 'notice'; return false; }
      // Assent is confirmed; subsequent acceptance preflight failures belong
      // to the plan alert, not a now-dismissed legal notice.
      call.stage = 'status';
      await latest.current.onNoticeComplete(call.isCurrent);
      await dispatch(call);
      return true;
    } catch (error) {
      if (call.stage === 'assent') {
        // Keep the legal notice's existing retry line, without another accept.
        if (call.isCurrent()) call.stage = 'notice';
      } else report(error, call);
      return false;
    } finally { if (call.stage !== 'notice') release(call); else publish(call.entry); }
  };
  const cancelNotice = (noticeGuard: () => boolean) => {
    const call = entry.pending;
    if (!call || call.stage !== 'notice' || call.isCurrent !== noticeGuard || !isCurrent() || !call.isCurrent()) return false;
    release(call); return true;
  };
  return {
    requestAccept, agree, cancelNotice,
    acceptExceptionMutation: { isPending: entry.pending?.kind === 'accept', mutate: () => { void requestAccept(); } },
    declineExceptionMutation: { isPending: entry.pending?.kind === 'decline', mutate: () => { void decline(); } },
  };
}
