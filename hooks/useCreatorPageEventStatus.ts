import {useEffect,useMemo,useRef,useState} from 'react';
import {CreatorPageScopeExpired,type CreatorPageScope} from '../lib/creatorPageReview';
import {requestWithDeadline} from '../lib/requestWithDeadline';
import {getPageEventSaveState} from '../lib/creatorPageEventSave';
import {loadCreatorPageEventReadiness} from '../lib/creatorPageEventReadiness';
import {getPageEventStatusAttempt,setPageEventStatus,type PageEventStatusInput,type PageEventStatusReceipt} from '../lib/creatorPageEventStatus';
import {readPageEventStatusAttempt,preparePageEventStatusAttempt,clearPageEventStatusAttempt,type PageEventStatusAttempt} from '../lib/creatorPageEventStatusAttempt';
/** Persist before status/refund orchestration; returning only reads, never replays money. */
export function useCreatorPageEventStatus(pageId:string|undefined,eventId:string|undefined,scope:CreatorPageScope|undefined) {
  const state=useMemo(()=>({loaded:false,busy:false,pending:null as PageEventStatusAttempt|null,error:null as string|null,
    retryReady:false,refundsNeedReview:false,conflict:false,outcome:null as PageEventStatusReceipt|null,alreadyClosed:false}),[pageId,eventId,scope]);
  const latest=useRef(state);latest.current=state;const mounted=useRef(false);const [,render]=useState(0);
  const current=()=>mounted.current&&latest.current===state&&!!scope?.isCurrent();
  const update=()=>{if(current())render(v=>v+1);};
  const assertOperation=(owned:CreatorPageScope)=>{if(!owned.isCurrent())throw new CreatorPageScopeExpired();};
  const withinOperation=async<T,>(milliseconds:number,work:(owned:CreatorPageScope)=>Promise<T>)=>{
    if(!scope||!current())throw new CreatorPageScopeExpired();
    let active=true;
    const owned={userId:scope.userId,isCurrent:()=>active&&current()};
    try{return await requestWithDeadline(work(owned),milliseconds);}
    finally{active=false;}
  };
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const finish=async(attempt:PageEventStatusAttempt,receipt:PageEventStatusReceipt,owned:CreatorPageScope)=>{
    assertOperation(owned);state.outcome=receipt;state.retryReady=false;
    const readiness=await loadCreatorPageEventReadiness(attempt.pageId,attempt.eventId,owned);
    assertOperation(owned);state.refundsNeedReview=receipt.status==='Cancelled'&&readiness.cancellationRequiresRefunds;
    if(!await requestWithDeadline(clearPageEventStatusAttempt(attempt,owned),3_000))throw Error('The event action is confirmed. Check again to finish recovery.');
    assertOperation(owned);state.pending=null;state.error=null;
  };
  const check=async()=>{
    if(!current()||!pageId||!eventId||!scope||state.busy)return;
    state.busy=true;state.error=null;state.retryReady=false;update();
    try{
      await withinOperation(12_000,async owned=>{
      const attempt=await readPageEventStatusAttempt(pageId,eventId,owned);assertOperation(owned);
      state.pending=attempt;state.loaded=true;if(!attempt)return;
      let receipt=await getPageEventStatusAttempt(pageId,eventId,attempt.requestId,attempt.input,owned);
      assertOperation(owned);
      const fresh=await getPageEventSaveState(pageId,eventId,owned);assertOperation(owned);
      if(!receipt&&(fresh.updatedAt!==attempt.input.expectedUpdatedAt||fresh.status!=='Live'))receipt=await getPageEventStatusAttempt(pageId,eventId,attempt.requestId,attempt.input,owned);
      assertOperation(owned);
      if(receipt){await finish(attempt,receipt,owned);return;}
      // Version/status change prevents a late original request from succeeding.
      // A second receipt read distinguishes it from our own late commit.
      if(fresh.updatedAt!==attempt.input.expectedUpdatedAt||fresh.status!=='Live'){
        const readiness=await loadCreatorPageEventReadiness(pageId,eventId,owned);assertOperation(owned);
        state.refundsNeedReview=attempt.input.status==='Cancelled'&&readiness.cancellationRequiresRefunds;
        if(!await requestWithDeadline(clearPageEventStatusAttempt(attempt,owned),3_000))throw Error('Check the original event action again.');
        assertOperation(owned);state.pending=null;state.alreadyClosed=fresh.status===attempt.input.status;state.conflict=!state.alreadyClosed;
        return;
      }
      const readiness=await loadCreatorPageEventReadiness(pageId,eventId,owned);assertOperation(owned);
      state.refundsNeedReview=attempt.input.status==='Cancelled'&&readiness.cancellationRequiresRefunds;
      state.retryReady=!state.refundsNeedReview;
      });
    }catch{if(current())state.error=state.outcome?'The event action was recorded. Check its current status to finish recovery.':'Could not confirm this event action. Your original request is kept for another check.';}
    finally{state.busy=false;update();}
  };
  useEffect(()=>{void check();},[state]);
  const dispatch=async(attempt:PageEventStatusAttempt,owned:CreatorPageScope)=>{
    assertOperation(owned);
    const receipt=await setPageEventStatus(attempt.pageId,attempt.eventId,attempt.requestId,attempt.input,owned);
    await finish(attempt,receipt,owned);return receipt;
  };
  const begin=async(input:PageEventStatusInput,beforeStatus?:(owned:CreatorPageScope)=>Promise<void>)=>{
    if(!current()||!pageId||!eventId||!scope||!state.loaded||state.busy||state.pending||state.error||state.conflict||state.outcome||state.alreadyClosed)throw Error('Check this event action before continuing.');
    state.busy=true;state.error=null;state.retryReady=false;update();
    try{
      return await withinOperation(25_000,async owned=>{
      const prepared=await preparePageEventStatusAttempt(pageId,eventId,input,owned);assertOperation(owned);
      state.pending=prepared.attempt;
      if(!prepared.created)throw Error('Check the original event action before continuing.');
      // This callback can run only for the newly confirmed action. Recovery and
      // original status retry never invoke the refund workflow again.
      if(beforeStatus)await beforeStatus(owned);
      assertOperation(owned);
      return await dispatch(prepared.attempt,owned);
      });
    }catch(e){if(current())state.error=state.outcome?'The event action was recorded. Check its current status to finish recovery.':'This action is unconfirmed. Check its saved status before continuing.';if(state.outcome)throw Error('The event action was recorded. Check its current status to finish recovery.');throw e;}
    finally{state.busy=false;update();}
  };
  const retry=async()=>{
    if(!current()||!scope||!state.pending||!state.retryReady||state.busy)return;
    const a=state.pending;
    state.busy=true;state.retryReady=false;state.error=null;update();
    try{
      await withinOperation(25_000,async owned=>{
      // Check again immediately before status dispatch; a paid order may have
      // appeared since recovery. Backend authority remains independent.
      const readiness=await loadCreatorPageEventReadiness(a.pageId,a.eventId,owned);assertOperation(owned);
      if(a.input.status==='Cancelled'&&readiness.cancellationRequiresRefunds){state.refundsNeedReview=true;return;}
      await dispatch(a,owned);
      });
    }catch{if(current())state.error=state.outcome?'The event action was recorded. Check its current status to finish recovery.':'Could not confirm the original event action. Check its saved status again.';}
    finally{state.busy=false;update();}
  };
  return {...state,begin,check,retry,canWrite:()=>current()&&state.loaded&&!state.busy&&!state.pending&&!state.error&&!state.conflict&&!state.outcome&&!state.alreadyClosed};
}
