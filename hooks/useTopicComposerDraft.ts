import {useCallback,useEffect,useRef,useState} from 'react';
import {requestWithDeadline} from '../lib/requestWithDeadline';
import type {CommunityOperationScope} from '../lib/communityChat';
import {emptyTopicComposer,readTopicComposer,saveTopicComposer,prepareTopicComposer,finishTopicComposer,verifyTopicComposerTarget,type TopicComposerRoom,type TopicComposerDraft,type TopicDraftAttempt} from '../lib/topicComposerDraft';
export function useTopicComposerDraft(topicId:TopicComposerRoom|undefined,owner:CommunityOperationScope|null){
 const ref=useRef<{owner:CommunityOperationScope|null;draft:TopicComposerDraft;ready:boolean;error:boolean}>({owner:null,draft:emptyTopicComposer(),ready:false,error:false});
 const [state,setState]=useState(ref.current);const epoch=useRef(0),revision=useRef(0);
 const publish=useCallback((value:typeof state)=>{ref.current=value;setState(value);},[]);
 const load=useCallback(async()=>{if(!topicId||!owner?.isCurrent())return;const stamp=++epoch.current;try{const r=await requestWithDeadline((async()=>{if(ref.current.owner===owner&&ref.current.ready&&ref.current.error)await saveTopicComposer(topicId,owner,ref.current.draft);return readTopicComposer(topicId,owner);})(),12_000);if(owner.isCurrent()&&stamp===epoch.current)publish({owner,draft:r.draft,ready:true,error:r.unsaved});}catch{if(owner.isCurrent()&&stamp===epoch.current)publish({...ref.current,owner,error:true});}},[topicId,owner,publish]);
 useEffect(()=>{++epoch.current;revision.current++;publish({owner,draft:emptyTopicComposer(),ready:false,error:false});void Promise.resolve().then(load);return()=>{++epoch.current;};},[load,owner,publish]);
 const persist=useCallback(async(draft:TopicComposerDraft)=>{if(!topicId||!owner?.isCurrent())throw Error('This conversation visit changed.');const version=++revision.current;publish({owner,draft,ready:true,error:false});// Bound only the UI waiter; the underlying per-room storage queue stays ordered.
 try{await requestWithDeadline(saveTopicComposer(topicId,owner,draft),12_000);}catch(error){if(owner.isCurrent()&&ref.current.owner===owner&&version===revision.current)publish({...ref.current,error:true});throw error;}},[topicId,owner,publish]);
 const change=useCallback((patch:Partial<Omit<TopicComposerDraft,'attempt'>>)=>{if(!owner?.isCurrent()||ref.current.owner!==owner||!ref.current.ready)return;void persist({...ref.current.draft,...patch}).catch(()=>undefined);},[owner,persist]);
 const prepare=useCallback(async()=>{
  if(!topicId||!owner?.isCurrent()||ref.current.owner!==owner||!ref.current.ready||ref.current.error)throw Error('Check your saved message first.');
  const existing=ref.current.draft.attempt;
  const attempt=prepareTopicComposer(ref.current.draft);
  // A refused new target has never reached transport. Keep its editable draft,
  // rather than recording it as an uncertain send that cannot be corrected.
  if(!existing)await verifyTopicComposerTarget(topicId,attempt,owner);
  if(!owner.isCurrent()||ref.current.owner!==owner)throw Error('This conversation visit changed.');
  try{await persist({...ref.current.draft,attempt});}
  catch(error){if(owner.isCurrent()&&ref.current.owner===owner&&ref.current.draft.attempt===attempt)publish({...ref.current,error:true});throw error;}
  if(!owner.isCurrent())throw Error('This conversation visit changed.');
  return attempt;
 },[topicId,owner,persist,publish]);
 const finish=useCallback(async(attempt:TopicDraftAttempt)=>{if(!owner?.isCurrent()||ref.current.owner!==owner)return;// Storage cleanup follows a confirmed receipt. Keep recovery visible without
 // turning an already-sent message back into an uncertain send.
 try{await persist(finishTopicComposer(ref.current.draft,attempt));}
 catch{if(owner.isCurrent()&&ref.current.owner===owner)publish({...ref.current,error:true});}},[owner,persist,publish]);
 const owned=state.owner===owner;
 return {draft:owned?state.draft:emptyTopicComposer(),ready:owned&&state.ready,error:owned&&state.error,change,prepare,finish,retry:load};
}
