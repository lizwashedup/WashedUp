import { useCallback, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import * as Crypto from 'expo-crypto';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { WAITLIST_MANAGER_KEY } from '../constants/QueryKeys';
import { logError } from '../lib/logger';
import { requestWithDeadline } from '../lib/requestWithDeadline';

import { withDeadline } from '../lib/withTimeout';
import { waitlistChangeReceipts, type WaitlistEntry as Entry } from '../lib/waitlistChangeReceipts';

type Intent = { desired: boolean; phase: 'pending' | 'failed' | 'unknown' };
type State = { originalId?: string; entry: Entry | null; ready: boolean; loading: boolean; error: string | null; intent: Intent | null; pending: object | null; revision: number; visit: object | null };
type Options = { eventId: string; viewerId: string | null; epoch: number; isCurrent: () => boolean; canChange: () => boolean };
const fields = 'id,event_id,user_id,notified,exception_status,exception_expires_at';
const rejected = new Set(['P0001','42501','23502','23503','23505','23514','22P02','28000','28P01','42883','42703','42P01','40001','40P01']);
function ownEntry(data: unknown, eventId: string, viewerId: string): data is Entry {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const row = data as Entry;
  return typeof row.id === 'string' && !!row.id && row.event_id === eventId && row.user_id === viewerId;
}

const failureText = (desired: boolean) => desired ? 'Couldn’t join the waitlist. Try again.' : 'Couldn’t leave the waitlist. Try again.';

/** Own-row receipts, focus reads and retries of the original desired state.
 * Never joins a plan and never repeats an uncertain write automatically. */
export function usePlanWaitlist(options: Options) {
  const client = useQueryClient();
  const receipts = waitlistChangeReceipts(client);
  const key = JSON.stringify([options.viewerId, options.eventId]);
  const latest = useRef(options); latest.current = options;
  const state = useMemo<State>(() => ({ entry:null, ready:false, loading:true, error:null, intent:null, pending:null, revision:0, visit:null }), [options.eventId, options.viewerId, options.epoch]);
  const current = useRef(state); current.current = state;
  const [, redraw] = useState(0);
  const publish = () => { if (current.current === state && state.visit && latest.current.isCurrent()) redraw(n => n + 1); };
  const capture = () => { const visit=state.visit, owner=options; return () => !!visit && state.visit===visit && current.current===state && owner.isCurrent(); };
  const invalidate = () => {
    for (const queryKey of [['waitlisted-plans',options.viewerId], WAITLIST_MANAGER_KEY(options.eventId), ['inbox-count',options.viewerId]])
      void Promise.resolve(client.invalidateQueries({queryKey})).catch(error => logError(error,'plan.waitlist.refresh'));
  };
  const refresh = async () => {
    if (!options.viewerId || !state.visit || !options.isCurrent() || state.pending) return;
    const isCurrent=capture(), version=++state.revision;
    const valid=()=>isCurrent() && version===state.revision;
    const ticket = receipts.get(key);
    if (ticket) { state.intent={desired:ticket.desired,phase:'unknown'}; state.originalId=ticket.rowId; }
    state.loading=true; state.error=null; publish();
    try {
      const auth=await requestWithDeadline(supabase.auth.getUser(), 8000);
      if (!valid()) return;
      if (auth.error || auth.data.user?.id!==options.viewerId) throw new Error('Account unavailable');
      const response=await requestWithDeadline(supabase.from('event_waitlist').select(fields).eq('event_id',options.eventId).eq('user_id',options.viewerId).maybeSingle(), 12000);
      if (!valid()) return;
      if (response.error!==null || (response.data!==null && !ownEntry(response.data,options.eventId,options.viewerId))) throw new Error('Waitlist unavailable');
      state.entry=response.data; state.ready=true;
      if (ticket && receipts.get(key) === ticket) {
        // A join can still be pending behind another device’s entry. Only
        // the submitted UUID (or a definite uniqueness refusal and a current
        // membership) proves it is safe to offer the opposite action.
        const confirmed = ticket.desired ? response.data?.id===ticket.rowId || (ticket.conflict && !!response.data)
          : response.data?.id!==ticket.rowId;
        if (confirmed) {
          if (receipts.finish(ticket,{kind:'confirmed',entry:response.data})) invalidate();
        } else if (ticket.conflict) {
          receipts.finish(ticket,{kind:'refused'});
        } else state.error='We still can’t confirm the change. Check again in a moment.';
      } else if (state.intent?.phase==='failed' && (!!response.data===state.intent.desired ||
          (!state.intent.desired && response.data && response.data.id!==state.originalId))) {
        state.intent=null; state.error=null; invalidate();
      }
    } catch { if (valid()) { state.ready=false; state.error='Couldn’t check your waitlist. Try again.'; } }
    finally { if (valid()) {state.loading=false;publish();} }
  };
  const readRef = useRef(refresh); readRef.current=refresh;
  useFocusEffect(useCallback(()=>{
    const visit={};state.visit=visit;
    if (!receipts.get(key) && !state.pending && state.intent?.phase !== 'failed') state.intent=null;
    const stop=receipts.subscribe(key,(ticket,outcome)=>{
      if (state.visit!==visit || current.current!==state || !latest.current.isCurrent()) return;
      state.originalId=ticket.rowId;
      if (outcome.kind==='pending') {
        state.revision++; state.loading=false;
        if (!state.pending) state.intent={desired:ticket.desired,phase:'unknown'};
      } else if (outcome.kind==='confirmed') {
        state.revision++;state.loading=false;state.entry=outcome.entry;state.ready=true;
        state.intent=null;state.error=null;state.pending=null;
      } else {
        state.intent={desired:ticket.desired,phase:outcome.kind==='refused'?'failed':'unknown'};
        state.error=outcome.kind==='refused' ? failureText(ticket.desired) : null;
      }
      publish();
    });
    void readRef.current();
    return()=>{stop();if(state.visit===visit){state.visit=null;state.revision++;}};
  },[state,receipts,key]));
  const change = async (desired: boolean, retry = false) => {
    if (!options.viewerId || !state.visit || !options.isCurrent() || !latest.current.canChange() || state.pending || state.loading || !state.ready) return;
    if (receipts.get(key)) return refresh();
    if (state.intent && (!retry || state.intent.phase!=='failed' || state.intent.desired!==desired)) return;
    if (!state.intent && !!state.entry===desired) return;
    const intent:Intent={desired,phase:'pending'}, token={}, isCurrent=capture(), entry=state.entry;
    state.intent=intent;state.pending=token;state.revision++;state.error=null;publish();
    if (!retry) state.originalId=entry?.id;
    let ticket: ReturnType<typeof receipts.begin> = null;
    let duplicate=false;
    try {
      const auth=await requestWithDeadline(supabase.auth.getUser(), 8000);
      if (!isCurrent() || state.intent!==intent || !latest.current.canChange()) { if(state.intent===intent)state.intent=null;return; }
      if (auth.error || auth.data.user?.id!==options.viewerId) throw new Error('Account unavailable');
      if (!desired && (!entry || (retry && state.originalId && state.originalId!==entry.id))) throw new Error('Waitlist entry changed');
      const owned=receipts.begin(key,desired,desired ? Crypto.randomUUID() : entry!.id);
      if (!owned) { const other=receipts.get(key)!;state.intent={desired:other.desired,phase:'unknown'};return; }
      ticket=owned;
      // A UI timeout must not cancel the database write or authorize a second
      // one. Continue observing its exact receipt after leaving this route.
      const write=(async()=>{
        try {
          const response=desired
            ? await supabase.from('event_waitlist').insert({id:owned.rowId,event_id:options.eventId,user_id:options.viewerId}).select(fields).maybeSingle()
            : await supabase.from('event_waitlist').delete().eq('id',owned.rowId).eq('event_id',options.eventId).eq('user_id',options.viewerId).select(fields).maybeSingle();
          if(response.error && rejected.has(String(response.error.code))){
            duplicate=desired && response.error.code==='23505';
            receipts.finish(owned,{kind:duplicate?'conflict':'refused'});
          } else if (response.error===null && ownEntry(response.data,options.eventId,options.viewerId!) && response.data.id===owned.rowId) {
            if (receipts.finish(owned,{kind:'confirmed',entry:desired?response.data:null})) invalidate();
          } else receipts.finish(owned,{kind:'unknown'});
        } catch { receipts.finish(owned,{kind:'unknown'}); }
      })();
      await withDeadline(write,12_000,'Waitlist update');
    } catch {
      if(ticket) receipts.finish(ticket,{kind:'unknown'});
      else if (state.intent===intent) {intent.phase='failed';state.error=failureText(desired);}
    } finally {
      if(state.pending===token){state.pending=null;publish();}
      if(duplicate && isCurrent()) void refresh();
    }
  };
  const clearAfterJoining=()=>{
    if (!state.visit || current.current!==state || !options.isCurrent()) return;
    const held=receipts.get(key);
    if (held) receipts.finish(held,{kind:'confirmed',entry:null});
    state.pending=null;state.revision++;state.entry=null;state.intent=null;state.error=null;state.loading=false;state.ready=true;publish();};
  const setExceptionStatus=(value:string|null)=>{state.revision++;state.loading=false;if(state.entry)state.entry={...state.entry,exception_status:value};publish();};
  return { entry:state.entry, ready:state.ready, loading:state.loading, busy:!!state.pending, error:state.error,
    intent:state.intent, refresh, change, retry:()=>state.intent?.phase==='failed'?change(state.intent.desired,true):Promise.resolve(),
    clearAfterJoining,setExceptionStatus,capture,
  };
}
