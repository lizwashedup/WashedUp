/** Create the Circle once; optional refinements can retry that confirmed ID. */
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { supabase } from '../lib/supabase';
import { RequestDeadlineError, requestWithDeadline } from '../lib/requestWithDeadline';
import { uploadBase64ToStorage } from '../lib/uploadPhoto';
import { beginCircleCreation, finishCircleCreation, isCircleId, readCircleCreationAttempt } from '../lib/circles/creationAttempt';
import { circleKeys } from '../lib/circles/keys';
import type { CreateCircleArgs } from '../lib/circles/types';

export interface CircleCreationScope { userId: string; isCurrent: () => boolean }
export interface CreateCircleReceipt { circleId: string; policyApplied: boolean; coverApplied: boolean }
export class ObsoleteCircleCreationError extends Error {
  constructor() { super('This circle entry is no longer current.'); this.name = 'ObsoleteCircleCreationError'; }
}
export const isObsoleteCircleCreation = (error: unknown) => error instanceof Error && error.name === 'ObsoleteCircleCreationError';
export class UnconfirmedCircleCreationError extends Error {
  constructor() { super('We couldn’t confirm whether your circle was created. Check your circles before trying again.'); this.name = 'UnconfirmedCircleCreationError'; }
}
export const isUnconfirmedCircleCreation = (error: unknown) => error instanceof Error && error.name === 'UnconfirmedCircleCreationError';
type Owner = { userId: string | null | undefined };
type CreateOptions = { scope?: CircleCreationScope; onSetupPending?: (receipt: CreateCircleReceipt) => void };
type Call = CreateOptions & { args: CreateCircleArgs; owner: Owner; authEpoch: number; circleId?: string };
type Setup = { call: Call; receipt: CreateCircleReceipt; coverId: string | null; uploaded: boolean };

const hasInvitePolicyChanges = (args: CreateCircleArgs) =>
  args.invitePolicy === 'everyone' || (args.invitePolicy === 'chosen' && args.adminUserIds.length > 0);

export function useCreateCircle(userId: string | null | undefined) {
  const qc = useQueryClient();
  const owner = useMemo<Owner>(() => ({ userId }), [userId]);
  const active = useRef<Owner | null>(null), latest = useRef(owner); latest.current = owner;
  const mounted = useRef(false), authEpoch = useRef(0), authId = useRef<string | null | undefined>(undefined);
  const submitted = useRef<{ call: Call; requestId: string } | null>(null);
  const pending = useRef<Call | null>(null), setups = useRef(new Map<string, Setup>());
  useLayoutEffect(() => { active.current = owner; mounted.current = true; return () => { if (active.current === owner) active.current = null; }; }, [owner]);
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted.current) return;
      // A delayed initial snapshot cannot overwrite an observed transition.
      if (event === 'INITIAL_SESSION' && authId.current !== undefined) return;
      const next = session?.user.id ?? null;
      if (authId.current !== undefined && authId.current !== next) authEpoch.current++;
      authId.current = next;
    });
    return () => { mounted.current = false; setups.current.clear(); subscription.unsubscribe(); };
  }, []);
  const current = (call: Call) => mounted.current && active.current === call.owner && latest.current === call.owner &&
    !!call.owner.userId && call.authEpoch === authEpoch.current &&
    (authId.current === undefined || authId.current === call.owner.userId) &&
    (!call.scope || (call.scope.userId === call.owner.userId && call.scope.isCurrent()));
  const check = (call: Call) => { if (!current(call)) throw new ObsoleteCircleCreationError(); };
  const verify = async (call: Call) => {
    check(call);
    const { data, error } = await requestWithDeadline(supabase.auth.getUser(), 12_000);
    check(call);
    if (error) throw error;
    if (data.user?.id !== call.owner.userId) throw new ObsoleteCircleCreationError();
    check(call);
  };
  const invalidate = (setup: Setup) => {
    if (!current(setup.call) || !setup.call.owner.userId) return;
    for (const queryKey of [circleKeys.mine(setup.call.owner.userId), circleKeys.detail(setup.receipt.circleId)]) {
      if (!current(setup.call)) return;
      void qc.invalidateQueries({ queryKey }).catch(() => {});
    }
  };
  const applySetup = async (setup: Setup): Promise<CreateCircleReceipt> => {
    const { call } = setup, { args } = call, circleId = setup.receipt.circleId;
    check(call);
    if (!setup.receipt.policyApplied) {
      try {
        await verify(call);
        const parameters = args.invitePolicy === 'everyone'
          ? { p_circle_id: circleId, p_set_all_admins: true }
          : { p_circle_id: circleId, p_promote_user_ids: args.adminUserIds };
        const { error } = await supabase.rpc('update_circle', parameters);
        check(call); if (error) throw error;
        setup.receipt = { ...setup.receipt, policyApplied: true };
      } catch (error) { check(call); /* Keep the confirmed Circle and retryable setup state. */ }
    }
    if (!setup.receipt.coverApplied && args.coverBase64) {
      try {
        await verify(call);
        if (!setup.coverId) setup.coverId = Crypto.randomUUID();
        if (!setup.uploaded) {
          await uploadBase64ToStorage('circle-covers', `${circleId}/${setup.coverId}`, args.coverBase64, { upsert: true });
          check(call); setup.uploaded = true;
        }
        await verify(call);
        const { error } = await supabase.rpc('update_circle', { p_circle_id: circleId, p_cover_upload_id: setup.coverId });
        check(call); if (error) throw error;
        setup.receipt = { ...setup.receipt, coverApplied: true };
      } catch (error) { check(call); /* Retry the same upload/pointer, never create again. */ }
    }
    check(call); invalidate(setup); return { ...setup.receipt };
  };
  const acknowledgeReceipt = (circleId: string) => {
    const original = submitted.current;
    if (!original || !current(original.call) || !setups.current.has(circleId)) return;
    // The view has accepted this exact destination. Until then, a departure
    // during setup or conversion must leave the confirmed circle recoverable.
    void finishCircleCreation(original.call.owner.userId!, original.requestId, null).catch(() => {});
  };
  const rememberSetup = (call: Call, circleId: string) => {
    const setup: Setup = {
      call, coverId: null, uploaded: false,
      receipt: {
        circleId,
        policyApplied: !hasInvitePolicyChanges(call.args),
        coverApplied: !call.args.coverBase64,
      },
    };
    setups.current.set(circleId, setup);
    return setup;
  };
  const dispatchCreate = async (call: Call, requestId: string) => {
    const id = call.owner.userId!;
    try { check(call); }
    catch (error) { await finishCircleCreation(id, requestId, null); throw error; }
    let result;
    try {
      result = await supabase.rpc('create_circle', {
        p_name: call.args.name, p_description: call.args.description, p_member_user_ids: call.args.memberUserIds,
      });
    } catch { throw new UnconfirmedCircleCreationError(); }
    if (result.error) {
      if (result.status >= 400 && result.status < 500 && result.status !== 408) {
        await finishCircleCreation(id, requestId, null);
        throw result.error;
      }
      throw new UnconfirmedCircleCreationError();
    }
    if (!isCircleId(result.data)) throw new UnconfirmedCircleCreationError();
    let recorded: boolean;
    try { recorded = await finishCircleCreation(id, requestId, result.data); }
    catch { throw new UnconfirmedCircleCreationError(); }
    if (!recorded) throw new ObsoleteCircleCreationError();
    return result.data;
  };
  const mutation = useMutation<CreateCircleReceipt, Error, Call>({
    retry: false,
    networkMode: 'always',
    mutationFn: async call => {
      check(call); await verify(call); check(call);
      if (call.circleId) {
        const setup = setups.current.get(call.circleId);
        if (!setup || setup.call.owner !== call.owner || setup.call.authEpoch !== call.authEpoch) throw new ObsoleteCircleCreationError();
        return applySetup(setup);
      }
      const id = call.owner.userId!;
      const attempt = await beginCircleCreation(id, () => check(call));
      if (!attempt) throw new UnconfirmedCircleCreationError();
      submitted.current = { call, requestId: attempt.requestId };
      let circleId: string;
      try {
        // Bound the screen's wait. The original promise still records its own
        // receipt if it settles after the timeout or after the screen closes.
        circleId = await requestWithDeadline(dispatchCreate(call, attempt.requestId), 12_000);
      } catch (error) {
        check(call);
        if (error instanceof RequestDeadlineError) throw new UnconfirmedCircleCreationError();
        throw error;
      }
      check(call);
      const setup = rememberSetup(call, circleId);
      if (!setup.receipt.policyApplied || !setup.receipt.coverApplied) {
        call.onSetupPending?.({ ...setup.receipt });
      }
      return applySetup(setup);
    },
  });
  const run = async (call: Call) => {
    check(call);
    if (pending.current && current(pending.current)) throw new Error('Your circle is already being saved.');
    pending.current = call;
    try { const result = await mutation.mutateAsync(call); check(call); return result; }
    finally { if (pending.current === call) pending.current = null; }
  };
  const mutateAsync = (args: CreateCircleArgs, options?: CreateOptions) => {
    // Copy selections before TanStack can queue dispatch or the form can change.
    const call: Call = { owner, authEpoch: authEpoch.current, scope: options?.scope, onSetupPending: options?.onSetupPending,
      args: { ...args, memberUserIds: [...args.memberUserIds], adminUserIds: [...args.adminUserIds] } };
    if (authId.current === undefined && options?.scope) authId.current = options.scope.userId;
    const sameEntry = (prior: Call) => prior.owner === owner && prior.scope?.isCurrent === call.scope?.isCurrent && current(prior);
    for (const setup of setups.current.values()) {
      if (sameEntry(setup.call)) return Promise.resolve({ ...setup.receipt });
    }
    return run(call);
  };
  const retrySetupAsync = (circleId: string) => {
    const setup = setups.current.get(circleId);
    if (!setup) return Promise.reject(new ObsoleteCircleCreationError());
    check(setup.call);
    return run({ ...setup.call, circleId });
  };
  const canResumeSetup = (requestId: string) => {
    const original = submitted.current;
    return !!original && original.requestId === requestId && current(original.call) &&
      (!!original.call.args.coverBase64 || hasInvitePolicyChanges(original.call.args));
  };
  const resumeSetupAsync = async (requestId: string) => {
    const original = submitted.current;
    if (!original || !canResumeSetup(requestId)) throw new ObsoleteCircleCreationError();
    const { call } = original;
    const attempt = await readCircleCreationAttempt(call.owner.userId!);
    check(call);
    if (attempt?.requestId !== requestId || !attempt.circleId) throw new UnconfirmedCircleCreationError();
    if (!setups.current.has(attempt.circleId)) rememberSetup(call, attempt.circleId);
    return retrySetupAsync(attempt.circleId);
  };
  const belongs = !mutation.variables || current(mutation.variables);
  return { mutateAsync, retrySetupAsync, canResumeSetup, resumeSetupAsync, acknowledgeReceipt,
    isPending: belongs && mutation.isPending,
    error: belongs ? mutation.error : null,
    data: belongs ? mutation.data : undefined,
  };
}
