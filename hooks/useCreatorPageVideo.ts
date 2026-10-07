import {useEffect,useMemo,useRef,useState} from 'react';
import type {CreatorPageScope} from '../lib/creatorPageReview';
import type {EventMediaGuard} from '../lib/eventMediaGuard';
import type {DescriptionBlock} from '../lib/eventContent';
import {preparePageEventMediaAttempt,type PageEventMediaAttempt} from '../lib/creatorPageEventMediaAttempt';
import {pageEventMediaPath} from '../lib/creatorPageEventMedia';
import {startPageEventMediaTransfer,type PageEventMediaTransferProgress} from '../lib/creatorPageEventMediaTransfer';
import {createPageEventVideoDraft,choosePageEventVideoPoster,readPageEventVideoDrafts,readUnassignedPageVideoMedia,finishPageEventVideoDraft,discardPageEventVideoDraft,discardUnassignedPageVideoMedia,type PageEventVideoDraft} from '../lib/creatorPageVideoDraft';

export interface RecoveredPageVideo {path:string;localUri:string;ready:boolean;poster?:string}
/** Private video work behind the existing picker/frames, with explicit original-choice recovery. */
export function useCreatorPageVideo(pageId:string|undefined,eventId:string,scope:CreatorPageScope|undefined,guard:EventMediaGuard|undefined,savedBlocks:DescriptionBlock[]|undefined){
  const visit=useMemo(()=>({}),[pageId,eventId,scope]),latestVisit=useRef(visit);latestVisit.current=visit;
  const mounted=useRef(false),latestGuard=useRef(guard);latestGuard.current=guard;
  type Work={visit:object;cancelled:boolean;transfer?:ReturnType<typeof startPageEventMediaTransfer>};
  const active=useRef<Work|null>(null),selected=useRef<PageEventVideoDraft|null>(null),result=useRef<RecoveredPageVideo|null>(null);
  const [drafts,setDrafts]=useState<PageEventVideoDraft[]>([]),[unassigned,setUnassigned]=useState<PageEventMediaAttempt[]>([]),[busy,setBusy]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState<string|null>(null);
  const [progress,setProgress]=useState<{purpose:string;value:PageEventMediaTransferProgress}|null>(null);
  const current=(owned=visit)=>mounted.current&&latestVisit.current===owned&&!!scope?.isCurrent();
  const check=(w:Work)=>{if(!current(w.visit)||w.cancelled||active.current!==w)throw Error('This video visit ended.');};
  const cancel=()=>{const w=active.current;if(w&&!w.cancelled){w.cancelled=true;w.transfer?.cancel();}selected.current=null;result.current=null;};
  async function read(owned=visit){
    if(!pageId||!scope||!current(owned))throw Error('This video visit ended.');
    const entries=await readPageEventVideoDrafts(pageId,eventId,scope),orphans=await readUnassignedPageVideoMedia(pageId,eventId,scope);
    if(!current(owned))throw Error('This video visit ended.');setDrafts(entries);setUnassigned(orphans);return entries;
  }
  async function refresh(){
    if(!pageId||!scope||active.current)return;const owned=visit;setLoading(true);
    try{await read(owned);if(current(owned))setError(null);}catch{if(current(owned))setError('Could not check saved video uploads. Try checking again.');}finally{if(current(owned))setLoading(false);}
  }
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;cancel();};},[]);
  useEffect(()=>{selected.current=null;result.current=null;setDrafts([]);setUnassigned([]);setError(null);setProgress(null);setBusy(false);if(pageId&&scope)void refresh();return cancel;},[visit]);
  const savedKey=JSON.stringify(savedBlocks??[]);
  useEffect(()=>{
    if(!pageId||!scope||active.current)return;const owned=visit;let retired=false;
    void (async()=>{
      const entries=await readPageEventVideoDrafts(pageId,eventId,scope);
      for(const d of entries){
        if(retired||!current(owned)||active.current)return;
        if(d.choice==='pending')continue;
        const poster=d.posters.find(a=>a.mediaId===d.choice),path=pageEventMediaPath(eventId,d.video);
        if((savedBlocks??[]).some(b=>b.type==='video'&&b.path===path&&(poster?b.poster===pageEventMediaPath(eventId,poster):!b.poster))){await finishPageEventVideoDraft(d,scope);}
      }
      if(!retired&&current(owned))await read(owned);
    })().catch(()=>{if(!retired&&current(owned))setError('The video may be saved, but its local upload still needs checking.');});
    return()=>{retired=true;};
  },[visit,savedKey,busy]);
  function work<T>(action:(w:Work)=>Promise<T>){
    if(active.current)throw Error('A video action is already in progress.');
    if(!pageId||!scope||!current())throw Error('This video visit ended.');
    const w:Work={visit,cancelled:false};active.current=w;setBusy(true);setError(null);
    const done=(async()=>{
      try{await latestGuard.current?.check();check(w);return await action(w);}
      catch(e){if(current(w.visit)&&!w.cancelled)setError('Could not finish this video action. Its saved upload remains available below.');throw e;}
      finally{if(active.current===w)active.current=null;if(current(w.visit)){setBusy(false);setProgress(null);try{await read(w.visit);}catch{if(current(w.visit))setError('Could not check saved video uploads. Try checking again.');}}}
    })();
    return {done,cancel:()=>{w.cancelled=true;w.transfer?.cancel();}};
  }
  async function transfer(a:PageEventMediaAttempt,w:Work,onProgress?:(fraction:number)=>void){
    check(w);await latestGuard.current?.check();check(w);
    const task=startPageEventMediaTransfer(a,scope!,p=>{if(current(w.visit)&&!w.cancelled){setProgress({purpose:a.purpose,value:p});if(p.phase==='uploading')onProgress?.(p.bytes/p.totalBytes);}});w.transfer=task;
    try{const receipt=await task.done;check(w);return receipt;}finally{if(w.transfer===task)w.transfer=undefined;}
  }
  async function recover(d:PageEventVideoDraft,w:Work,onProgress?:(fraction:number)=>void){
    const entries=await readPageEventVideoDrafts(pageId!,eventId,scope!);check(w);
    if(!entries.some(a=>JSON.stringify(a)===JSON.stringify(d)))throw Error('Check the latest video choice.');
    selected.current=d;const video=await transfer(d.video,w,onProgress);let poster:string|undefined;
    if(d.choice!=='pending'&&d.choice!=='none'){
      const chosen=d.posters.find(a=>a.mediaId===d.choice);if(!chosen)throw Error('Check the saved poster choice.');
      poster=(await transfer(chosen,w)).objectName;
    }
    check(w);result.current={path:video.objectName,localUri:d.video.fileUri,ready:d.choice!=='pending',poster};return result.current;
  }
  const uploadVideo=(uri:string,onProgress:(fraction:number)=>void)=>work(async w=>{
    const prepared=await preparePageEventMediaAttempt(pageId!,eventId,'video','video/mp4',uri,scope!);check(w);
    const d=await createPageEventVideoDraft(prepared.attempt,scope!);check(w);return (await recover(d,w,onProgress)).path;
  });
  const uploadPoster=(uri:string)=>work(async w=>{
    const d=selected.current;if(!d)throw Error('Resume the saved video first.');
    const prepared=await preparePageEventMediaAttempt(pageId!,eventId,'poster','image/jpeg',uri,scope!);check(w);
    const chosen=await choosePageEventVideoPoster(d,prepared.attempt,scope!);check(w);selected.current=chosen;
    const receipt=await transfer(prepared.attempt,w);result.current={path:pageEventMediaPath(eventId,d.video),localUri:d.video.fileUri,ready:true,poster:receipt.objectName};return receipt.objectName;
  }).done;
  const withoutPoster=()=>work(async w=>{
    const d=selected.current;if(!d)throw Error('Resume the saved video first.');
    const chosen=await choosePageEventVideoPoster(d,null,scope!);check(w);selected.current=chosen;
    result.current={path:pageEventMediaPath(eventId,d.video),localUri:d.video.fileUri,ready:true};
  }).done;
  const resume=(d:PageEventVideoDraft,onProgress?:(fraction:number)=>void)=>work(w=>recover(d,w,onProgress));
  const resumeUnassigned=(a:PageEventMediaAttempt,onProgress?:(fraction:number)=>void)=>work(async w=>{
    const d=await createPageEventVideoDraft(a,scope!);check(w);return recover(d,w,onProgress);
  });
  const discard=(d:PageEventVideoDraft)=>work(async w=>{await discardPageEventVideoDraft(d,scope!);check(w);}).done;
  const discardUnassigned=(a:PageEventMediaAttempt)=>work(async w=>{
    await discardUnassignedPageVideoMedia(a,scope!);check(w);
  }).done;
  return {drafts,unassigned,busy,loading,error,progress,uploadVideo,uploadPoster,withoutPoster,resume,resumeUnassigned,discard,discardUnassigned,refresh,cancel,getResult:()=>result.current,isBusy:()=>!!active.current};
}
