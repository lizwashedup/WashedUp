/** Create the Circle once; optional refinements can retry that confirmed ID. */
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { supabase } from '../lib/supabase';
import { uploadBase64ToStorage } from '../lib/uploadPhoto';
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
type Call = { args: CreateCircleArgs; owner: Owner; authEpoch: number; scope?: CircleCreationScope; circleId?: string };
type Setup = { call: Call; receipt: CreateCircleReceipt; coverId: string | null; uploaded: boolean };
const isUuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export function useCreateCircle(userId: string | null | undefined) {
  const qc = useQueryClient();
  const owner = useMemo<Owner>(() => ({ userId }), [userId]);
  const active = useRef<Owner | null>(null), latest = useRef(owner); latest.current = owner;
  const mounted = useRef(false), authEpoch = useRef(0), authId = useRef<string | null | undefined>(undefined);
  const pending = useRef<Call | null>(null), setups = useRef(new Map<string, Setup>());
  const unconfirmed = useRef<Call | null>(null);
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
    const { data, error } = await supabase.auth.getUser();
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
  const mutation = useMutation<CreateCircleReceipt, Error, Call>({
    retry: false,
    mutationFn: async call => {
      check(call); await verify(call); check(call);
      if (call.circleId) {
        const setup = setups.current.get(call.circleId);
        if (!setup || setup.call.owner !== call.owner || setup.call.authEpoch !== call.authEpoch) throw new ObsoleteCircleCreationError();
        return applySetup(setup);
      }
      let result;
      try {
        result = await supabase.rpc('create_circle', { p_name: call.args.name, p_description: call.args.description, p_member_user_ids: call.args.memberUserIds });
      } catch (error) { check(call); throw new UnconfirmedCircleCreationError(); }
      check(call);
      if (result.error) {
        // A server rejection is retryable. A transport/server timeout can have
        // happened after commit, so a blind create retry could duplicate it.
        if (result.status >= 400 && result.status < 500) throw result.error;
        throw new UnconfirmedCircleCreationError();
      }
      if (!isUuid(result.data)) throw new UnconfirmedCircleCreationError();
      const setup: Setup = { call, coverId: null, uploaded: false, receipt: {
        circleId: result.data,
        policyApplied: call.args.invitePolicy === 'only_me' || (call.args.invitePolicy === 'chosen' && call.args.adminUserIds.length === 0),
        coverApplied: !call.args.coverBase64,
      } };
      setups.current.set(result.data, setup);
      return applySetup(setup);
    },
  });
  const run = async (call: Call) => {
    check(call);
    if (pending.current && current(pending.current)) throw new Error('Your circle is already being saved.');
    pending.current = call;
    try { const result = await mutation.mutateAsync(call); check(call); return result; }
    catch (error) { if (current(call) && isUnconfirmedCircleCreation(error)) unconfirmed.current = call; throw error; }
    finally { if (pending.current === call) pending.current = null; }
  };
  const mutateAsync = (args: CreateCircleArgs, options?: { scope?: CircleCreationScope }) => {
    // Copy selections before TanStack can queue dispatch or the form can change.
    const call: Call = { owner, authEpoch: authEpoch.current, scope: options?.scope,
      args: { ...args, memberUserIds: [...args.memberUserIds], adminUserIds: [...args.adminUserIds] } };
    if (authId.current === undefined && options?.scope) authId.current = options.scope.userId;
    const sameEntry = (prior: Call) => prior.owner === owner && prior.scope?.isCurrent === call.scope?.isCurrent && current(prior);
    if (unconfirmed.current && sameEntry(unconfirmed.current)) return Promise.reject(new UnconfirmedCircleCreationError());
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
  const belongs = !mutation.variables || current(mutation.variables);
  return { mutateAsync, retrySetupAsync,
    isPending: belongs && mutation.isPending,
    error: belongs ? mutation.error : null,
    data: belongs ? mutation.data : undefined,
  };
}
