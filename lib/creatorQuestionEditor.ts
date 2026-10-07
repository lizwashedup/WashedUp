import { supabase } from './supabase';
import { assertTicketVisit, canReadCreatorTickets, ticketReadAuthorization } from './creatorTicketRead';
import { getQuestions, QUESTIONS_MAX, QUESTION_PROMPT_MAX, QUESTION_OPTIONS_MAX, QUESTION_TYPES_WITH_OPTIONS, QUESTION_TYPE_OPTIONS, type QuestionScope, type QuestionType, type TicketQuestion } from './ticketing';
import type { CreatorPageScope } from './creatorPageReview';
export interface QuestionDraft { prompt:string; qtype:QuestionType; options:string[]|null; required:boolean; scope:QuestionScope }
export class CreatorQuestionChanged extends Error {}
export class CreatorQuestionRejected extends Error {}
export interface CreatorQuestionDispatch {
  previouslyDispatched:boolean;
  beforeDispatch:()=>Promise<boolean>;
}
const editable=['prompt','qtype','options','required','scope'] as const;
const columns='id,event_id,prompt,qtype,options,required,scope,sort_order,is_active,created_at,updated_at';
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
export function questionDraftProblem(draft:QuestionDraft):string|null {
  if(!draft.prompt.trim() || draft.prompt.trim().length>QUESTION_PROMPT_MAX)return 'Write a question, up to 500 characters.';
  if(!QUESTION_TYPE_OPTIONS.some(type=>type.value===draft.qtype))return 'Choose an answer type.';
  if(!['per_order','per_attendee'].includes(draft.scope) || typeof draft.required!=='boolean')return 'Choose who answers and whether an answer is required.';
  if(QUESTION_TYPES_WITH_OPTIONS.includes(draft.qtype) && (!Array.isArray(draft.options) || draft.options.length<2 || draft.options.length>QUESTION_OPTIONS_MAX || draft.options.some(o=>typeof o!=='string'||!o.trim()||o.trim().length>200)))return 'Add 2 to 50 choices, each up to 200 characters.';
  return null;
}
/** Same question identity and answer records. Exact editable-field receipt; explicit retries retain the original identity. */
export async function saveCreatorQuestion(eventId:string,id:string,draft:QuestionDraft,baseline:TicketQuestion|null,scope:CreatorPageScope,write=true,dispatch?:CreatorQuestionDispatch):Promise<TicketQuestion> {
  const problem=questionDraftProblem(draft);if(problem)throw Error(problem);
  const value:QuestionDraft={...draft,prompt:draft.prompt.trim(),options:QUESTION_TYPES_WITH_OPTIONS.includes(draft.qtype)?draft.options!.map(o=>o.trim()):null};
  const authorization=(await ticketReadAuthorization(scope))!;
  if(!await canReadCreatorTickets(eventId,scope))throw Error('Your access to edit this question could not be confirmed.');
  const read=async()=>{assertTicketVisit(scope);const result=await supabase.from('ticket_questions').select(columns).eq('event_id',eventId).eq('id',id).maybeSingle().setHeader('Authorization',authorization);assertTicketVisit(scope);if(result.error)throw result.error;return result.data as (TicketQuestion & {is_active:boolean})|null;};
  const matches=(row:Awaited<ReturnType<typeof read>>)=>!!row&&row.id===id&&row.event_id===eventId&&row.is_active&&editable.every(k=>same(row[k],value[k]));
  const previous=await read();if(matches(previous))return previous!;
  if(!baseline&&previous)throw new CreatorQuestionChanged('This question has a saved version. Reopen it before editing.');
  if(baseline&&(!previous||!previous.is_active||previous.id!==baseline.id||previous.event_id!==baseline.event_id||editable.some(k=>!same(previous[k],baseline[k]))))throw new CreatorQuestionChanged('This question changed. Reopen the saved question before editing it.');
  if(!write)throw Error('The original save is not yet confirmed. Retry the same question when you’re ready.');
  const questions=baseline?[]:await getQuestions(eventId,true,scope);
  if(!baseline&&questions.length>=QUESTIONS_MAX){
    if(dispatch?.previouslyDispatched===false)throw new CreatorQuestionRejected('This event already has 11 active questions. Edit an existing question or remove one before adding another.');
    throw Error('This event already has 11 active questions. The original save still needs to be checked.');
  }
  // Persist before constructing/sending a mutation. A restored legacy pending draft is uncertain.
  if(dispatch&&!await dispatch.beforeDispatch())throw Error('Keep the original save on this device before trying again.');
  let rejected=false;
  assertTicketVisit(scope);
  try {
    let request=baseline ? supabase.from('ticket_questions').update({...value,updated_at:new Date().toISOString()}).eq('event_id',eventId).eq('id',id).eq('is_active',true)
      : supabase.from('ticket_questions').insert({id,event_id:eventId,...value,is_active:true,sort_order:questions.length});
    if(baseline)for(const key of editable){const old=baseline[key];request=old===null?request.is(key,null):request.eq(key,key==='options'?JSON.stringify(old):old);}
    const result=await request.select(columns).maybeSingle().setHeader('Authorization',authorization);assertTicketVisit(scope);
    if(!result.error&&matches(result.data as Awaited<ReturnType<typeof read>>))return result.data as TicketQuestion;
    // SQL integrity/check rejections abort this statement. Transport failures do not.
    rejected=typeof result.error?.code==='string'&&(/^23/.test(result.error.code)||result.error.code==='P0001');
  }catch {assertTicketVisit(scope);}
  const saved=await read();if(matches(saved))return saved!;
  const unchanged=baseline?!!saved&&saved.is_active&&editable.every(k=>same(saved[k],baseline[k])):saved===null;
  if(rejected&&dispatch?.previouslyDispatched===false&&unchanged)throw new CreatorQuestionRejected('This question couldn’t be saved. Review your question and try again.');
  throw Error('The save could not be confirmed. Your question is kept. Retry to check its saved status.');
}
