import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useFocusEffect } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { checkContent } from '../lib/contentFilter';
import { isPlanPast } from '../lib/planTime';
import { getPlanTerminalStatus } from '../lib/planLifecycle';
import { friendlyError } from '../lib/friendlyError';
import { logError } from '../lib/logger';
import { withDeadline, withTimeout } from '../lib/withTimeout';
import { requestWithDeadline } from '../lib/requestWithDeadline';
import { classifyPlanJoinReceipt, type PlanJoinDenial, type PlanJoinRpc } from '../lib/planJoinSafety';
import { planJoinWriteLocks } from '../lib/planJoinWriteLock';
import type { CirclePlanContext } from './useCirclePlanContext';

export type PlanJoinResult = { greetingUnconfirmed?: string; greetingNotSent?: string };

type Options = {
  eventId: string; viewerId: string | null; epoch: number; isCurrent: () => boolean;
  membershipConfirmed?: boolean; ready: boolean; startTime?: string; endTime?: string | null; status?: unknown;
  circle: CirclePlanContext | undefined; age: number | null; gender: string | null;
  onJoined: (result: PlanJoinResult) => void; onError: (message: string, reason?: PlanJoinDenial) => void;
};
type JoinState = { pending: Call | null; result: 'idle' | 'joined' };
type Call = { key: string; token: object; eventId: string; viewerId: string; greeting?: string; rpc: PlanJoinRpc;
  startTime: string; endTime?: string | null; status?: unknown; age: number | null; gender: string | null;
  ownChat: boolean; state: JoinState; isCurrent: () => boolean; dispatched: boolean };
class UnknownJoin extends Error {}
class ConfirmedJoinRefusal extends Error {
  constructor(readonly reason: PlanJoinDenial) { super(denialCopy[reason]); }
}
const unknownCopy = 'We haven’t received confirmation yet. Check this plan before trying to join again.';
const denialCopy = {
  full: 'This plan just filled up.', not_found: 'This plan is no longer available.',
  not_eligible: 'This plan isn’t available for you.', not_circle_plan: 'This plan changed. Check its details before joining.',
  waitlist_priority: 'This spot is saved for the waitlist right now. Check back in a bit.',
};
// These PostgreSQL errors confirm that the transaction was rejected. An
// arbitrary five-character code is not proof of a rejected database write.
const rejectedTransactionCodes = new Set([
  'P0001', '42501', '23502', '23503', '23505', '23514', '22P02',
  '28000', '28P01', '42883', '42703', '42P01', '40001', '40P01',
]);

/** Membership is already confirmed. Stop waiting for optional chat receipts
 * as a group; never retry an insert or start one after recovery is shown. */
async function deliverJoinMessages(call: Call): Promise<PlanJoinResult> {
  const budget = 12_000;
  const started = performance.now();
  const systemReceipt = async () => {
    try {
      const result = await supabase.from('messages').insert({ event_id: call.eventId, user_id: call.viewerId, content: 'joined the plan', message_type: 'system' });
      if (result.error) logError(result.error, 'plan.join.system');
    } catch (error) { logError(error, 'plan.join.system'); }
    return true;
  };
  // Only wait on the individual insert. A late completion cannot continue a
  // background sequence and send a greeting after we told the member it wasn't sent.
  const systemSettled = await withTimeout(systemReceipt(), budget, false);
  if (!systemSettled) logError(new Error('System message receipt timed out'), 'plan.join.system');
  if (!call.greeting || !call.isCurrent()) return {};
  const remaining = budget - (performance.now() - started);
  if (!systemSettled || remaining <= 0) return { greetingNotSent: call.greeting };
  try {
    const result = await withDeadline(supabase.from('messages').insert({ event_id: call.eventId, user_id: call.viewerId, content: call.greeting, message_type: 'user' }), remaining, 'Introduction receipt');
    if (result?.error === null) return {};
    logError(result?.error ?? new Error('Missing greeting receipt'), 'plan.join.greeting');
  } catch (error) { logError(error, 'plan.join.greeting'); }
  return { greetingUnconfirmed: call.greeting };
}

/** Join receipts and optional greetings belong to their initiating account,
 * plan and focused visit. Unknown membership never enables a blind retry. */
export function usePlanJoin(options: Options) {
  const client = useQueryClient();
  const latest = useRef(options); latest.current = options;
  // Keep dispatched writes when the same account/plan returns to this mounted
  // controller. Other accounts and plans have independent locks. A negative
  // read cannot unlock an uncertain write that may still be committing.
  const states = useRef(new Map<string, JoinState>());
  const stateKey = JSON.stringify([options.viewerId, options.eventId]);
  const locks = planJoinWriteLocks(client);
  const getHold = useCallback(() => locks.get(stateKey), [locks, stateKey]);
  const hold = useSyncExternalStore(locks.subscribe, getHold, getHold);
  if (!states.current.has(stateKey)) states.current.set(stateKey, { pending: null, result: 'idle' });
  const state = states.current.get(stateKey)!;
  const owner = useMemo(() => ({ state }), [options.eventId, options.viewerId, options.epoch]);
  const ownerRef = useRef(owner); ownerRef.current = owner;
  const visit = useRef<object | null>(null);
  const [renderedVisit, setRenderedVisit] = useState<object | null>(null);
  const [, setRevision] = useState(0);
  useFocusEffect(useCallback(() => {
    const current = {}; visit.current = current; setRenderedVisit(current);
    return () => { if (visit.current === current) visit.current = null; };
  }, []));
  const publish = (changed: JoinState) => {
    if (visit.current && ownerRef.current.state === changed && latest.current.isCurrent()) setRevision(value => value + 1);
  };
  // Routes retain this exact rendered guard across participation/assent awaits.
  const isCurrent = () => !!renderedVisit && visit.current === renderedVisit && ownerRef.current === owner && options.isCurrent();
  const requireNonterminal = (call: Call) => {
    const terminal = getPlanTerminalStatus(call.status) ?? getPlanTerminalStatus(latest.current.status);
    if (terminal === 'cancelled') throw new Error('This plan was cancelled. Nobody new can join.');
    if (terminal === 'completed') throw new Error('This plan is complete. Nobody new can join.');
  };
  useEffect(() => {
    // An empty or failed read cannot prove a submitted write didn't commit.
    if (hold?.checking && options.membershipConfirmed && options.isCurrent()) {
      locks.finish(stateKey, hold.token);
    }
  }, [hold, locks, options.membershipConfirmed, options.isCurrent, stateKey]);
  const mutation = useMutation({
    retry: false,
    mutationFn: async (call: Call): Promise<PlanJoinResult | false> => {
      if (!call.isCurrent() || !latest.current.ready) return false;
      requireNonterminal(call);
      // Only pre-dispatch reads may time out and unlock an explicit retry.
      // A submitted membership write retains its separate receipt/unknown lock.
      const auth = await requestWithDeadline(supabase.auth.getUser(), 8000);
      if (!call.isCurrent() || !latest.current.ready) return false;
      requireNonterminal(call);
      if (auth.error || auth.data.user?.id !== call.viewerId) throw new Error('Couldn’t check your account. Try again.');
      if (isPlanPast(call.startTime, call.endTime)) throw new Error('This plan ended. Nobody new can join.');
      if (call.greeting) { const check = checkContent(call.greeting); if (!check.ok) throw new Error(check.reason); }
      if (call.rpc === 'join_event_atomic') {
        const gate = await requestWithDeadline(supabase.rpc('can_join_event_gender', { p_event_id: call.eventId, p_user_id: call.viewerId }), 12000);
        if (!call.isCurrent() || !latest.current.ready) return false;
        if (gate.error) throw new Error('Couldn’t check this plan. Try again.');
        if (gate.data !== true) throw new Error(gate.data === false ? denialCopy.not_eligible : 'Couldn’t check this plan. Try again.');
      }
      if (!call.isCurrent() || !latest.current.ready) return false;
      // A terminal status can arrive while auth or eligibility is pending.
      // Recheck just before the write; confirmed post-dispatch receipts keep
      // their existing handling even if a background refresh changes status.
      requireNonterminal(call);
      if (isPlanPast(call.startTime, call.endTime)) throw new Error('This plan ended. Nobody new can join.');
      if (!locks.begin(call.key, call.token)) return false;
      call.dispatched = true;
      let result;
      try {
        const write = Promise.resolve(supabase.rpc(call.rpc, { p_event_id: call.eventId, p_user_id: call.viewerId, p_age_at_join: call.age, p_gender_at_join: call.gender }));
        const missing = Symbol();
        const response = await withTimeout<Awaited<typeof write> | typeof missing>(write, 15_000, missing);
        if (response === missing) {
          locks.check(call.key, call.token);
          // Stop blocking the screen, not the server's transaction. A late
          // receipt may refresh membership, but cannot post an introduction.
          void write.then(late => {
            if (locks.get(call.key)?.token !== call.token) return;
            const denial = late?.error ? null : classifyPlanJoinReceipt(late?.data, call.rpc);
            if (denial?.kind === 'denied' || rejectedTransactionCodes.has(String(late?.error?.code ?? ''))) {
              locks.finish(call.key, call.token);
              if (denial?.kind === 'denied' && call.isCurrent()) latest.current.onError(denialCopy[denial.reason], denial.reason);
            }
            for (const part of ['members', 'detail']) void client.invalidateQueries({ queryKey: ['events', part, call.eventId, call.viewerId] });
          }).catch(() => {});
          throw new UnknownJoin();
        }
        result = response;
      } catch { throw new UnknownJoin(); }
      if (result?.error) {
        if (rejectedTransactionCodes.has(String(result.error.code ?? ''))) throw new Error('Couldn’t join this plan. Check the details and try again.');
        throw new UnknownJoin();
      }
      const receipt = classifyPlanJoinReceipt(result?.data, call.rpc);
      if (receipt.kind === 'unknown') throw new UnknownJoin();
      if (receipt.kind === 'denied') throw new ConfirmedJoinRefusal(receipt.reason);
      call.state.result = 'joined'; // remains locked even if this visit retired
      if (!call.isCurrent()) return false;
      if (!call.ownChat) return {};
      return deliverJoinMessages(call);
    },
    onSuccess: (joined, call) => { if (joined && call.isCurrent()) latest.current.onJoined(joined); },
    onError: (error, call) => {
      // Capacity, availability and waitlist refusals are authoritative business
      // outcomes, not application failures. Keep genuine transport, auth and
      // malformed-receipt failures in Sentry.
      if (!(error instanceof ConfirmedJoinRefusal)) logError(error, 'plan.join');
      if (error instanceof UnknownJoin) {
        if (locks.get(call.key)?.token !== call.token) return;
        locks.check(call.key, call.token);
      }
      if (!call.isCurrent()) return;
      if (error instanceof ConfirmedJoinRefusal) latest.current.onError(error.message, error.reason);
      else latest.current.onError(error instanceof UnknownJoin ? unknownCopy : friendlyError(error, 'Couldn’t join this plan. Try again.'));
    },
    onSettled: (_data, _error, call) => {
      if (call.state.result === 'joined' && !call.isCurrent()) locks.check(call.key, call.token);
      else if (!(_error instanceof UnknownJoin)) locks.finish(call.key, call.token);
      if (call.state.pending === call) call.state.pending = null;
      publish(call.state);
      if (call.dispatched) for (const queryKey of [
        ['events', 'members', call.eventId], ['events', 'detail', call.eventId], ['circle-plan-context', call.eventId],
        ['events', 'feed'], ['my-plans'], ['feed-member-ids'], ['wishlists', call.viewerId], ['saved-plans'], ['waitlisted-plans'],
      ]) void client.invalidateQueries({ queryKey });
    },
  });
  const join = (greeting?: string) => {
    const o = latest.current;
    if (locks.get(stateKey) || !isCurrent() || !o.ready || !o.viewerId || !o.startTime || !o.circle || state.pending || state.result !== 'idle') return;
    const call: Call = {
      key: stateKey, token: {}, eventId: o.eventId, viewerId: o.viewerId, greeting: greeting?.trim() || undefined,
      rpc: o.circle.is_circle_plan ? 'join_circle_plan_atomic' : 'join_event_atomic',
      startTime: o.startTime, endTime: o.endTime, status: o.status, age: o.age, gender: o.gender,
      ownChat: !o.circle.is_circle_plan || o.circle.has_own_chat === true, state, dispatched: false,
      isCurrent,
    };
    state.pending = call; publish(state); // synchronous lock before React renders
    mutation.mutate(call);
  };
  return { join, isPending: !!state.pending, unconfirmed: !!hold && (hold.checking || hold.token !== state.pending?.token), isCurrent };
}
