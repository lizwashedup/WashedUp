import { communityJoinPushRoute, loadCommunityJoinNotice, markCommunityJoinNoticeRead, CommunityJoinNoticeIdentityError } from '../communityJoinNotification';
import { supabase } from '../supabase';
jest.mock('../supabase', () => ({ supabase: { auth: { getSession: jest.fn() }, rpc: jest.fn(), from: jest.fn() } }));
const n='11111111-1111-4111-8111-111111111111',p='22222222-2222-4222-8222-222222222222',m='33333333-3333-4333-8333-333333333333';
const target={notification_id:n,page_id:p,member_id:m,kind:'request',eligible:true};
let alive=true,sessionCalls=0,replaceAt=Infinity;
const scope={userId:'viewer',isCurrent:()=>alive};
const resolve=jest.fn(),receipt=jest.fn(),header=jest.fn(),update=jest.fn();
beforeEach(()=>{
 jest.clearAllMocks();alive=true;sessionCalls=0;replaceAt=Infinity;
 jest.mocked(supabase.auth.getSession).mockImplementation(async()=>({data:{session:{user:{id:++sessionCalls>=replaceAt?'other':'viewer'},access_token:'fixture'}},error:null}) as any);
 resolve.mockResolvedValue({data:target,error:null});receipt.mockResolvedValue({data:{id:n},error:null});
 jest.mocked(supabase.rpc).mockImplementation(()=>({setHeader:(...args:any[])=>{header(...args);return resolve();}}) as any);
 const chain:any={};for(const method of ['eq','select','setHeader'])chain[method]=jest.fn(()=>chain);chain.maybeSingle=()=>receipt();chain.update=(value:any)=>{update(value);return chain;};
 jest.mocked(supabase.from).mockReturnValue(chain);
});
it('resolves only the authenticated exact notification and validates its complete source',async()=>{
 expect(await loadCommunityJoinNotice(n,'community_join_request',scope)).toEqual(target);
 expect(supabase.rpc).toHaveBeenCalledWith('get_my_creator_page_join_notice',{p_notification_id:n});expect(header).toHaveBeenCalledWith('Authorization','Bearer fixture');
});
it.each([{},[],{...target,notification_id:p},{...target,page_id:'../x'},{...target,member_id:null},{...target,kind:'approved'},{...target,eligible:null}])('rejects malformed or mismatched source %p',async data=>{
 resolve.mockResolvedValue({data,error:null});await expect(loadCommunityJoinNotice(n,'community_join_request',scope)).rejects.toThrow();
});
it('distinguishes legacy null, unavailable mapped source and a failed lookup',async()=>{
 resolve.mockResolvedValueOnce({data:null,error:null}).mockResolvedValueOnce({data:{...target,eligible:false},error:null}).mockResolvedValueOnce({data:null,error:{code:'42501'}});
 expect(await loadCommunityJoinNotice(n,'community_join_request',scope)).toBeNull();
 expect(await loadCommunityJoinNotice(n,'community_join_request',scope)).toEqual({...target,eligible:false});
 await expect(loadCommunityJoinNotice(n,'community_join_request',scope)).rejects.toThrow('Couldn’t check');
});
it('fails identity closed after source resolves under a replacement account',async()=>{
 replaceAt=2;await expect(loadCommunityJoinNotice(n,'community_join_request',scope)).rejects.toBeInstanceOf(CommunityJoinNoticeIdentityError);
});
it('pins read bookkeeping to account, notice and type, retaining acted semantics for requests',async()=>{
 await markCommunityJoinNoticeRead(n,'community_join_request',scope,'acted');expect(update).toHaveBeenCalledWith({status:'acted'});
 const chain=jest.mocked(supabase.from).mock.results[0].value;expect(chain.eq).toHaveBeenCalledWith('user_id','viewer');expect(chain.eq).toHaveBeenCalledWith('id',n);expect(chain.eq).toHaveBeenCalledWith('type','community_join_request');
});
it('does not hide account replacement behind optional receipt failure',async()=>{
 receipt.mockRejectedValue(Error('offline'));replaceAt=2;await expect(markCommunityJoinNoticeRead(n,'community_join_approved',scope)).rejects.toBeInstanceOf(CommunityJoinNoticeIdentityError);
});
it('legacy notificationId alone remains legacy; any malformed mapped identity uses a safe fallback',()=>{
 expect(communityJoinPushRoute({type:'community_join_request',notificationId:n},true)).toBeNull();
 expect(communityJoinPushRoute({type:'community_join_declined',notificationId:n,creatorPageId:p},true)).toBe('/(tabs)/explore');
 expect(communityJoinPushRoute({type:'community_join_request',creatorPageId:null,communityMemberId:null},true)).toBe('/(tabs)/friends');
 expect(communityJoinPushRoute({type:'new_message',creatorPageId:p},true)).toBeNull();
});
