import { useCallback, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { logError } from '../lib/logger';

export type PlanDepartureAction = 'leave' | 'cancel';
export type PlanDepartureResult = {
  action: PlanDepartureAction;
  announcementUnconfirmed?: true;
  reconciled?: true;
};
type Options = {
  eventId: string;
  viewerId: string | null;
  epoch: number;
  isCurrent: () => boolean;
  ready: boolean;
  canLeave: boolean;
  canCancel: boolean;
  hasOwnChat: boolean;
  onSuccess: (result: PlanDepartureResult) => void;
  onError: (message: string, action: PlanDepartureAction) => void;
  onUnconfirmed: (action: PlanDepartureAction) => void;
};
type DepartureState = {
  pending: Call | null;
  checking: Call | null;
  outcome: 'idle' | 'unknown' | 'confirmed';
  action: PlanDepartureAction | null;
};
type Call = {
  eventId: string;
  viewerId: string;
  action: PlanDepartureAction;
  state: DepartureState;
  hasOwnChat: boolean;
  isCurrent: () => boolean;
  dispatched: boolean;
};
class UnconfirmedDeparture extends Error {}
// These codes describe rejected PostgreSQL transactions. PostgREST shape
// errors, connection failures and arbitrary codes do not prove a rollback.
const rejectedTransactionCodes = new Set([
  'P0001', '42501', '23502', '23503', '23505', '23514', '22P02',
  '28000', '28P01', '42883', '42703', '42P01', '40001', '40P01',
]);
const failureCopy = {
  leave: 'Couldn’t leave this plan. Try again.',
  cancel: 'Couldn’t cancel this plan. Try again.',
};
function confirmsDeparture(data: unknown, call: Call): boolean {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const row = data as Record<string, unknown>;
  return call.action === 'leave'
    ? row.event_id === call.eventId && row.user_id === call.viewerId && row.status === 'left'
    : row.id === call.eventId && row.creator_user_id === call.viewerId && row.status === 'cancelled';
}

/** Primary departure receipts are final independently of optional chat delivery.
 * Locks survive return to an account/plan in this mounted controller. They are
 * not a durable cross-screen queue or server idempotency guarantee. */
export function usePlanDeparture(options: Options) {
  const client = useQueryClient();
  const latest = useRef(options); latest.current = options;
  const states = useRef(new Map<string, DepartureState>());
  const key = JSON.stringify([options.viewerId, options.eventId]);
  if (!states.current.has(key)) states.current.set(key, { pending: null, checking: null, outcome: 'idle', action: null });
  const state = states.current.get(key)!;
  const owner = useMemo(() => ({ state }), [options.eventId, options.viewerId, options.epoch]);
  const ownerRef = useRef(owner); ownerRef.current = owner;
  const visit = useRef<object | null>(null);
  const [renderedVisit, setRenderedVisit] = useState<object | null>(null);
  const [, setRevision] = useState(0);
  useFocusEffect(useCallback(() => {
    const current = {}; visit.current = current; setRenderedVisit(current);
    return () => { if (visit.current === current) visit.current = null; };
  }, []));
  const isCurrent = () => !!renderedVisit && visit.current === renderedVisit && ownerRef.current === owner && options.isCurrent();
  const publish = (changed: DepartureState) => {
    if (visit.current && ownerRef.current.state === changed && latest.current.isCurrent()) setRevision(value => value + 1);
  };
  const mayDispatch = (call: Call) => call.isCurrent() && latest.current.ready &&
    (call.action === 'leave' ? latest.current.canLeave : latest.current.canCancel);
  const invalidate = (call: Call) => {
    for (const queryKey of [
      ['events', 'members', call.eventId], ['events', 'detail', call.eventId], ['circle-plan-context', call.eventId],
      ['events', 'feed'], ['my-plans'], ['feed-member-ids'], ['saved-plans'], ['waitlisted-plans'],
    ]) void client.invalidateQueries({ queryKey }).catch(error => logError(error, 'plan.departure.refresh'));
  };
  const reportSuccess = (result: PlanDepartureResult, call: Call) => {
    if (!call.isCurrent()) return;
    // A UI callback failure cannot turn a confirmed database write into a
    // failed departure or make the mutation library retry it.
    try { latest.current.onSuccess(result); } catch (error) { logError(error, 'plan.departure.feedback'); }
  };
  const mutation = useMutation({
    retry: false,
    mutationFn: async (call: Call): Promise<PlanDepartureResult | false> => {
      if (!mayDispatch(call)) return false;
      const auth = await supabase.auth.getUser();
      if (!mayDispatch(call)) return false;
      if (auth.error || auth.data.user?.id !== call.viewerId) throw new Error('Account could not be checked');
      let response;
      call.dispatched = true;
      try {
        response = call.action === 'leave'
          ? await supabase.from('event_members').update({ status: 'left' })
            .eq('event_id', call.eventId).eq('user_id', call.viewerId).select('event_id,user_id,status').maybeSingle()
          : await supabase.from('events').update({ status: 'cancelled' })
            .eq('id', call.eventId).eq('creator_user_id', call.viewerId).select('id,creator_user_id,status').maybeSingle();
      } catch { throw new UnconfirmedDeparture(); }
      if (response?.error) {
        if (rejectedTransactionCodes.has(String(response.error.code ?? ''))) throw response.error;
        throw new UnconfirmedDeparture();
      }
      if (response?.error !== null || !confirmsDeparture(response.data, call)) throw new UnconfirmedDeparture();
      call.state.outcome = 'confirmed';
      if (!call.isCurrent()) return false;
      const result: PlanDepartureResult = { action: call.action };
      // Leaving removes this member's permission to post in the event chat.
      // Do not send a guaranteed-forbidden follow-up or announce before the
      // departure is confirmed. A future departure notice must be server-owned
      // and atomic with the membership change. Cancellation retains membership.
      // Whole-circle plans still have no event conversation to announce into.
      if (call.hasOwnChat && call.action === 'cancel') {
        try {
          const message = await supabase.from('messages').insert({
            event_id: call.eventId,
            user_id: call.viewerId,
            content: 'cancelled this plan',
            message_type: 'system',
          });
          if (message?.error !== null) {
            result.announcementUnconfirmed = true;
            logError(message?.error ?? new Error('Missing announcement receipt'), 'plan.departure.announcement');
          }
        } catch (error) {
          result.announcementUnconfirmed = true;
          logError(error, 'plan.departure.announcement');
        }
      }
      return result;
    },
    onSuccess: (result, call) => { if (result) reportSuccess(result, call); },
    onError: (error, call) => {
      logError(error, 'plan.departure');
      if (error instanceof UnconfirmedDeparture) call.state.outcome = 'unknown';
      if (!call.isCurrent()) return;
      if (error instanceof UnconfirmedDeparture) latest.current.onUnconfirmed(call.action);
      else latest.current.onError(call.dispatched ? failureCopy[call.action] : 'Couldn’t check your account. Try again.', call.action);
    },
    onSettled: (_data, _error, call) => {
      if (call.state.pending === call) call.state.pending = null;
      publish(call.state);
      if (call.dispatched) invalidate(call);
    },
  });
  const start = (action: PlanDepartureAction) => {
    const o = latest.current;
    if (!isCurrent() || !o.viewerId || !o.eventId || !o.ready ||
      !(action === 'leave' ? o.canLeave : o.canCancel) || state.pending || state.checking || state.outcome !== 'idle') return;
    const call: Call = { eventId: o.eventId, viewerId: o.viewerId, action, hasOwnChat: o.hasOwnChat, state, isCurrent, dispatched: false };
    state.action = action; state.pending = call; publish(state);
    mutation.mutate(call);
  };
  const checkResult = async () => {
    const o = latest.current;
    if (!isCurrent() || !o.viewerId || state.pending || state.checking || state.outcome !== 'unknown' || !state.action) return;
    const call: Call = { eventId: o.eventId, viewerId: o.viewerId, action: state.action, hasOwnChat: false, state, isCurrent, dispatched: false };
    state.checking = call; publish(state);
    try {
      const auth = await supabase.auth.getUser();
      if (!call.isCurrent()) return;
      if (auth.error || auth.data.user?.id !== call.viewerId) throw new Error('Account could not be checked');
      const response = call.action === 'leave'
        ? await supabase.from('event_members').select('event_id,user_id,status').eq('event_id', call.eventId).eq('user_id', call.viewerId).maybeSingle()
        : await supabase.from('events').select('id,creator_user_id,status').eq('id', call.eventId).eq('creator_user_id', call.viewerId).maybeSingle();
      if (response?.error !== null || !confirmsDeparture(response.data, call)) throw new Error('Departure not confirmed');
      state.outcome = 'confirmed';
      invalidate(call);
      reportSuccess({ action: call.action, reconciled: true }, call);
    } catch (error) {
      logError(error, 'plan.departure.check');
      if (call.isCurrent()) latest.current.onError('We still couldn’t confirm the result. Check again in a moment.', call.action);
    } finally {
      if (state.checking === call) state.checking = null;
      publish(state);
    }
  };
  return {
    leave: () => start('leave'), cancel: () => start('cancel'), checkResult,
    isPending: !!state.pending, pendingAction: state.pending?.action ?? null,
    unknownAction: state.outcome === 'unknown' ? state.action : null,
    isChecking: !!state.checking, isCurrent,
  };
}
