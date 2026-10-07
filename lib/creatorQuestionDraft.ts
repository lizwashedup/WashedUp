import AsyncStorage from '@react-native-async-storage/async-storage';
import type {CreatorPageScope} from './creatorPageReview';
import {questionDraftProblem,type QuestionDraft} from './creatorQuestionEditor';
import {QUESTION_PROMPT_MAX,QUESTION_OPTIONS_MAX,QUESTION_TYPE_OPTIONS,type TicketQuestion} from './ticketing';
export interface CreatorQuestionRecord {
  recordId:string;form:Omit<QuestionDraft,'options'>&{options:string[]};baseline:TicketQuestion|null;
  pending:QuestionDraft|null;confirmed:boolean;dispatched?:boolean;
}
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
const writes=new Map<string,Promise<unknown>>();
function key(event:string,route:string,scope:CreatorPageScope){
 if(!scope.isCurrent()||![event,scope.userId].every(uuid)||(route!=='new'&&!uuid(route)))throw Error('This question visit is unavailable.');
 return `creator-question-draft:v1:${scope.userId}:${event}:${route}`;
}
function valid(v:CreatorQuestionRecord,event:string,route:string){
 const f=v?.form,b=v?.baseline;
 if(v?.dispatched!==undefined&&typeof v.dispatched!=='boolean')throw Error('The original save needs to be checked.');
 if(!v||!uuid(v.recordId)||typeof v.confirmed!=='boolean'||!f||typeof f.prompt!=='string'||f.prompt.length>QUESTION_PROMPT_MAX
 ||!QUESTION_TYPE_OPTIONS.some(t=>t.value===f.qtype)||typeof f.required!=='boolean'||!['per_order','per_attendee'].includes(f.scope)
 ||!Array.isArray(f.options)||f.options.length>QUESTION_OPTIONS_MAX||f.options.some(o=>typeof o!=='string'||o.length>200))throw Error('Your saved question draft could not be read.');
 if(route==='new'?b!==null:v.recordId!==route||!b||b.id!==route||b.event_id!==event||typeof b.prompt!=='string'||!QUESTION_TYPE_OPTIONS.some(t=>t.value===b.qtype)||typeof b.required!=='boolean'||!['per_order','per_attendee'].includes(b.scope)||!Number.isSafeInteger(b.sort_order)||(b.options!==null&&(!Array.isArray(b.options)||b.options.some(o=>typeof o!=='string'))))throw Error('The original question needs to be checked.');
 if(v.pending!==null){if(!v.pending||typeof v.pending.prompt!=='string'||questionDraftProblem(v.pending))throw Error('The original save needs to be checked.');}
 if(v.confirmed&&!v.pending)throw Error('The confirmed question needs to be checked.');
}
async function ordered<T>(storageKey:string,work:()=>Promise<T>){
 const prior=writes.get(storageKey)??Promise.resolve();const next=prior.catch(()=>undefined).then(work);writes.set(storageKey,next);
 try{return await next;}finally{if(writes.get(storageKey)===next)writes.delete(storageKey);}
}
export async function readCreatorQuestionDraft(event:string,route:string,scope:CreatorPageScope){
 const k=key(event,route,scope);await writes.get(k);const raw=await AsyncStorage.getItem(k);key(event,route,scope);if(raw===null)return null;
 const r=JSON.parse(raw);if(r?.version!==1||r.userId!==scope.userId||r.eventId!==event||r.routeId!==route)throw Error('Your saved question draft could not be read.');valid(r.value,event,route);return {raw,value:r.value as CreatorQuestionRecord};
}
export function writeCreatorQuestionDraft(event:string,route:string,scope:CreatorPageScope,value:CreatorQuestionRecord,expected:string|null){
 const k=key(event,route,scope);valid(value,event,route);const raw=JSON.stringify({version:1,userId:scope.userId,eventId:event,routeId:route,value});
 return ordered(k,async()=>{if(await AsyncStorage.getItem(k)!==expected)throw Error('Another visit changed this question draft. Keep this editor open.');await AsyncStorage.setItem(k,raw);return raw;});
}
export function clearCreatorQuestionDraft(event:string,route:string,scope:CreatorPageScope,expected:string|null){
 const k=key(event,route,scope);return ordered(k,async()=>{if(await AsyncStorage.getItem(k)!==expected)throw Error('A newer question draft is still on this device.');if(expected!==null)await AsyncStorage.removeItem(k);});
}
