import {supabase} from './supabase';
import {scopedTicketRequest} from './creatorTicketRead';
import type {CreatorPageScope} from './creatorPageReview';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function attendeeMessageEventRoute(eventId:string,notificationId?:string){
 if(typeof eventId!=='string'||!uuid.test(eventId))throw new Error('This event address is invalid.');
 if(notificationId!==undefined&&(typeof notificationId!=='string'||!uuid.test(notificationId)))throw new Error('This update address is invalid.');
 return `/event/${eventId}${notificationId?`?notificationId=${notificationId}`:''}`;
}
/** Explicit Scene update payloads never fall through into Plan or chat routes. */
export function attendeeMessagePushRoute(data:Record<string,unknown>,enabled:boolean):string|null{
 if(data.type!=='attendee_message')return null;
 if(!enabled||typeof data.exploreEventId!=='string'||!uuid.test(data.exploreEventId))return '/(tabs)/explore';
 if(data.notificationId!==undefined&&(typeof data.notificationId!=='string'||!uuid.test(data.notificationId)))return '/(tabs)/explore';
 return attendeeMessageEventRoute(data.exploreEventId,data.notificationId as string|undefined);
}
export async function loadAttendeeNoticeLinks(ids:string[],scope:CreatorPageScope):Promise<Map<string,string|null>>{
 if(!ids.length)return new Map();
 if(!scope.userId||ids.some(id=>!uuid.test(id)))throw new Error('This update could not be checked.');
 const result=await scopedTicketRequest(scope,()=>supabase.from('app_notifications').select('id,user_id,explore_event_id,explore_event_origin_id').in('id',ids).eq('user_id',scope.userId));
 // The previous backend has no Scene column and cannot create these updates.
 // Preserve its ordinary notifications during the staged private rollout.
 if(result.error?.code==='42703')return new Map(ids.map(id=>[id,null]));
 if(result.error||!Array.isArray(result.data)||result.data.length!==ids.length)throw new Error('This update could not be checked.');
 const targets=new Map<string,string|null>();
 for(const row of result.data){
  if(!ids.includes(row.id)||targets.has(row.id)||row.user_id!==scope.userId||!(row.explore_event_id===null||(typeof row.explore_event_id==='string'&&uuid.test(row.explore_event_id))))throw new Error('This update could not be confirmed.');
  if(!(row.explore_event_origin_id===null||(typeof row.explore_event_origin_id==='string'&&uuid.test(row.explore_event_origin_id)))||(row.explore_event_id!==null&&row.explore_event_origin_id!==row.explore_event_id))throw new Error('This update could not be confirmed.');
  targets.set(row.id,row.explore_event_origin_id);
 }
 return targets;
}

export interface AttendeeMessageNotice {
 id:string; title:string; body:string|null; createdAt:string; eventId:string|null;
}
/** The notification is the delivered message; a missing event must not erase it. */
export async function loadAttendeeMessageNotice(notificationId:string,eventId:string,scope:CreatorPageScope):Promise<AttendeeMessageNotice|null>{
 if(typeof notificationId!=='string'||!uuid.test(notificationId)||typeof eventId!=='string'||!uuid.test(eventId)||!scope.userId)throw new Error('This update address is invalid.');
 const {data,error}=await scopedTicketRequest(scope,()=>supabase.from('app_notifications')
  .select('id,user_id,type,event_id,explore_event_id,explore_event_origin_id,title,body,created_at')
  .eq('id',notificationId).eq('user_id',scope.userId).maybeSingle());
 if(error)throw new Error('Could not load this update. Please try again.');
 if(data===null)return null;
 if(!data||data.id!==notificationId||data.user_id!==scope.userId||data.type!=='broadcast'||data.event_id!==null||
  data.explore_event_origin_id!==eventId||!(data.explore_event_id===null||data.explore_event_id===eventId)||typeof data.title!=='string'||
  !(data.body===null||typeof data.body==='string')||typeof data.created_at!=='string'||!Number.isFinite(Date.parse(data.created_at)))
  throw new Error('This update could not be confirmed.');
 return {id:data.id,title:data.title,body:data.body,createdAt:data.created_at,eventId:data.explore_event_id};
}
export async function markAttendeeMessageRead(notificationId:string,scope:CreatorPageScope):Promise<void>{
 if(typeof notificationId!=='string'||!uuid.test(notificationId)||!scope.userId)throw new Error('This update address is invalid.');
 const {data,error}=await scopedTicketRequest(scope,()=>supabase.from('app_notifications').update({status:'read'})
  .eq('id',notificationId).eq('user_id',scope.userId).eq('type','broadcast').is('event_id',null).select('id').maybeSingle());
 if(error||data?.id!==notificationId)throw new Error('Could not mark this update read.');
}
