/** Private local media copies, owned by the original actor/page/event. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import * as Crypto from 'expo-crypto';
import {getPageEventSaveState} from './creatorPageEventSave';
import {CreatorPageScopeExpired,type CreatorPageScope} from './creatorPageReview';
import {getPageEventMediaAttempt,assertPageEventMediaAccount,mediaUUID,validPageEventMediaInput,type PageEventMediaInput,type PageEventMediaPurpose,type PageEventMediaMime} from './creatorPageEventMedia';
import {claimPageEventMediaReuseWork} from './creatorPageEventMediaReuseWork';
export interface PageEventMediaAttempt extends PageEventMediaInput {version:1;pageId:string;eventId:string;userId:string;fileUri:string;fileMd5:string;digestKind:'native-md5-manifest-v1'}
const queues=new Map<string,Promise<unknown>>();
const key=(p:string,e:string,s:CreatorPageScope)=>`creator-page-event-media:v1:${s.userId}:${p}:${e}`;
function current(p:string,e:string,s:CreatorPageScope){if(!s.isCurrent()||!mediaUUID(p)||!mediaUUID(e)||!mediaUUID(s.userId))throw new CreatorPageScopeExpired();}
function file(p:string,e:string,id:string,mime:PageEventMediaMime,s:CreatorPageScope){
  current(p,e,s);if(!mediaUUID(id)||!FileSystem.documentDirectory)throw Error('Private file storage is unavailable.');
  return `${FileSystem.documentDirectory}creator-event-media/${s.userId}/${p}/${e}/${id}.${mime==='video/mp4'?'mp4':mime==='image/jpeg'?'jpg':mime==='image/png'?'png':'webp'}`;
}
async function serial<T>(k:string,action:()=>Promise<T>):Promise<T>{const next=(queues.get(k)??Promise.resolve()).catch(()=>undefined).then(action);queues.set(k,next);try{return await next;}finally{if(queues.get(k)===next)queues.delete(k);}}
async function read(p:string,e:string,s:CreatorPageScope):Promise<PageEventMediaAttempt[]>{
  current(p,e,s);const raw=await AsyncStorage.getItem(key(p,e,s));current(p,e,s);if(raw===null)return [];
  const r=JSON.parse(raw);if(!r||r.version!==1||r.pageId!==p||r.eventId!==e||r.userId!==s.userId||!Array.isArray(r.attempts))throw Error('Saved media attempts need review.');
  const seen=new Set<string>();
  for(const a of r.attempts){if(!a||a.version!==1||a.pageId!==p||a.eventId!==e||a.userId!==s.userId||a.digestKind!=='native-md5-manifest-v1'||typeof a.fileMd5!=='string'||!/^[a-f\d]{32}$/.test(a.fileMd5)||a.fileUri!==file(p,e,a.mediaId,a.mimeType,s)||seen.has(a.mediaId)||!validPageEventMediaInput(a))throw Error('Saved media attempts need review.');seen.add(a.mediaId);}
  return r.attempts;
}
async function write(p:string,e:string,s:CreatorPageScope,attempts:PageEventMediaAttempt[]){current(p,e,s);await AsyncStorage.setItem(key(p,e,s),JSON.stringify({version:1,pageId:p,eventId:e,userId:s.userId,attempts}));current(p,e,s);}
async function info(uri:string,maxBytes:number){
  const first=await FileSystem.getInfoAsync(uri);
  if(!first.exists||first.isDirectory||!Number.isSafeInteger(first.size)||first.size<1||first.size>maxBytes)throw Error('The original media file is unavailable or exceeds its size limit.');
  const r=await FileSystem.getInfoAsync(uri,{md5:true});
  if(!r.exists||r.isDirectory||r.size!==first.size||typeof r.md5!=='string'||!/^[a-f\d]{32}$/i.test(r.md5))throw Error('The original media file could not be verified.');
  return{byteSize:r.size,fileMd5:r.md5.toLowerCase()};
}
// Native MD5 avoids a large JS/base64 buffer. This SDK uses NSData on iOS;
// maximum-size video memory use still requires supported-device profiling.
// This is a domain-separated manifest fingerprint, NOT a SHA-256 of file bytes.
async function digest(mime:string,size:number,md5:string){return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256,`washedup:event-media:native-md5:v1:${mime}:${size}:${md5}`);}
export function readPageEventMediaAttempts(p:string,e:string,s:CreatorPageScope){return serial(key(p,e,s),()=>read(p,e,s));}
export function preparePageEventMediaAttempt(p:string,e:string,purpose:PageEventMediaPurpose,mimeType:PageEventMediaMime,sourceUri:string,s:CreatorPageScope){
  current(p,e,s);return serial(key(p,e,s),async()=>{
    const pending=await read(p,e,s);await assertPageEventMediaAccount(s);
    const state=await getPageEventSaveState(p,e,s);current(p,e,s);if(!['Draft','Live'].includes(state.status))throw Error('This event is closed.');
    if(!sourceUri.startsWith('file://'))throw Error('Choose a local media file.');
    const source=await info(sourceUri,purpose==='video'?104857600:10485760);current(p,e,s);
    const existing=pending.find(a=>a.purpose===purpose&&a.mimeType===mimeType&&a.byteSize===source.byteSize&&a.fileMd5===source.fileMd5);
    if(existing)return {attempt:existing,created:false};
    const mediaId=Crypto.randomUUID(),contentDigest=await digest(mimeType,source.byteSize,source.fileMd5);current(p,e,s);
    const input={mediaId,purpose,mimeType,byteSize:source.byteSize,contentDigest};if(!validPageEventMediaInput(input))throw Error('Check the media type and size.');
    const fileUri=file(p,e,mediaId,mimeType,s);let storeDispatched=false;
    try{
      await FileSystem.makeDirectoryAsync(fileUri.slice(0,fileUri.lastIndexOf('/')),{intermediates:true});current(p,e,s);
      await FileSystem.copyAsync({from:sourceUri,to:fileUri});current(p,e,s);
      const copied=await info(fileUri,purpose==='video'?104857600:10485760);current(p,e,s);if(copied.byteSize!==source.byteSize||copied.fileMd5!==source.fileMd5)throw Error('The media file changed while it was being prepared.');
      const attempt:PageEventMediaAttempt={version:1,pageId:p,eventId:e,userId:s.userId,...input,fileUri,fileMd5:source.fileMd5,digestKind:'native-md5-manifest-v1'};
      storeDispatched=true;await write(p,e,s,[...pending,attempt]);return{attempt,created:true};
    }catch(error){if(!storeDispatched)try{await FileSystem.deleteAsync(fileUri,{idempotent:true});}catch{/* Unrecorded local copy cleanup remains retryable by account-owned housekeeping. */}throw error;}
  });
}
export async function verifyPageEventMediaFile(a:PageEventMediaAttempt,s:CreatorPageScope){
  const stored=await readPageEventMediaAttempts(a.pageId,a.eventId,s);if(!stored.some(v=>JSON.stringify(v)===JSON.stringify(a)))throw Error('Use the original saved media attempt.');
  await assertPageEventMediaAccount(s);const actual=await info(a.fileUri,a.purpose==='video'?104857600:10485760);current(a.pageId,a.eventId,s);
  const fingerprint=await digest(a.mimeType,actual.byteSize,actual.fileMd5);current(a.pageId,a.eventId,s);
  if(actual.byteSize!==a.byteSize||actual.fileMd5!==a.fileMd5||fingerprint!==a.contentDigest)throw Error('The original media file changed. Keep the attempt for review.');return a.fileUri;
}
export function clearPageEventMediaAttempt(a:PageEventMediaAttempt,s:CreatorPageScope){
  return serial(key(a.pageId,a.eventId,s),async()=>{
    const release=claimPageEventMediaReuseWork(a.userId,a.pageId,a.eventId,a.mediaId);
    try{
    const stored=await read(a.pageId,a.eventId,s),entry=stored.find(v=>v.mediaId===a.mediaId);
    if(!entry||JSON.stringify(entry)!==JSON.stringify(a))return false;
    const r=await getPageEventMediaAttempt(a.pageId,a.eventId,a,s);
    if(!r||r.pageId!==a.pageId||r.eventId!==a.eventId||r.userId!==a.userId||r.mediaId!==a.mediaId||r.contentDigest!==a.contentDigest||r.purpose!==a.purpose||r.mimeType!==a.mimeType||r.byteSize!==a.byteSize
      ||!(r.abandonedAt&&!r.attached||r.attached&&r.readyAt&&r.objectPresent&&!r.abandonedAt))throw Error('Check the original media attachment before clearing this attempt.');
    await assertPageEventMediaAccount(s);await FileSystem.deleteAsync(a.fileUri,{idempotent:true});current(a.pageId,a.eventId,s);
    await write(a.pageId,a.eventId,s,stored.filter(v=>v.mediaId!==a.mediaId));return true;
    }finally{release();}
  });
}
