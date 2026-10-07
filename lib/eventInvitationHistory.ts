import {supabase} from './supabase';
import {scopedTicketRequest} from './creatorTicketRead';
import type {CreatorPageScope} from './creatorPageReview';
import {messageUuid} from './attendeeMessageContract';
import {AttendeeMessageHistoryDenied,type MessageHistoryCursor,type MessageHistoryRow} from './attendeeMessageHistory';
import {invitationAudienceLabel} from './eventInvitation';
const date=(v:unknown):v is string=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:\d{2})$/.test(v)&&Number.isFinite(Date.parse(v));
export const isInvitationHistoryCursor=(c:unknown):c is MessageHistoryCursor=>!!c&&typeof (c as MessageHistoryCursor).id==='string'&&messageUuid.test((c as MessageHistoryCursor).id)&&date((c as MessageHistoryCursor).created_at);
/** Map saved invitation content into the existing compact message-history presentation. */
export function readInvitationHistoryPage(value:unknown,eventId:string):{rows:MessageHistoryRow[];next:MessageHistoryCursor|null}|null{
 const p=value as {rows:Record<string,unknown>[];next:MessageHistoryCursor|null};
 if(!p||!Array.isArray(p.rows)||p.rows.length>20||!(p.next===null||isInvitationHistoryCursor(p.next)))return null;
 const seen=new Set<string>(),rows:MessageHistoryRow[]=[];
 for(const r of p.rows){
  if(!r||typeof r.id!=='string'||!messageUuid.test(r.id)||seen.has(r.id)||r.event_id!==eventId
   ||typeof r.body!=='string'||!r.body.trim()||!['past_attendees','followers','community_members'].includes(String(r.audience))
   ||!Number.isSafeInteger(r.recipient_count)||(r.recipient_count as number)<1||!date(r.created_at))return null;
  seen.add(r.id);rows.push({id:r.id,event_id:eventId,subject:invitationAudienceLabel(r.audience as 'past_attendees'|'followers'|'community_members'),body:r.body,recipient_count:r.recipient_count as number,created_at:r.created_at,queued_at:r.created_at});
 }
 if(p.next&&(rows.length!==20||p.next.id!==rows.at(-1)?.id||p.next.created_at!==rows.at(-1)?.created_at))return null;
 return {rows,next:p.next?{id:p.next.id,created_at:p.next.created_at}:null};
}
export async function loadEventInvitationHistory(eventId:string,pageId:string,scope:CreatorPageScope,cursor:MessageHistoryCursor|null=null){
 if(![eventId,pageId].every(id=>messageUuid.test(id))||cursor&&!isInvitationHistoryCursor(cursor))throw Error('Invalid invitation history reference.');
 const {data,error}=await scopedTicketRequest(scope,()=>supabase.rpc('get_event_invitation_history',{p_event_id:eventId,p_page_id:pageId,p_before_at:cursor?.created_at??null,p_before_id:cursor?.id??null}));
 if(error?.code==='42501')throw new AttendeeMessageHistoryDenied('Invitation history access is no longer available.');
 if(error)throw Error('Invitation history could not be loaded.');
 const result=readInvitationHistoryPage(data,eventId);if(!result)throw Error('Invitation history could not be confirmed.');return result;
}
