const mockRequest=jest.fn();
jest.mock('../creatorTicketRead',()=>({scopedTicketRequest:(...args:unknown[])=>mockRequest(...args)}));
jest.mock('../supabase',()=>({supabase:{from:jest.fn()}}));
import {attendeeMessagePushRoute,attendeeMessageEventRoute,loadAttendeeNoticeLinks,loadAttendeeMessageNotice,markAttendeeMessageRead} from '../attendeeMessageNotification';
const id='11111111-1111-4111-8111-111111111111',event='22222222-2222-4222-8222-222222222222';
const scope={userId:'member',isCurrent:()=>true};
beforeEach(()=>jest.clearAllMocks());
it('routes only explicit Scene update payloads, never misusing their Plan fallback',()=>{expect(attendeeMessagePushRoute({type:'attendee_message',exploreEventId:event,eventId:id},true)).toBe(`/event/${event}`);expect(attendeeMessagePushRoute({type:'broadcast',eventId:id},true)).toBeNull();});
it('gated or invalid Scene payloads recover to Scene without opening an unrelated chat',()=>{expect(attendeeMessagePushRoute({type:'attendee_message',exploreEventId:'../../chat',eventId:id},true)).toBe('/(tabs)/explore');expect(attendeeMessagePushRoute({type:'attendee_message',exploreEventId:event},false)).toBe('/(tabs)/explore');expect(()=>attendeeMessageEventRoute('bad')).toThrow();});
it('validates notification and initiating recipient before returning the event',async()=>{mockRequest.mockResolvedValue({data:[{id,user_id:'member',explore_event_id:event,explore_event_origin_id:event}],error:null});expect((await loadAttendeeNoticeLinks([id],scope)).get(id)).toBe(event);expect(mockRequest.mock.calls[0][0]).toBe(scope);});
it.each([[{id,user_id:'other',explore_event_id:event,explore_event_origin_id:event}],[],[{id,user_id:'member',explore_event_id:'bad'}],[{id:event,user_id:'member',explore_event_id:event,explore_event_origin_id:event}]].map(data=>({data})))('rejects mismatched or partial metadata %p',async ({data})=>{mockRequest.mockResolvedValue({data,error:null});await expect(loadAttendeeNoticeLinks([id],scope)).rejects.toThrow();});
it('supports an older schema without changing ordinary notification behavior',async()=>{mockRequest.mockResolvedValue({data:null,error:{code:'42703'}});expect((await loadAttendeeNoticeLinks([id],scope)).get(id)).toBeNull();});
it('a network or permission error is not mistaken for an ordinary notification',async()=>{mockRequest.mockResolvedValue({data:null,error:{code:'42501'}});await expect(loadAttendeeNoticeLinks([id],scope)).rejects.toThrow();});

it('carries the notification identity into the event route without accepting malformed IDs',()=>{
 expect(attendeeMessagePushRoute({type:'attendee_message',exploreEventId:event,notificationId:id},true)).toBe(`/event/${event}?notificationId=${id}`);
 expect(attendeeMessagePushRoute({type:'attendee_message',exploreEventId:event,notificationId:'../another'},true)).toBe('/(tabs)/explore');
 expect(()=>attendeeMessageEventRoute(event,'bad')).toThrow();
});
const message=()=>({id,user_id:'member',type:'broadcast',event_id:null,explore_event_id:event,explore_event_origin_id:event,title:'A new meeting point',body:'Full saved update\nSecond paragraph',created_at:'2026-09-16T17:00:00Z'});
it('reads the complete original content, including after the event has been deleted',async()=>{
 mockRequest.mockResolvedValueOnce({data:message(),error:null});
 expect(await loadAttendeeMessageNotice(id,event,scope)).toEqual({id,title:message().title,body:message().body,createdAt:message().created_at,eventId:event});
 mockRequest.mockResolvedValueOnce({data:{...message(),explore_event_id:null},error:null});
 expect(await loadAttendeeMessageNotice(id,event,scope)).toMatchObject({body:message().body,eventId:null});
});
it.each([{user_id:'other'},{id:event},{type:'chat'},{event_id:event},{explore_event_id:id},{explore_event_origin_id:id},{body:12},{title:null},{created_at:'unknown'}])('rejects mismatched recipient/content/context %p',async override=>{
 mockRequest.mockResolvedValue({data:{...message(),...override},error:null});
 await expect(loadAttendeeMessageNotice(id,event,scope)).rejects.toThrow();
});
it('distinguishes missing notification from read failure and never substitutes push-body content',async()=>{
 mockRequest.mockResolvedValueOnce({data:null,error:null});expect(await loadAttendeeMessageNotice(id,event,scope)).toBeNull();
 mockRequest.mockResolvedValueOnce({data:null,error:{code:'42703'}});await expect(loadAttendeeMessageNotice(id,event,scope)).rejects.toThrow('Could not load');
});
it('requires an own exact receipt for optional read bookkeeping',async()=>{
 mockRequest.mockResolvedValueOnce({data:{id},error:null});await expect(markAttendeeMessageRead(id,scope)).resolves.toBeUndefined();
 mockRequest.mockResolvedValueOnce({data:{id:event},error:null});await expect(markAttendeeMessageRead(id,scope)).rejects.toThrow();
});

it('keeps a deleted Scene event classified separately from ordinary broadcasts',async()=>{mockRequest.mockResolvedValue({data:[{id,user_id:'member',explore_event_id:null,explore_event_origin_id:event}],error:null});expect((await loadAttendeeNoticeLinks([id],scope)).get(id)).toBe(event);mockRequest.mockResolvedValue({data:[{id,user_id:'member',explore_event_id:null,explore_event_origin_id:null}],error:null});expect((await loadAttendeeNoticeLinks([id],scope)).get(id)).toBeNull();});
