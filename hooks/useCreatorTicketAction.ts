import { useCallback, useEffect, useRef, useState } from 'react';
import type { CreatorPageScope } from '../lib/creatorPageReview';
import { performTicketAction, type TicketAction, type TicketActionState } from '../lib/creatorTicketAction';
import {readCreatorExtraRemoval,prepareCreatorExtraRemoval,clearCreatorExtraRemoval} from '../lib/creatorExtraRemovalAttempt';

/** One in-flight management action; an uncertain result retains the original intent. */
export function useCreatorTicketAction(scope: CreatorPageScope, onConfirmed: (action: TicketAction) => void, eventId?:string) {
  const lock = useRef(false);
  const intent = useRef<TicketAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [recovery, setRecovery] = useState<{ action: TicketAction; state: TicketActionState; message?: string } | null>(null);
  const [loaded,setLoaded]=useState(!eventId),[storageError,setStorageError]=useState(''),[notice,setNotice]=useState('');
  const generation=useRef(0),mounted=useRef(true),storageReady=useRef(!eventId);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;generation.current++;};},[]);
  const reload=useCallback(async()=>{
    if(!mounted.current||!eventId||!scope.isCurrent())return;
    const visit=++generation.current;storageReady.current=false;setLoaded(false);setStorageError('');
    try{
      const action=await readCreatorExtraRemoval(eventId,scope);
      if(!mounted.current||visit!==generation.current||!scope.isCurrent())return;
      if(action){intent.current=action;setRecovery({action,state:'unknown'});}
      storageReady.current=true;setLoaded(true);
    }catch{if(mounted.current&&visit===generation.current&&scope.isCurrent())setStorageError('Your previous extra action couldn’t be loaded. Try again before making changes.');}
  },[eventId,scope]);
  useEffect(()=>{if(eventId)void reload();else {storageReady.current=true;setLoaded(true);}},[eventId,reload]);
  const run = async (action: TicketAction, checkOnly = false, retry = false) => {
    if (!mounted.current || !scope.isCurrent() || !storageReady.current || storageError || lock.current || (intent.current && (!retry || intent.current !== action))) return;
    const owned = scope;
    lock.current = true; intent.current = action; setBusy(true);setNotice('');
    // Keep recovery mounted through a focus change, without assuming the request was cancelled.
    setRecovery({ action, state: 'unknown' });
    try {
      if(action.kind==='remove-extra'&&action.pageId&&!action.requestId){
        const prepared=await prepareCreatorExtraRemoval(action,owned);action=prepared.action;intent.current=action;
        if(!owned.isCurrent()||!mounted.current)return;
        setRecovery({action,state:'unknown'});
        if(!prepared.created)return; // Another visit's original action must be checked explicitly.
      }
      const state = await performTicketAction(action, owned, checkOnly);
      if (!owned.isCurrent()||!mounted.current) return;
      if (state === 'confirmed'||state==='in_use') {
        if(action.kind==='remove-extra'&&action.requestId)await clearCreatorExtraRemoval(action,owned);
        if(!owned.isCurrent()||!mounted.current)return;
        intent.current = null; setRecovery(null); onConfirmed(action);
        if(state==='in_use')setNotice('This extra is linked to an order and stays in its history. Pause it to stop new purchases.');
      }
      else setRecovery({ action, state });
    } catch {
      if (owned.isCurrent()&&mounted.current) setRecovery({ action, state: 'unknown', message: 'Check your connection, device storage and event access, then check the saved status.' });
    } finally { lock.current = false;if(mounted.current)setBusy(false); }
  };
  return {
    busy, recovery, run,storageError,notice,reload,
    isBlocked: () => !storageReady.current || !!storageError || lock.current || !!intent.current,
    check: () => recovery && run(recovery.action, true, true),
    retry: () => recovery?.state === 'unchanged' && run(recovery.action, false, true),
    dismiss: () => { if (!lock.current && !recovery?.action.requestId && (recovery?.state === 'changed' || recovery?.state === 'unchanged')) { intent.current = null; setRecovery(null); } },
    blocked: !loaded || !!storageError || busy || !!recovery,
  };
}
