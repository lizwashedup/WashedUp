/** Strict adapter for private page-event uploads; no public URL or legacy fallback. */
import {supabase} from './supabase';
import {CreatorPageScopeExpired,type CreatorPageScope} from './creatorPageReview';
export const PAGE_EVENT_MEDIA_BUCKET='creator-event-media';
export type PageEventMediaPurpose='cover'|'image'|'video'|'poster';
export type PageEventMediaMime='image/jpeg'|'image/png'|'image/webp'|'video/mp4';
export interface PageEventMediaInput {mediaId:string;purpose:PageEventMediaPurpose;byteSize:number;mimeType:PageEventMediaMime;contentDigest:string}
export interface PageEventMediaReceipt extends PageEventMediaInput {pageId:string;eventId:string;userId:string;objectName:string;createdAt:string;readyAt:string|null;abandonedAt:string|null;objectPresent:boolean;attached:boolean}
export const mediaUUID=(v:unknown):v is string=>typeof v==='string'&&/^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v);
const timestamp=(v:unknown):v is string=>typeof v==='string'&&Number.isFinite(Date.parse(v));
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
export function validPageEventMediaInput(v:unknown):v is PageEventMediaInput {
  if(!object(v)||!mediaUUID(v.mediaId)||typeof v.contentDigest!=='string'||!/^[a-f\d]{64}$/.test(v.contentDigest)||!Number.isSafeInteger(v.byteSize)||(v.byteSize as number)<1)return false;
  return v.purpose==='video'?v.mimeType==='video/mp4'&&(v.byteSize as number)<=104857600
    :['cover','image','poster'].includes(v.purpose as string)&&['image/jpeg','image/png','image/webp'].includes(v.mimeType as string)&&(v.byteSize as number)<=10485760;
}
export function pageEventMediaPath(eventId:string,input:PageEventMediaInput) {
  if(!mediaUUID(eventId)||!validPageEventMediaInput(input))throw Error('This media attempt is unavailable.');
  return `${eventId}/private-${input.mediaId}.${input.mimeType==='video/mp4'?'mp4':input.mimeType==='image/jpeg'?'jpg':input.mimeType==='image/png'?'png':'webp'}`;
}
export async function assertPageEventMediaAccount(scope:CreatorPageScope) {
  const current=()=>{if(!scope.isCurrent()||!mediaUUID(scope.userId))throw new CreatorPageScopeExpired();};
  current();const {data,error}=await supabase.auth.getUser();current();if(error)throw error;if(data.user?.id!==scope.userId)throw new CreatorPageScopeExpired();
}
export function parsePageEventMediaReceipt(raw:unknown,pageId:string,eventId:string,input:PageEventMediaInput,scope:CreatorPageScope):PageEventMediaReceipt {
  if(!object(raw)||raw.id!==input.mediaId||raw.page_id!==pageId||raw.event_id!==eventId||raw.created_by!==scope.userId
    ||raw.purpose!==input.purpose||raw.byte_size!==input.byteSize||raw.mime_type!==input.mimeType||raw.content_digest!==input.contentDigest
    ||raw.object_name!==pageEventMediaPath(eventId,input)||!timestamp(raw.created_at)
    ||!(raw.ready_at===null||timestamp(raw.ready_at))||!(raw.abandoned_at===null||timestamp(raw.abandoned_at))
    ||typeof raw.object_present!=='boolean'||typeof raw.attached!=='boolean'
    ||raw.attached&&(raw.ready_at===null||raw.abandoned_at!==null))throw Error('The original media attempt could not be confirmed.');
  return {mediaId:input.mediaId,purpose:input.purpose,byteSize:input.byteSize,mimeType:input.mimeType,contentDigest:input.contentDigest,pageId,eventId,userId:scope.userId,objectName:raw.object_name as string,createdAt:raw.created_at as string,readyAt:raw.ready_at as string|null,abandonedAt:raw.abandoned_at as string|null,objectPresent:raw.object_present,attached:raw.attached};
}
async function call(name:string,pageId:string,eventId:string,input:PageEventMediaInput,scope:CreatorPageScope,nullable=false) {
  if(!mediaUUID(pageId)||!mediaUUID(eventId)||!validPageEventMediaInput(input))throw Error('This media attempt is unavailable.');
  const original={...input};await assertPageEventMediaAccount(scope);
  const args={p_page_id:pageId,p_event_id:eventId,p_media_id:original.mediaId,...(name==='reserve_creator_page_event_media'?{
    p_purpose:original.purpose,p_byte_size:original.byteSize,p_mime_type:original.mimeType,p_content_digest:original.contentDigest}: {})};
  const {data,error}=await supabase.rpc(name,args);await assertPageEventMediaAccount(scope);if(error)throw error;
  if(data===null&&nullable)return null;
  return parsePageEventMediaReceipt(data,pageId,eventId,original,scope);
}
export function getPageEventMediaAttempt(pageId:string,eventId:string,input:PageEventMediaInput,scope:CreatorPageScope){return call('get_creator_page_event_media_attempt',pageId,eventId,input,scope,true);}
export async function reservePageEventMedia(pageId:string,eventId:string,input:PageEventMediaInput,scope:CreatorPageScope){return(await call('reserve_creator_page_event_media',pageId,eventId,input,scope))!;}
export async function completePageEventMedia(pageId:string,eventId:string,input:PageEventMediaInput,scope:CreatorPageScope,signal?:AbortSignal){
  const original={...input},current=()=>{if(signal?.aborted||!scope.isCurrent())throw new CreatorPageScopeExpired();};current();
  const receipt=await getPageEventMediaAttempt(pageId,eventId,original,scope);current();
  if(!receipt||receipt.abandonedAt)throw Error('Use the original saved media attempt.');
  const session=await supabase.auth.getSession();current();
  if(session.error||session.data.session?.user.id!==scope.userId||!session.data.session.access_token)throw new CreatorPageScopeExpired();
  // The existing endpoint resolves the attempt kind in the backend. No digest,
  // file path or caller-provided proof crosses this completion boundary.
  const {data,error}=await supabase.functions.invoke('verify-event-media-reuse',{
    body:{pageId,eventId,mediaId:original.mediaId},headers:{Authorization:`Bearer ${session.data.session.access_token}`},signal,timeout:55000,
  });
  current();await assertPageEventMediaAccount(scope);current();if(error)throw error;
  const confirmed=parsePageEventMediaReceipt(data,pageId,eventId,original,scope);
  if(!confirmed.readyAt||!confirmed.objectPresent||confirmed.abandonedAt)throw Error('The original upload is not confirmed.');return confirmed;
}
export async function abandonPageEventMedia(pageId:string,eventId:string,input:PageEventMediaInput,scope:CreatorPageScope){
  const r=(await call('abandon_creator_page_event_media',pageId,eventId,input,scope))!;
  if(!r.abandonedAt||r.attached)throw Error('The media was not confirmed as abandoned.');return r;
}
export function pageEventMediaRecoveryState(r:PageEventMediaReceipt|null) {
  if(!r)return 'unreserved' as const;
  if(r.abandonedAt)return 'abandoned' as const;
  if(r.readyAt&&!r.objectPresent)return 'confirmed_object_missing' as const;
  if(r.attached)return 'attached' as const;
  if(r.readyAt)return 'ready_unattached' as const;
  return r.objectPresent?'uploaded_unconfirmed' as const:'awaiting_upload' as const;
}
