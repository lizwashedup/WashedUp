import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import type { CreatorPageScope } from '../lib/creatorPageReview';
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
  try{const saved=await loadSaleAlertPreference(eventId,scope);if(current()){state.remote=saved;state.unavailable=false;}}
  catch(e){if(current()){if(e instanceof SaleAlertAccessDenied){state.remote=null;state.unavailable=true;}else state.error='Could not check your sale alert preference.';}}
  finally{state.busy=false;publish();}
 },[current,scope,state,eventId,publish]);
 useEffect(()=>{state.active=true;void check();return()=>{state.active=false;};},[state,check]);
 const change=async()=>{
  if(!current()||!scope||state.busy||state.error||!state.remote)return;
  const saved=state.remote;state.busy=true;publish();
  try{const result=await saveSaleAlertPreference(saved,!saved.enabled,scope);if(current())state.remote=result;}
  catch(e){if(current()){if(e instanceof SaleAlertAccessDenied){state.remote=null;state.unavailable=true;}else state.error='Your change could not be confirmed. Check its saved status.';}}
  finally{state.busy=false;publish();}
 };
 return {remote:state.remote,busy:state.busy,error:state.error,unavailable:state.unavailable,check,change};
}
