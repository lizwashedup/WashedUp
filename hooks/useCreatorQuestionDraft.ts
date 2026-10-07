import {useCallback,useEffect,useMemo,useReducer,useRef} from 'react';
import {randomUUID} from 'expo-crypto';
import type {CreatorPageScope} from '../lib/creatorPageReview';
import type {TicketQuestion} from '../lib/ticketing';
import type {QuestionDraft} from '../lib/creatorQuestionEditor';
import {readCreatorQuestionDraft,writeCreatorQuestionDraft,clearCreatorQuestionDraft,type CreatorQuestionRecord} from '../lib/creatorQuestionDraft';

export function useCreatorQuestionDraft(eventId:string,routeId:string,scope:CreatorPageScope,enabled:boolean,question:TicketQuestion|null){
 const [,render]=useReducer(n=>n+1,0);
 const state=useMemo(()=>({value:null as CreatorQuestionRecord|null,raw:null as string|null,loaded:false,loading:false,saving:false,readError:false,error:'',revision:0,loadGeneration:0,loadingScope:null as CreatorPageScope|null,queue:Promise.resolve()}),[eventId,routeId,scope.userId]);
 const owned=useRef(state);owned.current=state;const mounted=useRef(false);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const current=useCallback(()=>mounted.current&&owned.current===state&&scope.isCurrent(),[scope,state]);
 const initial=useRef(question);initial.current=question;
 const load=useCallback(async()=>{
  if(!enabled||!current()||state.loaded||(state.loading&&state.loadingScope===scope))return;const request=++state.loadGeneration;state.loadingScope=scope;state.loading=true;state.error='';render();
  try{
   const saved=await readCreatorQuestionDraft(eventId,routeId,scope);if(!current()||request!==state.loadGeneration)return;
   const q=initial.current;
   state.value=saved?.value??(routeId==='new'||q?{recordId:q?.id??randomUUID(),baseline:q?structuredClone(q):null,pending:null,confirmed:false,dispatched:false,form:q?{prompt:q.prompt,qtype:q.qtype,options:q.options?.length?[...q.options]:['',''],required:q.required,scope:q.scope}:{prompt:'',qtype:'short_text',options:['',''],required:false,scope:'per_order'}}:null);
   state.raw=saved?.raw??null;state.loaded=true;state.readError=false;
  }catch{if(current()&&request===state.loadGeneration){state.readError=true;state.error='Couldn’t read your question draft. Try again before editing.';}}
  finally{if(request===state.loadGeneration){state.loading=false;if(current())render();}}
 },[enabled,current,state,eventId,routeId,scope]);
 useEffect(()=>{void load();},[load]);
 const persist=async(value:CreatorQuestionRecord)=>{
  if(!current()||!state.loaded)return false;
  state.value=value;state.saving=true;state.error='';const revision=++state.revision;render();
  const write=state.queue.catch(()=>undefined).then(async()=>{state.raw=await writeCreatorQuestionDraft(eventId,routeId,scope,value,state.raw);});state.queue=write;
  try{await write;return true;}catch(error){if(state.revision===revision)state.error=error instanceof Error?error.message:'Couldn’t keep your question on this device.';return false;}
  finally{if(state.revision===revision)state.saving=false;if(current())render();}
 };
 const finish=async()=>{
  if(!current()||!state.value)return false;
  if(!await persist({...state.value,confirmed:true}))return false;
  try{await clearCreatorQuestionDraft(eventId,routeId,scope,state.raw);state.raw=null;return true;}
  catch{state.error='Your question is saved. Finish clearing its device draft before starting another.';if(current())render();return false;}
 };
 return {...state,ready:state.loaded&&!!state.value&&enabled&&scope.isCurrent(),
  change(update:(form:CreatorQuestionRecord['form'])=>CreatorQuestionRecord['form']){if(!current()||!state.loaded||!state.value||state.value.pending||state.value.confirmed)return;void persist({...state.value,form:update(state.value.form)});},
  async prepare(draft:QuestionDraft){if(!state.value)return null;const value={...state.value,pending:state.value.pending??draft,dispatched:state.value.pending?(state.value.dispatched??true):false};return await persist(value)?value:null;},
  async markDispatched(){if(!current()||!state.value?.pending)return false;return await persist({...state.value,dispatched:true})&&current();},
  async releaseRejected(){if(!current()||!state.value?.pending||state.value.confirmed)return false;return persist({...state.value,pending:null,dispatched:false});},
  async discard(){if(!current())return false;try{await state.queue.catch(()=>undefined);await clearCreatorQuestionDraft(eventId,routeId,scope,state.raw);state.raw=null;state.error='';return true;}catch{state.error='Couldn’t clear the original device draft. Try again.';if(current())render();return false;}},
  finish,save:()=>state.value?persist(state.value):Promise.resolve(false),retry:()=>state.readError?load():state.value?persist(state.value):Promise.resolve(false),
 };
}
