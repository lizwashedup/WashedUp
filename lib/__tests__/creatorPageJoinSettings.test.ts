import AsyncStorage from '@react-native-async-storage/async-storage';
const mockUser=jest.fn(),mockRpc=jest.fn();
jest.mock('../supabase',()=>({supabase:{auth:{getUser:()=>mockUser()},rpc:(...args:unknown[])=>mockRpc(...args)}}));
import {normalizePageJoinSettings,readPageJoinDraft,persistPageJoinDraft,readPageJoinSettings,savePageJoinDraft,loadPageJoinEditor,resolvePageJoinSave,type PageJoinState,type PageJoinDraft} from '../creatorPageJoinSettings';
const page='11111111-1111-4111-8111-111111111111',user='22222222-2222-4222-8222-222222222222';
const scope={userId:user,isCurrent:()=>true};
const settings={join_policy:'open' as const,join_welcome_message:null,join_intro_question:null,guidelines_url:null,join_ask_reason:false,join_ask_source:false,join_ask_rules_confirm:false,join_open_question:null};
const initial:PageJoinState={page_id:page,owner_id:user,name:'Sunday Table',published:false,audience:'everyone',version:0,pending_count:0,settings};
const draft=(pending=false):PageJoinDraft=>({pageId:page,userId:user,baseVersion:0,settings:{...settings,join_welcome_message:'Welcome'},pending});
let state:PageJoinState;
beforeEach(async()=>{jest.clearAllMocks();await AsyncStorage.clear();state={...initial};mockUser.mockResolvedValue({data:{user:{id:user}},error:null});mockRpc.mockImplementation(async(name,args)=>{if(name==='save_creator_page_join_settings')state={...state,version:state.version+1,settings:args.p_settings};return{data:state,error:null};});});
it('normalizes the inherited fields and rejects invalid values before dispatch',()=>{
 expect(normalizePageJoinSettings({...settings,join_welcome_message:' Hello ',join_open_question:' '})).toEqual({...settings,join_welcome_message:'Hello'});
 for(const value of [{...settings,join_policy:'invite_only'},{...settings,join_ask_reason:'true'},{...settings,join_open_question:'x'.repeat(201)},{...settings,guidelines_url:'javascript:bad'},{...settings,other:true}])expect(()=>normalizePageJoinSettings(value as never)).toThrow();
});
it('prepares a private default without making a settings mutation',async()=>{const loaded=await loadPageJoinEditor(page,scope);expect(loaded.draft.settings).toEqual(settings);expect(loaded.draft.pending).toBe(false);expect(mockRpc.mock.calls.map(c=>c[0])).toEqual(['get_creator_page_join_settings']);});
it('serializes rapid local edits and retains the newest draft',async()=>{
 const a=draft(),b={...a,settings:{...a.settings,join_welcome_message:'Newest'}};
 await Promise.all([persistPageJoinDraft(a,scope),persistPageJoinDraft(b,scope)]);expect((await readPageJoinDraft(page,scope))?.settings.join_welcome_message).toBe('Newest');expect(mockRpc).not.toHaveBeenCalled();
});
it('does not dispatch when durable preparation fails',async()=>{jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('Storage full'));await expect(savePageJoinDraft(draft(),scope)).rejects.toThrow('Storage full');expect(mockRpc).not.toHaveBeenCalled();});
it('persists the pending version and exact settings before issuing the RPC',async()=>{
 mockRpc.mockImplementation(async(name,args)=>{expect(name).toBe('save_creator_page_join_settings');const saved=await readPageJoinDraft(page,scope);expect(saved?.pending).toBe(true);expect(saved?.baseVersion).toBe(args.p_expected_version);expect(saved?.settings).toEqual(args.p_settings);return{data:{...initial,version:1,settings:args.p_settings},error:null};});
 const result=await savePageJoinDraft(draft(),scope);expect(result.pending).toBe(false);expect(result.baseVersion).toBe(1);expect(await readPageJoinDraft(page,scope)).toEqual(result);
});
it('a lost successful response stays pending and checking resolves current matching state without resending',async()=>{
 mockRpc.mockImplementationOnce(async(_name,args)=>{state={...state,version:1,settings:args.p_settings};throw Error('Response lost');});
 await expect(savePageJoinDraft(draft(),scope)).rejects.toThrow('Response lost');expect((await readPageJoinDraft(page,scope))?.pending).toBe(true);
 const checked=await resolvePageJoinSave(page,scope);expect(checked.baseVersion).toBe(1);expect(checked.pending).toBe(false);expect(mockRpc.mock.calls.filter(c=>c[0]==='save_creator_page_join_settings')).toHaveLength(1);
});
it('does not replace an unresolved pending save with another intent',async()=>{await persistPageJoinDraft(draft(true),scope);await expect(savePageJoinDraft({...draft(),settings},scope)).rejects.toThrow('original saved attempt');expect(mockRpc).not.toHaveBeenCalled();});
it('retains the draft after a conflicting newer saved version',async()=>{
 await persistPageJoinDraft(draft(true),scope);state={...state,version:2};const loaded=await loadPageJoinEditor(page,scope);expect(loaded.conflict).toBe(true);expect(loaded.draft).toEqual(draft(true));await expect(resolvePageJoinSave(page,scope)).rejects.toThrow('draft is still saved');expect((await readPageJoinDraft(page,scope))?.pending).toBe(true);
});
it('does not invent confirmation for an unchanged version-zero default',async()=>{await persistPageJoinDraft({...draft(true),settings},scope);expect((await loadPageJoinEditor(page,scope)).confirmed).toBe(false);await expect(resolvePageJoinSave(page,scope)).rejects.toThrow('unconfirmed');});
it('rejects a mismatched receipt and keeps the original attempt',async()=>{mockRpc.mockResolvedValueOnce({data:{...initial,version:1,page_id:user,settings:draft().settings},error:null});await expect(savePageJoinDraft(draft(),scope)).rejects.toThrow('confirmed');expect((await readPageJoinDraft(page,scope))?.pending).toBe(true);});
it('blocks a changed account and never reads another account’s local draft',async()=>{await persistPageJoinDraft(draft(),scope);expect(await readPageJoinDraft(page,{userId:page,isCurrent:()=>true})).toBeNull();mockUser.mockResolvedValueOnce({data:{user:{id:page}},error:null});await expect(savePageJoinDraft(draft(),scope)).rejects.toThrow();expect(mockRpc).not.toHaveBeenCalled();});
it('does not apply a late receipt after the initiating visit retires',async()=>{let live=true;const owned={userId:user,isCurrent:()=>live};mockRpc.mockImplementationOnce(async(_n,args)=>{live=false;return{data:{...initial,version:1,settings:args.p_settings},error:null};});await expect(savePageJoinDraft(draft(),owned)).rejects.toThrow();expect((await readPageJoinDraft(page,scope))?.pending).toBe(true);});
it('does not treat an unavailable or wrong-owner state as empty settings',async()=>{mockRpc.mockResolvedValueOnce({data:null,error:new Error('Denied')});await expect(readPageJoinSettings(page,scope)).rejects.toThrow('Denied');mockRpc.mockResolvedValueOnce({data:{...initial,owner_id:page},error:null});await expect(readPageJoinSettings(page,scope)).rejects.toThrow('confirmed');});
it('corrupt recovery data does not disappear into defaults',async()=>{await AsyncStorage.setItem(`creator-page-join-settings:v1:${user}:${page}`,'broken');await expect(loadPageJoinEditor(page,scope)).rejects.toThrow('saved joining draft');expect(mockRpc.mock.calls.every(c=>c[0]==='get_creator_page_join_settings')).toBe(true);});

it('bounds an unanswered authorization check without preparing or sending a save',async()=>{
 jest.useFakeTimers();try{mockUser.mockReturnValueOnce(new Promise(()=>{}));const result=savePageJoinDraft(draft(),scope);const failed=expect(result).rejects.toThrow('too long');await jest.advanceTimersByTimeAsync(12000);await failed;expect(mockRpc).not.toHaveBeenCalled();expect(await readPageJoinDraft(page,scope)).toBeNull();}finally{jest.useRealTimers();}
});
it('times out a dispatched save but retains exact recovery intent and ignores its late receipt',async()=>{
 jest.useFakeTimers();try{let resolve!:(v:any)=>void;mockRpc.mockImplementationOnce((_n,args)=>{state={...initial,version:1,settings:args.p_settings};return new Promise(r=>{resolve=r;});});const result=savePageJoinDraft(draft(),scope);const failed=expect(result).rejects.toThrow('too long');await jest.advanceTimersByTimeAsync(25000);await failed;expect(await readPageJoinDraft(page,scope)).toEqual(draft(true));const checked=await resolvePageJoinSave(page,scope);expect(checked.baseVersion).toBe(1);expect(checked.pending).toBe(false);resolve({data:{...state,version:99},error:null});await Promise.resolve();expect(await readPageJoinDraft(page,scope)).toEqual(checked);expect(mockRpc.mock.calls.filter(c=>c[0]==='save_creator_page_join_settings')).toHaveLength(1);}finally{jest.useRealTimers();}
});
it('bounds remote read failures while keeping physical storage writes serialized',async()=>{
 jest.useFakeTimers();try{mockRpc.mockReturnValueOnce(new Promise(()=>{}));const read=readPageJoinSettings(page,scope);const failed=expect(read).rejects.toThrow('too long');await jest.advanceTimersByTimeAsync(12000);await failed;
 const original=jest.mocked(AsyncStorage.setItem).getMockImplementation()!;let finish!:()=>void;const a=draft(),b={...a,settings:{...a.settings,join_welcome_message:'Latest'}};
 jest.mocked(AsyncStorage.setItem).mockImplementationOnce((key,value)=>new Promise<void>(resolve=>{finish=()=>{Promise.resolve(original(key,value)).then(()=>resolve());};}));
 const first=persistPageJoinDraft(a,scope),second=persistPageJoinDraft(b,scope);await jest.advanceTimersByTimeAsync(30000);expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1);finish();await Promise.all([first,second]);expect(await readPageJoinDraft(page,scope)).toEqual(b);
 }finally{jest.useRealTimers();}
});
