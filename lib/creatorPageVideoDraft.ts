/** Durable, explicit video/poster choice. No upload or automatic pairing. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type {CreatorPageScope} from './creatorPageReview';
import {CreatorPageScopeExpired} from './creatorPageReview';
import {getPageEventSaveState} from './creatorPageEventSave';
import {readPageEventMediaAttempts,clearPageEventMediaAttempt,type PageEventMediaAttempt} from './creatorPageEventMediaAttempt';
import {mediaUUID,validPageEventMediaInput,assertPageEventMediaAccount,getPageEventMediaAttempt,reservePageEventMedia,abandonPageEventMedia,pageEventMediaPath} from './creatorPageEventMedia';

export interface PageEventVideoDraft {
  version:1;revision:number;userId:string;pageId:string;eventId:string;
  video:PageEventMediaAttempt;
  /** All explicitly selected originals stay recorded until terminal cleanup. */
  posters:PageEventMediaAttempt[];
  choice:'pending'|'none'|string;
}
const queues=new Map<string,Promise<unknown>>();
const key=(p:string,e:string,s:CreatorPageScope)=>`creator-page-video-drafts:v1:${s.userId}:${p}:${e}`;
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
function current(p:string,e:string,s:CreatorPageScope){if(!s.isCurrent()||![p,e,s.userId].every(mediaUUID))throw new CreatorPageScopeExpired();}
function validAttempt(a:PageEventMediaAttempt,p:string,e:string,u:string,purpose:'video'|'poster'){
  return !!a&&a.version===1&&a.userId===u&&a.pageId===p&&a.eventId===e&&a.purpose===purpose&&validPageEventMediaInput(a)
    &&a.digestKind==='native-md5-manifest-v1'&&typeof a.fileUri==='string'&&a.fileUri.startsWith('file://')&&typeof a.fileMd5==='string'&&/^[a-f\d]{32}$/.test(a.fileMd5);
}
async function serial<T>(p:string,e:string,s:CreatorPageScope,action:()=>Promise<T>):Promise<T>{
  current(p,e,s);const k=key(p,e,s),next=(queues.get(k)??Promise.resolve()).catch(()=>undefined).then(action);queues.set(k,next);
  try{return await next;}finally{if(queues.get(k)===next)queues.delete(k);}
}
async function read(p:string,e:string,s:CreatorPageScope):Promise<PageEventVideoDraft[]>{
  current(p,e,s);const raw=await AsyncStorage.getItem(key(p,e,s));current(p,e,s);if(raw===null)return [];
  const store=JSON.parse(raw);if(store?.version!==1||store.userId!==s.userId||store.pageId!==p||store.eventId!==e||!Array.isArray(store.drafts))throw Error('Check the saved video choices.');
  const seen=new Set<string>();
  for(const d of store.drafts){
    if(d?.version!==1||!Number.isSafeInteger(d.revision)||d.revision<1||d.userId!==s.userId||d.pageId!==p||d.eventId!==e||!validAttempt(d.video,p,e,s.userId,'video')||seen.has(d.video.mediaId)||!Array.isArray(d.posters)||!d.posters.every((a:PageEventMediaAttempt)=>validAttempt(a,p,e,s.userId,'poster'))||new Set(d.posters.map((a:PageEventMediaAttempt)=>a.mediaId)).size!==d.posters.length||!(d.choice==='pending'||d.choice==='none'||d.posters.some((a:PageEventMediaAttempt)=>a.mediaId===d.choice)))throw Error('Check the saved video choices.');
    seen.add(d.video.mediaId);
  }
  return store.drafts;
}
async function write(p:string,e:string,s:CreatorPageScope,drafts:PageEventVideoDraft[]){
  current(p,e,s);await AsyncStorage.setItem(key(p,e,s),JSON.stringify({version:1,userId:s.userId,pageId:p,eventId:e,drafts}));current(p,e,s);
}
async function authority(p:string,e:string,s:CreatorPageScope){
  await assertPageEventMediaAccount(s);current(p,e,s);const state=await getPageEventSaveState(p,e,s);current(p,e,s);return state;
}
async function storedOriginal(a:PageEventMediaAttempt,s:CreatorPageScope){
  const originals=await readPageEventMediaAttempts(a.pageId,a.eventId,s);current(a.pageId,a.eventId,s);
  if(!originals.some(v=>same(v,a)))throw Error('Use the original saved media attempt.');
}
const originals=(d:PageEventVideoDraft)=>[d.video,...d.posters];
function exact(entries:PageEventVideoDraft[],d:PageEventVideoDraft){
  const found=entries.find(v=>v.video.mediaId===d.video.mediaId);if(!found||!same(found,d))throw Error('Check the latest saved video choice.');return found;
}
export function readPageEventVideoDrafts(p:string,e:string,s:CreatorPageScope){return serial(p,e,s,()=>read(p,e,s));}
export function createPageEventVideoDraft(input:PageEventMediaAttempt,s:CreatorPageScope){
  const video:PageEventMediaAttempt=JSON.parse(JSON.stringify(input)),{pageId:p,eventId:e}=video;
  return serial(p,e,s,async()=>{
    if(!validAttempt(video,p,e,s.userId,'video'))throw Error('Choose the original video.');
    const entries=await read(p,e,s);await storedOriginal(video,s);
    const state=await authority(p,e,s);if(!['Draft','Live'].includes(state.status))throw Error('This event is closed.');
    const found=entries.find(d=>d.video.mediaId===video.mediaId);if(found){if(!same(found.video,video))throw Error('Use the original video.');return found;}
    const d:PageEventVideoDraft={version:1,revision:1,userId:s.userId,pageId:p,eventId:e,video:JSON.parse(JSON.stringify(video)),posters:[],choice:'pending'};
    await write(p,e,s,[...entries,d]);return d;
  });
}
/** Passing null is the explicit existing "without preview" choice, never inferred. */
export function choosePageEventVideoPoster(draft:PageEventVideoDraft,poster:PageEventMediaAttempt|null,s:CreatorPageScope){
  const d:PageEventVideoDraft=JSON.parse(JSON.stringify(draft)),a=poster?JSON.parse(JSON.stringify(poster)) as PageEventMediaAttempt:null,{pageId:p,eventId:e}=d;
  return serial(p,e,s,async()=>{
    const entries=await read(p,e,s),found=entries.find(v=>v.video.mediaId===d.video.mediaId);if(!found||!same(found.video,d.video))throw Error('Check the saved video.');
    const choice=a?.mediaId??'none';
    if(a&&!validAttempt(a,p,e,s.userId,'poster'))throw Error('Choose a poster from this event.');
    await storedOriginal(d.video,s);if(a)await storedOriginal(a,s);
    const state=await authority(p,e,s);if(!['Draft','Live'].includes(state.status))throw Error('This event is closed.');
    // A lost local acknowledgment may recover only this exact already-saved choice.
    if(found.choice===choice&&(!a||found.posters.some(v=>same(v,a))))return found;
    exact(entries,d);
    const prior=a&&found.posters.find(v=>v.mediaId===a.mediaId);if(prior&&!same(prior,a))throw Error('Use the original poster.');
    const next={...found,revision:found.revision+1,choice,posters:a&&!prior?[...found.posters,a]:found.posters};
    await write(p,e,s,entries.map(v=>v.video.mediaId===d.video.mediaId?next:v));return next;
  });
}

/** Read-only list: unlinked originals remain visible, never guessed into a pair. */
export async function readUnassignedPageVideoMedia(p:string,e:string,s:CreatorPageScope){
  const drafts=await readPageEventVideoDrafts(p,e,s),attempts=await readPageEventMediaAttempts(p,e,s);current(p,e,s);
  const assigned=new Set(drafts.flatMap(d=>originals(d).map(a=>a.mediaId)));
  return attempts.filter(a=>['video','poster'].includes(a.purpose)&&!assigned.has(a.mediaId));
}

async function cleanup(draft:PageEventVideoDraft,s:CreatorPageScope,discard:boolean){
  const d:PageEventVideoDraft=JSON.parse(JSON.stringify(draft)),{pageId:p,eventId:e}=d;
  return serial(p,e,s,async()=>{
    const entries=await read(p,e,s);exact(entries,d);
    const state=await authority(p,e,s),blocks=state.fields.description_blocks??[];
    const videoPath=pageEventMediaPath(e,d.video),poster=d.posters.find(a=>a.mediaId===d.choice);
    if(!discard&&(d.choice==='pending'||!blocks.some(b=>b.type==='video'&&b.path===videoPath&&(poster?b.poster===pageEventMediaPath(e,poster):!b.poster))))throw Error('Check the complete saved video and poster before cleanup.');
    const shared=new Set(entries.filter(v=>v.video.mediaId!==d.video.mediaId).flatMap(v=>originals(v).map(a=>a.mediaId)));
    // Video first: discarding cannot remove a selection that is already attached.
    for(const a of originals(d)){
      let r=await getPageEventMediaAttempt(p,e,a,s);current(p,e,s);
      const selected=a.mediaId===d.video.mediaId||a.mediaId===d.choice;
      if(!discard&&selected&&!(r?.attached&&r.readyAt&&r.objectPresent&&!r.abandonedAt))throw Error('Check the confirmed video attachment.');
      if(discard&&a.mediaId===d.video.mediaId&&r?.attached)throw Error('Remove the video from the saved event before discarding its upload.');
      if(shared.has(a.mediaId))continue;
      if(!r){r=await reservePageEventMedia(p,e,a,s);current(p,e,s);}
      if(!r.attached&&!r.abandonedAt){await abandonPageEventMedia(p,e,a,s);current(p,e,s);}
      await clearPageEventMediaAttempt(a,s);current(p,e,s);
    }
    // Local cleanup can partially finish; the complete journal stays until every
    // receipt/clear succeeds, including after a committed-but-lost response.
    await write(p,e,s,entries.filter(v=>v.video.mediaId!==d.video.mediaId));return true;
  });
}
export const finishPageEventVideoDraft=(d:PageEventVideoDraft,s:CreatorPageScope)=>cleanup(d,s,false);
export const discardPageEventVideoDraft=(d:PageEventVideoDraft,s:CreatorPageScope)=>cleanup(d,s,true);

/** Serialize orphan discard with poster selection; a chosen frame is never an orphan. */
export function discardUnassignedPageVideoMedia(input:PageEventMediaAttempt,s:CreatorPageScope){
  const a:PageEventMediaAttempt=JSON.parse(JSON.stringify(input)),{pageId:p,eventId:e}=a;
  return serial(p,e,s,async()=>{
    const entries=await read(p,e,s);
    if(!['video','poster'].includes(a.purpose)||entries.some(d=>originals(d).some(v=>v.mediaId===a.mediaId)))throw Error('Check the latest video choices.');
    await storedOriginal(a,s);await authority(p,e,s);
    let r=await getPageEventMediaAttempt(p,e,a,s);current(p,e,s);
    if(!r){r=await reservePageEventMedia(p,e,a,s);current(p,e,s);}
    if(!r.attached&&!r.abandonedAt){await abandonPageEventMedia(p,e,a,s);current(p,e,s);}
    await clearPageEventMediaAttempt(a,s);current(p,e,s);
  });
}
