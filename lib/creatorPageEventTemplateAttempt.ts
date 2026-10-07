/** One recoverable template save per account/source event. Contains no private body. */
import {requestWithDeadline} from './requestWithDeadline';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import {CreatorPageScopeExpired,type CreatorPageScope} from './creatorPageReview';
import {getPageEventTemplate,savePageEventTemplate,type PageEventTemplateAttempt,type PageEventTemplate} from './creatorPageEventTemplate';
import {mediaUUID} from './creatorPageEventMedia';
import {getPageEventSaveState} from './creatorPageEventSave';
import {sameEventSaveVersion} from './eventSaveVersion';

export interface SavedPageTemplateAttempt extends PageEventTemplateAttempt {version:1;userId:string}
export type PageTemplateAttemptResult={state:'missing';attempt:SavedPageTemplateAttempt}|{state:'stale';attempt:SavedPageTemplateAttempt;updatedAt:string}|{state:'saved';template:PageEventTemplate;cleanupPending:boolean};
export type PageTemplateResolution = 'saved' | 'retired';
export type PageTemplateRetireResult=Extract<PageTemplateAttemptResult,{state:'saved'}>|{state:'retired';cleanupPending:boolean};
const queues=new Map<string,Promise<unknown>>();
const key=(pageId:string,eventId:string,scope:CreatorPageScope)=>`creator-page-event-template:v1:${scope.userId}:${pageId}:${eventId}`;
const timestamp=(v:unknown):v is string=>typeof v==='string'&&Number.isFinite(Date.parse(v));
function current(pageId:string,eventId:string,scope:CreatorPageScope){
  if(!scope.isCurrent()||![pageId,eventId,scope.userId].every(mediaUUID))throw new CreatorPageScopeExpired();
}
async function serial<T>(k:string,work:()=>Promise<T>):Promise<T>{
  const pending=(queues.get(k)??Promise.resolve()).catch(()=>undefined).then(work);queues.set(k,pending);
  try{return await pending;}finally{if(queues.get(k)===pending)queues.delete(k);}
}
/** Bound network work inside the journal queue. Unlike a storage mutation, a
 * retired network continuation can safely release this queue: later recovery
 * uses the same request ID, and the child scope prevents any late follow-up. */
async function network<T>(scope:CreatorPageScope,milliseconds:number,work:(owned:CreatorPageScope)=>Promise<T>):Promise<T>{
  if(!scope.isCurrent())throw new CreatorPageScopeExpired();
  let active=true;const owned={userId:scope.userId,isCurrent:()=>active&&scope.isCurrent()};
  try{return await requestWithDeadline(work(owned),milliseconds);}finally{active=false;}
}
function valid(a:SavedPageTemplateAttempt,pageId:string,eventId:string,scope:CreatorPageScope){
  return a&&a.version===1&&a.pageId===pageId&&a.eventId===eventId&&a.userId===scope.userId&&mediaUUID(a.templateId)
    &&typeof a.name==='string'&&a.name===a.name.trim()&&a.name.length>0&&a.name.length<=80&&timestamp(a.expectedUpdatedAt)
    &&Object.keys(a).sort().join()===['version','pageId','eventId','userId','templateId','name','expectedUpdatedAt'].sort().join();
}
async function read(pageId:string,eventId:string,scope:CreatorPageScope):Promise<SavedPageTemplateAttempt|null>{
  current(pageId,eventId,scope);const raw=await AsyncStorage.getItem(key(pageId,eventId,scope));current(pageId,eventId,scope);
  if(raw===null)return null;
  const a=JSON.parse(raw) as SavedPageTemplateAttempt;
  if(!valid(a,pageId,eventId,scope))throw Error('The original template attempt needs to be checked.');
  return a;
}
export function readPageTemplateAttempt(pageId:string,eventId:string,scope:CreatorPageScope){
  current(pageId,eventId,scope);return serial(key(pageId,eventId,scope),()=>read(pageId,eventId,scope));
}
export function preparePageTemplateAttempt(pageId:string,eventId:string,name:string,expectedUpdatedAt:string,scope:CreatorPageScope){
  current(pageId,eventId,scope);
  if(typeof name!=='string'||!name.trim()||name.trim().length>80||!timestamp(expectedUpdatedAt))throw Error('Check the template name and saved source event.');
  const label=name.trim();
  return serial(key(pageId,eventId,scope),async()=>{
    const existing=await read(pageId,eventId,scope);if(existing)return {attempt:existing,created:false};
    const attempt:SavedPageTemplateAttempt={version:1,userId:scope.userId,pageId,eventId,templateId:Crypto.randomUUID(),name:label,expectedUpdatedAt};
    current(pageId,eventId,scope);await AsyncStorage.setItem(key(pageId,eventId,scope),JSON.stringify(attempt));current(pageId,eventId,scope);
    return {attempt,created:true};
  });
}
function same(a:SavedPageTemplateAttempt,b:SavedPageTemplateAttempt){return Object.keys(a).every(k=>a[k as keyof SavedPageTemplateAttempt]===b[k as keyof SavedPageTemplateAttempt])&&Object.keys(a).length===Object.keys(b).length;}
async function finishSaved(a:SavedPageTemplateAttempt,saved:PageEventTemplate,scope:CreatorPageScope,onResolved?:(state:PageTemplateResolution)=>void):Promise<Extract<PageTemplateAttemptResult,{state:'saved'}>>{
  current(a.pageId,a.eventId,scope);
  if(saved.id!==a.templateId||saved.userId!==a.userId||saved.sourcePageId!==a.pageId||saved.sourceEventId!==a.eventId
    ||saved.name!==a.name||!sameEventSaveVersion(saved.sourceUpdatedAt,a.expectedUpdatedAt))throw Error('The template does not match the original saved attempt.');
  onResolved?.('saved');
  let cleanupPending=false;
  try{await AsyncStorage.removeItem(key(a.pageId,a.eventId,scope));}catch{cleanupPending=true;}
  current(a.pageId,a.eventId,scope);return {state:'saved',template:saved,cleanupPending};
}
/** Check never writes to the backend; retry can only send the same saved ID.
 * Unknown/denied reads retain the intent. Confirmation stays final if optional
 * local cleanup fails, preventing a duplicate save after a lost cleanup ack. */
export function resolvePageTemplateAttempt(attempt:SavedPageTemplateAttempt,scope:CreatorPageScope,action:'check'|'retry',onResolved?:(state:PageTemplateResolution)=>void):Promise<PageTemplateAttemptResult>{
  const a={...attempt};current(a.pageId,a.eventId,scope);
  if(!valid(a,a.pageId,a.eventId,scope)||!['check','retry'].includes(action))throw Error('Check the original template attempt.');
  return serial(key(a.pageId,a.eventId,scope),async()=>{
    const original=await read(a.pageId,a.eventId,scope);
    if(!original||!same(original,a))throw Error('This is not the current saved template attempt.');
    let saved=await network(scope,12_000,owned=>getPageEventTemplate(a.pageId,a.eventId,a.templateId,owned));
    if(!saved){
      const source=await network(scope,12_000,owned=>getPageEventSaveState(a.pageId,a.eventId,owned));current(a.pageId,a.eventId,scope);
      if(!sameEventSaveVersion(source.updatedAt,a.expectedUpdatedAt)){
        // An earlier template writer holds the source row against updates.
        // Re-read after the new source version to catch its committed result.
        saved=await network(scope,12_000,owned=>getPageEventTemplate(a.pageId,a.eventId,a.templateId,owned));current(a.pageId,a.eventId,scope);
        if(!saved)return {state:'stale',attempt:a,updatedAt:source.updatedAt};
      }
    }
    if(!saved&&action==='retry')saved=await network(scope,25_000,owned=>savePageEventTemplate(a,owned));
    current(a.pageId,a.eventId,scope);
    if(!saved)return {state:'missing',attempt:a};
    return finishSaved(a,saved,scope,onResolved);
  });
}

/** Explicitly retire only an obsolete original. The original-ID RPC serializes
 * behind any pending template transaction: a confirmed original wins; only a
 * definite version rejection plus a fresh missing receipt permits local clear.
 * Unknown/denied results preserve the journal. No event or template is deleted. */
export function retireStalePageTemplateAttempt(attempt:SavedPageTemplateAttempt,scope:CreatorPageScope,onResolved?:(state:PageTemplateResolution)=>void):Promise<PageTemplateRetireResult>{
  const a={...attempt};current(a.pageId,a.eventId,scope);
  if(!valid(a,a.pageId,a.eventId,scope))throw Error('Check the original template attempt.');
  return serial(key(a.pageId,a.eventId,scope),async()=>{
    const original=await read(a.pageId,a.eventId,scope);
    if(!original||!same(original,a))throw Error('Check the current original template attempt.');
    let saved=await network(scope,12_000,owned=>getPageEventTemplate(a.pageId,a.eventId,a.templateId,owned));
    if(saved)return finishSaved(a,saved,scope,onResolved);
    const source=await network(scope,12_000,owned=>getPageEventSaveState(a.pageId,a.eventId,owned));current(a.pageId,a.eventId,scope);
    if(sameEventSaveVersion(source.updatedAt,a.expectedUpdatedAt))throw Error('The original source is still current. Check or retry that template.');
    try{saved=await network(scope,25_000,owned=>savePageEventTemplate(a,owned));}
    catch(failure){
      current(a.pageId,a.eventId,scope);
      if(!failure||typeof failure!=='object'||!('code' in failure)||failure.code!=='PT409')throw failure;
      saved=await network(scope,12_000,owned=>getPageEventTemplate(a.pageId,a.eventId,a.templateId,owned));current(a.pageId,a.eventId,scope);
      if(saved)return finishSaved(a,saved,scope,onResolved);
      onResolved?.('retired');
      let cleanupPending=false;
      try{await AsyncStorage.removeItem(key(a.pageId,a.eventId,scope));}catch{cleanupPending=true;}
      current(a.pageId,a.eventId,scope);return {state:'retired',cleanupPending};
    }
    return finishSaved(a,saved,scope,onResolved);
  });
}
