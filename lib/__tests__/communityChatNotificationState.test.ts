import { supabase } from '../supabase';
import { getCommunityChatPreference } from '../communityChatPreference';
import { getCommunityInboxNotificationState, getCommunityTopicNotificationContext } from '../communityChatNotificationState';
import { communityNotificationLabel } from '../communityChatNotificationPresentation';
import type { CommunityChatRowData } from '../communityChat';
jest.mock('../supabase',()=>({supabase:{auth:{getUser:jest.fn()},from:jest.fn()}}));
jest.mock('../communityChatPreference',()=>({getCommunityChatPreference:jest.fn()}));
const preference=jest.mocked(getCommunityChatPreference),getUser=jest.mocked(supabase.auth.getUser),from=jest.mocked(supabase.from);
const page='774c2329-e22e-4113-8a2a-67ca854dd2c9',topic='fb44e4c9-7834-42f5-907e-9507546ae25e',user='753c5b17-ca8d-431f-ad8f-0d9b70c0dccb',event='2f009e23-13f7-404e-aecf-f26bb480d175';
const main:CommunityChatRowData={key:'main',kind:'community',targetId:page,communityId:page,title:'Community',secondary:null,preview:'Preserved',lastAt:null,unread:7,accent:null,image:null,eventId:null};
let current=true,chain:any;const scope={userId:user,isCurrent:()=>current};
beforeEach(()=>{jest.resetAllMocks();current=true;getUser.mockResolvedValue({data:{user:{id:user}},error:null} as any);chain={};for(const k of ['select','eq','maybeSingle'])chain[k]=jest.fn(()=>chain);from.mockReturnValue(chain);preference.mockResolvedValue({communityId:page,userId:user,muted:true,version:1});});
it.each([[null,null,'persistent'],[event,event,'event'],[null,event,'event']])('resolves immutable topic provenance with current=%s original=%s',async(currentEvent,original,kind)=>{
 chain.maybeSingle.mockResolvedValue({data:{id:topic,community_id:page,explore_event_id:currentEvent,original_event_id:original},error:null});
 await expect(getCommunityTopicNotificationContext(topic,scope)).resolves.toEqual({communityId:page,kind});
});
it.each([null,{id:topic,community_id:page,explore_event_id:null},{id:topic,community_id:'wrong',explore_event_id:null,original_event_id:null}])('keeps absent or incomplete context unknown (%j)',async data=>{
 chain.maybeSingle.mockResolvedValue({data,error:null});await expect(getCommunityTopicNotificationContext(topic,scope)).rejects.toThrow('could not be confirmed');
});
it('rejects a retired context read',async()=>{chain.maybeSingle.mockImplementation(async()=>{current=false;return{data:{id:topic,community_id:page,explore_event_id:null,original_event_id:null},error:null};});await expect(getCommunityTopicNotificationContext(topic,scope)).rejects.toThrow('changed');});
it('overlays parent state without changing event rooms, identities, previews or counts',async()=>{
 const room={...main,key:'topic',kind:'room' as const,targetId:topic,unread:3};const attendee={...room,key:'event',eventId:event,roomNotificationsOn:true};
 const result=await getCommunityInboxNotificationState([main,room,attendee],scope);
 expect(result).toEqual([{...main,communityMuted:true},{...room,communityMuted:true},attendee]);expect(result[2]).toBe(attendee);expect(preference).toHaveBeenCalledTimes(1);
});
it('keeps conversations and unread counts when one preference read fails',async()=>{
 preference.mockRejectedValue(Error('Offline'));await expect(getCommunityInboxNotificationState([main],scope)).resolves.toEqual([{...main,communityMuted:null}]);
});
it('never reads community preferences for an attendee-only inbox',async()=>{
 const attendee={...main,kind:'room' as const,eventId:event};await expect(getCommunityInboxNotificationState([attendee],scope)).resolves.toEqual([attendee]);expect(preference).not.toHaveBeenCalled();
});
it('rejects account changes instead of masking them as unavailable preferences',async()=>{
 preference.mockImplementation(async()=>{current=false;throw Error('Changed');});await expect(getCommunityInboxNotificationState([main],scope)).rejects.toThrow('changed');
});
it('renders effective parent and individual states without inferring an event parent override',()=>{
 expect(communityNotificationLabel({...main,communityMuted:true})).toBe('All community chats muted');
 expect(communityNotificationLabel({...main,communityMuted:null})).toContain('unavailable');
 expect(communityNotificationLabel({...main,communityMuted:false,roomNotificationsOn:false})).toBe('Chat muted');
 expect(communityNotificationLabel({...main,kind:'room',eventId:event,communityMuted:true,roomNotificationsOn:true})).toBeNull();
});
