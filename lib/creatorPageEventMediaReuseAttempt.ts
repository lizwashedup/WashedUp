import {pageEventReuseNetwork} from './creatorPageEventReuseOperation';
/** Persist the exact source/destination before any protected reuse reservation. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import {claimPageEventMediaReuseWork} from './creatorPageEventMediaReuseWork';
import {removePageEventMediaReuseRuns} from './creatorPageEventMediaReuseFiles';
import {CreatorPageScopeExpired,type CreatorPageScope} from './creatorPageReview';
import {getPageEventSaveState} from './creatorPageEventSave';
import {assertPageEventMediaAccount,mediaUUID,type PageEventMediaPurpose} from './creatorPageEventMedia';
import {getPageEventMediaSource,getPageEventMediaReuseAttempt,pageEventMediaReuseInput,
  type PageEventMediaReuseIntent,type PageEventMediaSource} from './creatorPageEventMediaReuse';
export interface PageEventMediaReuseAttempt extends PageEventMediaReuseIntent {version:1;pageId:string;eventId:string;userId:string}
const queues=new Map<string,Promise<unknown>>();
const key=(p:string,e:string,s:CreatorPageScope)=>`creator-page-event-media-reuse:v1:${s.userId}:${p}:${e}`;
function current(p:string,e:string,s:CreatorPageScope){if(!s.isCurrent()||!mediaUUID(p)||!mediaUUID(e)||!mediaUUID(s.userId))throw new CreatorPageScopeExpired();}
async function serial<T>(k:string,action:()=>Promise<T>):Promise<T>{const next=(queues.get(k)??Promise.resolve()).catch(()=>undefined).then(action);queues.set(k,next);try{return await next;}finally{if(queues.get(k)===next)queues.delete(k);}}
async function read(p:string,e:string,s:CreatorPageScope):Promise<PageEventMediaReuseAttempt[]>{
  current(p,e,s);const raw=await AsyncStorage.getItem(key(p,e,s));current(p,e,s);if(raw===null)return [];
  const parsed=JSON.parse(raw);
  if(!parsed||parsed.version!==1||parsed.pageId!==p||parsed.eventId!==e||parsed.userId!==s.userId||!Array.isArray(parsed.attempts))throw Error('Saved media reuse attempts need review.');
  const seen=new Set<string>();
  for(const a of parsed.attempts){
    if(!a||a.version!==1||a.pageId!==p||a.eventId!==e||a.userId!==s.userId||seen.has(a.mediaId))throw Error('Saved media reuse attempts need review.');
    pageEventMediaReuseInput(a);seen.add(a.mediaId);
  }
  return parsed.attempts;
}
async function write(p:string,e:string,s:CreatorPageScope,attempts:PageEventMediaReuseAttempt[]){current(p,e,s);await AsyncStorage.setItem(key(p,e,s),JSON.stringify({version:1,pageId:p,eventId:e,userId:s.userId,attempts}));current(p,e,s);}
export function readPageEventMediaReuseAttempts(p:string,e:string,s:CreatorPageScope){return serial(key(p,e,s),()=>read(p,e,s));}
export function preparePageEventMediaReuseAttempt(p:string,e:string,purpose:PageEventMediaPurpose,sourceIdentity:{pageId:string;eventId:string;mediaId:string},s:CreatorPageScope){
  current(p,e,s);const source={pageId:sourceIdentity.pageId,eventId:sourceIdentity.eventId,mediaId:sourceIdentity.mediaId};
  if(!mediaUUID(source.pageId)||!mediaUUID(source.eventId)||!mediaUUID(source.mediaId)||!['cover','image','poster','video'].includes(purpose))throw Error('Check the original source media.');
  return serial(key(p,e,s),async()=>{
    const pending=await read(p,e,s);
    const existing=pending.find(a=>a.purpose===purpose&&a.source.pageId===source.pageId&&a.source.eventId===source.eventId&&a.source.mediaId===source.mediaId);
    // Return the original pending attempt even if source access has changed.
    // Resume still requires current backend authorization; this path does not reserve.
    if(existing)return {attempt:existing,created:false};
    await pageEventReuseNetwork(s, networkScope => assertPageEventMediaAccount(networkScope));
    const state=await pageEventReuseNetwork(s, networkScope => getPageEventSaveState(p,e,networkScope));current(p,e,s);if(!['Draft','Live'].includes(state.status))throw Error('This event is closed.');
    const descriptor=await pageEventReuseNetwork(s, networkScope => getPageEventMediaSource(source.pageId,source.eventId,source.mediaId,networkScope));current(p,e,s);
    const original:PageEventMediaSource={pageId:descriptor.pageId,eventId:descriptor.eventId,mediaId:descriptor.mediaId,purpose:descriptor.purpose,byteSize:descriptor.byteSize,mimeType:descriptor.mimeType,contentDigest:descriptor.contentDigest,objectName:descriptor.objectName};
    const attempt:PageEventMediaReuseAttempt={version:1,pageId:p,eventId:e,userId:s.userId,mediaId:Crypto.randomUUID(),purpose,source:original};
    pageEventMediaReuseInput(attempt);
    await write(p,e,s,[...pending,attempt]);
    // A write rejection may still have persisted; never erase it or create another
    // remote reservation here. Reopening reads the original durable intent.
    return {attempt,created:true};
  });
}
export function clearPageEventMediaReuseAttempt(attempt:PageEventMediaReuseAttempt,s:CreatorPageScope){
  const a:PageEventMediaReuseAttempt=JSON.parse(JSON.stringify(attempt));current(a.pageId,a.eventId,s);
  if(a.userId!==s.userId)throw new CreatorPageScopeExpired();
  const release=claimPageEventMediaReuseWork(a.userId,a.pageId,a.eventId,a.mediaId);
  return serial(key(a.pageId,a.eventId,s),async()=>{
    const stored=await read(a.pageId,a.eventId,s),entry=stored.find(v=>v.mediaId===a.mediaId);
    if(!entry||JSON.stringify(entry)!==JSON.stringify(a))return false;
    const confirmTerminal=async()=>{
      const receipt=await pageEventReuseNetwork(s, networkScope => getPageEventMediaReuseAttempt(a.pageId,a.eventId,a,networkScope));
      if(!receipt||receipt.mediaId!==a.mediaId||receipt.userId!==a.userId||receipt.pageId!==a.pageId||receipt.eventId!==a.eventId
        ||receipt.source.mediaId!==a.source.mediaId||receipt.source.eventId!==a.source.eventId||receipt.source.pageId!==a.source.pageId
        ||!(receipt.abandonedAt&&!receipt.attached||receipt.attached&&receipt.readyAt&&receipt.objectPresent&&!receipt.abandonedAt))throw Error('Check the original media attachment before clearing this attempt.');
      await pageEventReuseNetwork(s, networkScope => assertPageEventMediaAccount(networkScope));current(a.pageId,a.eventId,s);
    };
    await confirmTerminal();
    await removePageEventMediaReuseRuns(a,s,confirmTerminal);
    await confirmTerminal();
    await write(a.pageId,a.eventId,s,stored.filter(v=>v.mediaId!==a.mediaId));return true;
  }).finally(release);
}
