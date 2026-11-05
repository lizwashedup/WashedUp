import AsyncStorage from '@react-native-async-storage/async-storage';
import { changeCommunityJoiningMethod, checkCommunityJoiningSave, JoiningSettingsOutcomeUnknown,
  readCommunityJoiningAttempt, readCommunityJoiningMethod, readCommunityOpenJoining, saveCommunityJoiningDetails } from '../communityJoiningSettings';
const mockSession=jest.fn(), mockRequest=jest.fn(), mockCall=jest.fn(),mockOptions=jest.fn();
jest.mock('../supabase',()=>({supabase:{auth:{getSession:()=>mockSession()},
  from:(table:string)=>{mockCall('from',table);return mockChain();},
  rpc:(name:string,args:unknown)=>{mockCall('rpc',name,args);return name==='get_community_joining_options' ? mockChain(mockOptions) : mockChain();},
}}));
function mockChain(request=mockRequest){const result:any={then:(...args:any[])=>request().then(...args)};for(const method of ['update','select','eq','single','maybeSingle','setHeader','abortSignal'])result[method]=(...args:any[])=>{mockCall(method,...args);return result;};return result;}
const community='00000000-0000-4000-8000-000000000001',user='00000000-0000-4000-8000-000000000002';
let live=true;
const scope={userId:user,isCurrent:()=>live};
const details={settings:{join_welcome_message:' Hello ',join_intro_question:' Tell us ',guidelines_url:''},questions:{askReason:true,askSource:false,askRulesConfirm:false,openQuestion:' One more '}};
const saved={id:community,join_welcome_message:'Hello',join_intro_question:'Tell us',guidelines_url:null,join_ask_reason:true,join_ask_source:false,join_ask_rules_confirm:false,join_open_question:'One more'};
const deferred=()=>{let resolve!:(value:any)=>void;const promise=new Promise(yes=>{resolve=yes;});return{promise,resolve};};
beforeEach(async()=>{await AsyncStorage.clear();jest.clearAllMocks();live=true;mockOptions.mockResolvedValue({data:null,error:{code:'PGRST202',message:'Could not find get_community_joining_options'}});mockSession.mockResolvedValue({data:{session:{user:{id:user},access_token:'fixture-token'}},error:null});mockRequest.mockResolvedValue({data:saved,error:null});});
afterEach(()=>jest.useRealTimers());
it('saves the welcome and loaded optional questions in one exact community update',async()=>{await saveCommunityJoiningDetails(community,details,scope);const {id,...patch}=saved;expect(mockCall.mock.calls.filter(c=>c[0]==='update')).toEqual([['update',patch]]);expect(mockCall).toHaveBeenCalledWith('eq','id',community);expect(mockCall).toHaveBeenCalledWith('setHeader','Authorization','Bearer fixture-token');});
it('omits optional columns completely when they were not loaded',async()=>{mockRequest.mockResolvedValue({data:{id:community,join_welcome_message:'Hello',join_intro_question:'Tell us',guidelines_url:null},error:null});await saveCommunityJoiningDetails(community,{...details,questions:null},scope);expect(mockCall.mock.calls.find(c=>c[0]==='update')?.[1]).toEqual({join_welcome_message:'Hello',join_intro_question:'Tell us',guidelines_url:null});});
it('rejects invalid text before dispatch',async()=>{await expect(saveCommunityJoiningDetails(community,{...details,settings:{...details.settings,guidelines_url:'javascript:alert(1)'}},scope)).rejects.toThrow('link');expect(mockRequest).not.toHaveBeenCalled();});
it('surfaces an explicit database rejection without pretending any fields saved',async()=>{mockRequest.mockResolvedValue({data:null,error:{code:'42501',message:'denied'}});await expect(saveCommunityJoiningDetails(community,details,scope)).rejects.toMatchObject({code:'42501'});expect(mockCall.mock.calls.filter(c=>c[0]==='update')).toHaveLength(1);});
it.each([null,{...saved,id:user},{...saved,join_ask_reason:false}])('treats a missing or mismatched receipt as unknown',async data=>{mockRequest.mockResolvedValue({data,error:null});await expect(saveCommunityJoiningDetails(community,details,scope)).rejects.toBeInstanceOf(JoiningSettingsOutcomeUnknown);});
it('transport failure and deadline are unknown, with no automatic second write',async()=>{mockRequest.mockRejectedValueOnce(Error('offline'));await expect(saveCommunityJoiningDetails(community,details,scope)).rejects.toBeInstanceOf(JoiningSettingsOutcomeUnknown);jest.useFakeTimers();mockRequest.mockReturnValueOnce(new Promise(()=>{}));const result=saveCommunityJoiningDetails(community,details,scope);const check=expect(result).rejects.toBeInstanceOf(JoiningSettingsOutcomeUnknown);await jest.advanceTimersByTimeAsync(12_001);await check;expect(mockCall.mock.calls.filter(c=>c[0]==='update')).toHaveLength(2);});
it('pins account ownership and retires before dispatch if the account or visit changes',async()=>{mockSession.mockResolvedValueOnce({data:{session:{user:{id:'other'},access_token:'other-token'}},error:null});await expect(saveCommunityJoiningDetails(community,details,scope)).rejects.toThrow();expect(mockCall).not.toHaveBeenCalled();const response=deferred();mockSession.mockReturnValueOnce(response.promise);const write=saveCommunityJoiningDetails(community,details,scope);live=false;response.resolve({data:{session:{user:{id:user},access_token:'fixture-token'}},error:null});await expect(write).rejects.toThrow();expect(mockCall).not.toHaveBeenCalled();});
it('uses the existing method RPC and confirms the resulting method separately',async()=>{mockRequest.mockResolvedValueOnce({data:null,error:null}).mockResolvedValueOnce({data:{id:community,join_policy:'approval_required'},error:null});await changeCommunityJoiningMethod(community,'approval_required',scope);expect(mockCall).toHaveBeenCalledWith('rpc','set_community_join_policy',{p_community_id:community,p_join_policy:'approval_required'});expect(mockCall.mock.calls.filter(c=>c[0]==='update')).toHaveLength(0);});
it('does not claim a method change if the saved method cannot be confirmed',async()=>{mockRequest.mockResolvedValueOnce({data:null,error:null}).mockResolvedValueOnce({data:{id:community,join_policy:'open'},error:null}).mockResolvedValueOnce({data:{page_id:community,page_kind:'community'},error:null});await expect(changeCommunityJoiningMethod(community,'approval_required',scope)).rejects.toBeInstanceOf(JoiningSettingsOutcomeUnknown);});
it('method read failure is distinct from an absent legacy column',async()=>{mockRequest.mockResolvedValueOnce({data:null,error:{code:'42703'}});expect(await readCommunityJoiningMethod(community,scope)).toBeNull();mockRequest.mockResolvedValueOnce({data:null,error:Error('offline')});await expect(readCommunityJoiningMethod(community,scope)).rejects.toThrow('offline');});
it('reconciliation reads exact values without a mutation',async()=>{expect(await checkCommunityJoiningSave(community,{kind:'details',details},scope)).toBe(true);mockRequest.mockResolvedValueOnce({data:{...saved,join_open_question:'Different'},error:null});expect(await checkCommunityJoiningSave(community,{kind:'details',details},scope)).toBe(false);expect(mockCall.mock.calls.some(c=>c[0]==='update'||c[0]==='rpc')).toBe(false);});
it('distinguishes supported Open joining from legacy review and failed availability reads',async()=>{mockRequest.mockResolvedValueOnce({data:{page_id:community,page_kind:'community'},error:null});expect(await readCommunityOpenJoining(community,scope)).toBe(true);mockRequest.mockResolvedValueOnce({data:null,error:null});expect(await readCommunityOpenJoining(community,scope)).toBe(false);mockRequest.mockResolvedValueOnce({data:null,error:Error('denied')});await expect(readCommunityOpenJoining(community,scope)).rejects.toThrow('denied');});
it('reads effective legacy review, even when its stored policy says Open',async()=>{
 mockRequest.mockResolvedValueOnce({data:{id:community,join_policy:'open'},error:null}).mockResolvedValueOnce({data:null,error:null});
 expect(await readCommunityJoiningMethod(community,scope)).toBe('approval_required');
});
it('uses the verified server capability after the upgrade, without trusting a raw legacy flag',async()=>{
 mockOptions.mockResolvedValue({data:{version:1,community_id:community,method:'approval_required'},error:null});
 expect(await readCommunityJoiningMethod(community,scope)).toBe('approval_required');expect(await readCommunityOpenJoining(community,scope)).toBe(true);
 expect(mockCall.mock.calls.some(c=>c[0]==='from')).toBe(false);
});
it('does not fall back on denied, malformed or mismatched capability results',async()=>{
 for(const response of [{data:null,error:{code:'42501',message:'denied'}},{data:{version:1,community_id:user,method:'open'},error:null},{data:{version:99,community_id:community,method:'open'},error:null}]){
 mockOptions.mockResolvedValue(response);await expect(readCommunityJoiningMethod(community,scope)).rejects.toBeDefined();
 }expect(mockCall.mock.calls.some(c=>c[0]==='from')).toBe(false);
});
it('restores an uncertain attempt across a later visit and clears it only after matching saved values',async()=>{
 mockRequest.mockRejectedValueOnce(Error('lost response'));await expect(saveCommunityJoiningDetails(community,details,scope)).rejects.toThrow();
 const nextScope={userId:user,isCurrent:()=>true};expect(await readCommunityJoiningAttempt(community,nextScope)).toEqual({kind:'details',details});
 expect(await checkCommunityJoiningSave(community,{kind:'details',details},nextScope)).toBe(true);expect(await readCommunityJoiningAttempt(community,nextScope)).toBeNull();
});
it('keeps the original attempt when later edits or another account try to replace it',async()=>{
 mockRequest.mockRejectedValueOnce(Error('offline'));await expect(saveCommunityJoiningDetails(community,details,scope)).rejects.toThrow();
 await expect(saveCommunityJoiningDetails(community,{...details,settings:{...details.settings,join_welcome_message:'Changed'}},scope)).rejects.toBeInstanceOf(JoiningSettingsOutcomeUnknown);
 expect(mockCall.mock.calls.filter(c=>c[0]==='update')).toHaveLength(1);
 expect(await readCommunityJoiningAttempt(community,{...scope,userId:'other'})).toBeNull();
 await expect(checkCommunityJoiningSave(community,{kind:'method',method:'open'},scope)).rejects.toThrow('original');
 expect(await readCommunityJoiningAttempt(community,scope)).not.toBeNull();
});
it('does not dispatch when durable storage fails',async()=>{
 jest.spyOn(AsyncStorage,'setItem').mockRejectedValueOnce(Error('disk full'));
 await expect(saveCommunityJoiningDetails(community,details,scope)).rejects.toThrow('disk full');expect(mockRequest).not.toHaveBeenCalled();
});
it('retries only the exact saved values on explicit request, without a second optimistic draft',async()=>{
 mockRequest.mockRejectedValueOnce(Error('offline'));await expect(saveCommunityJoiningDetails(community,details,scope)).rejects.toThrow();
 await saveCommunityJoiningDetails(community,details,scope);
 expect(mockCall.mock.calls.filter(c=>c[0]==='update')).toHaveLength(2);expect(await readCommunityJoiningAttempt(community,scope)).toBeNull();
});
