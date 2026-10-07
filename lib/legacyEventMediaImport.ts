/** Import an exact existing public body object through the private original-upload path. */
import {AppState} from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Crypto from 'expo-crypto';
import {supabase} from './supabase';
import {CreatorPageScopeExpired,type CreatorPageScope} from './creatorPageReview';
import {getPageEventSaveState} from './creatorPageEventSave';
import {preparePageEventMediaAttempt,clearPageEventMediaAttempt,type PageEventMediaAttempt} from './creatorPageEventMediaAttempt';
import {startPageEventMediaTransfer,type PageEventMediaTransferProgress} from './creatorPageEventMediaTransfer';
import {getPageEventMediaAttempt,mediaUUID,type PageEventMediaReceipt} from './creatorPageEventMedia';
import {claimPageEventMediaReuseWork} from './creatorPageEventMediaReuseWork';
import {assertLegacyEventMediaSource,legacyEventMediaDownloadUrl,validLegacyEventMediaSource,type LegacyEventMediaSource} from './legacyEventMediaSource';

export interface LegacyEventMediaDownload {runId:string}
export interface LegacyEventMediaImportResult {source:LegacyEventMediaSource;original:PageEventMediaAttempt;receipt:PageEventMediaReceipt}
export interface LegacyEventMediaImportProgress {phase:'reading-legacy'|'uploading-original';bytes:number;totalBytes:number;upload?:PageEventMediaTransferProgress}
const suffix=(s:LegacyEventMediaSource)=>s.mimeType==='video/mp4'?'mp4':s.mimeType==='image/jpeg'?'jpg':s.mimeType==='image/png'?'png':'webp';
function directory(pageId:string,eventId:string,source:LegacyEventMediaSource,run:LegacyEventMediaDownload,scope:CreatorPageScope){
  if(!FileSystem.documentDirectory||![pageId,eventId,scope.userId,run.runId].every(mediaUUID)||!validLegacyEventMediaSource(source))throw Error('Check the original import files.');
  return `${FileSystem.documentDirectory}creator-event-legacy-import/${scope.userId}/${pageId}/${eventId}/${source.objectId}/${source.objectVersion}/${run.runId}/`;
}
export function startLegacyEventMediaImport(input:{pageId:string;eventId:string;source:LegacyEventMediaSource;original?:PageEventMediaAttempt;
  onDownloadPrepared:(run:LegacyEventMediaDownload)=>Promise<void>;onOriginalPrepared:(original:PageEventMediaAttempt)=>Promise<void>},scope:CreatorPageScope,onProgress?:(p:LegacyEventMediaImportProgress)=>void){
  const {pageId,eventId,onDownloadPrepared,onOriginalPrepared}=input,source:LegacyEventMediaSource=JSON.parse(JSON.stringify(input.source));let original=input.original?JSON.parse(JSON.stringify(input.original)) as PageEventMediaAttempt:undefined;
  if(!validLegacyEventMediaSource(source)||![pageId,eventId,scope.userId].every(mediaUUID)||source.source.eventId===eventId)throw Error('Choose a different saved destination event.');
  const release=claimPageEventMediaReuseWork(scope.userId,pageId,eventId,source.objectId),controller=new AbortController();
  let error:Error|null=null,download:{cancelAsync():Promise<void>}|null=null,upload:{cancel():void}|null=null,timer:ReturnType<typeof setTimeout>|null=null,finished=false;
  const pending=new Set<Promise<unknown>>();
  const cancel=(reason:Error=new CreatorPageScopeExpired())=>{if(controller.signal.aborted)return;error=reason;controller.abort();if(timer)clearTimeout(timer);void download?.cancelAsync().catch(()=>{});upload?.cancel();};
  const current=()=>{if(!scope.isCurrent()||AppState.currentState!=='active')cancel();if(controller.signal.aborted)throw error??new CreatorPageScopeExpired();};
  const owned={userId:scope.userId,isCurrent:()=>!controller.signal.aborted&&scope.isCurrent()};
  const authority=async()=>{current();const target=await getPageEventSaveState(pageId,eventId,owned);current();if(!['Draft','Live'].includes(target.status))throw Error('This destination event is closed.');await assertLegacyEventMediaSource(source,owned);current();};
  const stall=()=>{if(timer)clearTimeout(timer);timer=setTimeout(()=>cancel(Error('The original media stopped responding. Keep this import for retry.')),60_000);};
  const transport=async<T,>(work:Promise<T>)=>{
    pending.add(work);const settled=()=>{pending.delete(work);if(finished&&!pending.size)release();};void work.then(settled,settled);
    let listener=()=>{};const stopped=new Promise<never>((_,reject)=>{listener=()=>reject(error??new CreatorPageScopeExpired());controller.signal.addEventListener('abort',listener,{once:true});if(controller.signal.aborted)listener();});
    try{return await Promise.race([work,stopped]);}finally{controller.signal.removeEventListener('abort',listener);}
  };
  const app=AppState.addEventListener('change',state=>{if(state!=='active')cancel();});
  const {data:{subscription:auth}}=supabase.auth.onAuthStateChange((event,session)=>{if(event==='INITIAL_SESSION'&&session?.user.id===scope.userId&&scope.isCurrent())return;cancel();});
  const done=(async():Promise<LegacyEventMediaImportResult>=>{
    try{
      await authority();
      if(!original){
        const run={runId:Crypto.randomUUID()},folder=directory(pageId,eventId,source,run,owned),uri=folder+'source.'+suffix(source);
        // Caller durably records this exact directory before any bytes are fetched.
        await onDownloadPrepared(run);current();await FileSystem.makeDirectoryAsync(folder,{intermediates:true});current();
        let received=0;const task=FileSystem.createDownloadResumable(legacyEventMediaDownloadUrl(source),uri,{cache:false,sessionType:FileSystem.FileSystemSessionType.FOREGROUND,headers:{'Cache-Control':'no-cache, no-store','If-Match':source.etag}},p=>{
          if(controller.signal.aborted)return;
          if(!Number.isSafeInteger(p.totalBytesWritten)||p.totalBytesWritten<received||p.totalBytesWritten>source.byteSize){cancel(Error('The original media download changed size.'));return;}
          if(p.totalBytesWritten>received){received=p.totalBytesWritten;stall();}
          try{current();onProgress?.({phase:'reading-legacy',bytes:received,totalBytes:source.byteSize});}catch(e){cancel(e instanceof Error?e:new CreatorPageScopeExpired());}
        });
        download=task;stall();let result;
        try{result=await transport(task.downloadAsync());current();}finally{if(timer)clearTimeout(timer);download=null;}
        const etag=result?.headers?Object.entries(result.headers).find(([k])=>k.toLowerCase()==='etag')?.[1]:undefined;
        if(!result||result.status!==200||result.uri!==uri||result.mimeType?.split(';')[0].trim().toLowerCase()!==source.mimeType||etag!==source.etag)throw Error('The original media response could not be confirmed.');
        const info=await FileSystem.getInfoAsync(uri,{md5:true});current();
        if(!info.exists||info.isDirectory||info.size!==source.byteSize||!info.md5||/^"[a-f\d]{32}"$/i.test(source.etag)&&info.md5.toLowerCase()!==source.etag.slice(1,-1).toLowerCase())throw Error('The original media bytes changed.');
        await authority();
        original=(await preparePageEventMediaAttempt(pageId,eventId,source.purpose,source.mimeType,uri,owned)).attempt;current();
        await onOriginalPrepared(original);current();
      }
      if(original.pageId!==pageId||original.eventId!==eventId||original.userId!==scope.userId||original.purpose!==source.purpose||original.mimeType!==source.mimeType||original.byteSize!==source.byteSize
        ||/^"[a-f\d]{32}"$/i.test(source.etag)&&original.fileMd5.toLowerCase()!==source.etag.slice(1,-1).toLowerCase())throw Error('Use the original saved import attempt.');
      await authority();
      const task=startPageEventMediaTransfer(original,owned,p=>onProgress?.({phase:'uploading-original',bytes:p.bytes,totalBytes:source.byteSize,upload:p}));upload=task;
      const receipt=await task.done;current();await authority();
      return {source,original,receipt};
    }finally{if(timer)clearTimeout(timer);app.remove();auth.unsubscribe();finished=true;if(!pending.size)release();}
  })();
  return {done,cancel:()=>cancel()};
}
/** Only terminal destination attachment/abandonment permits deleting exact owned
 * import files. Source revocation cannot undo a separately confirmed destination. */
export async function clearLegacyEventMediaImport(pageId:string,eventId:string,source:LegacyEventMediaSource,original:PageEventMediaAttempt,downloads:LegacyEventMediaDownload[],scope:CreatorPageScope){
  const release=claimPageEventMediaReuseWork(scope.userId,pageId,eventId,source.objectId);
  try{
    const confirm=async()=>{
      if(!scope.isCurrent())throw new CreatorPageScopeExpired();
      const receipt=await getPageEventMediaAttempt(pageId,eventId,original,scope);
      if(!receipt||receipt.mediaId!==original.mediaId||receipt.userId!==scope.userId||receipt.pageId!==pageId||receipt.eventId!==eventId
        ||!(receipt.attached&&receipt.readyAt&&receipt.objectPresent&&!receipt.abandonedAt||receipt.abandonedAt&&!receipt.attached))throw Error('Check the original imported media attachment.');
    };
    await confirm();
    for(const run of downloads){await confirm();await FileSystem.deleteAsync(directory(pageId,eventId,source,run,scope),{idempotent:true});}
    await confirm();await clearPageEventMediaAttempt(original,scope);
  }finally{release();}
}

export {directory as legacyEventMediaImportDirectory};
