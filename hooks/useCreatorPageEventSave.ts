import { useEffect, useMemo, useRef, useState } from 'react';
import { CreatorPageScopeExpired, type CreatorPageScope } from '../lib/creatorPageReview';
import { requestWithDeadline } from '../lib/requestWithDeadline';
import { getPageEventSaveAttempt, getPageEventSaveState, validPageEventSaveInput, pageEventSaveMatches, savePageEvent, type PageEventSaveInput, type PageEventSaveReceipt, type PageEventSaveState } from '../lib/creatorPageEventSave';
import { clearPageEventSaveAttempt, preparePageEventSaveAttempt, readPageEventSaveAttempt, type PageEventSaveAttempt } from '../lib/creatorPageEventSaveAttempt';
/** Current page/event/account owns saves; mounting never replays pending work. */
export function useCreatorPageEventSave(pageId: string | undefined,eventId: string | undefined,scope: CreatorPageScope | undefined) {
  const state = useMemo(()=>({ loaded:false,busy:false,current:null as PageEventSaveState|null,pending:null as PageEventSaveAttempt|null,
    recoveryRequired:false,retryReady:false,conflict:false,error:null as string|null,outcome:null as PageEventSaveReceipt|null,confirmedInput:null as PageEventSaveInput|null }),[pageId,eventId,scope]);
  const latest=useRef(state);latest.current=state;const mounted=useRef(false);const [,render]=useState(0);
  const current=()=>mounted.current&&latest.current===state&&!!scope?.isCurrent();
  const update=()=>{if(current())render(n=>n+1);};
  const withinOperation=async<T,>(milliseconds:number,work:(owned:CreatorPageScope)=>Promise<T>)=>{
    if(!scope||!current())throw new CreatorPageScopeExpired();
    let active=true;
    const owned={userId:scope.userId,isCurrent:()=>active&&current()};
    try{return await requestWithDeadline(work(owned),milliseconds);}
    finally{active=false;}
  };
  const assertOperation=(owned:CreatorPageScope)=>{if(!owned.isCurrent())throw new CreatorPageScopeExpired();};
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const load=async()=>{
    if(!pageId||!eventId||!scope||!current()||state.busy)return;
    state.busy=true;state.error=null;update();
    try{
      await withinOperation(12_000,async owned=>{
      const pending=await readPageEventSaveAttempt(pageId,eventId,owned);assertOperation(owned);
      const saved=await getPageEventSaveState(pageId,eventId,owned);assertOperation(owned);
      state.pending=pending;state.recoveryRequired=!!pending;state.retryReady=false;
      if(state.current&&state.current.updatedAt!==saved.updatedAt)state.conflict=true;
      state.current=saved;state.loaded=true;
      });
    }catch{if(current()){state.error='Couldn’t check the saved event. Try again when connected.';state.loaded=false;}}
    finally{state.busy=false;update();}
  };
  useEffect(()=>{void load();},[state]);
  const finish=async(attempt:PageEventSaveAttempt,saved:PageEventSaveReceipt,owned:CreatorPageScope)=>{
    assertOperation(owned);
    if(saved.requestId!==attempt.requestId||saved.userId!==attempt.userId||!pageEventSaveMatches(saved,attempt.input))throw Error('The saved event does not match this attempt.');
    state.outcome=saved;state.confirmedInput=attempt.input;state.current=saved;state.retryReady=false;
    // Confirmation survives a device-storage cleanup failure.
    if(!await requestWithDeadline(clearPageEventSaveAttempt(attempt,owned),3_000))throw Error('The event saved. Check again to finish recovery.');
    assertOperation(owned);
    state.pending=null;state.recoveryRequired=false;state.error=null;
  };
  const dispatch=async(attempt:PageEventSaveAttempt,owned:CreatorPageScope)=>{
    try {
      assertOperation(owned);
      const saved=await savePageEvent(attempt.pageId,attempt.eventId,attempt.requestId,attempt.input,owned);
      await finish(attempt,saved,owned);return saved;
    } catch (failure) {
      // A definite PostgreSQL validation/permission rejection rolls back this
      // transaction. Confirm that no earlier same-ID receipt exists before
      // releasing its local attempt so the owner can correct the input.
      const code=failure&&typeof failure==='object'&&'code' in failure?failure.code:null;
      if(owned.isCurrent()&&typeof code==='string'&&['22023','22P02','P0001','23514'].includes(code)) {
        try {
          const saved=await getPageEventSaveAttempt(attempt.pageId,attempt.eventId,attempt.requestId,owned);
          if(owned.isCurrent()&&!saved&&await clearPageEventSaveAttempt(attempt,owned)) {
            if(owned.isCurrent()){state.pending=null;state.recoveryRequired=false;state.retryReady=false;}
          }
        } catch { /* Failed recovery keeps the original attempt. */ }
      }
      throw failure;
    }
  };
  const save=async(input:Omit<PageEventSaveInput,'expectedUpdatedAt'>)=>{
    if(!current()||!pageId||!eventId||!scope||!state.loaded||!state.current||state.busy||state.error||state.recoveryRequired||state.conflict)throw Error('Check the saved event before saving changes.');
    const completeInput={...input,expectedUpdatedAt:state.current.updatedAt};
    if(!validPageEventSaveInput(completeInput))throw Error('Check the offer settings. Capacity must be a positive whole number or blank for no limit.');
    state.busy=true;state.error=null;state.outcome=null;update();
    try{
      state.recoveryRequired=true;update();
      return await withinOperation(25_000,async owned=>{
        const prepared=await preparePageEventSaveAttempt(pageId,eventId,completeInput,owned);
        assertOperation(owned);
        state.pending=prepared.attempt;
        if(!prepared.created)throw Error('Check the original event save before continuing.');
        return dispatch(prepared.attempt,owned);
      });
    }catch(e){if(current())state.error=!state.recoveryRequired?null:state.outcome?'The event saved. Check its current status to finish recovery.':'This save is unconfirmed. Check its saved status before continuing.';throw e;}
    finally{state.busy=false;update();}
  };
  const check=async()=>{
    if(!current()||!pageId||!eventId||!scope||state.busy)return;
    state.busy=true;state.retryReady=false;state.error=null;update();
    try{
      await withinOperation(12_000,async owned=>{
      const attempt=await readPageEventSaveAttempt(pageId,eventId,owned);assertOperation(owned);
      state.pending=attempt;state.recoveryRequired=!!attempt;
      if(!attempt){
        const fresh=await getPageEventSaveState(pageId,eventId,owned);assertOperation(owned);
        // Checking cannot rebase older unsaved editor fields onto another
        // session's version. Reopen/review the saved event before writing.
        if(state.current&&state.current.updatedAt!==fresh.updatedAt)state.conflict=true;
        state.current=fresh;state.loaded=true;return;
      }
      let saved=await getPageEventSaveAttempt(pageId,eventId,attempt.requestId,owned);assertOperation(owned);
      const fresh=await getPageEventSaveState(pageId,eventId,owned);assertOperation(owned);
      // A commit can land between these two reads. Look for its receipt again
      // before clearing a stale rejected request on version-change evidence.
      if(!saved&&fresh.updatedAt!==attempt.input.expectedUpdatedAt)saved=await getPageEventSaveAttempt(pageId,eventId,attempt.requestId,owned);
      assertOperation(owned);
      if(saved){await finish(attempt,saved,owned);assertOperation(owned);state.current=fresh;if(fresh.updatedAt!==saved.updatedAt)state.conflict=true;}
      else if(fresh.updatedAt!==attempt.input.expectedUpdatedAt){
        if(!await clearPageEventSaveAttempt(attempt,owned))throw Error('Check the original event save again.');
        assertOperation(owned);
        state.pending=null;state.recoveryRequired=false;state.current=fresh;state.conflict=true;
      }else{state.current=fresh;state.retryReady=true;}
      state.loaded=true;
      });
    }catch{if(current())state.error=state.outcome?'The event saved. Check its current status to finish recovery.':'Couldn’t confirm this save. Your original attempt is kept for another check.';}
    finally{state.busy=false;update();}
  };
  const retry=async()=>{
    if(!current()||state.busy||!state.pending||!state.retryReady)return;
    const attempt=state.pending;state.busy=true;state.retryReady=false;update();
    try{await withinOperation(25_000,owned=>dispatch(attempt,owned));}catch{if(current())state.error=state.outcome?'The event saved. Check its current status to finish recovery.':state.recoveryRequired?'This save is still unconfirmed. Check its saved status.':null;}
    finally{state.busy=false;update();}
  };
  return {...state,save,check,retry,refresh:load,canWrite:()=>state.loaded&&!state.busy&&!state.error&&!state.recoveryRequired&&!state.conflict&&current(),ready:!!pageId&&state.loaded&&!state.busy&&!state.error&&!state.recoveryRequired&&!state.conflict&&current()};
}
