/** Exact-source adapters for protected cover/template/duplicate reuse. */
import {supabase} from './supabase';
import {CreatorPageScopeExpired,type CreatorPageScope} from './creatorPageReview';
import {assertPageEventMediaAccount,mediaUUID,pageEventMediaPath,parsePageEventMediaReceipt,validPageEventMediaInput,
  type PageEventMediaInput,type PageEventMediaPurpose,type PageEventMediaReceipt} from './creatorPageEventMedia';
export interface PageEventMediaSource extends PageEventMediaInput {pageId:string;eventId:string;objectName:string}
export interface PageEventMediaReuseIntent {mediaId:string;purpose:PageEventMediaPurpose;source:PageEventMediaSource}
export interface PageEventMediaReuseReceipt extends PageEventMediaReceipt {source:PageEventMediaSource}
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
export function parsePageEventMediaSource(raw:unknown,pageId:string,eventId:string,mediaId:string):PageEventMediaSource {
  if(!object(raw)||!mediaUUID(pageId)||!mediaUUID(eventId)||raw.page_id!==pageId||raw.event_id!==eventId||raw.media_id!==mediaId)throw Error('The source media could not be confirmed.');
  const input={mediaId:raw.media_id,purpose:raw.purpose,byteSize:raw.byte_size,mimeType:raw.mime_type,contentDigest:raw.content_digest};
  if(!validPageEventMediaInput(input)||raw.object_name!==pageEventMediaPath(eventId,input))throw Error('The source media could not be confirmed.');
  return {...input,pageId,eventId,objectName:raw.object_name as string};
}
export async function getPageEventMediaSource(pageId:string,eventId:string,mediaId:string,scope:CreatorPageScope) {
  if(!mediaUUID(pageId)||!mediaUUID(eventId)||!mediaUUID(mediaId))throw Error('This source media is unavailable.');
  await assertPageEventMediaAccount(scope);
  const {data,error}=await supabase.rpc('get_creator_page_event_media_source',{p_page_id:pageId,p_event_id:eventId,p_media_id:mediaId});
  await assertPageEventMediaAccount(scope);if(error)throw error;
  return parsePageEventMediaSource(data,pageId,eventId,mediaId);
}
export function pageEventMediaReuseInput(intent:PageEventMediaReuseIntent):PageEventMediaInput {
  const s=intent.source;
  if(!s||!mediaUUID(s.pageId)||!mediaUUID(s.eventId)||!validPageEventMediaInput(s)||s.objectName!==pageEventMediaPath(s.eventId,s)||s.mediaId===intent.mediaId)throw Error('This media reuse attempt is unavailable.');
  const input={mediaId:intent.mediaId,purpose:intent.purpose,byteSize:s.byteSize,mimeType:s.mimeType,contentDigest:s.contentDigest};
  if(!validPageEventMediaInput(input))throw Error('This media reuse attempt is unavailable.');
  return input;
}
async function call(name:'get_creator_page_event_media_reuse_attempt'|'reserve_creator_page_event_media_reuse'|'cancel_creator_page_event_media_reuse',pageId:string,eventId:string,intent:PageEventMediaReuseIntent,scope:CreatorPageScope) {
  if(!mediaUUID(pageId)||!mediaUUID(eventId))throw Error('This media reuse attempt is unavailable.');
  // Capture intent before any async boundary; extra caller/file fields never cross RPC.
  const input=pageEventMediaReuseInput(intent),s=intent.source;
  const source:PageEventMediaSource={mediaId:s.mediaId,purpose:s.purpose,byteSize:s.byteSize,mimeType:s.mimeType,contentDigest:s.contentDigest,pageId:s.pageId,eventId:s.eventId,objectName:s.objectName};
  await assertPageEventMediaAccount(scope);
  const args={p_page_id:pageId,p_event_id:eventId,p_media_id:input.mediaId,p_source_page_id:source.pageId,p_source_event_id:source.eventId,p_source_media_id:source.mediaId,...(name!=='get_creator_page_event_media_reuse_attempt'?{p_purpose:input.purpose}:{}),...(name==='cancel_creator_page_event_media_reuse'?{p_byte_size:input.byteSize,p_mime_type:input.mimeType,p_content_digest:input.contentDigest}:{})};
  const {data,error}=await supabase.rpc(name,args);await assertPageEventMediaAccount(scope);if(error)throw error;
  if(data===null&&name==='get_creator_page_event_media_reuse_attempt')return null;
  const receipt=parsePageEventMediaReceipt(data,pageId,eventId,input,scope);
  if(!object(data)||data.source_media_id!==source.mediaId||data.source_page_id!==source.pageId||data.source_event_id!==source.eventId||data.source_object_name!==source.objectName)throw Error('The original media reuse attempt could not be confirmed.');
  if(name==='cancel_creator_page_event_media_reuse'&&!receipt.attached&&!receipt.abandonedAt)throw Error('The original media cancellation still needs checking.');
  return {...receipt,source};
}
export const getPageEventMediaReuseAttempt=(pageId:string,eventId:string,intent:PageEventMediaReuseIntent,scope:CreatorPageScope)=>call('get_creator_page_event_media_reuse_attempt',pageId,eventId,intent,scope);
export async function reservePageEventMediaReuse(pageId:string,eventId:string,intent:PageEventMediaReuseIntent,scope:CreatorPageScope){return(await call('reserve_creator_page_event_media_reuse',pageId,eventId,intent,scope))!;}

/** Explicit stop only; caller retains the original journal until terminal cleanup. */
export async function cancelPageEventMediaReuse(pageId:string,eventId:string,intent:PageEventMediaReuseIntent,scope:CreatorPageScope){return(await call('cancel_creator_page_event_media_reuse',pageId,eventId,intent,scope))!;}

/** Trusted server verification is the only completion path for a reused object.
 * Unknown results keep the caller's original durable intent; never fall back to
 * direct completion or automatically repeat the invocation.
 */
export async function completePageEventMediaReuse(pageId:string,eventId:string,intent:PageEventMediaReuseIntent,scope:CreatorPageScope,signal?:AbortSignal):Promise<PageEventMediaReceipt>{
  const input=pageEventMediaReuseInput(intent),s=intent.source;
  const original:PageEventMediaReuseIntent={mediaId:input.mediaId,purpose:input.purpose,source:{mediaId:s.mediaId,pageId:s.pageId,eventId:s.eventId,purpose:s.purpose,byteSize:s.byteSize,mimeType:s.mimeType,contentDigest:s.contentDigest,objectName:s.objectName}};
  const current=()=>{if(signal?.aborted||!scope.isCurrent())throw new CreatorPageScopeExpired();};current();
  const receipt=await getPageEventMediaReuseAttempt(pageId,eventId,original,scope);current();
  if(!receipt||receipt.abandonedAt)throw Error('Use the original saved media reuse attempt.');
  const session=await supabase.auth.getSession();current();
  if(session.error||session.data.session?.user.id!==scope.userId||!session.data.session.access_token)throw new CreatorPageScopeExpired();
  const {data,error}=await supabase.functions.invoke('verify-event-media-reuse',{
    body:{pageId,eventId,mediaId:input.mediaId},headers:{Authorization:`Bearer ${session.data.session.access_token}`},signal,timeout:55000,
  });
  current();await assertPageEventMediaAccount(scope);current();if(error)throw error;
  const confirmed=parsePageEventMediaReceipt(data,pageId,eventId,input,scope);
  if(!confirmed.readyAt||!confirmed.objectPresent||confirmed.abandonedAt)throw Error('The original media reuse is not confirmed.');
  return confirmed;
}
