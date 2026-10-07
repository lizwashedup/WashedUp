jest.mock('../supabase',()=>({supabase:{auth:{getSession:jest.fn()},from:jest.fn()}}));
jest.mock('../publishedPageIdentity',()=>({checkPublishedPageScope:jest.fn()}));
import {pageInvitationPushRoute,pageInvitationRoute,loadPageInvitationTarget,markPageInvitationRead} from '../pageInvitationNotification';
import {supabase} from '../supabase';
const page='11111111-1111-4111-8111-111111111111',invitation='22222222-2222-4222-8222-222222222222';
it('opens exact invitation rather than unrelated chat/event fallback',()=>{expect(pageInvitationPushRoute({type:'page_team_invitation',creatorPageId:page,pageInvitationId:invitation,eventId:'other'},true)).toBe(`/creator/page-team?id=${page}&invitationId=${invitation}`);});
it('invalid or disabled invitation targets stay within safe navigation',()=>{expect(pageInvitationPushRoute({type:'page_team_invitation',creatorPageId:'../../',pageInvitationId:invitation},true)).toBe('/(tabs)/friends');expect(pageInvitationPushRoute({type:'page_team_invitation',creatorPageId:page,pageInvitationId:invitation},false)).toBe('/(tabs)/friends');expect(()=>pageInvitationRoute({pageId:page,invitationId:'bad'})).toThrow();});
it('ordinary notification types remain untouched',()=>{expect(pageInvitationPushRoute({type:'broadcast'},true)).toBeNull();});

const notification='44444444-4444-4444-8444-444444444444';
const target={notification_id:notification,page_id:page,invitation_id:invitation,user_id:'viewer'};
const scope={userId:'viewer',isCurrent:()=>true};
const read=jest.fn(),header=jest.fn(),eq=jest.fn(),update=jest.fn();
const session={data:{session:{user:{id:'viewer'},access_token:'test-token'}},error:null};
beforeEach(()=>{
 jest.clearAllMocks();read.mockReset().mockResolvedValue({data:target,error:null});jest.mocked(supabase.auth.getSession).mockReset().mockResolvedValue(session as any);
 jest.mocked(supabase.from).mockImplementation(()=>{const query:any={select:()=>query,eq:(...args:any[])=>{eq(...args);return query;},update:(...args:any[])=>{update(...args);return query;},setHeader:(...args:any[])=>{header(...args);return query;},maybeSingle:()=>read()};return query;});
});
it('pins the initiating recipient on the exact target read',async()=>{
 expect(await loadPageInvitationTarget(notification,scope)).toEqual({pageId:page,invitationId:invitation});
 expect(header).toHaveBeenCalledWith('Authorization','Bearer test-token');expect(eq).toHaveBeenCalledWith('notification_id',notification);expect(eq).toHaveBeenCalledWith('user_id','viewer');
});
it.each([{},[],{...target,notification_id:page},{...target,user_id:'other'},{...target,page_id:'invalid'},{...target,invitation_id:'invalid'}])('rejects malformed or mismatched target %p',async data=>{
 read.mockResolvedValue({data,error:null});await expect(loadPageInvitationTarget(notification,scope)).rejects.toThrow('could not be confirmed');
});
it('distinguishes a removed mapping from an unsuccessful read',async()=>{
 read.mockResolvedValueOnce({data:null,error:null});expect(await loadPageInvitationTarget(notification,scope)).toBeNull();
 read.mockResolvedValueOnce({data:null,error:Error('private SQL details')});await expect(loadPageInvitationTarget(notification,scope)).rejects.toThrow('Couldn’t check this invitation');
});
it.each(['before','after'])('rejects a different account %s the target read',async phase=>{
 if(phase==='after')jest.mocked(supabase.auth.getSession).mockResolvedValueOnce(session as any);
 jest.mocked(supabase.auth.getSession).mockResolvedValue({data:{session:{user:{id:'other'},access_token:'other-token'}},error:null} as any);
 await expect(loadPageInvitationTarget(notification,scope)).rejects.toMatchObject({name:'PageInvitationIdentityError'});
 expect(read).toHaveBeenCalledTimes(phase==='after'?1:0);
});
it('marks only this recipient’s exact notice read after rechecking identity',async()=>{
 read.mockResolvedValue({data:{id:notification},error:null});await markPageInvitationRead(notification,scope);
 expect(update).toHaveBeenCalledWith({status:'read'});expect(eq).toHaveBeenCalledWith('id',notification);expect(eq).toHaveBeenCalledWith('user_id','viewer');expect(header).toHaveBeenCalledWith('Authorization','Bearer test-token');
 expect(supabase.auth.getSession).toHaveBeenCalledTimes(2);
});
it.each([{data:null,error:null},{data:{id:page},error:null},{data:null,error:Error('offline')}])('requires the exact receipt %p',async result=>{
 read.mockResolvedValue(result);await expect(markPageInvitationRead(notification,scope)).rejects.toThrow('mark this invitation');
});
it.each(['target','receipt'])('does no work for invalid %s identifiers',async operation=>{
 await expect((operation==='target'?loadPageInvitationTarget:markPageInvitationRead)('invalid',scope)).rejects.toThrow();expect(read).not.toHaveBeenCalled();expect(supabase.auth.getSession).not.toHaveBeenCalled();
});
it('cannot dispatch after the session lock times out, even if the session later resolves',async()=>{
 jest.useFakeTimers();let resolve!:(value:any)=>void;const pending=new Promise<any>(yes=>{resolve=yes;});jest.mocked(supabase.auth.getSession).mockReturnValueOnce(pending);
 try{const assertion=expect(loadPageInvitationTarget(notification,scope)).rejects.toMatchObject({name:'PageInvitationIdentityError'});await jest.advanceTimersByTimeAsync(12001);await assertion;resolve(session);await Promise.resolve();await Promise.resolve();expect(read).not.toHaveBeenCalled();}finally{jest.useRealTimers();}
});
it('retired visits cannot start any account check',async()=>{
 await expect(loadPageInvitationTarget(notification,{...scope,isCurrent:()=>false})).rejects.toMatchObject({name:'PageInvitationIdentityError'});expect(supabase.auth.getSession).not.toHaveBeenCalled();
});
