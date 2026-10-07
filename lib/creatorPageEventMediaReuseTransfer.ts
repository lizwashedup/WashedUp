/** Explicit protected reuse transfer; the existing UI/writer gate remains off.
 * Creates no event attachment and never clears the saved intent automatically.
 */
import {AppState} from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Crypto from 'expo-crypto';
import {supabase,SUPABASE_URL,SUPABASE_ANON_KEY} from './supabase';
import {CreatorPageScopeExpired,type CreatorPageScope} from './creatorPageReview';
import {getPageEventSaveState} from './creatorPageEventSave';
import {assertPageEventMediaAccount,mediaUUID,pageEventMediaPath} from './creatorPageEventMedia';
import {getPageEventMediaSource,getPageEventMediaReuseAttempt,reservePageEventMediaReuse,pageEventMediaReuseInput,completePageEventMediaReuse} from './creatorPageEventMediaReuse';
import {readPageEventMediaReuseAttempts,type PageEventMediaReuseAttempt} from './creatorPageEventMediaReuseAttempt';
import {loadEventMediaSource} from './eventMediaSource';
import {verifyEventMediaFileCopy} from './verifyEventMediaFileCopy';
import {claimPageEventMediaReuseWork} from './creatorPageEventMediaReuseWork';
export type ReuseTransferPhase='checking'|'reading-original'|'uploading'|'reading-copy'|'verifying'|'confirming';
export interface ReuseTransferProgress {phase:ReuseTransferPhase;bytes:number;totalBytes:number}
const sameSource=(a:PageEventMediaReuseAttempt['source'],b:PageEventMediaReuseAttempt['source'])=>
  a.mediaId===b.mediaId&&a.pageId===b.pageId&&a.eventId===b.eventId&&a.purpose===b.purpose&&a.byteSize===b.byteSize&&a.mimeType===b.mimeType&&a.contentDigest===b.contentDigest&&a.objectName===b.objectName;
export function startPageEventMediaReuseTransfer(attempt:PageEventMediaReuseAttempt,scope:CreatorPageScope,onProgress?:(value:ReuseTransferProgress)=>void){
  // Snapshot all input before any asynchronous boundary.
  const a:PageEventMediaReuseAttempt=JSON.parse(JSON.stringify(attempt)),input=pageEventMediaReuseInput(a);
  if(a.version!==1||!mediaUUID(a.pageId)||!mediaUUID(a.eventId)||!mediaUUID(a.userId)||a.userId!==scope.userId)throw Error('Use the original saved media attempt.');
  const controller=new AbortController();let failure:Error|null=null,task:{cancelAsync():Promise<void>}|null=null,stallTimer:ReturnType<typeof setTimeout>|null=null;
  const cancel=(error:Error=new CreatorPageScopeExpired())=>{if(controller.signal.aborted)return;failure=error;controller.abort();if(stallTimer)clearTimeout(stallTimer);void task?.cancelAsync().catch(()=>{});};
  const current=()=>{if(!scope.isCurrent()||AppState.currentState!=='active')cancel();if(controller.signal.aborted)throw failure??new CreatorPageScopeExpired();};
  current();const release=claimPageEventMediaReuseWork(a.userId,a.pageId,a.eventId,a.mediaId);
  let finished=false;const pendingTransports=new Set<Promise<unknown>>();
  const runTransport=async<T>(start:()=>Promise<T>):Promise<T>=>{
    current();const pending=start();pendingTransports.add(pending);
    const settled=()=>{pendingTransports.delete(pending);if(finished&&!pendingTransports.size)release();};
    void pending.then(settled,settled);
    let listener:()=>void=()=>{};
    const cancelled=new Promise<never>((_,reject)=>{listener=()=>reject(failure??new CreatorPageScopeExpired());controller.signal.addEventListener('abort',listener,{once:true});if(controller.signal.aborted)listener();});
    try{return await Promise.race([pending,cancelled]);}finally{controller.signal.removeEventListener('abort',listener);}
  };
  const resetStall=()=>{if(stallTimer)clearTimeout(stallTimer);stallTimer=setTimeout(()=>cancel(Error('The media transfer stopped responding. Check the original attempt before retrying.')),60_000);};
  const progress=(phase:ReuseTransferPhase,bytes=0)=>{current();onProgress?.({phase,bytes,totalBytes:input.byteSize});};
  const appSubscription=AppState.addEventListener('change',state=>{if(state!=='active')cancel();});
  const {data:{subscription:authSubscription}}=supabase.auth.onAuthStateChange((event,session)=>{
    // Supabase reports the current session when a listener is registered. That
    // first report is not an account change; real transitions still retire work.
    if(event==='INITIAL_SESSION'&&session?.user.id===scope.userId&&scope.isCurrent())return;
    cancel();
  });
  const done=(async()=>{
    let runDirectory:string|undefined;
    try{
      progress('checking');
      const saved=await readPageEventMediaReuseAttempts(a.pageId,a.eventId,scope);current();
      if(!saved.some(v=>JSON.stringify(v)===JSON.stringify(a)))throw Error('Use the original saved media attempt.');
      const access=async()=>{
        await assertPageEventMediaAccount(scope);current();
        const state=await getPageEventSaveState(a.pageId,a.eventId,scope);current();
        if(!['Draft','Live'].includes(state.status))throw Error('This event is closed.');
        const source=await getPageEventMediaSource(a.source.pageId,a.source.eventId,a.source.mediaId,scope);current();
        if(!sameSource(a.source,source))throw Error('The original source media changed. Keep this attempt for review.');
      };
      await access();
      let receipt=await getPageEventMediaReuseAttempt(a.pageId,a.eventId,a,scope);current();
      if(receipt?.abandonedAt)throw Error('This media attempt was abandoned.');
      if(receipt?.readyAt&&!receipt.objectPresent)throw Error('Confirmed media is missing. Keep the original attempt for review.');
      if(!receipt){receipt=await reservePageEventMediaReuse(a.pageId,a.eventId,a,scope);current();}
      // Confirmed prior results are read back too. Never trust local stage flags as
      // proof of uploaded bytes, or overwrite an object after an uncertain upload.
      if(!FileSystem.documentDirectory)throw Error('Private file storage is unavailable.');
      const runId=Crypto.randomUUID();if(!mediaUUID(runId))throw Error('Could not identify this transfer.');
      const ext=input.mimeType==='video/mp4'?'mp4':input.mimeType==='image/jpeg'?'jpg':input.mimeType==='image/png'?'png':'webp';
      runDirectory=`${FileSystem.documentDirectory}creator-event-media-reuse/${a.userId}/${a.pageId}/${a.eventId}/${a.mediaId}/${runId}/`;
      await FileSystem.makeDirectoryAsync(runDirectory,{intermediates:true});current();
      // Persist only ownership/paths; never write access tokens or resumable HTTP data.
      await FileSystem.writeAsStringAsync(runDirectory+'attempt.json',JSON.stringify({version:1,attempt:a,runId,original:`original.${ext}`,readback:`readback.${ext}`}));current();
      const originalUri=runDirectory+`original.${ext}`,copyUri=runDirectory+`readback.${ext}`;
      const download=async(eventId:string,path:string,uri:string,phase:'reading-original'|'reading-copy')=>{
        await access();current();const source=await loadEventMediaSource(eventId,path,input.mimeType==='video/mp4'?'video':'image',scope);current();
        progress(phase);let downloaded=0;const downloadTask=FileSystem.createDownloadResumable(source.uri,uri,{headers:source.headers,cache:false,sessionType:FileSystem.FileSystemSessionType.FOREGROUND},p=>{
          if(controller.signal.aborted)return;
          if(!scope.isCurrent()||!Number.isSafeInteger(p.totalBytesWritten)||p.totalBytesWritten<downloaded||p.totalBytesWritten>input.byteSize){cancel(Error('The media transfer could not be verified.'));return;}
          if(p.totalBytesWritten>downloaded){downloaded=p.totalBytesWritten;resetStall();}try{progress(phase,p.totalBytesWritten);}catch(error){cancel(error instanceof Error?error:new Error('Media transfer stopped.'));}
        });
        task=downloadTask;resetStall();let result;
        try{result=await runTransport(()=>downloadTask.downloadAsync());current();}finally{if(stallTimer)clearTimeout(stallTimer);task=null;}
        if(!result||result.status!==200||result.uri!==uri||result.mimeType?.split(';')[0].trim().toLowerCase()!==input.mimeType)throw Error('The original media could not be downloaded. Keep the saved attempt.');
        const file=await FileSystem.getInfoAsync(uri);current();
        if(!file.exists||file.isDirectory||file.size!==input.byteSize)throw Error('The downloaded media size changed. Keep the saved attempt.');
      };
      await download(a.source.eventId,a.source.objectName,originalUri,'reading-original');
      // Refresh committed object presence immediately before a possible upload.
      receipt=await getPageEventMediaReuseAttempt(a.pageId,a.eventId,a,scope);current();
      if(!receipt||receipt.abandonedAt||receipt.readyAt&&!receipt.objectPresent)throw Error('Check the original media attempt before continuing.');
      if(!receipt.objectPresent){
        await access();current();
        const session=await supabase.auth.getSession();current();
        if(session.error||session.data.session?.user.id!==scope.userId||!session.data.session.access_token)throw new CreatorPageScopeExpired();
        progress('uploading');let uploaded=0;const uploadTask=FileSystem.createUploadTask(`${SUPABASE_URL}/storage/v1/object/creator-event-media/${pageEventMediaPath(a.eventId,input)}`,originalUri,
          {httpMethod:'POST',uploadType:FileSystem.FileSystemUploadType.BINARY_CONTENT,sessionType:FileSystem.FileSystemSessionType.FOREGROUND,headers:{Authorization:`Bearer ${session.data.session.access_token}`,apikey:SUPABASE_ANON_KEY,'Content-Type':input.mimeType,'x-upsert':'false'}},p=>{
            if(controller.signal.aborted)return;
            if(!scope.isCurrent()||!Number.isSafeInteger(p.totalBytesSent)||p.totalBytesSent<uploaded||p.totalBytesSent>input.byteSize){cancel();return;}
            if(p.totalBytesSent>uploaded){uploaded=p.totalBytesSent;resetStall();}try{progress('uploading',p.totalBytesSent);}catch(error){cancel(error instanceof Error?error:new Error('Media transfer stopped.'));}
          });
        task=uploadTask;resetStall();let result;
        try{result=await runTransport(()=>uploadTask.uploadAsync());current();}finally{if(stallTimer)clearTimeout(stallTimer);task=null;}
        if(!result||result.status<200||result.status>=300)throw Error('The upload was not confirmed. Check the original attempt before retrying.');
      }
      await download(a.eventId,pageEventMediaPath(a.eventId,input),copyUri,'reading-copy');
      progress('verifying');await verifyEventMediaFileCopy({originalUri,copyUri,byteSize:input.byteSize,mimeType:input.mimeType},scope,controller.signal);current();
      await access();current();progress('confirming');
      const confirmed=await completePageEventMediaReuse(a.pageId,a.eventId,a,scope,controller.signal);current();
      // Preserve files and intent for attachment/CAS recovery. Cleanup is a distinct,
      // account-owned step once attachment or explicit abandonment is confirmed.
      return {receipt:confirmed,runDirectory,originalUri,copyUri};
    }finally{
      if(stallTimer)clearTimeout(stallTimer);
      appSubscription.remove();authSubscription.unsubscribe();finished=true;if(!pendingTransports.size)release();
    }
  })();
  return {done,cancel:()=>cancel()};
}
