/** Scene updates use their own event identity; event_id is reserved for Plans. */
export interface AttendeeNotice { id:string; user_id:string; type:string; event_id?:string|null; }
export interface AttendeePushTarget { notificationId:string; eventId:string; invitationDecision?:'ordinary'|'send'|'suppress'|'hold'; }
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isAttendeeNoticeCandidate(n:Pick<AttendeeNotice,'type'|'event_id'>){return n.type==='broadcast'&&!n.event_id;}
export async function resolveAttendeeMessagePushTargets(database:{from:(name:string)=>any;rpc:(name:string,args:any)=>PromiseLike<any>},notices:AttendeeNotice[]){
 const candidates=notices.filter(isAttendeeNoticeCandidate),targets=new Map<string,AttendeePushTarget>();
 if(!candidates.length)return targets;
 const expected=new Map(candidates.map(n=>[n.id,n]));
 if(expected.size!==candidates.length)throw new Error('Duplicate broadcast in claimed batch');
 const {data,error}=await database.from('app_notifications').select('id,user_id,explore_event_id,explore_event_origin_id').in('id',candidates.map(n=>n.id));
 if(error||!Array.isArray(data)||data.length!==expected.size)throw new Error('Broadcast event targets could not be checked');
 const seen=new Set<string>();
 for(const row of data){
  const notice=expected.get(row?.id);
  if(!notice||seen.has(row.id)||row.user_id!==notice.user_id||!(row.explore_event_id===null||(typeof row.explore_event_id==='string'&&uuid.test(row.explore_event_id))))throw new Error('Broadcast target did not match its recipient');
  seen.add(row.id);
  if(!(row.explore_event_origin_id===null||(typeof row.explore_event_origin_id==='string'&&uuid.test(row.explore_event_origin_id)))||(row.explore_event_id!==null&&row.explore_event_origin_id!==row.explore_event_id))throw new Error('Broadcast origin did not match its event');
  if(row.explore_event_origin_id)targets.set(row.id,{notificationId:row.id,eventId:row.explore_event_origin_id});
 }
 if(targets.size){
  const {data:decisions,error:decisionError}=await database.rpc('get_scene_message_push_decisions',{p_notification_ids:[...targets.keys()]});
  if(decisionError||!Array.isArray(decisions)||decisions.length!==targets.size)throw new Error('Scene message delivery decisions could not be checked');
  const decided=new Set<string>();
  for(const row of decisions){
   const target=targets.get(row?.notification_id),notice=expected.get(row?.notification_id);
   if(!target||!notice||decided.has(row.notification_id)||row.user_id!==notice.user_id||!['ordinary','send','suppress','hold'].includes(row.decision))throw new Error('Scene message delivery decision did not match its recipient');
   decided.add(row.notification_id);target.invitationDecision=row.decision;
  }
 }
 return targets;
}
export function attendeeMessagePushData(target:AttendeePushTarget){return {type:'attendee_message',notificationId:target.notificationId,exploreEventId:target.eventId};}
