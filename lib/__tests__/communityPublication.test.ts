import AsyncStorage from '@react-native-async-storage/async-storage';
import { changeCommunityPublication, checkCommunityPublication, publicationAttempt, readCommunityPublication, readCommunityPublicationAttempt, readCommunityDiscoveryAvailable, CommunityPublicationUnknown } from '../communityPublication';
const mockSession=jest.fn(), mockRequest=jest.fn(), mockCalls=jest.fn();
jest.mock('../supabase',()=>({supabase:{auth:{getSession:()=>mockSession()},from:(table:string)=>mockChain(table),rpc:(name:string,args:any)=>{mockCalls('rpc',name,args);return mockChain(name)}}}));
function mockChain(table:string){let write=false;const chain:any={then:(...args:any[])=>mockRequest(table,write).then(...args)};for(const name of ['select','update','eq','single','maybeSingle','setHeader','abortSignal'])chain[name]=(...args:any[])=>{if(name==='update')write=true;mockCalls(name,...args);return chain;};return chain;}
const id='00000000-0000-4000-8000-000000000001', user='00000000-0000-4000-8000-000000000002';
const initial={id,status:'draft' as const,discoverable:false};
let row:any,member:any,live:boolean,writeResult:any;
const scope={userId:user,isCurrent:()=>live};
const attempt=()=>publicationAttempt(initial,'publish');
const deferred=()=>{let resolve!:(r:any)=>void;const promise=new Promise(r=>{resolve=r});return{promise,resolve};};
beforeEach(async()=>{await AsyncStorage.clear();jest.clearAllMocks();live=true;row={...initial};member={community_id:id,user_id:user,status:'active',role:'leader'};writeResult={data:{...initial,status:'active'},error:null};mockSession.mockResolvedValue({data:{session:{user:{id:user},access_token:'test-token'}},error:null});mockRequest.mockImplementation(async(table,write)=>write||table==='set_community_discoverable'?writeResult:{data:table==='get_community_visibility_options'?{version:1,community_id:id,can_change_discovery:true}:table==='community_members'?member:row,error:null});});
afterEach(()=>jest.useRealTimers());
it('pins the creator account, checks exact membership and confirms one conditional publication',async()=>{
 expect(await changeCommunityPublication(attempt(),scope)).toEqual(writeResult.data);
 expect(mockCalls).toHaveBeenCalledWith('setHeader','Authorization','Bearer test-token');
 expect(mockCalls).toHaveBeenCalledWith('update',{status:'active'});
 expect(mockCalls).toHaveBeenCalledWith('eq','status','draft');expect(mockCalls).toHaveBeenCalledWith('eq','discoverable',false);
 expect(await readCommunityPublicationAttempt(id,scope)).toBeNull();
});
it.each(['member','admin','events','member_care','finance'])('rejects selected %s roles before any write',async role=>{
 member.role=role;await expect(changeCommunityPublication(attempt(),scope)).rejects.toThrow('leader or co-leader');expect(mockCalls.mock.calls.some(c=>c[0]==='update')).toBe(false);
});
it('rejects another community/account membership and revoked membership',async()=>{
 for(const bad of [{...member,community_id:user},{...member,user_id:id},{...member,status:'left'},null]){member=bad;await expect(readCommunityPublication(id,scope)).rejects.toThrow();}
 expect(mockCalls.mock.calls.some(c=>c[0]==='update')).toBe(false);
});
it('keeps banned, missing and malformed status reads from becoming a draft',async()=>{
 for(const bad of [null,{...initial,id:user},{...initial,status:'unknown'},{...initial,discoverable:null}]){row=bad;await expect(readCommunityPublication(id,scope)).rejects.toThrow();}
});
it('requires the same account and current visit after authentication resolves',async()=>{
 mockSession.mockResolvedValueOnce({data:{session:{user:{id:'other'},access_token:'other'}},error:null});await expect(changeCommunityPublication(attempt(),scope)).rejects.toThrow();
 const pending=deferred();mockSession.mockReturnValueOnce(pending.promise);const result=changeCommunityPublication(attempt(),scope);live=false;pending.resolve({data:{session:{user:{id:user},access_token:'test-token'}},error:null});await expect(result).rejects.toThrow();expect(mockRequest).not.toHaveBeenCalled();
});
it.each([null,{...initial,status:'draft'},{...initial,id:user,status:'active'}])('does not report a missing or mismatched update receipt as success',async data=>{
 writeResult={data,error:null};await expect(changeCommunityPublication(attempt(),scope)).rejects.toBeInstanceOf(CommunityPublicationUnknown);expect(await readCommunityPublicationAttempt(id,scope)).toEqual(attempt());
});
it.each(['42501','PT409','22023'])('allows recovery after a first dispatch explicitly rejected with %s',async code=>{
 writeResult={data:null,error:{code,message:'rejected'}};await expect(changeCommunityPublication(attempt(),scope)).rejects.toThrow('Check the saved status');
 expect((await checkCommunityPublication(id,scope)).attempt).toBeNull();
});
it('does not use a rejected retry to dismiss an earlier unknown result',async()=>{
 writeResult={data:null,error:null};await expect(changeCommunityPublication(attempt(),scope)).rejects.toBeInstanceOf(CommunityPublicationUnknown);
 writeResult={data:null,error:{code:'42501',message:'denied'}};await expect(changeCommunityPublication(attempt(),scope)).rejects.toBeInstanceOf(CommunityPublicationUnknown);
 expect(await readCommunityPublicationAttempt(id,scope)).toEqual(attempt());
});
it('restores a lost response on a later visit and reconciles read-only',async()=>{
 mockRequest.mockImplementation(async(table,write)=>{if(write)throw Error('response lost');return{data:table==='community_members'?member:row,error:null};});
 await expect(changeCommunityPublication(attempt(),scope)).rejects.toBeInstanceOf(CommunityPublicationUnknown);
 const next={userId:user,isCurrent:()=>true};expect(await readCommunityPublicationAttempt(id,next)).toEqual(attempt());row={...initial,status:'active'};
 expect((await checkCommunityPublication(id,next)).attempt).toBeNull();expect(mockCalls.mock.calls.filter(c=>c[0]==='update')).toHaveLength(1);
});
it('will not replace an uncertain publish with archive, visibility or another account’s change',async()=>{
 writeResult={data:null,error:null};await expect(changeCommunityPublication(attempt(),scope)).rejects.toThrow();
 await expect(changeCommunityPublication(publicationAttempt(initial,'archive'),scope)).rejects.toThrow();
 await expect(changeCommunityPublication(publicationAttempt(initial,'show'),scope)).rejects.toThrow();
 expect(await readCommunityPublicationAttempt(id,{...scope,userId:'other'})).toBeNull();expect(mockCalls.mock.calls.filter(c=>c[0]==='update')).toHaveLength(1);
});
it('allows only an explicit same-payload retry while the original state is unchanged',async()=>{
 writeResult={data:null,error:null};await expect(changeCommunityPublication(attempt(),scope)).rejects.toThrow();writeResult={data:{...initial,status:'active'},error:null};
 await changeCommunityPublication(attempt(),scope);expect(mockCalls.mock.calls.filter(c=>c[0]==='update')).toHaveLength(2);expect(await readCommunityPublicationAttempt(id,scope)).toBeNull();
});
it('does not overwrite a concurrent visibility or lifecycle change',async()=>{
 row={...initial,discoverable:true};await expect(changeCommunityPublication(attempt(),scope)).rejects.toThrow('settings changed');expect(mockCalls.mock.calls.some(c=>c[0]==='update')).toBe(false);
});
it('does not dispatch if saving the local recovery record fails',async()=>{
 jest.spyOn(AsyncStorage,'setItem').mockRejectedValueOnce(Error('disk full'));await expect(changeCommunityPublication(attempt(),scope)).rejects.toThrow('disk full');expect(mockCalls.mock.calls.some(c=>c[0]==='update')).toBe(false);
});
it('locks simultaneous actions across mounted screens',async()=>{
 const pending=deferred();mockSession.mockReturnValueOnce(pending.promise);const first=changeCommunityPublication(attempt(),scope);await expect(changeCommunityPublication(attempt(),scope)).rejects.toThrow();await expect(checkCommunityPublication(id,scope)).rejects.toThrow();pending.resolve({data:{session:{user:{id:user},access_token:'test-token'}},error:null});await first;expect(mockCalls.mock.calls.filter(c=>c[0]==='update')).toHaveLength(1);
});
it('bounds a hung write without retrying automatically',async()=>{
 jest.useFakeTimers();mockRequest.mockImplementation((table,write)=>write?new Promise(()=>{}):Promise.resolve({data:table==='community_members'?member:row,error:null}));
 const result=changeCommunityPublication(attempt(),scope),check=expect(result).rejects.toBeInstanceOf(CommunityPublicationUnknown);await jest.advanceTimersByTimeAsync(12_001);await check;expect(mockCalls.mock.calls.filter(c=>c[0]==='update')).toHaveLength(1);expect(await readCommunityPublicationAttempt(id,scope)).not.toBeNull();
});
it.each([['unpublish','active','draft'],['archive','active','archived'],['archive','draft','archived']])('preserves the supported %s transition from %s',async(action,from,to)=>{
 row={...initial,status:from};writeResult={data:{...row,status:to},error:null};await changeCommunityPublication(publicationAttempt(row,action as any),scope);expect(mockCalls).toHaveBeenCalledWith('update',{status:to});
});
it('changes discovery without changing page status or joining rules',async()=>{
 writeResult={data:{...initial,discoverable:true},error:null};await changeCommunityPublication(publicationAttempt(initial,'show'),scope);expect(mockCalls).toHaveBeenCalledWith('rpc','set_community_discoverable',{p_community_id:id,p_expected_status:'draft',p_expected_discoverable:false,p_discoverable:true});expect(mockCalls.mock.calls.some(c=>c[0]==='update')).toBe(false);
 expect(()=>publicationAttempt({...initial,status:'archived'},'show')).toThrow();
});

it('does not mistake a readable discovery column for a deployed setter',async()=>{mockRequest.mockImplementation(async table=>({data:table==='community_members'?member:table==='communities'?row:null,error:table==='get_community_visibility_options'?{code:'PGRST202',message:'Could not find get_community_visibility_options'}:null}));expect(await readCommunityDiscoveryAvailable(id,scope)).toBe(false);await expect(changeCommunityPublication(publicationAttempt(initial,'show'),scope)).rejects.toThrow('aren’t available');expect(mockCalls.mock.calls.some(c=>c[0]==='update'||c[1]==='set_community_discoverable')).toBe(false);});
it('keeps denied and malformed capability results as errors',async()=>{for(const response of [{data:null,error:{code:'42501',message:'denied'}},{data:{version:1,community_id:user,can_change_discovery:true},error:null},{data:{version:99,community_id:id,can_change_discovery:true},error:null}]){mockRequest.mockResolvedValue(response);await expect(readCommunityDiscoveryAvailable(id,scope)).rejects.toBeDefined();}});
