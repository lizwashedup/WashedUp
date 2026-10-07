import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { TextInput } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useTopicComposerDraft } from './useTopicComposerDraft';
import { useChatMentionFocus } from './useChatMentionFocus';
import { checkTopicComposerAttempt, verifyTopicComposerTarget } from '../lib/topicComposerDraft';
import { addChatMentionReference, rebaseChatMentions } from '../lib/chatMentionIdentity';
import { findMentionMembers, type MentionMember } from '../lib/chatMentions';
import { insertMentionAt, mentionQueryAt } from '../lib/communityChatUi';
import { getBroadcastReplyMembers, sendBroadcastReply, type CommunityOperationScope } from '../lib/communityChat';
import { requestWithDeadline } from '../lib/requestWithDeadline';
import { friendlyError } from '../lib/friendlyError';

let nextReplyComposerVisit=0;
/** One durable reply composer per parent/account; hidden message rows do no draft/member reads. */
export function useCommunityReplyComposer(parentId: string, parentScope: CommunityOperationScope | undefined, visible: boolean,
  onSent: () => void) {
  const visit = useMemo(()=>({id:++nextReplyComposerVisit}),[parentId,parentScope,visible]);
  const active = useRef<object|null>(null);
  const current = useCallback(()=>visible && active.current===visit && !!parentScope?.isCurrent(),[visible,visit,parentScope]);
  useLayoutEffect(()=>{active.current=visit;return()=>{if(active.current===visit)active.current=null;};},[visit]);
  const owner=useMemo(()=>visible && parentScope?{userId:parentScope.userId,isCurrent:current}:null,[visible,parentScope,current]);
  const room=useMemo(()=>({kind:'reply' as const,id:parentId}),[parentId]);
  const composer=useTopicComposerDraft(room,owner);
  const input=useRef<TextInput>(null), caret=useRef(0), textRef=useRef('');
  const focus=useChatMentionFocus(input,current);
  const [failure,setFailure]=useState<string|null>(null);
  const [query,setQuery]=useState<string|null>(null),[sending,setSending]=useState(false);
  const attemptRef=useRef<object|null>(null);
  const text=composer.draft.text;
  textRef.current=text;
  useLayoutEffect(()=>{attemptRef.current=null;setSending(false);setQuery(null);setFailure(null);caret.current=0;},[visit]);
  const members=useQuery({queryKey:['broadcast-reply-members',parentId,owner?.userId,visit.id],enabled:!!owner&&query!==null,retry:false,
    queryFn:async({signal})=>{let live=true;const scope={userId:owner!.userId,isCurrent:()=>live&&current()&&!signal.aborted};
      try{return await requestWithDeadline(getBroadcastReplyMembers(parentId,scope),12_000);}finally{live=false;}}});
  const change=(value:string)=>{
    if(!current()||!composer.ready||composer.error)return;
    const position=caret.current>=textRef.current.length?value.length:Math.min(caret.current,value.length);
    caret.current=position;textRef.current=value;
    composer.change({text:value,mentions:composer.draft.mentions?rebaseChatMentions(composer.draft.mentions,value):null});
    setQuery(mentionQueryAt(value,position));
  };
  const select=(member:MentionMember)=>{
    if(!current()||!composer.ready||composer.error||!member.first_name||!members.data?.some(row=>row.id===member.id&&row.first_name===member.first_name))return;
    const value=textRef.current,query=mentionQueryAt(value,caret.current);if(query===null)return;
    const start=caret.current-query.length-1,inserted=insertMentionAt(value,caret.current,member.first_name);
    composer.change({text:inserted.text,mentions:addChatMentionReference(inserted.text,composer.draft.mentions??null,member.id,member.first_name,start)});
    textRef.current=inserted.text;caret.current=inserted.caret;setQuery(null);focus(inserted.caret);
  };
  const send=async(checkOnly=false)=>{
    if(!owner||!current()||attemptRef.current||!composer.ready||composer.error||(!composer.draft.attempt&&!textRef.current.trim()))return;
    const token={};attemptRef.current=token;setSending(true);setFailure(null);
    const scope={userId:owner.userId,isCurrent:()=>current()&&attemptRef.current===token};
    try{
      const previous=composer.draft.attempt;
      if(checkOnly&&!previous)return;
      const attempt=previous??await composer.prepare();
      if(!scope.isCurrent())return;
      const confirmed=previous?await checkTopicComposerAttempt(room,attempt,scope):false;
      if(!confirmed){
        if(checkOnly){setFailure('Your reply is kept. Retry the original when you’re ready.');return;}
        if(previous)await verifyTopicComposerTarget(room,attempt,scope);
        await requestWithDeadline(sendBroadcastReply(parentId,attempt.text,scope,attempt.id,attempt.mentions??null),12_000);
      }
      if(!scope.isCurrent())return;
      await composer.finish(attempt);
      if(!scope.isCurrent())return;
      setQuery(null);onSent();
    }catch(error){if(scope.isCurrent())setFailure(friendlyError(error,'Your reply is kept. Check the original before trying again.'));}
    finally{if(attemptRef.current===token){attemptRef.current=null;if(current())setSending(false);}}
  };
  return {composer,text,sending,failure,input,query,change,select,send,
    candidates:findMentionMembers(members.data??[],query,owner?.userId),membersLoading:members.isFetching,membersError:members.isError,
    retryMembers:()=>{if(current())void members.refetch({cancelRefetch:false});},closeMentions:()=>{if(current())setQuery(null);},
    selection:(position:number)=>{if(current()){caret.current=position;setQuery(mentionQueryAt(textRef.current,position));}},
    sendDisabled:!composer.ready||composer.error||sending||!!composer.draft.attempt||!text.trim(),
  };
}
export type CommunityReplyComposerState=ReturnType<typeof useCommunityReplyComposer>;
