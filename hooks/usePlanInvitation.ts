import { useCallback, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { logError } from '../lib/logger';

type Reply = 'accepted' | 'declined';
type Invitation = {id:string;event_id:string;recipient_id:string;status:'pending'|Reply};
type Attempt = {invitation:Invitation;reply:Reply;phase:'pending'|'failed'|'unknown'};
type Options = {eventId:string;viewerId:string|null;epoch:number;isCurrent:()=>boolean;canRespond:()=>boolean};
type State = {invitation:Invitation|null;attempt:Attempt|null;busy:boolean;loading:boolean;ready:boolean;error:string|null;visit:object|null;revision:number};
const fields='id,event_id,recipient_id,status';
const rejected=new Set(['P0001','42501','23502','23503','23505','23514','22P02','28000','28P01','42883','42703','42P01','40001','40P01']);
function own(data:unknown,eventId:string,viewerId:string):data is Invitation {
  if(!data||typeof data!=='object'||Array.isArray(data))return false;
  const r=data as Invitation;
  return typeof r.id==='string'&&!!r.id&&r.event_id===eventId&&r.recipient_id===viewerId&&['pending','accepted','declined'].includes(r.status);
}
/** Invitation acknowledgement is separate from admission. Acceptance checks
 * confirmed own membership and can never create a membership itself. */
export function usePlanInvitation(options:Options){
  const client=useQueryClient(),latest=useRef(options);latest.current=options;
  const state=useMemo<State>(()=>({invitation:null,attempt:null,busy:false,loading:false,ready:false,error:null,visit:null,revision:0}),[options.eventId,options.viewerId,options.epoch]);
  const owner=useRef(state);owner.current=state;const[,redraw]=useState(0);
  const publish=()=>{if(owner.current===state&&state.visit&&latest.current.isCurrent())redraw(n=>n+1);};
  const capture=()=>{const visit=state.visit;return()=>!!visit&&state.visit===visit&&owner.current===state&&options.isCurrent();};
  const invalidate=()=>{for(const queryKey of [['pending-invites'],['inbox-count']])void Promise.resolve(client.invalidateQueries({queryKey})).catch(e=>logError(e,'plan.invitation.refresh'));};
  const refresh=async()=>{
    if(!options.viewerId||!state.visit||!options.isCurrent()||state.busy)return;
    const validVisit=capture(),version=++state.revision,attempt=state.attempt;
    const valid=()=>validVisit()&&version===state.revision;
    state.loading=true;state.error=null;publish();
    try{
      const auth=await supabase.auth.getUser();if(!valid())return;
      if(auth.error||auth.data.user?.id!==options.viewerId)throw new Error('Account unavailable');
      let q=supabase.from('plan_invites').select(fields).eq('event_id',options.eventId).eq('recipient_id',options.viewerId);
      q=attempt?q.eq('id',attempt.invitation.id):q.eq('status','pending').order('created_at',{ascending:true}).order('id',{ascending:true}).limit(1);
      const result=await q.maybeSingle();if(!valid())return;
      if(result.error!==null||(result.data!==null&&!own(result.data,options.eventId,options.viewerId)))throw new Error('Invitation unavailable');
      if(attempt){
        if(!result.data||result.data.id!==attempt.invitation.id)throw new Error('Invitation unavailable');
        if(result.data.status!=='pending'){
          state.invitation=null;state.attempt=null;
          state.error=result.data.status===attempt.reply?null:'This invitation was already answered.';invalidate();
        }else{state.invitation=result.data;state.error=attempt.phase==='unknown'?'We still can’t confirm your reply. Check again in a moment.':'Couldn’t save your invitation reply. Try again.';}
      }else{if(result.data&&result.data.status!=='pending')throw new Error('Unexpected invitation');state.invitation=result.data;}
      state.ready=true;
    }catch{if(valid()){state.ready=false;state.error='Couldn’t check this invitation. Try again.';}}
    finally{if(valid()){state.loading=false;publish();}}
  };
  const readRef=useRef(refresh);readRef.current=refresh;
  useFocusEffect(useCallback(()=>{const visit={};state.visit=visit;void readRef.current();return()=>{if(state.visit===visit){state.visit=null;state.revision++;}};},[state]));
  const respond=async(reply:Reply,invitation=state.invitation,retry=false)=>{
    if(!options.viewerId||!invitation||!state.visit||!options.isCurrent()||!latest.current.canRespond()||state.busy||state.loading||!state.ready)return;
    if(state.attempt&&(!retry||state.attempt.phase!=='failed'||state.attempt.reply!==reply||state.attempt.invitation.id!==invitation.id))return;
    const attempt:Attempt={invitation,reply,phase:'pending'},valid=capture();
    state.attempt=attempt;state.busy=true;state.revision++;state.error=null;publish();let dispatched=false;
    try{
      const auth=await supabase.auth.getUser();
      if(!valid()||!latest.current.canRespond()){state.attempt=null;return;}
      if(auth.error||auth.data.user?.id!==options.viewerId)throw new Error('Account unavailable');
      if(reply==='accepted'){
        const member=await supabase.from('event_members').select('event_id,user_id,status').eq('event_id',options.eventId).eq('user_id',options.viewerId).maybeSingle();
        if(!valid()||!latest.current.canRespond()){state.attempt=null;return;}
        if(member.error!==null||member.data?.event_id!==options.eventId||member.data?.user_id!==options.viewerId||member.data?.status!=='joined')throw new Error('Membership unconfirmed');
      }
      dispatched=true;
      const result=await supabase.from('plan_invites').update({status:reply,updated_at:new Date().toISOString()}).eq('id',invitation.id).eq('event_id',options.eventId).eq('recipient_id',options.viewerId).eq('status','pending').select(fields).maybeSingle();
      if(result.error&&rejected.has(String(result.error.code))){dispatched=false;throw result.error;}
      if(result.error!==null||!own(result.data,options.eventId,options.viewerId)||result.data.id!==invitation.id||result.data.status!==reply)throw new Error('Reply unconfirmed');
      state.invitation=null;state.attempt=null;state.ready=true;
      if(owner.current===state&&latest.current.isCurrent())invalidate();
    }catch{attempt.phase=dispatched?'unknown':'failed';state.error=dispatched?'Your invitation reply may have saved. Check before trying again.':'Couldn’t save your invitation reply. Try again.';}
    finally{state.busy=false;publish();}
  };
  const prepareAcceptance=()=>{
    if(!state.visit||!options.isCurrent()||!state.invitation||state.attempt||state.busy||state.loading||!state.ready||!latest.current.canRespond())return null;
    const invitation=state.invitation,valid=capture();let used=false;
    return()=>{if(used||!valid())return;used=true;void respond('accepted',invitation);};
  };
  return {invitation:state.invitation,attempt:state.attempt,busy:state.busy,loading:state.loading,ready:state.ready,error:state.error,
    refresh,decline:()=>respond('declined'),prepareAcceptance,
    keepInvitation:()=>{if(state.visit&&options.isCurrent()&&!state.busy&&!state.loading&&state.attempt?.phase==='failed'&&state.attempt.reply==='declined'){state.attempt=null;state.error=null;publish();}},
    retry:()=>state.attempt?.phase==='failed'?respond(state.attempt.reply,state.attempt.invitation,true):Promise.resolve()};
}
