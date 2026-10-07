import {loadOrganizationPageUpdateTarget,loadOrganizationPageUpdate,markOrganizationPageUpdateRead,organizationPageUpdatePushRoute} from '../organizationPageUpdate';
import {supabase} from '../supabase';
jest.mock('../supabase',()=>({supabase:{auth:{getSession:jest.fn()},from:jest.fn()}}));
const n='11111111-1111-4111-8111-111111111111',p='22222222-2222-4222-8222-222222222222',b='33333333-3333-4333-8333-333333333333';
const mapping={notification_id:n,page_id:p,broadcast_id:b,user_id:'member'};
const content={id:b,creator_page_id:p,body:'Saved update',created_at:'2026-09-15T00:00:00Z'};
const session={data:{session:{user:{id:'member'},access_token:'test-token'}},error:null};
let scope:any,filters:any[];
const read=jest.fn(),header=jest.fn(),write=jest.fn();
beforeEach(()=>{
 jest.clearAllMocks();scope={userId:'member',isCurrent:()=>true};filters=[];read.mockReset().mockResolvedValue({data:mapping,error:null});
 jest.mocked(supabase.auth.getSession).mockReset().mockResolvedValue(session as any);
 jest.mocked(supabase.from).mockImplementation(()=>{const q:any={select:()=>q,eq:(...a:any[])=>{filters.push(a);return q;},update:(...a:any[])=>{write(...a);return q;},setHeader:(...a:any[])=>{header(...a);return q;},maybeSingle:()=>read()};return q;});
});
it('routes only explicit page-update IDs without legacy fallthrough',()=>{const data={type:'creator_page_update',creatorPageId:p,creatorPageBroadcastId:b,eventId:'unrelated-plan'};expect(organizationPageUpdatePushRoute(data,true)).toBe(`/organization/${p}?identity=page&update=${b}`);expect(organizationPageUpdatePushRoute({...data,type:'broadcast'},true)).toBeNull();expect(organizationPageUpdatePushRoute({...data,creatorPageId:'../../chat'},true)).toBe('/(tabs)/explore');expect(organizationPageUpdatePushRoute(data,false)).toBe('/(tabs)/explore');});
it('reads the exact recipient/notification with initiating authorization',async()=>{
 expect(await loadOrganizationPageUpdateTarget(n,scope)).toEqual({notificationId:n,pageId:p,broadcastId:b});expect(filters).toEqual([['notification_id',n],['user_id','member']]);expect(header).toHaveBeenCalledWith('Authorization','Bearer test-token');expect(supabase.auth.getSession).toHaveBeenCalledTimes(2);
});
it.each([null,{},[],{...mapping,user_id:'other'},{...mapping,page_id:[p]},{...mapping,notification_id:p},{...mapping,broadcast_id:'invalid'}])('handles unavailable or invalid target %p',async data=>{
 read.mockResolvedValue({data,error:null});if(data===null)expect(await loadOrganizationPageUpdateTarget(n,scope)).toBeNull();else await expect(loadOrganizationPageUpdateTarget(n,scope)).rejects.toThrow('confirmed');
});
it('reports a safe lookup error instead of backend internals',async()=>{
 read.mockResolvedValue({data:null,error:Error('private SQL detail')});await expect(loadOrganizationPageUpdateTarget(n,scope)).rejects.toThrow('Couldn’t check this update');
});
it('does not fetch personal content when signed out',async()=>{scope.userId=null;expect(await loadOrganizationPageUpdate(p,b,scope)).toBeNull();expect(supabase.from).not.toHaveBeenCalled();});
it('reads the complete exact page/update body with initiating authorization',async()=>{
 read.mockResolvedValue({data:content,error:null});expect(await loadOrganizationPageUpdate(p,b,scope)).toMatchObject({id:b,pageId:p,body:'Saved update'});expect(filters).toEqual([['id',b],['creator_page_id',p]]);expect(header).toHaveBeenCalledWith('Authorization','Bearer test-token');
});
it.each([{...content,creator_page_id:n},{...content,id:p},{...content,body:null},{...content,created_at:null}])('rejects content with mismatched or malformed identity %p',async data=>{
 read.mockResolvedValue({data,error:null});await expect(loadOrganizationPageUpdate(p,b,scope)).rejects.toThrow('confirmed');
});
it('keeps unavailable content distinct from connection failure',async()=>{
 read.mockResolvedValueOnce({data:null,error:null});expect(await loadOrganizationPageUpdate(p,b,scope)).toBeNull();read.mockResolvedValueOnce({data:null,error:Error('offline')});await expect(loadOrganizationPageUpdate(p,b,scope)).rejects.toThrow('Couldn’t read this update');
});
it.each(['target','content','receipt'])('retires the %s operation after a changed account',async operation=>{
 read.mockResolvedValue({data:operation==='target'?mapping:operation==='content'?content:{id:n},error:null});jest.mocked(supabase.auth.getSession).mockResolvedValueOnce(session as any).mockResolvedValue({data:{session:{user:{id:'other'},access_token:'other'}},error:null} as any);
 const work=operation==='target'?loadOrganizationPageUpdateTarget(n,scope):operation==='content'?loadOrganizationPageUpdate(p,b,scope):markOrganizationPageUpdateRead(n,scope);await expect(work).rejects.toMatchObject({name:'OrganizationUpdateIdentityError'});
});
it('marks only the exact recipient notice and requires the saved receipt',async()=>{
 read.mockResolvedValueOnce({data:{id:n},error:null});await markOrganizationPageUpdateRead(n,scope);expect(write).toHaveBeenCalledWith({status:'read'});expect(filters).toEqual([['id',n],['user_id','member']]);expect(header).toHaveBeenCalledWith('Authorization','Bearer test-token');
 read.mockResolvedValueOnce({data:{id:p},error:null});await expect(markOrganizationPageUpdateRead(n,scope)).rejects.toThrow('mark this update');
});
it.each(['target','content','session'])('bounds a stalled %s read',async phase=>{
 jest.useFakeTimers();try{
 if(phase==='session')jest.mocked(supabase.auth.getSession).mockReturnValueOnce(new Promise(()=>{}));else read.mockReturnValueOnce(new Promise(()=>{}));
 const work=phase==='content'?loadOrganizationPageUpdate(p,b,scope):loadOrganizationPageUpdateTarget(n,scope);const assertion=expect(work).rejects.toThrow();await jest.advanceTimersByTimeAsync(12001);await assertion;
 }finally{jest.useRealTimers();}
});
it('does not expose late content after its visit retires',async()=>{
 read.mockImplementationOnce(async()=>{scope.isCurrent=()=>false;return{data:content,error:null};});await expect(loadOrganizationPageUpdate(p,b,scope)).rejects.toMatchObject({name:'OrganizationUpdateIdentityError'});
});
