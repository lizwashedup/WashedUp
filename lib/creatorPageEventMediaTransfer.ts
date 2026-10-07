/** Explicit original upload; leaves its durable intent until attachment or abandonment. */
import {AppState} from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import {supabase,SUPABASE_URL,SUPABASE_ANON_KEY} from './supabase';
import {CreatorPageScopeExpired,type CreatorPageScope} from './creatorPageReview';
import {getPageEventSaveState} from './creatorPageEventSave';
import {assertPageEventMediaAccount,mediaUUID,pageEventMediaPath,validPageEventMediaInput,getPageEventMediaAttempt,reservePageEventMedia,completePageEventMedia} from './creatorPageEventMedia';
import {readPageEventMediaAttempts,verifyPageEventMediaFile,type PageEventMediaAttempt} from './creatorPageEventMediaAttempt';
import {claimPageEventMediaReuseWork} from './creatorPageEventMediaReuseWork';

export interface PageEventMediaTransferProgress {phase:'checking'|'uploading'|'confirming';bytes:number;totalBytes:number}
export function startPageEventMediaTransfer(attempt:PageEventMediaAttempt,scope:CreatorPageScope,onProgress?:(value:PageEventMediaTransferProgress)=>void){
  const a:PageEventMediaAttempt=JSON.parse(JSON.stringify(attempt));
  if(a.version!==1||!validPageEventMediaInput(a)||![a.pageId,a.eventId,a.userId].every(mediaUUID)||a.userId!==scope.userId)throw Error('Use the original saved media attempt.');
  const controller=new AbortController();let failure:Error|null=null,task:{cancelAsync():Promise<void>}|null=null,stallTimer:ReturnType<typeof setTimeout>|null=null;
  const cancel=(error:Error=new CreatorPageScopeExpired())=>{if(controller.signal.aborted)return;failure=error;controller.abort();if(stallTimer)clearTimeout(stallTimer);void task?.cancelAsync().catch(()=>{});};
  const current=()=>{if(!scope.isCurrent()||AppState.currentState!=='active')cancel();if(controller.signal.aborted)throw failure??new CreatorPageScopeExpired();};
  current();const release=claimPageEventMediaReuseWork(a.userId,a.pageId,a.eventId,a.mediaId);
  let finished=false;const pendingTransports=new Set<Promise<unknown>>();
  const runTransport=async<T>(start:()=>Promise<T>):Promise<T>=>{
    current();const pending=start();pendingTransports.add(pending);
    const settled=()=>{pendingTransports.delete(pending);if(finished&&!pendingTransports.size)release();};void pending.then(settled,settled);
    let listener=()=>{};const cancelled=new Promise<never>((_,reject)=>{listener=()=>reject(failure??new CreatorPageScopeExpired());controller.signal.addEventListener('abort',listener,{once:true});if(controller.signal.aborted)listener();});
    try{return await Promise.race([pending,cancelled]);}finally{controller.signal.removeEventListener('abort',listener);}
  };
  const resetStall=()=>{if(stallTimer)clearTimeout(stallTimer);stallTimer=setTimeout(()=>cancel(Error('The upload stopped responding. Check the saved attempt before retrying.')),60_000);};
  const progress=(phase:PageEventMediaTransferProgress['phase'],bytes=0)=>{current();onProgress?.({phase,bytes,totalBytes:a.byteSize});};
  const appSubscription=AppState.addEventListener('change',state=>{if(state!=='active')cancel();});
  const {data:{subscription:authSubscription}}=supabase.auth.onAuthStateChange((event,session)=>{
    if(event==='INITIAL_SESSION'&&session?.user.id===scope.userId&&scope.isCurrent())return;cancel();
  });
  const done=(async()=>{
    try{
      progress('checking');const saved=await readPageEventMediaAttempts(a.pageId,a.eventId,scope);current();
      if(!saved.some(v=>JSON.stringify(v)===JSON.stringify(a)))throw Error('Use the original saved media attempt.');
      const access=async()=>{await assertPageEventMediaAccount(scope);current();const state=await getPageEventSaveState(a.pageId,a.eventId,scope);current();if(!['Draft','Live'].includes(state.status))throw Error('This event is closed.');};
      await access();let receipt=await getPageEventMediaAttempt(a.pageId,a.eventId,a,scope);current();
      if(receipt?.abandonedAt||receipt?.readyAt&&!receipt.objectPresent)throw Error('Check the original media attempt before continuing.');
      if(!receipt){receipt=await reservePageEventMedia(a.pageId,a.eventId,a,scope);current();}
      // A committed remote object is never uploaded again. Its server-side byte
      // proof supports recovery even if the local file has since disappeared.
      if(!receipt.objectPresent){
        const uri=await verifyPageEventMediaFile(a,scope);current();await access();
        const session=await supabase.auth.getSession();current();
        if(session.error||session.data.session?.user.id!==scope.userId||!session.data.session.access_token)throw new CreatorPageScopeExpired();
        // Refresh immediately before dispatch; preserve any upload that committed
        // while the original receipt was being checked.
        receipt=await getPageEventMediaAttempt(a.pageId,a.eventId,a,scope);current();
        if(!receipt||receipt.abandonedAt||receipt.readyAt&&!receipt.objectPresent)throw Error('Check the saved upload before continuing.');
        if(!receipt.objectPresent){
          progress('uploading');let uploaded=0;
          const uploadTask=FileSystem.createUploadTask(`${SUPABASE_URL}/storage/v1/object/creator-event-media/${pageEventMediaPath(a.eventId,a)}`,uri,
            {httpMethod:'POST',uploadType:FileSystem.FileSystemUploadType.BINARY_CONTENT,sessionType:FileSystem.FileSystemSessionType.FOREGROUND,
              headers:{Authorization:`Bearer ${session.data.session.access_token}`,apikey:SUPABASE_ANON_KEY,'Content-Type':a.mimeType,'x-upsert':'false'}},p=>{
              if(controller.signal.aborted)return;
              if(!scope.isCurrent()||!Number.isSafeInteger(p.totalBytesSent)||p.totalBytesSent<uploaded||p.totalBytesSent>a.byteSize){cancel();return;}
              if(p.totalBytesSent>uploaded){uploaded=p.totalBytesSent;resetStall();}
              try{progress('uploading',p.totalBytesSent);}catch(error){cancel(error instanceof Error?error:Error('Upload stopped.'));}
            });
          task=uploadTask;resetStall();let result;
          try{result=await runTransport(()=>uploadTask.uploadAsync());current();}finally{if(stallTimer)clearTimeout(stallTimer);task=null;}
          if(!result||result.status<200||result.status>=300)throw Error('The upload could not be confirmed. Check the original attempt before retrying.');
        }
      }
      await access();progress('confirming');const confirmed=await completePageEventMedia(a.pageId,a.eventId,a,scope,controller.signal);current();return confirmed;
    }finally{
      if(stallTimer)clearTimeout(stallTimer);appSubscription.remove();authSubscription.unsubscribe();finished=true;if(!pendingTransports.size)release();
    }
  })();
  return {done,cancel:()=>cancel()};
}
