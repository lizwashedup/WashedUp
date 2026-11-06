import { useEffect, useMemo, useRef, useState } from 'react';
import { CreatorPageScopeExpired, type CreatorPageScope } from '../lib/creatorPageReview';
import { requestWithDeadline } from '../lib/requestWithDeadline';
import { hasOperatorDraftProtocol, cancelOperatorDraftAttempt, createOperatorDraft, getOperatorDraftAttempt, operatorDraftReceiptMatches, type OperatorDraftInput, type OperatorDraftReceipt, type OperatorDraftOutcome } from '../lib/operatorEventDraft';
import { readOperatorDraftAttempt, prepareOperatorDraftAttempt, completeOperatorDraftAttempt, type OperatorDraftAttempt } from '../lib/operatorEventDraftAttempt';

/** Recover a request across visits; mounting only reads, never retries a write. */
export function useOperatorEventDraft(communityId:string|null,scope:CreatorPageScope|undefined){
  const state=useMemo(()=>({loaded:!scope,supported:false,busy:false,pending:null as OperatorDraftAttempt|null,
    saved:null as OperatorDraftReceipt|null,restored:null as OperatorDraftInput|null,error:null as string|null,retryReady:false}),[communityId,scope]);
  const mounted=useRef(false),latest=useRef(state);latest.current=state;const [,render]=useState(0);
  const current=()=>mounted.current&&latest.current===state&&!!scope?.isCurrent();
  const update=()=>{if(current())render(n=>n+1);};
  const available=!!scope?.isCurrent();
  const within=async<T,>(ms:number,work:(owned:CreatorPageScope)=>Promise<T>)=>{
    if(!scope||!current())throw new CreatorPageScopeExpired();let active=true;
    const owned={userId:scope.userId,isCurrent:()=>active&&current()};
    try{return await requestWithDeadline(work(owned),ms);}finally{active=false;}
  };
  const assert=(owned:CreatorPageScope)=>{if(!owned.isCurrent())throw new CreatorPageScopeExpired();};
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const finish=async(attempt:OperatorDraftAttempt,saved:OperatorDraftOutcome,owned:CreatorPageScope)=>{
    assert(owned);
    if(saved.requestId!==attempt.requestId||saved.userId!==attempt.userId||!operatorDraftReceiptMatches(saved,attempt.input))throw Error('Check the original draft save.');
    if(saved.status==='Draft')state.saved=saved;state.retryReady=false;
    if(!await completeOperatorDraftAttempt(attempt,saved,owned))throw Error('Check this draft once more to finish recovery.');
    assert(owned);state.pending=null;state.error=null;
    if(saved.status==='Cancelled')state.restored=attempt.input;
    return saved;
  };
  const check=async()=>{
    if(!scope||!current()||state.busy)return;
    state.busy=true;state.error=null;state.retryReady=false;update();
    try{
      await within(12_000,async owned=>{
        const pending=await readOperatorDraftAttempt(communityId,owned);assert(owned);state.pending=pending;
        const supported=await hasOperatorDraftProtocol(owned);assert(owned);state.supported=supported;
        if(pending&&!supported)throw Error('Draft recovery is unavailable.');
        if(pending){
          const saved=await getOperatorDraftAttempt(pending.requestId,owned);assert(owned);
          if(saved)await finish(pending,saved,owned);else state.retryReady=true;
        }
        state.loaded=true;
      });
    }catch{if(current())state.error=state.saved?'Your draft is saved. Check again to finish recovery on this device.':state.pending?'We couldn’t confirm the draft save. Check again when connected.':'We couldn’t load event creation. Check your connection and try again.';}
    finally{state.busy=false;update();}
  };
  useEffect(()=>{if(available)void check();},[state,available]);
  const canStart=()=>!scope||current()&&state.loaded&&!state.busy&&!state.pending&&!state.saved&&!state.error;
  const save=async(input:OperatorDraftInput)=>{
    if(!scope||!canStart()||!state.supported||input.communityId!==communityId)throw Error('Check the original draft before saving.');
    state.busy=true;state.error=null;update();
    try{
      return await within(25_000,async owned=>{
        const prepared=await prepareOperatorDraftAttempt(input,owned);assert(owned);state.pending=prepared.attempt;update();
        if(!prepared.created)throw Error('Check the original draft before saving.');
        return finish(prepared.attempt,await createOperatorDraft(prepared.attempt.requestId,prepared.attempt.input,owned),owned);
      });
    }catch(error){if(current())state.error=state.saved?'Your draft is saved. Check again to finish recovery on this device.':'This save is unconfirmed. Check its status before continuing.';throw error;}
    finally{state.busy=false;update();}
  };
  const recover=async(cancel:boolean)=>{
    if(!scope||!current()||state.busy||!state.pending||(!cancel&&!state.retryReady))return;
    state.busy=true;state.error=null;state.retryReady=false;update();
    try{
      await within(25_000,async owned=>{
        const original=await readOperatorDraftAttempt(communityId,owned);assert(owned);
        if(!original||JSON.stringify(original)!==JSON.stringify(state.pending))throw Error('Check the original save again.');
        await finish(original,await (cancel?cancelOperatorDraftAttempt:createOperatorDraft)(original.requestId,original.input,owned),owned);
      });
    }catch{if(current())state.error='The original save is still unconfirmed. Check its status when connected.';}
    finally{state.busy=false;update();}
  };
  return {enabled:!!scope,ready:state.loaded,supported:state.supported,busy:state.busy,pending:state.pending,saved:state.saved,
    error:state.error,restored:state.restored,retryReady:state.retryReady,canStart,save,check,retry:()=>recover(false),resumeEditing:()=>recover(true)};
}
