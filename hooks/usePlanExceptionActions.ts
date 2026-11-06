import { useCallback, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { checkReservedSpotReply, isDefiniteSpotRefusal, reservedSpotReceipts,
  type ReservedSpotGrant } from '../lib/reservedSpotReceipt';
import { useFocusEffect } from 'expo-router';
import { supabase } from '../lib/supabase';
import { acceptWaitlistException, declineWaitlistException } from '../lib/waitlistExceptions';
import { getParticipationNoticeStatus, type ParticipationAssentContext } from '../lib/participationTerms';
import { ChangedPlanParticipationAccount, ObsoletePlanParticipation, recordScopedPlanAssent, requirePlanParticipationAccount,
  requirePlanParticipationCurrent, type PlanParticipationScope } from '../lib/planParticipationScope';

type Options = {
  eventId: string; viewerId: string | null; epoch: number; isCurrent: () => boolean;
  grant: ReservedSpotGrant | null;
  refreshInvitation: () => Promise<void>;
  available: boolean; organizerUserId: string | null; organizerName: string;
  onNotice: (isCurrent: () => boolean, context: ParticipationAssentContext) => void;
  onNoticeComplete: (isCurrent: () => boolean) => void | Promise<void>;
  onAccepted: () => void; onDeclined: () => void;
  refreshInbox: (viewerId: string) => Promise<void>;
  onError: (error: unknown, kind: 'accept' | 'decline') => void;
};
type Stage = 'status' | 'notice' | 'assent' | 'dispatch' | 'notification' | 'check';
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
  const receipts = reservedSpotReceipts(useQueryClient());
  const key = JSON.stringify([options.viewerId, options.eventId, options.grant?.rowId, options.grant?.invitedAt]);
  const outstanding = receipts.get(key);
  if (!entries.current.has(key)) entries.current.set(key, { pending: null, completed: false });
  const entry = entries.current.get(key)!;
  const entryRef = useRef(entry); entryRef.current = entry;
  const owner = useMemo(() => ({}), [options.viewerId, options.eventId, options.epoch]);
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
      const pending = entryRef.current.pending;
      if (pending && pending.stage !== 'dispatch' && pending.stage !== 'notification') pending.entry.pending = null;
    };
  }, []));
  const isCurrent = useCallback(() => !!renderedVisit && visit.current === renderedVisit && ownerRef.current === owner && options.isCurrent(),
    [renderedVisit, owner, options.isCurrent]);
  const publish = (changed: Entry) => {
    if (visit.current && entryRef.current === changed && latest.current.isCurrent()) setRevision(value => value + 1);
  };
  const release = (call: Call) => { if (call.entry.pending === call) { call.entry.pending = null; publish(call.entry); } };
  const start = (kind: Call['kind'], checking = false): Call | null => {
    const value = latest.current;
    if (!isCurrent() || !value.viewerId || !value.eventId || !value.grant || !value.available || entry.pending || entry.completed) return null;
    if (entryRef.current !== entry || receipts.has(key) !== checking) return null;
    const call: Call = {
      kind, eventId: value.eventId, viewerId: value.viewerId, entry, stage: 'status',
      isCurrent: () => isCurrent() && entry.pending === call &&
        (entryRef.current === entry || (!latest.current.grant &&
          (call.stage === 'dispatch' || call.stage === 'check' || call.stage === 'notification'))),
      context: { listingType: 'plan', listingId: value.eventId, organizerUserId: value.organizerUserId, organizerName: value.organizerName, action: 'join' },
    };
    entry.pending = call; publish(entry);
    return call;
  };
  const report = (error: unknown, call: Call) => {
    if (!(error instanceof ObsoletePlanParticipation) && call.isCurrent()) latest.current.onError(error, call.kind);
  };
  const finishConfirmed = async (call: Call, recovered: boolean) => {
    call.entry.completed = true;
    requirePlanParticipationCurrent(call);
    call.stage = 'notification';
    // Account preflight still protects cleanup when the decision finishes after an account switch.
    try {
      await requirePlanParticipationAccount(call);
      const refreshInbox = latest.current.refreshInbox;
      const grantTime = options.grant?.invitedAt;
      const cleanup = supabase.from('app_notifications').update({ status: call.kind === 'accept' ? 'acted' : 'read' })
        .eq('type', 'exception_invite').eq('event_id', call.eventId).eq('user_id', call.viewerId);
      // The decision has committed. Only refresh its owner's inbox when the secondary write settles.
      // A late response must never navigate, show a new alert or retry the decision.
      // A later grant may have its own notification. A recovered reply only owns its original notice.
      const acknowledgement = !recovered ? cleanup : grantTime ? cleanup.eq('created_at', grantTime) : Promise.resolve();
      void Promise.resolve(acknowledgement)
        .finally(() => refreshInbox(call.viewerId))
        .catch(() => {});
    } catch (error) {
      if (error instanceof ChangedPlanParticipationAccount) return;
    }
    if (call.isCurrent()) {
      if (call.kind === 'accept') latest.current.onAccepted(); else latest.current.onDeclined();
    }
  };
  const checkReply = async (call: Call, ticket: { kind: Call['kind'] }) => {
    const grant = options.grant;
    if (!grant) return;
    call.stage = 'check';
    await requirePlanParticipationAccount(call);
    const result = await checkReservedSpotReply(ticket.kind, call.eventId, call.viewerId, grant);
    requirePlanParticipationCurrent(call);
    if (receipts.get(key) !== ticket) return;
    if (result === 'confirmed') {
      receipts.delete(key);
      await finishConfirmed(call, true);
    } else if (result === 'changed') {
      // Keep the old reply protected if refresh fails. A different grant has a fresh key.
      await latest.current.refreshInvitation();
      if (entryRef.current !== entry && receipts.get(key) === ticket) receipts.delete(key);
    }
  };
  const dispatch = async (call: Call) => {
    await requirePlanParticipationAccount(call);
    if (!latest.current.available) throw new Error('This invitation changed. Check the plan before trying again.');
    if (receipts.has(key)) return;
    call.stage = 'dispatch';
    const ticket = { kind: call.kind };
    receipts.set(key, ticket);
    try {
      await (call.kind === 'accept' ? acceptWaitlistException(call.eventId) : declineWaitlistException(call.eventId));
    } catch (error) {
      if (receipts.get(key) !== ticket) return;
      if (isDefiniteSpotRefusal(error)) {
        receipts.delete(key);
        throw error;
      }
      if (call.isCurrent()) {
        try { await checkReply(call, ticket); } catch { /* The member can check again. */ }
      }
      return;
    }
    if (receipts.get(key) === ticket && call.isCurrent()) {
      receipts.delete(key);
      await finishConfirmed(call, false);
    }
  };
  const check = async () => {
    const ticket = receipts.get(key);
    if (!ticket) return;
    const call = start(ticket.kind, true);
    if (!call) return;
    try {
      await checkReply(call, ticket);
    } catch {
      // A later check can confirm the decision without issuing another write.
    } finally {
      release(call);
    }
  };
  const requestAccept = async () => {
    const call = start('accept'); if (!call) return;
    try {
      await requirePlanParticipationAccount(call);
      const { needsAssent, versions } = await getParticipationNoticeStatus();
      requirePlanParticipationCurrent(call);
      if (needsAssent) {
        call.context.versions = versions;
        call.stage = 'notice';
        latest.current.onNotice(call.isCurrent, call.context);
        publish(call.entry);
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
    requestAccept, agree, cancelNotice, check,
    needsCheck: !!outstanding && entry.pending?.stage !== 'dispatch',
    checking: entry.pending?.stage === 'check',
    acceptExceptionMutation: { isPending: entry.pending?.kind === 'accept', mutate: () => { void requestAccept(); } },
    declineExceptionMutation: { isPending: entry.pending?.kind === 'decline', mutate: () => { void decline(); } },
  };
}
