import {pageEventReuseNetwork, createPageEventReuseOperation} from './creatorPageEventReuseOperation';
/** Complete event reuse into one saved draft, using existing media and save contracts. */
import {sameEventSaveVersion} from './eventSaveVersion';
import {readPageEventCopyStop,preparePageEventCopyStop,resolvePageEventCopyStop,clearPageEventCopyStop} from './creatorPageEventCopyStop';
import {cleanupStoppedPageEventCopy} from './creatorPageEventCopyCleanup';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import {CreatorPageScopeExpired,type CreatorPageScope} from './creatorPageReview';
import {getPageEventTemplate} from './creatorPageEventTemplate';
import {planPageEventReuse,materializePageEventReuse,type PageEventReusePlan,type EventReuseMediaCopy} from './creatorPageEventReusePlan';
import {getPageEventSaveState,getPageEventSaveAttempt,savePageEvent,pageEventSaveMatches,validPageEventSaveInput,type PageEventSaveInput,type PageEventSaveReceipt,type PageEventSaveState} from './creatorPageEventSave';
import {readPageEventMediaReuseAttempts,preparePageEventMediaReuseAttempt,clearPageEventMediaReuseAttempt} from './creatorPageEventMediaReuseAttempt';
import {getPageEventMediaReuseAttempt} from './creatorPageEventMediaReuse';
import {startPageEventMediaReuseTransfer,type ReuseTransferProgress} from './creatorPageEventMediaReuseTransfer';
import {mediaUUID,type PageEventMediaReceipt} from './creatorPageEventMedia';
import {getLegacyEventMediaSource,assertLegacyEventMediaSource,validLegacyEventMediaSource,type LegacyEventMediaSource} from './legacyEventMediaSource';
import {startLegacyEventMediaImport,clearLegacyEventMediaImport,type LegacyEventMediaDownload,type LegacyEventMediaImportProgress} from './legacyEventMediaImport';
import type {PageEventMediaAttempt} from './creatorPageEventMediaAttempt';

export type PageEventReuseSource={kind:'event';pageId:string;eventId:string}|{kind:'template';pageId:string;eventId:string;templateId:string};
export interface SavedPageEventReuse {
  version:1;userId:string;pageId:string;eventId:string;requestId:string;source:PageEventReuseSource;sourceUpdatedAt:string;
  plan:PageEventReusePlan;destination:PageEventSaveInput;latitude:number|null;longitude:number|null;input?:PageEventSaveInput;keeping?:true;
  legacyImports?:{slotKey:string;source:LegacyEventMediaSource;downloads:LegacyEventMediaDownload[];original?:PageEventMediaAttempt;unprepared?:true}[];
}
export type PageEventReuseConflictReason='source'|'destination';
export type PageEventReuseResult={state:'stopping'}|{state:'kept';event:PageEventSaveState;cleanupPending:boolean}|{state:'pending';attempt:SavedPageEventReuse}|{state:'conflict';reason:PageEventReuseConflictReason;attempt:SavedPageEventReuse}|{state:'saved';saved:PageEventSaveReceipt;cleanupPending:boolean};
export interface PageEventReuseProgress {completed:number;total:number;media?:ReuseTransferProgress;legacy?:LegacyEventMediaImportProgress}
const queues=new Map<string,Promise<unknown>>(),active=new Set<string>();
const key=(pageId:string,eventId:string,scope:CreatorPageScope)=>`creator-page-event-reuse:v1:${scope.userId}:${pageId}:${eventId}`;
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const clone=<T,>(v:T):T=>JSON.parse(JSON.stringify(v));
const canonical=(v:unknown):string=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':object(v)?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
const timestamp=(v:unknown):v is string=>typeof v==='string'&&Number.isFinite(Date.parse(v));
function current(pageId:string,eventId:string,scope:CreatorPageScope){if(!scope.isCurrent()||![pageId,eventId,scope.userId].every(mediaUUID))throw new CreatorPageScopeExpired();}
function validSource(s:PageEventReuseSource){return s&&['event','template'].includes(s.kind)&&mediaUUID(s.pageId)&&mediaUUID(s.eventId)&&(s.kind==='event'||mediaUUID(s.templateId));}
async function serial<T>(k:string,work:()=>Promise<T>){const pending=(queues.get(k)??Promise.resolve()).catch(()=>undefined).then(work);queues.set(k,pending);try{return await pending;}finally{if(queues.get(k)===pending)queues.delete(k);}}
async function source(s:PageEventReuseSource,scope:CreatorPageScope){
  if(s.kind==='template'){
    const saved=await pageEventReuseNetwork(scope, networkScope => getPageEventTemplate(s.pageId,s.eventId,s.templateId,networkScope));if(!saved)throw Error('The original template is unavailable.');
    return {plan:saved.reusePlan,updatedAt:saved.sourceUpdatedAt,latitude:null,longitude:null};
  }
  const saved=await pageEventReuseNetwork(scope, networkScope => getPageEventSaveState(s.pageId,s.eventId,networkScope));
  return {plan:planPageEventReuse(s.pageId,s.eventId,saved.fields),updatedAt:saved.updatedAt,latitude:saved.latitude,longitude:saved.longitude};
}
async function read(pageId:string,eventId:string,scope:CreatorPageScope):Promise<SavedPageEventReuse|null>{
  current(pageId,eventId,scope);const raw=await AsyncStorage.getItem(key(pageId,eventId,scope));current(pageId,eventId,scope);if(raw===null)return null;
  const a=JSON.parse(raw) as SavedPageEventReuse;
  if(!a||a.version!==1||a.userId!==scope.userId||a.pageId!==pageId||a.eventId!==eventId||!mediaUUID(a.requestId)||!validSource(a.source)
    ||a.keeping!==undefined&&a.keeping!==true||a.source.eventId===eventId||!timestamp(a.sourceUpdatedAt)||!validPageEventSaveInput(a.destination)||a.input&&!validPageEventSaveInput(a.input)
    ||canonical(a.plan)!==canonical(planPageEventReuse(a.source.pageId,a.source.eventId,a.plan.fields))
    ||!(a.latitude===null&&a.longitude===null||typeof a.latitude==='number'&&Math.abs(a.latitude)<=90&&typeof a.longitude==='number'&&Math.abs(a.longitude)<=180))throw Error('The original event reuse attempt needs review.');
  const legacy=a.plan.media.filter(slot=>slot.kind==='legacy');
  if((a.legacyImports?.length??0)!==legacy.length||new Set(a.legacyImports?.map(v=>v.slotKey)).size!==(a.legacyImports?.length??0)
    ||a.legacyImports?.some(v=>v.unprepared!==undefined&&(v.unprepared!==true||!!v.original)||!validLegacyEventMediaSource(v.source)||!legacy.some(slot=>slot.key===v.slotKey&&slot.reference===v.source.reference&&slot.purpose===v.source.purpose)
      ||canonical(v.source.source)!==canonical(a.source)||!Array.isArray(v.downloads)||v.downloads.some(run=>!mediaUUID(run.runId))
      ||v.original&&(v.original.pageId!==pageId||v.original.eventId!==eventId||v.original.userId!==scope.userId||v.original.purpose!==v.source.purpose||v.original.mimeType!==v.source.mimeType||v.original.byteSize!==v.source.byteSize)))throw Error('The original legacy media imports need review.');
  return a;
}
async function write(a:SavedPageEventReuse,scope:CreatorPageScope){current(a.pageId,a.eventId,scope);await AsyncStorage.setItem(key(a.pageId,a.eventId,scope),JSON.stringify(a));current(a.pageId,a.eventId,scope);}
export function readPageEventReuse(pageId:string,eventId:string,scope:CreatorPageScope){current(pageId,eventId,scope);return serial(key(pageId,eventId,scope),()=>read(pageId,eventId,scope));}
export function preparePageEventReuse(pageId:string,eventId:string,selected:PageEventReuseSource,scope:CreatorPageScope,expectedSourceUpdatedAt?:string){
  current(pageId,eventId,scope);const selectedSource=clone(selected);
  if(!validSource(selectedSource)||selectedSource.eventId===eventId)throw Error('Choose the original event and a different saved draft.');
  return serial(key(pageId,eventId,scope),async()=>{
    const pending=await read(pageId,eventId,scope);if(pending)return {attempt:pending,created:false};
    const original=await source(selectedSource,scope),target=await pageEventReuseNetwork(scope, networkScope => getPageEventSaveState(pageId,eventId,networkScope));current(pageId,eventId,scope);
    if(expectedSourceUpdatedAt!==undefined&&(!timestamp(expectedSourceUpdatedAt)||!sameEventSaveVersion(original.updatedAt,expectedSourceUpdatedAt)))throw Error('The selected source changed. Check the original copy before continuing.');
    if(target.status!=='Draft'||target.fields.image_url||target.fields.description||target.fields.description_blocks?.length||target.fields.event_date||target.fields.venue||target.fields.venue_address)throw Error('Use a new saved draft so existing event content is preserved.');
    const legacyImports:NonNullable<SavedPageEventReuse['legacyImports']>=[];
    for(const slot of original.plan.media){
      if(slot.kind==='legacy'){
        if(slot.purpose==='cover')throw Error('Check the original cover.');
        const purpose=slot.purpose;
        legacyImports.push({slotKey:slot.key,source:await pageEventReuseNetwork(scope, networkScope => getLegacyEventMediaSource(selectedSource,slot.reference,purpose,networkScope)),downloads:[]});
      }
    }
    const attempt:SavedPageEventReuse={version:1,userId:scope.userId,pageId,eventId,requestId:Crypto.randomUUID(),source:selectedSource,sourceUpdatedAt:original.updatedAt,
      plan:original.plan,destination:{fields:target.fields,expectedUpdatedAt:target.updatedAt,offerType:target.offerType,ticketCapacity:target.ticketCapacity,latitude:target.latitude,longitude:target.longitude},latitude:original.latitude,longitude:original.longitude,...(legacyImports.length?{legacyImports}:{} )};
    await write(attempt,scope);return {attempt,created:true};
  });
}
/** Check only reads server state (plus confirmed local cleanup); retry resumes
 * original copies and one complete save. It never publishes or creates a draft. */
export function startPageEventReuse(pageId:string,eventId:string,requestId:string,scope:CreatorPageScope,action:'check'|'retry'|'keep',onProgress?:(p:PageEventReuseProgress)=>void){
  current(pageId,eventId,scope);if(!mediaUUID(requestId)||!['check','retry','keep'].includes(action))throw Error('Check the original reuse attempt.');
  const k=key(pageId,eventId,scope);if(active.has(k))throw Error('This event reuse is already in progress.');active.add(k);
  let transfer:{cancel():void}|null=null;
  const operation=createPageEventReuseOperation(scope,()=>transfer?.cancel());
  const owned=operation.scope,check=()=>current(pageId,eventId,owned);
  const done=serial(k,async():Promise<PageEventReuseResult>=>{
    const a=await read(pageId,eventId,owned);if(!a||a.requestId!==requestId)throw Error('Use the original saved reuse attempt.');
    const finish=async(saved:PageEventSaveReceipt):Promise<PageEventReuseResult>=>{
      if(!a.input||!pageEventSaveMatches(saved,a.input))throw Error('The copied event does not match its complete saved attempt.');
      let cleanupPending=false;
      try{
        const pending=await readPageEventMediaReuseAttempts(pageId,eventId,owned);check();
        for(const m of pending){
          if(!a.plan.media.some(slot=>slot.purpose===m.purpose&&slot.sourceMediaId===m.source.mediaId&&a.source.pageId===m.source.pageId&&a.source.eventId===m.source.eventId))continue;
          await clearPageEventMediaReuseAttempt(m,owned);check();
        }
        for(const legacy of a.legacyImports??[]){
          if(!legacy.original)throw Error('Check the original media import.');
          await clearLegacyEventMediaImport(pageId,eventId,legacy.source,legacy.original,legacy.downloads,owned);check();
        }
        const stopping=await readPageEventCopyStop(pageId,eventId,owned);check();
        if(stopping&&!await clearPageEventCopyStop(stopping,owned))throw Error('Copy recovery cleanup remains pending.');
        await AsyncStorage.removeItem(k);
      }catch{cleanupPending=true;}
      check();return {state:'saved',saved,cleanupPending};
    };
    const existing=await pageEventReuseNetwork(owned, networkScope => getPageEventSaveAttempt(pageId,eventId,requestId,networkScope));check();
    if(existing)return finish(existing);
    if(action==='keep'||a.keeping){
      if(!a.keeping){a.keeping=true;await write(a,owned);}
      let stopping=await readPageEventCopyStop(pageId,eventId,owned);check();
      if(!stopping){
        if(action!=='keep')return {state:'stopping'};
        stopping=(await preparePageEventCopyStop(a,owned)).attempt;check();
      }
      const stopped=await resolvePageEventCopyStop(stopping,owned,action==='keep'?'retry':'check');check();
      if(stopped.state==='saved')return finish(stopped.saved);
      if(stopped.state==='pending')return {state:'stopping'};
      let cleanupPending=false;
      try{
        await cleanupStoppedPageEventCopy(a,owned,action==='keep'?'keep':'check',()=>write(a,owned));check();
        // Parent entry records terminal destination before this whole pointer is
        // removed. Keep the stop receipt until that parent acknowledges it.
      }catch{cleanupPending=true;}
      check();return {state:'kept',event:stopped.event,cleanupPending};
    }
    if(action==='check'){
      // A pending snapshot must not become a cached-source reader after page
      // revocation. A committed destination above has its own authorization.
      const original=await source(a.source,owned),target=await pageEventReuseNetwork(owned, networkScope => getPageEventSaveState(pageId,eventId,networkScope));check();
      const reason:PageEventReuseConflictReason|undefined=!sameEventSaveVersion(original.updatedAt,a.sourceUpdatedAt)||canonical(original.plan)!==canonical(a.plan)
        ? 'source' : target.status!=='Draft'||!sameEventSaveVersion(target.updatedAt,a.destination.expectedUpdatedAt) ? 'destination' : undefined;
      if(reason){
        // A full save locks the destination row. A newer destination read may
        // follow a save whose first receipt read raced its commit.
        const committed=await pageEventReuseNetwork(owned, networkScope => getPageEventSaveAttempt(pageId,eventId,requestId,networkScope));check();
        if(committed)return finish(committed);
        return {state:'conflict',reason,attempt:a};
      }
      return {state:'pending',attempt:a};
    }
    const access=async()=>{
      const original=await source(a.source,owned),target=await pageEventReuseNetwork(owned, networkScope => getPageEventSaveState(pageId,eventId,networkScope));check();
      if(!sameEventSaveVersion(original.updatedAt,a.sourceUpdatedAt)||canonical(original.plan)!==canonical(a.plan))throw Error('The source changed. Keep the original copy attempt for review.');
      if(target.status!=='Draft'||!sameEventSaveVersion(target.updatedAt,a.destination.expectedUpdatedAt))throw Error('The destination changed. Your existing draft is preserved.');
      for(const legacy of a.legacyImports??[]){await pageEventReuseNetwork(owned, networkScope => assertLegacyEventMediaSource(legacy.source,networkScope));check();}
    };
    await access();const copies:EventReuseMediaCopy[]=[];
    for(const slot of a.plan.media){
      check();
      if(slot.kind==='legacy'){
        const legacy=a.legacyImports?.find(v=>v.slotKey===slot.key);if(!legacy)throw Error('Keep the original saved media import.');
        const running=startLegacyEventMediaImport({pageId,eventId,source:legacy.source,original:legacy.original,
          onDownloadPrepared:async run=>{legacy.downloads.push(run);await write(a,owned);},
          onOriginalPrepared:async original=>{legacy.original=clone(original);await write(a,owned);}},owned,p=>onProgress?.({completed:copies.length,total:a.plan.media.length,legacy:p}));transfer=running;
        let imported;try{imported=await running.done;}finally{transfer=null;}
        check();copies.push({slotKey:slot.key,legacy:{...legacy.source,contentDigest:imported.original.contentDigest},receipt:imported.receipt});
        onProgress?.({completed:copies.length,total:a.plan.media.length});continue;
      }
      if(!slot.sourceMediaId)throw Error('The original media identity is unavailable.');
      const prepared=await preparePageEventMediaReuseAttempt(pageId,eventId,slot.purpose,{pageId:a.source.pageId,eventId:a.source.eventId,mediaId:slot.sourceMediaId},owned);check();
      let receipt:PageEventMediaReceipt|null=await pageEventReuseNetwork(owned, networkScope => getPageEventMediaReuseAttempt(pageId,eventId,prepared.attempt,networkScope));check();
      if(!receipt?.readyAt||!receipt.objectPresent||receipt.abandonedAt){
        const running=startPageEventMediaReuseTransfer(prepared.attempt,owned,media=>onProgress?.({completed:copies.length,total:a.plan.media.length,media}));transfer=running;
        try{receipt=(await running.done).receipt;}finally{transfer=null;}
      }
      check();if(!receipt)throw Error('The original media copy could not be confirmed.');
      copies.push({slotKey:slot.key,source:prepared.attempt.source,receipt});onProgress?.({completed:copies.length,total:a.plan.media.length});
    }
    await access();
    const fields=materializePageEventReuse(a.plan,pageId,eventId,copies);
    const input:PageEventSaveInput={...a.destination,fields:{...fields,public_name:a.destination.fields.public_name,ticket_price:a.destination.fields.ticket_price},latitude:a.latitude,longitude:a.longitude};
    if(a.input&&canonical(a.input)!==canonical(input))throw Error('The original complete copy payload changed. Keep the saved attempt.');
    if(!a.input){a.input=clone(input);await write(a,owned);}
    check();const inputToSave=a.input;const saved=await pageEventReuseNetwork(owned, networkScope => savePageEvent(pageId,eventId,requestId,inputToSave,networkScope), 25_000);check();return finish(saved);
  }).finally(()=>{operation.finish();active.delete(k);});
  return {done,cancel:operation.cancel};
}

/** Parent has durably recorded the kept destination; remove only its stopped
 * whole pointer after all original media/import cleanup is confirmed. */
export function acknowledgeKeptPageEventReuse(pageId:string,eventId:string,requestId:string,scope:CreatorPageScope){
 current(pageId,eventId,scope);const k=key(pageId,eventId,scope);
 if(active.has(k))throw Error('The original copy is still finishing.');
 return serial(k,async()=>{
  const a=await read(pageId,eventId,scope);if(!a)return true;
  if(a.requestId!==requestId||!a.keeping)throw Error('Check the original stopped copy.');
  const stopping=await readPageEventCopyStop(pageId,eventId,scope);current(pageId,eventId,scope);
  if(!stopping||stopping.copyRequestId!==requestId)throw Error('Check the original copy recovery.');
  const result=await resolvePageEventCopyStop(stopping,scope,'check');current(pageId,eventId,scope);
  if(result.state!=='kept')throw Error('Check the complete saved copy first.');
  try{await cleanupStoppedPageEventCopy(a,scope,'check',()=>write(a,scope));await AsyncStorage.removeItem(k);}catch{return false;}
  current(pageId,eventId,scope);return true;
 });
}
