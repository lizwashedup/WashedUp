import type {CreatorPageScope} from './creatorPageReview';
import {supabase} from './supabase';
import {assertTicketVisit,canReadCreatorTickets,scopedTicketRequest} from './creatorTicketRead';
import {getCreatorAccess} from './creatorMode';
import {eventSummaryAccess} from './eventSummary';
import {getPageEventSummaryAccess} from './pageEventSummary';
import {getEventAttendees,getEventMoneySummary,countAttendees,sumRefundedCentsOnPaidOrders} from './ticketAttendees';
import {getMyPayoutState,type PayoutState} from './ticketing';

/** Reuse the existing event finance gate and pinned ticket readers. No provider writes. */
export async function loadEventEarnings(eventId:string,pageId:string|null,scope:CreatorPageScope) {
  if(!await canReadCreatorTickets(eventId,scope))return null;
  const {data:event,error}=await scopedTicketRequest(scope,()=>supabase.from('explore_events')
    .select('id,title,event_date,start_time,host_user_id,community_id').eq('id',eventId).maybeSingle());
  if(error)throw error;
  if(!event || event.id!==eventId)throw Error('This event is unavailable.');
  const permission=pageId?await getPageEventSummaryAccess(pageId,eventId,scope)
    :eventSummaryAccess(event,await getCreatorAccess(),scope.userId);
  assertTicketVisit(scope);
  if(!permission.finance)return null;
  const [money,attendees]=await Promise.all([getEventMoneySummary(eventId,scope),getEventAttendees(eventId,scope)]);
  assertTicketVisit(scope);
  let payout:PayoutState|undefined,setupError=false,isPayee=false;
  // The release function uses coalesce(event.host_user_id, community.created_by).
  // Never present another recipient's setup as this viewer's bank details.
  try {
    let recipient=event.host_user_id;
    if(!recipient && event.community_id){
      const result=await scopedTicketRequest(scope,()=>supabase.from('communities').select('created_by').eq('id',event.community_id).maybeSingle());
      if(result.error || !result.data)throw Error('Payout recipient unavailable.');
      recipient=result.data.created_by;
    }
    assertTicketVisit(scope);
    isPayee=recipient===scope.userId;
    if(isPayee)payout=await getMyPayoutState(scope.userId,scope);
  } catch { assertTicketVisit(scope);setupError=true; }
  return {event,money,ticketsSold:countAttendees(attendees).sold,refundedCents:sumRefundedCentsOnPaidOrders(attendees),payout,isPayee,setupError};
}
export type EventEarnings=NonNullable<Awaited<ReturnType<typeof loadEventEarnings>>>;
