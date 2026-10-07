import {useEffect,useMemo,useRef,useState} from 'react';
import type {CreatorPageScope} from '../lib/creatorPageReview';
import type {EventMediaGuard} from '../lib/eventMediaGuard';
import {preparePageEventMediaAttempt,readPageEventMediaAttempts,clearPageEventMediaAttempt,type PageEventMediaAttempt} from '../lib/creatorPageEventMediaAttempt';
import {getPageEventMediaAttempt,reservePageEventMedia,abandonPageEventMedia} from '../lib/creatorPageEventMedia';
import {startPageEventMediaTransfer,type PageEventMediaTransferProgress} from '../lib/creatorPageEventMediaTransfer';

/** Existing cover selection plus explicit account-owned recovery; no automatic retry. */
export function useCreatorPageMediaUpload(pageId:string|undefined,eventId:string|undefined,scope:CreatorPageScope|undefined,guard:EventMediaGuard|undefined,
  onReady:(reference:string)=>void,onDiscard:(reference:string)=>void,savedReferences:readonly string[],purpose:'cover'|'image'='cover'){
  const noun=purpose==='cover'?'cover':'photo';
  const referenceFor=(objectName:string)=>purpose==='cover'?'creator-event-media:'+objectName:objectName;
  const savedKey=JSON.stringify(savedReferences);
  const visit=useMemo(()=>({}),[pageId,eventId,scope,purpose]),active=useRef(visit);active.current=visit;
  const mounted=useRef(false),lock=useRef<object|null>(null),task=useRef<ReturnType<typeof startPageEventMediaTransfer>|null>(null);
  const latest=useRef({guard,onReady,onDiscard});latest.current={guard,onReady,onDiscard};
  const [attempts,setAttempts]=useState<PageEventMediaAttempt[]>([]),[loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[progress,setProgress]=useState<PageEventMediaTransferProgress|null>(null);
  const current=(owned:object)=>mounted.current&&active.current===owned&&!!scope?.isCurrent();
  const assert=(owned:object)=>{if(!current(owned)||!pageId||!eventId||!scope)throw Error(`This ${noun} visit ended.`);};
  async function read(owned:object){
    assert(owned);const stored=await readPageEventMediaAttempts(pageId!,eventId!,scope!);assert(owned);
    const covers=stored.filter(a=>a.purpose===purpose);setAttempts(covers);return covers;
  }
  async function refresh(){
    if(!pageId||!eventId||!scope||lock.current)return;
    const owned=visit;setLoading(true);
    try{await read(owned);if(current(owned))setError(null);}catch{if(current(owned))setError(`Could not check saved ${noun} uploads. Try checking again.`);}
    finally{if(current(owned))setLoading(false);}
  }
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;task.current?.cancel();};},[]);
  useEffect(()=>{
    setAttempts([]);setError(null);setBusy(false);setProgress(null);setLoading(false);
    if(pageId&&eventId&&scope)void refresh();
    return()=>{task.current?.cancel();};
  },[visit]);
  // Delete only a local copy whose exact remote attachment is confirmed. An
  // uncertain save, another cover, or failed cleanup retains the original intent.
  useEffect(()=>{
    if(!savedReferences.length||!pageId||!eventId||!scope||lock.current)return;
    const owned=visit;let cancelled=false;
    void (async()=>{
      const entries=await readPageEventMediaAttempts(pageId,eventId,scope);assert(owned);
      for(const a of entries.filter(a=>a.purpose===purpose)){
        if(cancelled||lock.current)return;
        const r=await getPageEventMediaAttempt(pageId,eventId,a,scope);assert(owned);
        if(r?.attached&&r.readyAt&&r.objectPresent&&!r.abandonedAt&&savedReferences.includes(referenceFor(r.objectName))){
          await clearPageEventMediaAttempt(a,scope);assert(owned);
        }
      }
      if(!cancelled)await read(owned);
    })().catch(()=>{if(!cancelled&&current(owned))setError(`The ${noun} may be saved, but its local upload still needs checking.`);});
    return()=>{cancelled=true;};
  },[visit,savedKey,busy]);

  async function work<T>(action:(owned:object)=>Promise<T>):Promise<T>{
    if(lock.current)throw Error(`A ${noun} upload is already in progress.`);
    const owned=visit;assert(owned);lock.current=owned;setBusy(true);setError(null);
    try{return await action(owned);}catch(error){if(current(owned))setError(`Could not finish this ${noun} upload. Your saved attempt is available below.`);throw error;}
    finally{
      if(lock.current===owned)lock.current=null;
      if(current(owned)){setBusy(false);setProgress(null);try{await read(owned);}catch{if(current(owned))setError(`Could not check the saved ${noun} upload. Try checking again.`);}}
    }
  }
  async function transfer(a:PageEventMediaAttempt,owned:object,notify=true){
    await latest.current.guard?.check();assert(owned);
    const running=startPageEventMediaTransfer(a,scope!,value=>{if(current(owned))setProgress(value);});task.current=running;
    try{
      const receipt=await running.done;assert(owned);await latest.current.guard?.check();assert(owned);
      const reference=referenceFor(receipt.objectName);if(notify)latest.current.onReady(reference);return reference;
    }finally{if(task.current===running)task.current=null;}
  }
  const upload=(uri:string)=>work(async owned=>{
    await latest.current.guard?.check();assert(owned);
    const prepared=await preparePageEventMediaAttempt(pageId!,eventId!,purpose,'image/jpeg',uri,scope!);assert(owned);
    return transfer(prepared.attempt,owned,purpose==='cover');
  });
  const retry=(a:PageEventMediaAttempt)=>work(owned=>transfer(a,owned));
  const discard=(a:PageEventMediaAttempt)=>work(async owned=>{
    await latest.current.guard?.check();assert(owned);
    let original=await getPageEventMediaAttempt(pageId!,eventId!,a,scope!);assert(owned);
    // An authoritative missing receipt permits creating only this original
    // reservation/tombstone so cleanup never forgets an uncertain remote write.
    if(!original){original=await reservePageEventMedia(pageId!,eventId!,a,scope!);assert(owned);}
    if(!original.abandonedAt)await abandonPageEventMedia(pageId!,eventId!,a,scope!);assert(owned);
    await clearPageEventMediaAttempt(a,scope!);assert(owned);
    latest.current.onDiscard(referenceFor(original.objectName));
  });
  return {attempts,loading,busy,error,progress,upload,retry,discard,refresh,isBusy:()=>!!lock.current,cancel:()=>task.current?.cancel()};
}
