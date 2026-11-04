import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import type { CreatorPageScope } from '../lib/creatorPageReview';
import { requestWithDeadline } from '../lib/requestWithDeadline';
import { loadSaleAlertPreference, saveSaleAlertPreference, SaleAlertAccessDenied, type SaleAlertPreference } from '../lib/eventSaleAlerts';

/** Own event preference; pending/unknown saves never repeat automatically. */
export function useSaleAlertPreference(eventId: string, scope: CreatorPageScope | null) {
 const [,render]=useReducer((x:number)=>x+1,0);
 const state=useMemo(()=>({active:false,busy:false,error:'',unavailable:false,remote:null as SaleAlertPreference|null}),[eventId,scope]);
 const latest=useRef(state);latest.current=state;
 const current=useCallback(()=>state.active&&latest.current===state&&!!scope?.isCurrent(),[state,scope]);
 const publish=useCallback(()=>{if(current())render();},[current]);
 const check=useCallback(async()=>{
  if(!current()||!scope||state.busy)return;state.busy=true;state.error='';publish();
  let reading=true;
  const readScope={userId:scope.userId,isCurrent:()=>reading&&current()};
  try{const saved=await requestWithDeadline(loadSaleAlertPreference(eventId,readScope),12_000);if(current()){state.remote=saved;state.unavailable=false;}}
  catch(e){if(current()){if(e instanceof SaleAlertAccessDenied){state.remote=null;state.unavailable=true;}else state.error='Could not check your sale alert preference.';}}
  finally{reading=false;state.busy=false;publish();}
 },[current,scope,state,eventId,publish]);
 useEffect(()=>{state.active=true;void check();return()=>{state.active=false;};},[state,check]);
 const change=async()=>{
  if(!current()||!scope||state.busy||state.error||!state.remote)return;
  const saved=state.remote;state.busy=true;publish();
  // Cover session lookup as well as the RPC. An expired attempt cannot dispatch
  // later; a dispatched but unconfirmed write still requires a status read.
  let saving=true;
  const writeScope={userId:scope.userId,isCurrent:()=>saving&&current()};
  try{const result=await requestWithDeadline(saveSaleAlertPreference(saved,!saved.enabled,writeScope),25_000);if(current())state.remote=result;}
  catch(e){if(current()){if(e instanceof SaleAlertAccessDenied){state.remote=null;state.unavailable=true;}else state.error='Your change could not be confirmed. Check its saved status.';}}
  finally{saving=false;state.busy=false;publish();}
 };
 return {remote:state.remote,busy:state.busy,error:state.error,unavailable:state.unavailable,check,change};
}
