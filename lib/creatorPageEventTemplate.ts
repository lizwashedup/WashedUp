/** Exact saved-source template attempts; no legacy insert or publication fallback. */
import {supabase} from './supabase';
import {CreatorPageScopeExpired,type CreatorPageScope} from './creatorPageReview';
import {planPageEventReuse,type PageEventReusePlan} from './creatorPageEventReusePlan';
import {mediaUUID} from './creatorPageEventMedia';
import type {OperatorEventFields} from './creatorEvents';
import {sameEventSaveVersion} from './eventSaveVersion';

export interface PageEventTemplateAttempt {
  pageId:string; eventId:string; templateId:string; name:string; expectedUpdatedAt:string;
}
export interface PageEventTemplate {
  id:string; userId:string; sourcePageId:string; sourceEventId:string; sourceUpdatedAt:string;
  name:string; communityId:string|null; createdAt:string; fields:OperatorEventFields; reusePlan:PageEventReusePlan;
}
const timestamp=(v:unknown):v is string=>typeof v==='string'&&Number.isFinite(Date.parse(v));
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
function current(scope:CreatorPageScope){if(!mediaUUID(scope.userId)||!scope.isCurrent())throw new CreatorPageScopeExpired();}
function target(pageId:string,eventId:string,templateId:string,scope:CreatorPageScope){
  current(scope);if(![pageId,eventId,templateId].every(mediaUUID))throw Error('Check the saved source event and template.');
}
async function account(scope:CreatorPageScope){
  current(scope);const {data,error}=await supabase.auth.getUser();current(scope);
  if(error)throw error;if(data.user?.id!==scope.userId)throw new CreatorPageScopeExpired();
}
async function rpc(name:string,args:Record<string,unknown>,scope:CreatorPageScope){
  await account(scope);const {data,error}=await supabase.rpc(name,args);await account(scope);
  if(error)throw error;return data as unknown;
}
function decode(raw:unknown,pageId:string,eventId:string,templateId:string,scope:CreatorPageScope):PageEventTemplate {
  if(!object(raw)||raw.id!==templateId||raw.user_id!==scope.userId||raw.source_page_id!==pageId||raw.source_event_id!==eventId
    ||!timestamp(raw.source_updated_at)||!timestamp(raw.created_at)||typeof raw.name!=='string'||!raw.name.trim()||raw.name.length>80
    ||!(raw.community_id===null||mediaUUID(raw.community_id))||!object(raw.fields)
    ||raw.fields.event_date!==''||raw.fields.start_time!==null||raw.fields.end_time!==null)throw Error('The saved template could not be confirmed.');
  const reusePlan=planPageEventReuse(pageId,eventId,raw.fields as unknown as OperatorEventFields);
  return {id:templateId,userId:scope.userId,sourcePageId:pageId,sourceEventId:eventId,sourceUpdatedAt:raw.source_updated_at,
    name:raw.name,communityId:raw.community_id,createdAt:raw.created_at,fields:reusePlan.fields,reusePlan};
}
/** Null means confirmed absence; revoked source access remains an error. */
export async function getPageEventTemplate(pageId:string,eventId:string,templateId:string,scope:CreatorPageScope){
  target(pageId,eventId,templateId,scope);
  const raw=await rpc('get_creator_page_event_template',{p_page_id:pageId,p_event_id:eventId,p_template_id:templateId},scope);
  return raw===null?null:decode(raw,pageId,eventId,templateId,scope);
}
/** Persist this exact attempt before dispatch. Server snapshots the saved event;
 * unsaved edits must first pass the existing complete event-save flow. */
export async function savePageEventTemplate(attempt:PageEventTemplateAttempt,scope:CreatorPageScope){
  // Capture the caller's identity/version before any asynchronous account work.
  const a={...attempt};target(a.pageId,a.eventId,a.templateId,scope);
  if(typeof a.name!=='string'||!a.name.trim()||a.name.trim().length>80||!timestamp(a.expectedUpdatedAt))throw Error('Check the template name and saved event.');
  const name=a.name.trim();
  const raw=await rpc('save_creator_page_event_template',{p_page_id:a.pageId,p_event_id:a.eventId,p_template_id:a.templateId,p_name:name,p_expected_updated_at:a.expectedUpdatedAt},scope);
  const saved=decode(raw,a.pageId,a.eventId,a.templateId,scope);
  if(saved.name!==name||!sameEventSaveVersion(saved.sourceUpdatedAt,a.expectedUpdatedAt))throw Error('The saved template does not match this attempt.');
  return saved;
}
