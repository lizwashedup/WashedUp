import { useCallback, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { WAITLIST_MANAGER_KEY } from '../constants/QueryKeys';
import { logError } from '../lib/logger';

type Entry = { id: string; event_id: string; user_id: string; notified?: boolean; exception_status?: string | null; exception_expires_at?: string | null };
type Intent = { desired: boolean; phase: 'pending' | 'failed' | 'unknown' };
type State = { entry: Entry | null; ready: boolean; loading: boolean; error: string | null; intent: Intent | null; pending: object | null; revision: number; visit: object | null };
type Options = { eventId: string; viewerId: string | null; epoch: number; isCurrent: () => boolean; canChange: () => boolean };
const fields = 'id,event_id,user_id,notified,exception_status,exception_expires_at';
const rejected = new Set(['P0001','42501','23502','23503','23505','23514','22P02','28000','28P01','42883','42703','42P01','40001','40P01']);
function ownEntry(data: unknown, eventId: string, viewerId: string): data is Entry {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const row = data as Entry;
  return typeof row.id === 'string' && !!row.id && row.event_id === eventId && row.user_id === viewerId;
}

/** Own-row receipts, focus reads and retries of the original desired state.
 * Never joins a plan and never repeats an uncertain write automatically. */
export function usePlanWaitlist(options: Options) {
  const client = useQueryClient();
  const latest = useRef(options); latest.current = options;
  const state = useMemo<State>(() => ({ entry:null, ready:false, loading:true, error:null, intent:null, pending:null, revision:0, visit:null }), [options.eventId, options.viewerId, options.epoch]);
  const current = useRef(state); current.current = state;
  const [, redraw] = useState(0);
  const publish = () => { if (current.current === state && state.visit && latest.current.isCurrent()) redraw(n => n + 1); };
  const capture = () => { const visit=state.visit, owner=options; return () => !!visit && state.visit===visit && current.current===state && owner.isCurrent(); };
  const invalidate = () => {
    for (const queryKey of [['waitlisted-plans'], WAITLIST_MANAGER_KEY(options.eventId), ['inbox-count']])
      void Promise.resolve(client.invalidateQueries({queryKey})).catch(error => logError(error,'plan.waitlist.refresh'));
  };
  const refresh = async () => {
    if (!options.viewerId || !state.visit || !options.isCurrent() || state.pending) return;
    const isCurrent=capture(), version=++state.revision;
    const valid=()=>isCurrent() && version===state.revision;
    state.loading=true; state.error=null; publish();
    try {
      const auth=await supabase.auth.getUser();
      if (!valid()) return;
      if (auth.error || auth.data.user?.id!==options.viewerId) throw new Error('Account unavailable');
      const response=await supabase.from('event_waitlist').select(fields).eq('event_id',options.eventId).eq('user_id',options.viewerId).maybeSingle();
      if (!valid()) return;
      if (response.error!==null || (response.data!==null && !ownEntry(response.data,options.eventId,options.viewerId))) throw new Error('Waitlist unavailable');
      state.entry=response.data; state.ready=true;
      if (state.intent) {
        if (!!response.data===state.intent.desired) { state.intent=null; invalidate(); }
        else if (state.intent.phase==='unknown') state.error='We still can’t confirm the change. Check again in a moment.';
      }
    } catch { if (valid()) { state.ready=false; state.error='Couldn’t check your waitlist. Try again.'; } }
    finally { if (valid()) {state.loading=false;publish();} }
  };
  const readRef = useRef(refresh); readRef.current=refresh;
  useFocusEffect(useCallback(()=>{
    const visit={};state.visit=visit;void readRef.current();
    return()=>{if(state.visit===visit){state.visit=null;state.revision++;}};
  },[state]));
  const change = async (desired: boolean, retry = false) => {
    if (!options.viewerId || !state.visit || !options.isCurrent() || !latest.current.canChange() || state.pending || state.loading || !state.ready) return;
    if (state.intent && (!retry || state.intent.phase!=='failed' || state.intent.desired!==desired)) return;
    if (!state.intent && !!state.entry===desired) return;
    const intent:Intent={desired,phase:'pending'}, token={}, isCurrent=capture(), entry=state.entry;
    state.intent=intent;state.pending=token;state.revision++;state.error=null;publish();
    let dispatched=false, duplicate=false;
    try {
      const auth=await supabase.auth.getUser();
      if (!isCurrent() || !latest.current.canChange()) { if(state.intent===intent)state.intent=null;return; }
      if (auth.error || auth.data.user?.id!==options.viewerId) throw new Error('Account unavailable');
      if (!desired && !entry) throw new Error('Missing waitlist entry');
      dispatched=true;
      const response=desired
        ? await supabase.from('event_waitlist').insert({event_id:options.eventId,user_id:options.viewerId}).select(fields).maybeSingle()
        : await supabase.from('event_waitlist').delete().eq('id',entry!.id).eq('event_id',options.eventId).eq('user_id',options.viewerId).select(fields).maybeSingle();
      if(response.error && rejected.has(String(response.error.code))){dispatched=false;duplicate=desired && response.error.code==='23505';throw response.error;}
      if(response.error!==null || !ownEntry(response.data,options.eventId,options.viewerId) || (!desired && response.data.id!==entry!.id)) throw new Error('Unconfirmed waitlist change');
      if(state.intent!==intent)return;
      state.entry=desired?response.data:null;state.intent=null;state.ready=true;
      if (current.current===state && latest.current.isCurrent()) invalidate();
    } catch {
      if(state.intent!==intent)return;
      intent.phase=dispatched || duplicate?'unknown':'failed';
      state.error=intent.phase==='failed' ? (desired?'Couldn’t join the waitlist. Try again.':'Couldn’t leave the waitlist. Try again.') : null;
    } finally {
      if(state.pending===token){state.pending=null;publish();}
      if(duplicate && isCurrent()) void refresh();
    }
  };
  const clearAfterJoining=()=>{state.revision++;state.entry=null;state.intent=null;state.error=null;state.loading=false;state.ready=true;publish();};
  const setExceptionStatus=(value:string|null)=>{state.revision++;state.loading=false;if(state.entry)state.entry={...state.entry,exception_status:value};publish();};
  return { entry:state.entry, ready:state.ready, loading:state.loading, busy:!!state.pending, error:state.error,
    intent:state.intent, refresh, change, retry:()=>state.intent?.phase==='failed'?change(state.intent.desired,true):Promise.resolve(),
    clearAfterJoining,setExceptionStatus,capture,
  };
}
