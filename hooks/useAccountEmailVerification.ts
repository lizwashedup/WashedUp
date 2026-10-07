import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { accountEmail, AccountEmailFailure, type AccountEmailScope, type AccountEmailState } from '../lib/accountEmail';
export function useAccountEmailVerification(scope: AccountEmailScope | null, returnUrl: string) {
 const [,render]=useReducer((n:number)=>n+1,0);
 const state=useMemo(()=>({active:false,busy:false,error:'',unknown:false,draft:'',remote:null as AccountEmailState|null}),[scope,returnUrl]);
 const latest=useRef(state);latest.current=state;
 const current=useCallback(()=>state.active&&latest.current===state&&!!scope?.isCurrent(),[scope,state]);
 const publish=useCallback(()=>{if(current())render();},[current]);
 const check=useCallback(async()=>{
  if(!current()||!scope||state.busy)return;state.busy=true;publish();
  try{const remote=await accountEmail.load(scope);if(current()){state.remote=remote;state.error='';state.unknown=false;if(!state.draft)state.draft=remote.pendingEmail??remote.email??'';}}
  catch{if(current())state.error='Could not check your account email. Try again.';}
  finally{state.busy=false;publish();}
 },[scope,state,current,publish]);
 useEffect(()=>{state.active=true;void check();return()=>{state.active=false;};},[state,check]);
 const send=async(resend=false)=>{
  if(!current()||!scope||state.busy||state.unknown||!state.remote||state.remote.verified)return;
  state.busy=true;state.error='';publish();
  try{const remote=await accountEmail.requestLink(state.draft,scope,returnUrl,resend);if(current()){state.remote=remote;state.unknown=false;}}
  catch(e){if(current()){state.unknown=!(e instanceof AccountEmailFailure)||e.kind==='unknown';state.error=e instanceof AccountEmailFailure?e.message:'The request could not be confirmed. Check its status before trying again.';}}
  finally{state.busy=false;publish();}
 };
 const setDraft=(value:string)=>{if(current()&&!state.busy&&!state.unknown){state.draft=value;state.error='';publish();}};
 return {remote:state.remote,busy:state.busy,error:state.error,unknown:state.unknown,draft:state.draft,setDraft,check,send};
}
